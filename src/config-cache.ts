/**
 * @input:    运行时配置
 * @output:   ConfigCache — 配置缓存管理，避免频繁文件读取
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import type { CcConfig, WeChatAccount } from './config.js'

/**
 * 配置缓存
 * 监听文件变化并自动更新缓存
 */
export class ConfigCache {
  private config: CcConfig | null = null
  private wechatAccount: WeChatAccount | null = null
  private configWatcher: fs.FSWatcher | null = null
  private wechatWatcher: fs.FSWatcher | null = null
  private configPath: string
  private wechatPath: string
  private loadConfigFn: () => CcConfig
  private loadWechatFn: () => WeChatAccount | null

  constructor(
    configPath: string,
    wechatPath: string,
    loadConfigFn: () => CcConfig,
    loadWechatFn: () => WeChatAccount | null,
  ) {
    this.configPath = configPath
    this.wechatPath = wechatPath
    this.loadConfigFn = loadConfigFn
    this.loadWechatFn = loadWechatFn

    // 初始化缓存
    this.refreshConfig()
    this.refreshWechat()

    // 启动文件监听
    this.startWatchers()
  }

  /** 获取缓存的配置 */
  getConfig(): CcConfig {
    if (!this.config) {
      this.refreshConfig()
    }
    return this.config!
  }

  /** 获取缓存的微信账号 */
  getWechatAccount(): WeChatAccount | null {
    if (!this.wechatAccount && fs.existsSync(this.wechatPath)) {
      this.refreshWechat()
    }
    return this.wechatAccount
  }

  /** 强制刷新配置 */
  refreshConfig(): void {
    this.config = this.loadConfigFn()
  }

  /** 强制刷新微信账号 */
  refreshWechat(): void {
    this.wechatAccount = this.loadWechatFn()
  }

  /** 启动文件监听器 */
  private startWatchers(): void {
    // 监听配置文件变化
    if (fs.existsSync(this.configPath)) {
      try {
        this.configWatcher = fs.watch(this.configPath, (eventType) => {
          if (eventType === 'change') {
            this.refreshConfig()
          }
        })
        this.configWatcher.on('error', () => {
          // 监听失败时不影响功能，下次 getConfig 时会重新读取
        })
      } catch {
        // 文件监听不支持时静默失败
      }
    }

    // 监听微信配置文件变化
    if (fs.existsSync(this.wechatPath)) {
      try {
        this.wechatWatcher = fs.watch(this.wechatPath, (eventType) => {
          if (eventType === 'change') {
            this.refreshWechat()
          }
        })
        this.wechatWatcher.on('error', () => {})
      } catch {}
    }
  }

  /** 停止监听器 */
  stop(): void {
    if (this.configWatcher) {
      this.configWatcher.close()
      this.configWatcher = null
    }
    if (this.wechatWatcher) {
      this.wechatWatcher.close()
      this.wechatWatcher = null
    }
  }
}

/** 全局配置缓存实例 */
let globalCache: ConfigCache | null = null

/**
 * 初始化全局配置缓存
 */
export function initConfigCache(
  configPath: string,
  wechatPath: string,
  loadConfigFn: () => CcConfig,
  loadWechatFn: () => WeChatAccount | null,
): ConfigCache {
  if (globalCache) {
    globalCache.stop()
  }
  globalCache = new ConfigCache(configPath, wechatPath, loadConfigFn, loadWechatFn)
  return globalCache
}

/** 获取全局配置缓存 */
export function getConfigCache(): ConfigCache {
  if (!globalCache) {
    throw new Error('Config cache not initialized. Call initConfigCache first.')
  }
  return globalCache
}

/** 停止全局配置缓存 */
export function stopConfigCache(): void {
  if (globalCache) {
    globalCache.stop()
    globalCache = null
  }
}