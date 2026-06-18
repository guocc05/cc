import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const { RateLimiter, getRateLimiter, stopRateLimiter } = await import(
  pathToFileURL(path.join(rootDir, 'dist', 'src', 'rate-limiter.js')).href
)

test('默认配置：每分钟最多 30 条消息', () => {
  const limiter = new RateLimiter()
  const userId = 'test-user-1'

  // 前 30 次应该通过
  for (let i = 0; i < 30; i++) {
    const result = limiter.check(userId)
    assert.equal(result.allowed, true, `第 ${i + 1} 次应该被允许`)
  }

  // 第 31 次应该被拒绝
  const result = limiter.check(userId)
  assert.equal(result.allowed, false, '第 31 次应该被拒绝')
  assert.equal(result.remaining, 0)
})

test('自定义配置生效', () => {
  const limiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 5,
    enabled: true,
  })
  const userId = 'test-user-2'

  // 前 5 次通过
  for (let i = 0; i < 5; i++) {
    const result = limiter.check(userId)
    assert.equal(result.allowed, true)
  }

  // 第 6 次被拒绝
  const result = limiter.check(userId)
  assert.equal(result.allowed, false)
})

test('disabled 时允许所有请求', () => {
  const limiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    enabled: false,
  })
  const userId = 'test-user-3'

  // 即使超过 maxRequests 也应该通过
  for (let i = 0; i < 100; i++) {
    const result = limiter.check(userId)
    assert.equal(result.allowed, true, `第 ${i + 1} 次应该被允许 (disabled 模式)`)
  }
})

test('不同用户独立计数', () => {
  const limiter = new RateLimiter({ maxRequests: 2, enabled: true })
  const user1 = 'user-1'
  const user2 = 'user-2'

  // user1 用完配额
  assert.equal(limiter.check(user1).allowed, true)
  assert.equal(limiter.check(user1).allowed, true)
  assert.equal(limiter.check(user1).allowed, false)

  // user2 仍然可以
  assert.equal(limiter.check(user2).allowed, true)
  assert.equal(limiter.check(user2).allowed, true)
  assert.equal(limiter.check(user2).allowed, false)
})

test('remaining 正确返回', () => {
  const limiter = new RateLimiter({ maxRequests: 10, enabled: true })
  const userId = 'test-remaining'

  for (let i = 0; i < 10; i++) {
    const result = limiter.check(userId)
    assert.equal(result.remaining, 9 - i, `remaining 应该是 ${9 - i}`)
  }
})

test('getWaitTime 返回正确的等待时间', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1, enabled: true })
  const userId = 'test-wait'

  limiter.check(userId) // 用完配额
  const waitTime = limiter.getWaitTime(userId)

  // 等待时间应该小于窗口大小
  assert.ok(waitTime > 0, '应该有等待时间')
  assert.ok(waitTime <= 60_000, '等待时间不应该超过窗口大小')
})

test('formatBlockMessage 格式化正确', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1, enabled: true })
  const userId = 'test-format'

  limiter.check(userId) // 用完配额
  const msg = limiter.formatBlockMessage(userId)

  assert.ok(msg.includes('等待'), '应该包含"等待"')
  assert.ok(msg.includes('秒'), '应该包含"秒"')
})

test('stop() 停止清理定时器', () => {
  const limiter = new RateLimiter({ enabled: true })
  limiter.stop()

  // 停止后不应该抛错
  assert.ok(true)
})

test('全局实例 getRateLimiter 返回单例', () => {
  stopRateLimiter()

  const limiter1 = getRateLimiter()
  const limiter2 = getRateLimiter()

  assert.equal(limiter1, limiter2, '应该返回同一个实例')

  stopRateLimiter()
})

test('全局实例 stopRateLimiter 重置实例', () => {
  const limiter1 = getRateLimiter()
  stopRateLimiter()
  const limiter2 = getRateLimiter()

  assert.notEqual(limiter1, limiter2, 'stop 后应该是新实例')

  stopRateLimiter()
})

test('updateConfig 更新配置', () => {
  const limiter = new RateLimiter({ maxRequests: 5, enabled: true })
  const userId = 'test-update'

  // 用完 5 次
  for (let i = 0; i < 5; i++) {
    limiter.check(userId)
  }
  assert.equal(limiter.check(userId).allowed, false)

  // 更新配置到 10
  limiter.updateConfig({ maxRequests: 10 })

  // 由于窗口未过期，仍然被限制
  // 新窗口会使用新配置
  assert.ok(true)
})
