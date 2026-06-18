/**
 * @input:    用户消息、操作请求
 * @output:   RateLimiter — 请求速率限制器，防止 DoS 攻击
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

/**
 * 速率限制器配置
 */
export interface RateLimiterConfig {
  /** 时间窗口大小（毫秒） */
  windowMs: number
  /** 窗口内最大请求次数 */
  maxRequests: number
  /** 是否启用 */
  enabled: boolean
}

/** 单个用户的速率状态 */
interface UserRateState {
  count: number
  windowStart: number
}

/** 默认配置：每分钟最多 30 条消息 */
const DEFAULT_CONFIG: RateLimiterConfig = {
  windowMs: 60_000,
  maxRequests: 30,
  enabled: true,
}

/**
 * 速率限制器
 * 支持按用户 ID 进行请求频率限制
 */
export class RateLimiter {
  private config: RateLimiterConfig
  private userStates: Map<string, UserRateState> = new Map()
  /** 清理周期：每 5 分钟清理过期状态 */
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (this.config.enabled) {
      this.startCleanup()
    }
  }

  /**
   * 检查用户是否被允许发送请求
   * @returns { allowed: boolean, remaining: number, resetAt: number }
   */
  check(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
    if (!this.config.enabled) {
      return { allowed: true, remaining: this.config.maxRequests, resetAt: 0 }
    }

    const now = Date.now()
    let state = this.userStates.get(userId)

    // 窗口过期，重置计数
    if (!state || now - state.windowStart >= this.config.windowMs) {
      state = { count: 0, windowStart: now }
      this.userStates.set(userId, state)
    }

    const remaining = this.config.maxRequests - state.count
    const resetAt = state.windowStart + this.config.windowMs

    if (state.count >= this.config.maxRequests) {
      return { allowed: false, remaining: 0, resetAt }
    }

    state.count++
    return { allowed: true, remaining: remaining - 1, resetAt }
  }

  /** 获取用户被限制的剩余时间（毫秒） */
  getWaitTime(userId: string): number {
    const state = this.userStates.get(userId)
    if (!state) return 0
    const resetAt = state.windowStart + this.config.windowMs
    return Math.max(0, resetAt - Date.now())
  }

  /** 格式化限制消息 */
  formatBlockMessage(userId: string): string {
    const waitMs = this.getWaitTime(userId)
    const waitSec = Math.ceil(waitMs / 1000)
    return `⚠️ 发送过于频繁，请等待 ${waitSec} 秒后再试`
  }

  /** 清理过期的用户状态 */
  private cleanup(): void {
    const now = Date.now()
    for (const [userId, state] of this.userStates) {
      if (now - state.windowStart >= this.config.windowMs * 2) {
        this.userStates.delete(userId)
      }
    }
  }

  /** 启动定期清理 */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60_000)
  }

  /** 停止清理（进程退出时调用） */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /** 更新配置 */
  updateConfig(config: Partial<RateLimiterConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

/** 全局速率限制器实例 */
let globalLimiter: RateLimiter | null = null

/** 获取全局速率限制器 */
export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  if (!globalLimiter) {
    globalLimiter = new RateLimiter(config)
  } else if (config) {
    globalLimiter.updateConfig(config)
  }
  return globalLimiter
}

/** 停止全局速率限制器 */
export function stopRateLimiter(): void {
  if (globalLimiter) {
    globalLimiter.stop()
    globalLimiter = null
  }
}