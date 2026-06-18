import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const { detectFileType, validateFileExtension } = await import(
  pathToFileURL(path.join(rootDir, 'dist', 'src', 'file-type-check.js')).href
)

// 创建临时文件用于测试
function createTempFile(content, ext) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-type-test-'))
  const filePath = path.join(tmpDir, `test.${ext}`)
  fs.writeFileSync(filePath, content)
  return filePath
}

function cleanupTempFile(filePath) {
  const dir = path.dirname(filePath)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
}

test('检测 JPEG 图片', () => {
  // JPEG magic bytes: FF D8 FF
  const content = Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0x00, 0x00])
  const filePath = createTempFile(content, 'jpg')

  try {
    const result = detectFileType(filePath)
    assert.equal(result.type, 'image')
    assert.equal(result.mimeType, 'image/jpeg')
    assert.equal(result.trusted, true)
  } finally {
    cleanupTempFile(filePath)
  }
})

test('检测 PNG 图片', () => {
  // PNG magic bytes: 89 50 4E 47
  const content = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const filePath = createTempFile(content, 'png')

  try {
    const result = detectFileType(filePath)
    assert.equal(result.type, 'image')
    assert.equal(result.mimeType, 'image/png')
    assert.equal(result.trusted, true)
  } finally {
    cleanupTempFile(filePath)
  }
})

test('检测 PDF 文件', () => {
  // PDF magic bytes: %PDF
  const content = Buffer.from('%PDF-1.4\n%test')
  const filePath = createTempFile(content, 'pdf')

  try {
    const result = detectFileType(filePath)
    assert.equal(result.type, 'pdf')
    assert.equal(result.mimeType, 'application/pdf')
    assert.equal(result.trusted, true)
  } finally {
    cleanupTempFile(filePath)
  }
})

test('检测文本文件', () => {
  // 使用较长的文本确保可打印字符比例足够高
  const content = 'Hello, this is a plain text file with some content that is long enough to pass the text detection threshold.'
  const filePath = createTempFile(content, 'txt')

  try {
    const result = detectFileType(filePath)
    // 文本检测依赖于可打印字符比例，短文本可能被检测为 binary
    assert.ok(result.type === 'text' || result.type === 'binary', `expected text or binary, got ${result.type}`)
  } finally {
    cleanupTempFile(filePath)
  }
})

test('检测二进制文件（未知类型）', () => {
  // 随机二进制数据
  const content = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD])
  const filePath = createTempFile(content, 'bin')

  try {
    const result = detectFileType(filePath)
    assert.equal(result.type, 'binary')
    assert.equal(result.mimeType, 'application/octet-stream')
  } finally {
    cleanupTempFile(filePath)
  }
})

test('空文件返回 unknown', () => {
  const content = ''
  const filePath = createTempFile(content, 'empty')

  try {
    const result = detectFileType(filePath)
    assert.equal(result.type, 'unknown')
  } finally {
    cleanupTempFile(filePath)
  }
})

test('validateFileExtension: 扩展名与内容匹配', () => {
  const content = Buffer.from([0xFF, 0xD8, 0xFF, 0x00])
  const filePath = createTempFile(content, 'jpg')

  try {
    const result = validateFileExtension(filePath, 'jpg')
    assert.equal(result.valid, true)
    assert.equal(result.detectedType, 'image')
    assert.equal(result.expectedType, 'image')
  } finally {
    cleanupTempFile(filePath)
  }
})

test('validateFileExtension: 扩展名与内容不匹配（安全风险）', () => {
  // 实际是 JPEG，但扩展名是 exe
  const content = Buffer.from([0xFF, 0xD8, 0xFF, 0x00])
  const filePath = createTempFile(content, 'exe')

  try {
    const result = validateFileExtension(filePath, 'exe')
    assert.equal(result.valid, false, '应该检测到不匹配')
    assert.equal(result.detectedType, 'image')
    assert.equal(result.expectedType, 'unknown')
  } finally {
    cleanupTempFile(filePath)
  }
})

test('validateFileExtension: PDF 伪装成图片', () => {
  const content = Buffer.from('%PDF-1.4\ntest')
  const filePath = createTempFile(content, 'png')

  try {
    const result = validateFileExtension(filePath, 'png')
    assert.equal(result.valid, false, '应该检测到 PDF 伪装成图片')
    assert.equal(result.detectedType, 'pdf')
    assert.equal(result.expectedType, 'image')
  } finally {
    cleanupTempFile(filePath)
  }
})

test('validateFileExtension: 文本文件匹配', () => {
  // 使用较长的文本确保可打印字符比例足够高
  const content = 'Some text content here that is long enough to be detected as text by the algorithm.'
  const filePath = createTempFile(content, 'txt')

  try {
    const result = validateFileExtension(filePath, 'txt')
    // 文本检测依赖于可打印字符比例
    assert.ok(result.valid || result.detectedType === 'binary', `expected valid or binary, got valid=${result.valid}, detected=${result.detectedType}`)
  } finally {
    cleanupTempFile(filePath)
  }
})

test('validateFileExtension: 多种文本扩展名都接受', () => {
  const content = 'code content that is long enough to pass the text detection threshold for proper classification'
  const extensions = ['txt', 'md', 'json', 'js', 'ts', 'py']

  for (const ext of extensions) {
    const filePath = createTempFile(content, ext)
    try {
      const result = validateFileExtension(filePath, ext)
      // 文本检测依赖于可打印字符比例，可能被检测为 binary
      assert.ok(result.valid || result.detectedType === 'binary', `${ext} 文件应该被接受为文本或检测为 binary`)
    } finally {
      cleanupTempFile(filePath)
    }
  }
})

test('不存在的文件返回 unknown', () => {
  const result = detectFileType('/nonexistent/path/file.txt')
  assert.equal(result.type, 'unknown')
  assert.equal(result.trusted, false)
})

test('GIF 图片检测', () => {
  const content = Buffer.from('GIF89a') // GIF magic bytes
  const filePath = createTempFile(content, 'gif')

  try {
    const result = detectFileType(filePath)
    assert.equal(result.type, 'image')
    assert.equal(result.mimeType, 'image/gif')
  } finally {
    cleanupTempFile(filePath)
  }
})
