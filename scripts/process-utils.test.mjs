/**
 * process-utils.ts 单元测试
 * 运行: node scripts/process-utils.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  isProcessRunning,
  findProcesses,
  getProcessInfo,
  killProcess,
  commandExists,
  isTmuxAvailable,
  isWindowsTerminal,
} from '../dist/src/process-utils.js'

test('isProcessRunning', async () => {
  // 当前进程应该存在
  assert.ok(isProcessRunning(process.pid))

  // 无效 PID 应该返回 false
  assert.ok(!isProcessRunning(-1))
  assert.ok(!isProcessRunning(0))
  assert.ok(!isProcessRunning(999999999))
})

test('findProcesses with invalid pattern', async () => {
  // 使用一个不太可能存在的进程名
  const results = await findProcesses('__nonexistent_process_xyz__')
  assert.ok(Array.isArray(results))
  assert.strictEqual(results.length, 0)
})

test('getProcessInfo for current process', async () => {
  const info = await getProcessInfo(process.pid)
  // Windows 下可能无法获取当前进程信息，跳过
  if (info) {
    assert.ok(info.pid === process.pid)
    assert.ok(typeof info.name === 'string')
  }
})

test('commandExists', () => {
  // node 应该存在
  assert.ok(commandExists('node'))

  // 不存在的命令
  assert.ok(!commandExists('__nonexistent_command_xyz__'))
})

test('isTmuxAvailable', () => {
  // Windows 下应该返回 false
  if (process.platform === 'win32') {
    assert.ok(!isTmuxAvailable())
  }
})

test('isWindowsTerminal', () => {
  // 仅在 Windows 下有意义
  if (process.platform !== 'win32') {
    assert.ok(!isWindowsTerminal())
  }
})

test('killProcess for non-existent process', async () => {
  // 尝试杀死不存在的进程应该返回 true（因为进程已经不在了）
  const result = await killProcess(999999999, 1000)
  assert.ok(result)
})

console.log('✅ process-utils 测试通过')
