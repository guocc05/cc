import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-feishu-'))
process.env.HOME = testHome
fs.mkdirSync(path.join(testHome, '.im2cc', 'data'), { recursive: true })

const { FeishuAdapter, computeNextDelayMs, BACKOFF_TIERS } = await import(path.join(rootDir, 'dist', 'src', 'feishu.js'))

// 测试隔离：pollOnce 内部会调用 setCursor；这里用临时 HOME，避免污染用户数据。
const CURSORS_FILE = path.join(os.homedir(), '.im2cc', 'data', 'poll-cursors.json')
let cursorsBackup = null
before(() => {
  cursorsBackup = fs.existsSync(CURSORS_FILE) ? fs.readFileSync(CURSORS_FILE, 'utf-8') : null
})
after(() => {
  if (cursorsBackup === null) {
    if (fs.existsSync(CURSORS_FILE)) fs.unlinkSync(CURSORS_FILE)
  } else {
    fs.writeFileSync(CURSORS_FILE, cursorsBackup)
  }
  fs.rmSync(testHome, { recursive: true, force: true })
})

function makeConfig() {
  return {
    feishu: { appId: 'app-id', appSecret: 'app-secret' },
    allowedUserIds: [],
    defaultPermissionMode: 'default',
    defaultModes: {},
    recapBudget: 2000,
    maxFileSizeMB: 10,
    inboxTtlMinutes: 60,
    pollIntervalMs: 5000,
  }
}

test('FeishuAdapter recreates client after timeout errors', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  const replacementClient = { marker: 'replacement' }
  let rebuilds = 0

  adapter.createClient = () => {
    rebuilds++
    return replacementClient
  }

  const timeoutError = Object.assign(new Error('timeout of 15000ms exceeded'), {
    code: 'ECONNABORTED',
  })

  await assert.rejects(
    adapter.runRequest('发送消息', async () => {
      throw timeoutError
    }),
    /timeout of 15000ms exceeded/,
  )

  assert.equal(rebuilds, 1)
  assert.equal(adapter.client, replacementClient)
})

test('FeishuAdapter falls back to Lark domain after Feishu DNS failure', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  const replacementClient = { marker: 'lark-client' }
  let rebuilds = 0
  let calls = 0

  adapter.createClient = () => {
    rebuilds++
    return replacementClient
  }

  const result = await adapter.runRequest('拉取群列表', async () => {
    calls++
    if (calls === 1) {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND open.feishu.cn'), {
        code: 'ENOTFOUND',
      })
    }
    return { ok: true }
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls, 2)
  assert.equal(rebuilds, 1)
  assert.equal(adapter.client, replacementClient)
})

test('FeishuAdapter does not recreate client for non-timeout errors', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  const originalClient = adapter.client
  let rebuilds = 0

  adapter.createClient = () => {
    rebuilds++
    return { marker: 'unexpected' }
  }

  await assert.rejects(
    adapter.runRequest('拉取群列表', async () => {
      throw new Error('unauthorized')
    }),
    /unauthorized/,
  )

  assert.equal(rebuilds, 0)
  assert.equal(adapter.client, originalClient)
})

test('parseRestMessage 对 post 类型返回 unsupported 并附带中文提示', () => {
  const adapter = new FeishuAdapter(makeConfig())
  const msg = adapter.parseRestMessage({
    message_id: 'om_post_001',
    chat_id: 'oc_abc',
    msg_type: 'post',
    sender: { id: 'ou_user', sender_type: 'user' },
    body: { content: JSON.stringify({ title: '', content: [[{ tag: 'text', text: 'hi' }]] }) },
  })
  assert.ok(msg)
  assert.equal(msg.kind, 'unsupported')
  assert.match(msg.text ?? '', /图文混合|暂不支持/)
  // 保留原 messageId，方便 addReaction / 日志定位
  assert.equal(msg.messageId, 'om_post_001')
})

test('parseRestMessage 对未知类型仍返回 null（不抛错）', () => {
  const adapter = new FeishuAdapter(makeConfig())
  const msg = adapter.parseRestMessage({
    message_id: 'om_sticker_001',
    chat_id: 'oc_abc',
    msg_type: 'sticker',
    sender: { id: 'ou_user', sender_type: 'user' },
    body: { content: '{}' },
  })
  assert.equal(msg, null)
})

test('parseRestMessage 对 text 类型正常解析', () => {
  const adapter = new FeishuAdapter(makeConfig())
  const msg = adapter.parseRestMessage({
    message_id: 'om_text_001',
    chat_id: 'oc_abc',
    msg_type: 'text',
    sender: { id: 'ou_user', sender_type: 'user' },
    body: { content: JSON.stringify({ text: '/fc im2cc' }) },
  })
  assert.ok(msg)
  assert.equal(msg.kind, 'text')
  assert.equal(msg.text, '/fc im2cc')
})

// --- per-chat 自适应退避 @20260511-feishu-poll-adaptive-backoff ---

test('computeNextDelayMs 在 4 个梯度边界返回对应间隔', () => {
  // 活跃档：< 5min
  assert.equal(computeNextDelayMs(0), 5_000)
  assert.equal(computeNextDelayMs(5 * 60_000 - 1), 5_000)
  // 5-30min 闲档
  assert.equal(computeNextDelayMs(5 * 60_000), 30_000)
  assert.equal(computeNextDelayMs(30 * 60_000 - 1), 30_000)
  // 30min-2h 闲档
  assert.equal(computeNextDelayMs(30 * 60_000), 60_000)
  assert.equal(computeNextDelayMs(2 * 3600_000 - 1), 60_000)
  // 2h+ 深度闲档
  assert.equal(computeNextDelayMs(2 * 3600_000), 120_000)
  assert.equal(computeNextDelayMs(24 * 3600_000), 120_000)
  // BACKOFF_TIERS 自洽：最后一档 idleBelowMs 为 +∞
  assert.equal(BACKOFF_TIERS[BACKOFF_TIERS.length - 1].idleBelowMs, Number.POSITIVE_INFINITY)
})

test('pollOnce 对新发现 chat 立即拉一轮 catch-up', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  const fetched = []
  adapter.refreshBotGroups = async () => [{ chatId: 'oc_new' }]
  adapter.fetchGroupMessages = async (chatId) => { fetched.push(chatId); return [] }

  // 初始 state 为空 → 应被认作新发现 → 立即 fetch
  await adapter.pollOnce(async () => {})

  assert.deepEqual(fetched, ['oc_new'], '新发现的 chat 应被立即 fetch')
  const state = adapter.chatPollState.get('oc_new')
  assert.ok(state, 'state 应被初始化')
  assert.ok(state.nextFireAt > Date.now() - 100, 'fetch 后 nextFireAt 应推进到未来')
})

test('pollOnce 跳过未到期的 chat（不打 API）', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  const fetched = []
  adapter.refreshBotGroups = async () => [{ chatId: 'oc_idle' }]
  adapter.fetchGroupMessages = async (chatId) => { fetched.push(chatId); return [] }

  // 预置一个"未到期"的 state（nextFireAt 在未来）
  const future = Date.now() + 60_000
  adapter.chatPollState.set('oc_idle', { lastActiveAt: Date.now() - 3600_000, nextFireAt: future, lastMaxCreateTime: 0 })

  await adapter.pollOnce(async () => {})

  assert.equal(fetched.length, 0, '未到期的 chat 不应被 fetch')
  // state 未被改写
  const state = adapter.chatPollState.get('oc_idle')
  assert.equal(state.nextFireAt, future, 'nextFireAt 应保持不变')
})

test('pollOnce 拉到消息后重置 lastActiveAt 到当前时刻（回到 5s 档）', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  adapter.refreshBotGroups = async () => [{ chatId: 'oc_active' }]
  // 模拟拉到一条 text 消息
  adapter.fetchGroupMessages = async () => [{
    message_id: 'om_001', chat_id: 'oc_active', msg_type: 'text',
    sender: { id: 'ou_u', sender_type: 'user' },
    body: { content: JSON.stringify({ text: 'hi' }) },
    create_time: String(Date.now()),
  }]

  // 预置 state：已闲 1 小时 + nextFireAt 在过去（已到期）；lastMaxCreateTime=0 让任意 create_time 都视为"新"
  const longAgo = Date.now() - 3600_000
  adapter.chatPollState.set('oc_active', { lastActiveAt: longAgo, nextFireAt: Date.now() - 1000, lastMaxCreateTime: 0 })

  const before = Date.now()
  await adapter.pollOnce(async () => {})
  const after = Date.now()

  const state = adapter.chatPollState.get('oc_active')
  assert.ok(state.lastActiveAt >= before && state.lastActiveAt <= after,
    'lastActiveAt 应被刷新到当前时刻')
  // 新 idleMs ≈ 0 → 下一次延迟为 5s 档
  assert.ok(state.nextFireAt - state.lastActiveAt >= 4900 && state.nextFireAt - state.lastActiveAt <= 5100,
    `刚活跃后下次间隔应回到 5s 档（实际 ${state.nextFireAt - state.lastActiveAt}ms）`)
})

test('pollOnce 无消息时按 idleMs 升档退避', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  adapter.refreshBotGroups = async () => [{ chatId: 'oc_quiet' }]
  adapter.fetchGroupMessages = async () => []  // 无消息

  // 预置 state：已闲 45 分钟 → 应落在 30min-2h 档（60s）
  const idleStart = Date.now() - 45 * 60_000
  adapter.chatPollState.set('oc_quiet', { lastActiveAt: idleStart, nextFireAt: Date.now() - 1000, lastMaxCreateTime: 0 })

  await adapter.pollOnce(async () => {})

  const state = adapter.chatPollState.get('oc_quiet')
  assert.equal(state.lastActiveAt, idleStart, '无消息时 lastActiveAt 不变')
  const delay = state.nextFireAt - Date.now()
  assert.ok(delay >= 59_000 && delay <= 61_000,
    `45min 闲时应退避到 60s 档（实际 ${delay}ms）`)
})

test('pollOnce per-chat 状态独立：活跃群不影响闲群退避', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  adapter.refreshBotGroups = async () => [
    { chatId: 'oc_A_active' },
    { chatId: 'oc_B_idle' },
  ]
  adapter.fetchGroupMessages = async (chatId) => {
    if (chatId === 'oc_A_active') {
      return [{
        message_id: 'om_A', chat_id: 'oc_A_active', msg_type: 'text',
        sender: { id: 'ou_u', sender_type: 'user' },
        body: { content: JSON.stringify({ text: 'ping' }) },
        create_time: String(Date.now()),
      }]
    }
    return []  // B 无消息
  }

  const idleStart = Date.now() - 3 * 3600_000  // B 闲 3 小时
  adapter.chatPollState.set('oc_A_active', { lastActiveAt: Date.now() - 60_000, nextFireAt: Date.now() - 1, lastMaxCreateTime: 0 })
  adapter.chatPollState.set('oc_B_idle',   { lastActiveAt: idleStart,           nextFireAt: Date.now() - 1, lastMaxCreateTime: 0 })

  await adapter.pollOnce(async () => {})

  const stateA = adapter.chatPollState.get('oc_A_active')
  const stateB = adapter.chatPollState.get('oc_B_idle')
  // A 刚活跃 → 5s 档
  assert.ok(stateA.nextFireAt - stateA.lastActiveAt < 6_000, 'A 群活跃后应回到 5s 档')
  // B 仍闲 3h → 120s 档
  assert.equal(stateB.lastActiveAt, idleStart, 'B 群 lastActiveAt 不应受 A 影响')
  const delayB = stateB.nextFireAt - Date.now()
  assert.ok(delayB >= 119_000 && delayB <= 121_000, `B 群 3h 闲应在 120s 档（实际 ${delayB}ms）`)
})

test('pollOnce 不被 cursor 秒级边界的重复消息误判为"活跃"（核心 bug 修复）', async () => {
  // 模拟生产 bug：每次 fetch 因 start_time 闭区间拉到同一条旧消息，
  // 之前的代码（items.length > 0）会错误重置 lastActiveAt，让群永远停在 5s 档。
  // 修复后：只有 maxCreateTime > lastMaxCreateTime 时才视为真活跃。
  const adapter = new FeishuAdapter(makeConfig())
  const FIXED_CREATE_TIME = String(Date.now() - 10 * 60_000)  // 10 分钟前的"幽灵消息"

  adapter.refreshBotGroups = async () => [{ chatId: 'oc_ghost' }]
  // 每次 fetch 都返回同一条 create_time 固定的消息
  adapter.fetchGroupMessages = async () => [{
    message_id: 'om_ghost', chat_id: 'oc_ghost', msg_type: 'text',
    sender: { id: 'ou_u', sender_type: 'user' },
    body: { content: JSON.stringify({ text: 'ghost' }) },
    create_time: FIXED_CREATE_TIME,
  }]

  // 预置 state：已闲 10 分钟，到期可拉，lastMaxCreateTime 已记录这条消息
  const ghostMs = parseInt(FIXED_CREATE_TIME, 10)
  adapter.chatPollState.set('oc_ghost', {
    lastActiveAt: Date.now() - 10 * 60_000,
    nextFireAt: Date.now() - 1,
    lastMaxCreateTime: ghostMs,  // 已经见过这条消息了
  })

  await adapter.pollOnce(async () => {})

  const state = adapter.chatPollState.get('oc_ghost')
  // lastActiveAt 不应被重置——这是 bug 修复的核心
  assert.ok(Date.now() - state.lastActiveAt >= 10 * 60_000 - 1000,
    `lastActiveAt 不应被边界重复消息重置（实际 idle: ${Math.floor((Date.now() - state.lastActiveAt) / 1000)}s）`)
  // nextDelay 应反映 10min idle → 30s 档
  const delay = state.nextFireAt - Date.now()
  assert.ok(delay >= 29_000 && delay <= 31_000,
    `10min 闲群应在 30s 档（实际 ${delay}ms）`)
})

test('pollOnce 清理已退出的 chat（bot 被移出群）', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  // 预置两个群的 state
  adapter.chatPollState.set('oc_kept', { lastActiveAt: Date.now(), nextFireAt: Date.now() + 60_000, lastMaxCreateTime: 0 })
  adapter.chatPollState.set('oc_removed', { lastActiveAt: Date.now(), nextFireAt: Date.now() + 60_000, lastMaxCreateTime: 0 })

  // bot 已不在 oc_removed 中
  adapter.refreshBotGroups = async () => [{ chatId: 'oc_kept' }]
  adapter.fetchGroupMessages = async () => []

  await adapter.pollOnce(async () => {})

  assert.ok(adapter.chatPollState.has('oc_kept'))
  assert.equal(adapter.chatPollState.has('oc_removed'), false, '已退出的 chat state 应被清理')
})

test('FeishuAdapter sends structured panel messages as post payloads', async () => {
  const adapter = new FeishuAdapter(makeConfig())
  let captured = null

  adapter.client = {
    im: {
      message: {
        create: async (payload) => {
          captured = payload
          return {}
        },
      },
    },
  }

  await adapter.sendMessage('oc_test', {
    kind: 'panel',
    title: '反茄钟',
    sections: [{ lines: ['状态：进行中'] }],
  })

  assert.ok(captured)
  assert.equal(captured.data.msg_type, 'post')
  const content = JSON.parse(captured.data.content)
  assert.equal(content.zh_cn.title, '反茄钟')
  assert.match(content.zh_cn.content[0][0].text, /\*\*状态：\*\*/)
})
