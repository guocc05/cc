/**
 * @input:    TurnEvent 流（来自 base-driver.handleEvent）+ 计时器抽象
 * @output:   AggregatorAction 列表（send_text / send_tool_status）—— 决策何时发什么到 IM
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 *
 * 状态机：buffering → tool_running → buffering → ... → flushed (turn_end)
 *
 * 引入: @20260512-im-tool-call-progress (ARCHITECTURE §4.9)
 */

/** 来自 base-driver 的细粒度事件 */
export type TurnEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; toolUseId: string; name: string }
  | { kind: 'tool_end'; toolUseId: string; success: boolean }
  | { kind: 'turn_end' }

/** aggregator 决策应发的 IM 消息 */
export type AggregatorAction =
  | { kind: 'send_text'; text: string }
  | { kind: 'send_tool_status'; toolNames: string[]; toolCount: number }

export interface AggregatorConfig {
  /** 收到 text 后 debounce 等下一个 text 的窗口（ms），到期 flush */
  textDebounceMs: number
  /** 单个工具调用持续此值后发状态消息（ms）*/
  statusThresholdMs: number
}

export const DEFAULT_AGGREGATOR_CONFIG: AggregatorConfig = {
  textDebounceMs: 1500,
  statusThresholdMs: 10000,
}

/**
 * Turn aggregator: 接收事件 → 决策动作。
 *
 * 关键约束:
 * - 整 turn 内最多发 1 条 tool_status 消息（AC-3）
 * - 收到 text 时,所有 in-flight tool 还在 → 暂不 flush text,等下次或 turn_end
 * - tool 满 status_threshold → 发状态消息（仅一次/turn）+ flush 已缓冲 text
 * - turn_end → 强制 flush 一切
 * - flush() 同步路径用于 /stop 协同（AC-9）
 */
export interface TurnAggregator {
  /** 同步处理事件,返回应该发送的动作列表 */
  consume(event: TurnEvent): AggregatorAction[]
  /** 强制 flush 缓冲（含取消未触发的定时器）;返回剩余动作 */
  flush(): AggregatorAction[]
  /** 标记 turn 已结束,后续不再产生动作（防御性）*/
  isTurnEnded(): boolean
  /** /stop 协同: 完全清空状态,不发任何动作（仅用于强制中断后丢弃缓冲）*/
  abort(): void
}

interface AggregatorState {
  textBuffer: string
  textTimerHandle: ReturnType<typeof setTimeout> | null   // debounce 计时
  activeTools: Map<string, { name: string; startedAt: number }>   // toolUseId → meta
  toolNamesSeen: string[]                                  // 整 turn 累积 unique toolNames（按首次出现顺序）
  toolCountSeen: number                                    // 整 turn 累积 tool_start 总数（含重复）
  statusSent: boolean                                       // 整 turn 内是否已发过状态消息
  statusTimerHandle: ReturnType<typeof setTimeout> | null  // 长 tool 状态计时
  turnEnded: boolean
  pendingActions: AggregatorAction[]                       // 定时器触发产出的动作（异步注入）
}

interface AggregatorOptions {
  config?: Partial<AggregatorConfig>
  /** 测试注入: 自定义 setTimeout/clearTimeout（默认 globalThis）*/
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  /** 测试注入: 当定时器触发产出动作时回调（用于纯单测断言）*/
  onAsyncAction?: (actions: AggregatorAction[]) => void
}

export function createTurnAggregator(options: AggregatorOptions = {}): TurnAggregator {
  const cfg: AggregatorConfig = { ...DEFAULT_AGGREGATOR_CONFIG, ...options.config }
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const onAsyncAction = options.onAsyncAction

  const state: AggregatorState = {
    textBuffer: '',
    textTimerHandle: null,
    activeTools: new Map(),
    toolNamesSeen: [],
    toolCountSeen: 0,
    statusSent: false,
    statusTimerHandle: null,
    turnEnded: false,
    pendingActions: [],
  }

  function clearTextTimer(): void {
    if (state.textTimerHandle !== null) {
      clearTimeoutFn(state.textTimerHandle)
      state.textTimerHandle = null
    }
  }

  function clearStatusTimer(): void {
    if (state.statusTimerHandle !== null) {
      clearTimeoutFn(state.statusTimerHandle)
      state.statusTimerHandle = null
    }
  }

  function flushTextBufferIfAny(): AggregatorAction[] {
    if (!state.textBuffer) return []
    const text = state.textBuffer
    state.textBuffer = ''
    clearTextTimer()
    return [{ kind: 'send_text', text }]
  }

  function buildStatusAction(): AggregatorAction {
    return {
      kind: 'send_tool_status',
      toolNames: [...state.toolNamesSeen],
      toolCount: state.toolCountSeen,
    }
  }

  function scheduleTextDebounce(): void {
    clearTextTimer()
    state.textTimerHandle = setTimeoutFn(() => {
      state.textTimerHandle = null
      // 仅当无 active tool 时 debounce 才 flush;有 active tool 等 tool 结束/turn_end
      if (state.activeTools.size === 0 && state.textBuffer) {
        const actions = flushTextBufferIfAny()
        if (actions.length > 0) {
          state.pendingActions.push(...actions)
          onAsyncAction?.(actions)
        }
      }
    }, cfg.textDebounceMs)
  }

  function scheduleStatusThreshold(): void {
    if (state.statusSent || state.statusTimerHandle !== null) return
    state.statusTimerHandle = setTimeoutFn(() => {
      state.statusTimerHandle = null
      if (state.statusSent || state.activeTools.size === 0 || state.turnEnded) return
      // 触发: 发状态消息 + flush 已缓冲文本
      state.statusSent = true
      const actions: AggregatorAction[] = []
      const textFlush = flushTextBufferIfAny()
      if (textFlush.length > 0) actions.push(...textFlush)
      actions.push(buildStatusAction())
      state.pendingActions.push(...actions)
      onAsyncAction?.(actions)
    }, cfg.statusThresholdMs)
  }

  function drainPending(): AggregatorAction[] {
    if (state.pendingActions.length === 0) return []
    const out = state.pendingActions
    state.pendingActions = []
    return out
  }

  return {
    consume(event: TurnEvent): AggregatorAction[] {
      if (state.turnEnded) return drainPending()

      const out: AggregatorAction[] = []
      // 先把异步累积的动作派出（保证顺序: 先异步定时器结果,后本次同步结果）
      out.push(...drainPending())

      switch (event.kind) {
        case 'text': {
          // 累积文本(合并连续 text);text 不触发 flush——只重置 debounce
          if (state.textBuffer && !state.textBuffer.endsWith('\n') && !event.text.startsWith('\n')) {
            // 拼接时确保不丢分隔（如果两段都没有换行,加单空格分隔以防黏连）
            state.textBuffer += event.text
          } else {
            state.textBuffer += event.text
          }
          scheduleTextDebounce()
          break
        }
        case 'tool_start': {
          // AskUserQuestion 跳过——交给 askuser-bridge 处理（AC-8）
          if (event.name === 'AskUserQuestion') break
          state.activeTools.set(event.toolUseId, { name: event.name, startedAt: Date.now() })
          state.toolCountSeen++
          if (!state.toolNamesSeen.includes(event.name)) {
            state.toolNamesSeen.push(event.name)
          }
          // 启动状态阈值计时（仅首次需要;若已 statusSent 或已在计时则 no-op）
          scheduleStatusThreshold()
          // text debounce 暂停（有 in-flight tool 不 flush）
          clearTextTimer()
          break
        }
        case 'tool_end': {
          state.activeTools.delete(event.toolUseId)
          if (state.activeTools.size === 0) {
            // 全部 tool 结束 → 取消状态计时（若还未触发）
            clearStatusTimer()
            // text 缓冲可能还有内容,启 debounce 等下个可能的 text
            if (state.textBuffer) scheduleTextDebounce()
          }
          break
        }
        case 'turn_end': {
          state.turnEnded = true
          clearTextTimer()
          clearStatusTimer()
          // flush 剩余文本（如有）;turn_end 时不补发状态消息（已发过的保留）
          out.push(...flushTextBufferIfAny())
          break
        }
      }

      return out
    },

    flush(): AggregatorAction[] {
      // /stop 协同：立即派出缓冲（不取消已发的）+ 后续不再产生动作
      state.turnEnded = true
      clearTextTimer()
      clearStatusTimer()
      const out: AggregatorAction[] = []
      out.push(...drainPending())
      out.push(...flushTextBufferIfAny())
      return out
    },

    isTurnEnded(): boolean {
      return state.turnEnded
    },

    abort(): void {
      state.turnEnded = true
      state.textBuffer = ''
      state.pendingActions = []
      state.activeTools.clear()
      clearTextTimer()
      clearStatusTimer()
    },
  }
}
