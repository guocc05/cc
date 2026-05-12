/**
 * @input:    飞书 App 凭证, REST API (im.message.list, im.chat.list)
 * @output:   FeishuAdapter (TransportAdapter) — 飞书 REST 轮询（per-chat 自适应退避）、消息收发、资源下载
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import dns from 'node:dns/promises'
import * as lark from '@larksuiteoapi/node-sdk'
import axios from 'axios'
import type { Im2ccConfig } from './config.js'
import type { TransportAdapter, IncomingMessage, OutgoingMessage } from './transport.js'
import { getCursor, setCursor, initCursorIfMissing } from './poll-cursor.js'
import { log, error } from './logger.js'
import { buildFeishuMessage } from './message-format.js'

// --- Bot 群列表缓存 ---

interface BotChat { chatId: string }

const FEISHU_REQUEST_TIMEOUT_MS = 15_000
type FeishuDomainTarget = 'feishu' | 'lark'

// --- per-chat 自适应退避（消除空轮询）@20260511-feishu-poll-adaptive-backoff ---

export interface ChatPollState {
  /** 最近真有新消息进来的时刻 ms（或首次发现该群的时刻） */
  lastActiveAt: number
  /** 下次允许 fetch 的时刻 ms；now < nextFireAt 时本轮跳过该群 */
  nextFireAt: number
  /**
   * 上次 fetch 到的最大 create_time（毫秒，飞书原生精度）。
   * 用于区分"真新消息"vs"cursor 秒级精度边界导致的重复拉取"——
   * cursor 持久化时被截到秒，但 create_time 是毫秒。
   * `start_time` 是闭区间，所以同一秒的消息可能反复出现在 items 中。
   * 仅当本轮某 item 的 create_time > lastMaxCreateTime 时，视为"真活跃"。
   */
  lastMaxCreateTime: number
}

/**
 * 按"距上次活跃多久"切档的轮询间隔梯度。
 * 7 群放大场景下，闲群退避到 120s 可把月调用量从 ~48 万降到 ~1-2 万。
 */
export const BACKOFF_TIERS = [
  { idleBelowMs: 5 * 60_000,      intervalMs: 5_000 },   // < 5min: 5s
  { idleBelowMs: 30 * 60_000,     intervalMs: 30_000 },  // 5-30min: 30s
  { idleBelowMs: 2 * 3600_000,    intervalMs: 60_000 },  // 30min-2h: 60s
  { idleBelowMs: Number.POSITIVE_INFINITY, intervalMs: 120_000 }, // 2h+: 120s
] as const

export function computeNextDelayMs(idleMs: number): number {
  for (const tier of BACKOFF_TIERS) {
    if (idleMs < tier.idleBelowMs) return tier.intervalMs
  }
  return BACKOFF_TIERS[BACKOFF_TIERS.length - 1].intervalMs
}

export class FeishuAdapter implements TransportAdapter {
  readonly type = 'feishu' as const
  private client: lark.Client
  private domainTarget: FeishuDomainTarget = 'feishu'
  private cachedChats: BotChat[] = []
  private chatsCachedAt = 0
  private readonly CHAT_CACHE_TTL = 5 * 60 * 1000
  /** per-chat 自适应退避状态（in-memory，daemon 重启清零，重启后所有 chat 当作新发现，立即拉一轮 catch-up） */
  private chatPollState = new Map<string, ChatPollState>()
  // lark 域回切：低频后台 probe + 连续成功才切回，避免 DNS 间歇性故障下抖动
  private feishuRecoveryTimer: NodeJS.Timeout | null = null
  private feishuConsecutiveOk = 0
  private readonly FEISHU_RECOVERY_INTERVAL_MS = 5 * 60 * 1000
  private readonly FEISHU_RECOVERY_NEED_OK = 3

  constructor(private config: Im2ccConfig) {
    const { appId, appSecret } = config.feishu
    if (!appId || !appSecret) {
      throw new Error('飞书 App ID 或 App Secret 未配置。请运行 im2cc setup')
    }
    this.client = this.createClient()
  }

  async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    // 验证凭证
    try {
      const resp = await this.runRequest('获取 Bot 信息', () =>
        this.client.request({ method: 'GET', url: '/open-apis/bot/v3/info/' }))
      const botData = resp?.data as Record<string, unknown> | undefined
      const botInfo = botData?.bot as Record<string, string> | undefined
      log(`飞书 Bot 已连接: ${botInfo?.app_name ?? 'unknown'} (${botInfo?.open_id ?? ''})`)
    } catch (err) {
      error(`获取 Bot 信息失败: ${err}`)
    }

    const pollIntervalMs = this.config.pollIntervalMs

    let pollCount = 0
    const pollLoop = (): void => {
      pollCount++
      const n = pollCount
      log(`[feishu] poll #${n} 开始`)
      this.pollOnce(onMessage)
        .then(() => log(`[feishu] poll #${n} 完成`))
        .catch(err => error(`[feishu] poll #${n} 错误: ${err}`))
        .finally(() => {
          log(`[feishu] poll #${n} finally, 调度下一次`)
          setTimeout(pollLoop, pollIntervalMs)
        })
    }

    log(`[feishu] 启动 REST 轮询 (tick ${pollIntervalMs}ms, per-chat 自适应退避 5/30/60/120s)`)
    setTimeout(pollLoop, pollIntervalMs)
  }

  /**
   * 单次轮询：按 per-chat 自适应退避策略，只 fetch 到期的 chat。
   *
   * 状态机：
   * - 新发现的 chat：lastActiveAt=now, nextFireAt=now → 立即拉一轮 catch-up
   * - fetch 拿到消息：lastActiveAt 重置为 now（回到 5s 档）
   * - fetch 无消息：lastActiveAt 不动，按 idleMs 切档退避
   * - fetch 失败：按当前 idleMs 推进 nextFireAt（避免连击失败群）
   *
   * 抽为类方法是为了让单测能通过 monkey-patch refreshBotGroups + fetchGroupMessages 直接驱动。
   */
  async pollOnce(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    try {
      const chats = await this.refreshBotGroups()
      const now = Date.now()

      // 同步 chatPollState 与当前 chat 列表
      const seen = new Set<string>()
      for (const chat of chats) {
        seen.add(chat.chatId)
        if (!this.chatPollState.has(chat.chatId)) {
          // 新发现：立即拉一轮 catch-up（覆盖 daemon 启动 / 加入新群 两种场景）
          this.chatPollState.set(chat.chatId, { lastActiveAt: now, nextFireAt: now, lastMaxCreateTime: 0 })
        }
      }
      for (const id of this.chatPollState.keys()) {
        if (!seen.has(id)) this.chatPollState.delete(id)
      }

      let fetched = 0
      let skipped = 0
      for (const chat of chats) {
        const state = this.chatPollState.get(chat.chatId)!
        if (Date.now() < state.nextFireAt) { skipped++; continue }
        fetched++

        try {
          const items = await this.fetchGroupMessages(chat.chatId)
          const fetchedAt = Date.now()

          // 算本轮最大 create_time（毫秒，飞书原生精度）
          let maxCreateTime = 0
          for (const item of items) {
            const ct = parseInt((item.create_time as string) ?? '0', 10)
            if (ct > maxCreateTime) maxCreateTime = ct
          }

          // 关键：用毫秒精度比较"真新消息"vs"cursor 秒级边界重复"。
          // cursor 持久化是秒级（不做 +1，靠 isDuplicate 去重），所以同一秒内的
          // 消息会反复出现在 items 中——不能仅凭 items.length>0 就判定"群活跃"，
          // 否则 idle 永远是 0，退避档进不去（@20260511 已踩过的坑）。
          const hasNewActivity = maxCreateTime > state.lastMaxCreateTime
          if (hasNewActivity) {
            state.lastActiveAt = fetchedAt
            state.lastMaxCreateTime = maxCreateTime
          }
          state.nextFireAt = fetchedAt + computeNextDelayMs(fetchedAt - state.lastActiveAt)

          if (items.length === 0) continue

          // 处理消息（onMessage 内部用 isDuplicate 去重，重复拉到的消息不会被重复处理）
          for (const item of items) {
            const msg = this.parseRestMessage(item)
            if (msg) {
              try { await onMessage(msg) } catch (err) {
                error(`[poll] 处理消息出错 [${chat.chatId}]: ${err}`)
              }
            }
          }

          if (maxCreateTime > 0) {
            // 不做 +1，避免跳过同一秒内的后续消息。isDuplicate 负责去重。
            setCursor(chat.chatId, Math.floor(maxCreateTime / 1000).toString())
          }
        } catch (err) {
          error(`[poll] 拉取群 ${chat.chatId} 消息失败: ${err}`)
          // 失败时也按当前 idleMs 推进 nextFireAt，避免下一 tick 立即重连失败群
          const failedAt = Date.now()
          state.nextFireAt = failedAt + computeNextDelayMs(failedAt - state.lastActiveAt)
        }
      }
      log(`[feishu] poll 统计: fetched=${fetched} skipped=${skipped} total=${chats.length}`)
    } catch (err) {
      error(`[poll] 轮询失败: ${err}`)
    }
  }

  /** 给消息添加表情回应（确认收到） */
  async addReaction(messageId: string, emojiType: string = 'OnIt'): Promise<void> {
    try {
      await this.runRequest(`添加消息表情 ${messageId}`, () =>
        this.client.im.messageReaction.create({
          path: { message_id: messageId },
          data: { reaction_type: { emoji_type: emojiType } },
        }))
    } catch {
      // 非关键功能，失败不影响主流程
    }
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    return this.sendMessage(conversationId, { kind: 'text', text })
  }

  async sendMessage(conversationId: string, message: OutgoingMessage): Promise<void> {
    const payload = buildFeishuMessage(message)
    try {
      await this.runRequest(`发送消息到 ${conversationId}`, () =>
        this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: conversationId,
            msg_type: payload.msgType,
            content: payload.content,
          },
        }))
    } catch (err) {
      error(`发送飞书消息失败 [${conversationId}]: ${err}`)
      throw err
    }
  }

  async downloadMedia(
    messageId: string,
    fileKey: string,
    msgType: string,
    destPath: string,
  ): Promise<void> {
    const tmpPath = destPath + '.tmp.' + process.pid
    try {
      const resp = await this.runRequest(`下载消息资源 ${messageId}`, () =>
        this.client.im.messageResource.get({
          path: { message_id: messageId, file_key: fileKey },
          params: { type: msgType as 'image' | 'file' },
        }))

      if (resp && typeof (resp as Record<string, unknown>).writeFile === 'function') {
        await (resp as unknown as { writeFile(p: string): Promise<void> }).writeFile(tmpPath)
      } else {
        const data = resp as unknown as Buffer
        fs.writeFileSync(tmpPath, data)
      }
      fs.chmodSync(tmpPath, 0o600)
      fs.renameSync(tmpPath, destPath)
    } catch (err) {
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      throw err
    }
  }

  // --- 内部方法 ---

  private createClient(): lark.Client {
    const httpInstance = axios.create({ timeout: FEISHU_REQUEST_TIMEOUT_MS })

    httpInstance.interceptors.request.use((req) => {
      if (req.headers) req.headers['User-Agent'] = 'oapi-node-sdk/1.0.0'
      return req
    }, undefined, { synchronous: true })

    httpInstance.interceptors.response.use((resp) => {
      const requestConfig = resp.config as unknown as { $return_headers?: boolean }
      if (requestConfig.$return_headers) {
        return { data: resp.data, headers: resp.headers }
      }
      return resp.data
    })

    return new lark.Client({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: this.domainTarget === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
      httpInstance,
    })
  }

  private isTimeoutError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const candidate = err as { code?: string, message?: string }
    return candidate.code === 'ECONNABORTED'
      || candidate.message?.includes(`timeout of ${FEISHU_REQUEST_TIMEOUT_MS}ms exceeded`) === true
  }

  private isFeishuDnsError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const candidate = err as { code?: string, message?: string }
    return candidate.code === 'ENOTFOUND'
      || candidate.message?.includes('ENOTFOUND open.feishu.cn') === true
  }

  private async runRequest<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (this.isTimeoutError(err)) {
        error(`[feishu] ${label} 超时 (${FEISHU_REQUEST_TIMEOUT_MS}ms)，重建客户端`)
        this.client = this.createClient()
      } else if (this.domainTarget === 'feishu' && this.isFeishuDnsError(err)) {
        error(`[feishu] ${label} 解析 open.feishu.cn 失败，切换到 open.larksuite.com 重试`)
        this.domainTarget = 'lark'
        this.client = this.createClient()
        // 切到 lark 后启动后台 probe，DNS 恢复后能自动切回 feishu
        this.startFeishuRecoveryProbe()
        // 重试在 catch 块内：失败不在外层 try 保护范围，必须独立兜底以记录上下文
        try {
          return await fn()
        } catch (retryErr) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
          error(`[feishu] ${label} DNS 降级重试也失败 (lark 域): ${msg}`)
          throw retryErr
        }
      }
      throw err
    }
  }

  /**
   * 启动 lark 域恢复探测（幂等）。每 5 分钟 DNS probe 一次 open.feishu.cn，
   * 连续 3 次成功才切回 feishu 域，避免间歇性 DNS 故障导致频繁抖动。
   */
  private startFeishuRecoveryProbe(): void {
    if (this.feishuRecoveryTimer) return
    this.feishuRecoveryTimer = setInterval(async () => {
      if (this.domainTarget === 'feishu') {
        // 已经切回，停止 probe
        if (this.feishuRecoveryTimer) {
          clearInterval(this.feishuRecoveryTimer)
          this.feishuRecoveryTimer = null
        }
        this.feishuConsecutiveOk = 0
        return
      }
      try {
        await dns.resolve('open.feishu.cn')
        this.feishuConsecutiveOk++
        if (this.feishuConsecutiveOk >= this.FEISHU_RECOVERY_NEED_OK) {
          log(`[feishu] open.feishu.cn 已稳定恢复（连续 ${this.feishuConsecutiveOk} 次 DNS 成功），切回 feishu 域`)
          this.domainTarget = 'feishu'
          this.client = this.createClient()
          this.feishuConsecutiveOk = 0
          if (this.feishuRecoveryTimer) {
            clearInterval(this.feishuRecoveryTimer)
            this.feishuRecoveryTimer = null
          }
        }
      } catch {
        this.feishuConsecutiveOk = 0  // 任何一次失败重置计数
      }
    }, this.FEISHU_RECOVERY_INTERVAL_MS)
    this.feishuRecoveryTimer.unref()
  }

  private async refreshBotGroups(): Promise<BotChat[]> {
    if (Date.now() - this.chatsCachedAt < this.CHAT_CACHE_TTL && this.cachedChats.length > 0) {
      return this.cachedChats
    }

    const chats: BotChat[] = []
    let pageToken: string | undefined

    do {
      const resp = await this.runRequest('拉取群列表', () =>
        this.client.im.chat.list({
          params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
        }))
      for (const item of resp?.data?.items ?? []) {
        if (item.chat_id) chats.push({ chatId: item.chat_id })
      }
      pageToken = resp?.data?.has_more ? resp?.data?.page_token : undefined
    } while (pageToken)

    this.cachedChats = chats
    this.chatsCachedAt = Date.now()
    log(`[feishu] 刷新群列表: ${chats.length} 个会话`)
    return chats
  }

  private async fetchGroupMessages(chatId: string): Promise<Array<Record<string, unknown>>> {
    const cursor = initCursorIfMissing(chatId)
    const items: Array<Record<string, unknown>> = []
    let pageToken: string | undefined

    do {
      const resp = await this.runRequest(`拉取群 ${chatId} 消息`, () =>
        this.client.im.message.list({
          params: {
            container_id_type: 'chat',
            container_id: chatId,
            start_time: cursor,
            sort_type: 'ByCreateTimeAsc',
            page_size: 50,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        }))
      for (const item of resp?.data?.items ?? []) {
        items.push(item as Record<string, unknown>)
      }
      pageToken = resp?.data?.has_more ? resp?.data?.page_token : undefined
    } while (pageToken)

    return items
  }

  /** REST 消息格式 → 统一 IncomingMessage */
  private parseRestMessage(item: Record<string, unknown>): IncomingMessage | null {
    const sender = item.sender as Record<string, unknown> | undefined
    const body = item.body as Record<string, string> | undefined
    const messageId = (item.message_id as string) ?? ''
    const chatId = (item.chat_id as string) ?? ''
    const msgType = (item.msg_type as string) ?? ''
    const senderId = (sender?.id as string) ?? ''
    const senderType = (sender?.sender_type as string) ?? ''

    if (senderType === 'app') return null

    const base = { messageId, conversationId: chatId, transport: 'feishu' as const, senderId }

    if (msgType === 'text') {
      let text = ''
      try {
        const content = JSON.parse(body?.content ?? '{}') as Record<string, string>
        text = content.text ?? ''
      } catch { return null }
      text = text.replace(/@_user_\d+\s*/g, '').trim()
      if (!text) return null
      return { ...base, kind: 'text', text }
    }

    if (msgType === 'image') {
      try {
        const content = JSON.parse(body?.content ?? '{}') as Record<string, string>
        const imageKey = content.image_key
        if (!imageKey) return null
        return { ...base, kind: 'file', fileKey: imageKey, fileName: 'image.png', msgType: 'image' }
      } catch { return null }
    }

    if (msgType === 'file') {
      try {
        const content = JSON.parse(body?.content ?? '{}') as Record<string, string>
        const fileKey = content.file_key
        const fileName = content.file_name || 'unknown'
        if (!fileKey) return null
        return { ...base, kind: 'file', fileKey, fileName, msgType: 'file' }
      } catch { return null }
    }

    // 富文本（post）消息会把图片和文字混在一起，我们暂不拆解，直接提示用户分条发
    if (msgType === 'post') {
      return {
        ...base,
        kind: 'unsupported',
        text: '暂不支持图文混合消息。请先依次发送图片（可多张），再单独发送文字指令——系统会把所有图片一起交给 AI 处理。',
      }
    }

    return null
  }
}
