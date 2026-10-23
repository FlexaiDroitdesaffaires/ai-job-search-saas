import mammoth from "mammoth"
import { extractText } from "unpdf"

export const PDF_MIME = "application/pdf"
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const MAX_RESUME_BYTES = 10 * 1024 * 1024
export const MAX_RESUME_PAGES = 50
export const MAX_EXTRACTED_TEXT_CHARS = 200_000

const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const MAX_DOCX_ENTRIES = 512
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const MAX_DOCX_COMPRESSION_RATIO = 100

export type ResumeFileErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_SIGNATURE"
  | "MALFORMED_DOCUMENT"
  | "DOCUMENT_TOO_COMPLEX"
  | "UNSAFE_DOCUMENT"
  | "UNSUPPORTED_FILE_TYPE"

export class ResumeFileError extends Error {
  constructor(readonly code: ResumeFileErrorCode) {
    super(code)
    this.name = "ResumeFileError"
  }
}

function reject(code: ResumeFileErrorCode): never {
  throw new ResumeFileError(code)
}

function validateSize(buffer: Buffer) {
  if (buffer.length === 0) reject("EMPTY_FILE")
  if (buffer.length > MAX_RESUME_BYTES) reject("FILE_TOO_LARGE")
}

function validatePdf(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") reject("INVALID_FILE_SIGNATURE")
  if (!buffer.subarray(Math.max(0, buffer.length - 4_096)).includes(Buffer.from("%%EOF"))) {
    reject("MALFORMED_DOCUMENT")
  }
}

function findZipEnd(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  reject("MALFORMED_DOCUMENT")
}

function unsafeArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/")
  return normalized.includes("\0") || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)
    || normalized.split("/").includes("..")
}

function activeDocxEntry(name: string) {
  const lower = name.toLowerCase()
  return lower === "word/vbaproject.bin"
    || lower.startsWith("word/embeddings/")
    || lower.startsWith("word/activex/")
    || /\.(?:exe|dll|js|vbs|bat|cmd|ps1)$/.test(lower)
}

function validateDocx(buffer: Buffer) {
  if (buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) reject("INVALID_FILE_SIGNATURE")

  const endOffset = findZipEnd(buffer)
  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const centralDisk = buffer.readUInt16LE(endOffset + 6)
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8)
  const entryCount = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) reject("UNSAFE_DOCUMENT")
  if (entryCount === 0 || entryCount > MAX_DOCX_ENTRIES) reject("DOCUMENT_TOO_COMPLEX")
  if (centralOffset + centralSize !== endOffset || centralOffset + centralSize > buffer.length) reject("MALFORMED_DOCUMENT")

  const requiredEntries = new Set(["[Content_Types].xml", "_rels/.rels", "word/document.xml"])
  let cursor = centralOffset
  let totalCompressed = 0
  let totalUncompressed = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) reject("MALFORMED_DOCUMENT")
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressed = buffer.readUInt32LE(cursor + 20)
    const uncompressed = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > endOffset || [compressed, uncompressed, localOffset].includes(0xffffffff)) reject("MALFORMED_DOCUMENT")

    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8")
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || unsafeArchivePath(name) || activeDocxEntry(name)) {
      reject("UNSAFE_DOCUMENT")
    }
    if (compressed === 0 && uncompressed > 0) reject("DOCUMENT_TOO_COMPLEX")
    if (compressed > 0 && uncompressed / compressed > MAX_DOCX_COMPRESSION_RATIO) reject("DOCUMENT_TOO_COMPLEX")

    totalCompressed += compressed
    totalUncompressed += uncompressed
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES
      || (totalCompressed > 0 && totalUncompressed / totalCompressed > MAX_DOCX_COMPRESSION_RATIO)) {
      reject("DOCUMENT_TOO_COMPLEX")
    }
    requiredEntries.delete(name)
    cursor = next
  }

  if (cursor !== endOffset || requiredEntries.size > 0) reject("MALFORMED_DOCUMENT")
}

export function validateResumeFile(buffer: Buffer, mimeType: string) {
  validateSize(buffer)
  if (mimeType === PDF_MIME) return validatePdf(buffer)
  if (mimeType === DOCX_MIME) return validateDocx(buffer)
  reject("UNSUPPORTED_FILE_TYPE")
}

function validateExtractedText(text: string) {
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) reject("DOCUMENT_TOO_COMPLEX")
  return text
}

export async function extractResumeText(buffer: Buffer, mimeType: string) {
  validateResumeFile(buffer, mimeType)
  try {
    if (mimeType === PDF_MIME) {
      const result = await extractText(new Uint8Array(buffer), { mergePages: true })
      if (result.totalPages > MAX_RESUME_PAGES) reject("DOCUMENT_TOO_COMPLEX")
      return validateExtractedText(result.text)
    }
    if (mimeType === DOCX_MIME) {
      const result = await mammoth.extractRawText({ buffer })
      return validateExtractedText(result.value)
    }
  } catch (error) {
    if (error instanceof ResumeFileError) throw error
    reject("MALFORMED_DOCUMENT")
  }
  reject("UNSUPPORTED_FILE_TYPE")
}
