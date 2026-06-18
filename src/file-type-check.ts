/**
 * @input:    文件路径
 * @output:   detectFileType() — 通过 magic bytes 检测文件真实类型
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'

/** 文件类型检测结果 */
export interface FileTypeResult {
  /** 检测到的类型 */
  type: FileType
  /** 是否可信（扩展名与内容匹配） */
  trusted: boolean
  /** 检测到的 MIME 类型 */
  mimeType: string
}

/** 支持的文件类型 */
export type FileType =
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'doc'   // 旧 Word
  | 'xls'   // 旧 Excel
  | 'ppt'   // 旧 PowerPoint
  | 'text'
  | 'binary'
  | 'unknown'

/** Magic bytes 签名表 */
const MAGIC_SIGNATURES: Array<{
  signature: Buffer
  type: FileType
  mimeType: string
  offset: number
}> = [
  // 图片
  { signature: Buffer.from([0xFF, 0xD8, 0xFF]), type: 'image', mimeType: 'image/jpeg', offset: 0 },
  { signature: Buffer.from([0x89, 0x50, 0x4E, 0x47]), type: 'image', mimeType: 'image/png', offset: 0 },
  { signature: Buffer.from('GIF8'), type: 'image', mimeType: 'image/gif', offset: 0 },
  { signature: Buffer.from('RIFF'), type: 'image', mimeType: 'image/webp', offset: 0 }, // WebP 也是 RIFF 格式

  // PDF
  { signature: Buffer.from('%PDF'), type: 'pdf', mimeType: 'application/pdf', offset: 0 },

  // Office 新格式（ZIP 容器）
  { signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]), type: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', offset: 0 },
  { signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]), type: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', offset: 0 },
  { signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]), type: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', offset: 0 },

  // Office 旧格式（OLE 容器）
  { signature: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), type: 'doc', mimeType: 'application/msword', offset: 0 },
]

/** 扩展名到类型的映射 */
const EXTENSION_MAP: Record<string, FileType> = {
  // 图片
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  // PDF
  pdf: 'pdf',
  // Office 新格式
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  // Office 旧格式
  doc: 'doc',
  xls: 'xls',
  ppt: 'ppt',
  // 文本
  txt: 'text',
  md: 'text',
  json: 'text',
  js: 'text',
  ts: 'text',
  py: 'text',
  html: 'text',
  css: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  sh: 'text',
  bash: 'text',
  zsh: 'text',
}

/** Office 新格式的内部标识符（用于区分 docx/xlsx/pptx） */
const OFFICE_CONTENT_TYPES: Record<string, FileType> = {
  'wordprocessingml.document': 'docx',
  'spreadsheetml.sheet': 'xlsx',
  'presentationml.presentation': 'pptx',
}

/**
 * 通过 magic bytes 检测文件真实类型
 */
export function detectFileType(filePath: string): FileTypeResult {
  try {
    const fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(512)
    const bytesRead = fs.readSync(fd, header, 0, 512, 0)
    fs.closeSync(fd)

    if (bytesRead < 4) {
      return { type: 'unknown', trusted: false, mimeType: 'application/octet-stream' }
    }

    // 检查 magic signatures
    for (const sig of MAGIC_SIGNATURES) {
      if (header.length >= sig.signature.length + sig.offset) {
        const slice = header.slice(sig.offset, sig.offset + sig.signature.length)
        if (slice.equals(sig.signature)) {
          // ZIP 格式需要进一步检查内部结构区分 docx/xlsx/pptx
          if (sig.type === 'docx' || sig.type === 'xlsx' || sig.type === 'pptx') {
            const officeType = detectOfficeType(header)
            if (officeType) {
              return { type: officeType, trusted: true, mimeType: getMimeType(officeType) }
            }
          }
          return { type: sig.type, trusted: true, mimeType: sig.mimeType }
        }
      }
    }

    // 检查是否为文本（UTF-8 可打印字符比例）
    if (isLikelyText(header)) {
      return { type: 'text', trusted: true, mimeType: 'text/plain' }
    }

    return { type: 'binary', trusted: false, mimeType: 'application/octet-stream' }
  } catch {
    return { type: 'unknown', trusted: false, mimeType: 'application/octet-stream' }
  }
}

/**
 * 从 ZIP 容器中检测 Office 文件类型
 */
function detectOfficeType(header: Buffer): FileType | null {
  try {
    // 在 ZIP 文件中查找 [Content_Types].xml
    // 这是一个简化的检测，真实实现需要解析 ZIP 结构
    // 但对于常见的 Office 文件，文件名通常包含标识符
    const headerStr = header.toString('utf-8', 0, 512)

    for (const [key, type] of Object.entries(OFFICE_CONTENT_TYPES)) {
      if (headerStr.includes(key)) {
        return type
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 检查缓冲区是否可能是文本文件
 */
function isLikelyText(buffer: Buffer): boolean {
  let printableCount = 0
  const len = Math.min(buffer.length, 512)

  for (let i = 0; i < len; i++) {
    const byte = buffer[i]
    // 可打印 ASCII: 32-126, plus \n(10), \r(13), \t(9)
    if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
      printableCount++
    }
    // UTF-8 多字节字符的引导字节
    if (byte >= 0xC0 && byte <= 0xFD) {
      printableCount++
    }
  }

  // 如果超过 85% 是可打印字符，认为是文本
  return printableCount / len > 0.85
}

/**
 * 获取类型的 MIME 类型
 */
function getMimeType(type: FileType): string {
  const typeToMime: Record<FileType, string> = {
    image: 'image/*',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword',
    xls: 'application/vnd.ms-excel',
    ppt: 'application/vnd.ms-powerpoint',
    text: 'text/plain',
    binary: 'application/octet-stream',
    unknown: 'application/octet-stream',
  }
  return typeToMime[type] ?? 'application/octet-stream'
}

/**
 * 验证文件扩展名与内容是否匹配
 */
export function validateFileExtension(filePath: string, extension: string): {
  valid: boolean
  detectedType: FileType
  expectedType: FileType
} {
  const detected = detectFileType(filePath)
  const expectedType = EXTENSION_MAP[extension.toLowerCase()] ?? 'unknown'

  // 对于 ZIP 格式的 Office 文件，扩展名需要精确匹配
  if (detected.type === 'docx' || detected.type === 'xlsx' || detected.type === 'pptx') {
    return {
      valid: detected.type === expectedType,
      detectedType: detected.type,
      expectedType,
    }
  }

  // 图片类型可以接受任何图片扩展名
  if (detected.type === 'image' && expectedType === 'image') {
    return { valid: true, detectedType: detected.type, expectedType }
  }

  // 文本类型可以接受任何文本扩展名
  if (detected.type === 'text' && expectedType === 'text') {
    return { valid: true, detectedType: detected.type, expectedType }
  }

  // PDF 匹配
  if (detected.type === 'pdf' && expectedType === 'pdf') {
    return { valid: true, detectedType: detected.type, expectedType }
  }

  // 类型不匹配
  return { valid: detected.type === expectedType, detectedType: detected.type, expectedType }
}