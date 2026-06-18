import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const { ConfigCache, initConfigCache, getConfigCache, stopConfigCache } = await import(
  pathToFileURL(path.join(rootDir, 'dist', 'src', 'config-cache.js')).href
)

// 创建临时配置文件
function createTempConfigFile() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-cache-test-'))
  const configPath = path.join(tmpDir, 'config.json')
  const wechatPath = path.join(tmpDir, 'wechat.json')

  fs.writeFileSync(configPath, JSON.stringify({ allowedUserIds: ['user1'] }))
  fs.writeFileSync(wechatPath, JSON.stringify({ corpId: 'test', secret: 'test' }))

  return {
    configPath,
    wechatPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
    },
  }
}

test('ConfigCache 初始化并读取配置', () => {
  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    const cache = new ConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: ['user1'] }),
      () => ({ corpId: 'test', secret: 'test' }),
    )

    const config = cache.getConfig()
    assert.ok(config)
    assert.deepEqual(config.allowedUserIds, ['user1'])

    const wechat = cache.getWechatAccount()
    assert.ok(wechat)
    assert.equal(wechat?.corpId, 'test')
  } finally {
    cleanup()
  }
})

test('getConfig() 返回缓存的配置', () => {
  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    let loadCount = 0
    const cache = new ConfigCache(
      configPath,
      wechatPath,
      () => {
        loadCount++
        return { allowedUserIds: ['user1'] }
      },
      () => null,
    )

    // 第一次调用会加载
    const config1 = cache.getConfig()
    const config2 = cache.getConfig()

    // 两次调用应该返回同一个对象（缓存）
    assert.equal(config1, config2, '应该返回缓存的同一个对象')
    assert.equal(loadCount, 1, '只应该加载一次')
  } finally {
    cleanup()
  }
})

test('refreshConfig() 强制刷新配置', () => {
  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    let loadCount = 0
    const cache = new ConfigCache(
      configPath,
      wechatPath,
      () => {
        loadCount++
        return { allowedUserIds: [`user${loadCount}`] }
      },
      () => null,
    )

    cache.getConfig()
    assert.equal(loadCount, 1)

    cache.refreshConfig()
    const config = cache.getConfig()
    assert.equal(loadCount, 2, 'refresh 应该重新加载')
    assert.deepEqual(config.allowedUserIds, ['user2'])
  } finally {
    cleanup()
  }
})

test('refreshWechat() 强制刷新微信账号', () => {
  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    let loadCount = 0
    const cache = new ConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: [] }),
      () => {
        loadCount++
        return { corpId: `corp${loadCount}`, secret: 'secret' }
      },
    )

    cache.getWechatAccount()
    assert.equal(loadCount, 1)

    cache.refreshWechat()
    const wechat = cache.getWechatAccount()
    assert.equal(loadCount, 2)
    assert.equal(wechat?.corpId, 'corp2')
  } finally {
    cleanup()
  }
})

test('stop() 停止文件监听', () => {
  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    const cache = new ConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: [] }),
      () => null,
    )

    // stop 不应该抛错
    cache.stop()
    assert.ok(true)
  } finally {
    cleanup()
  }
})

test('getWechatAccount() 文件不存在返回 null', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-cache-test-'))
  const configPath = path.join(tmpDir, 'config.json')
  const wechatPath = path.join(tmpDir, 'nonexistent.json')

  fs.writeFileSync(configPath, JSON.stringify({ allowedUserIds: [] }))

  try {
    const cache = new ConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: [] }),
      () => null,
    )

    // 文件不存在时返回 null
    const wechat = cache.getWechatAccount()
    assert.equal(wechat, null)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('全局实例 initConfigCache/getConfigCache/stopConfigCache', () => {
  stopConfigCache() // 确保干净状态

  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    const cache = initConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: ['global'] }),
      () => null,
    )

    const retrieved = getConfigCache()
    assert.equal(cache, retrieved, 'getConfigCache 应该返回同一个实例')

    stopConfigCache()
    assert.ok(true, 'stopConfigCache 不应该抛错')
  } finally {
    cleanup()
  }
})

test('getConfigCache 未初始化时抛错', () => {
  stopConfigCache()

  assert.throws(() => {
    getConfigCache()
  }, /not initialized/i)
})

test('重复调用 initConfigCache 替换旧实例', () => {
  stopConfigCache()

  const { configPath, wechatPath, cleanup } = createTempConfigFile()

  try {
    const cache1 = initConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: ['v1'] }),
      () => null,
    )

    const cache2 = initConfigCache(
      configPath,
      wechatPath,
      () => ({ allowedUserIds: ['v2'] }),
      () => null,
    )

    assert.notEqual(cache1, cache2, '应该是不同的实例')
    assert.equal(getConfigCache(), cache2, '全局应该是新实例')
  } finally {
    stopConfigCache()
    cleanup()
  }
})
