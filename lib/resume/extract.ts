import mammoth from "mammoth"
import { extractText } from "unpdf"

export const PDF_MIME = "application/pdf"
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const MAX_RESUME_BYTES = 10 * 1024 * 1024

function hasPdfSignature(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-"
}

function hasZipSignature(buffer: Buffer) {
  return buffer[0] === 0x50 && buffer[1] === 0x4b
}

export async function extractResumeText(buffer: Buffer, mimeType: string) {
  if (mimeType === PDF_MIME) {
    if (!hasPdfSignature(buffer)) throw new Error("INVALID_FILE_SIGNATURE")
    const result = await extractText(new Uint8Array(buffer), { mergePages: true })
    return result.text
  }
  if (mimeType === DOCX_MIME) {
    if (!hasZipSignature(buffer)) throw new Error("INVALID_FILE_SIGNATURE")
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  throw new Error("UNSUPPORTED_FILE_TYPE")
}
