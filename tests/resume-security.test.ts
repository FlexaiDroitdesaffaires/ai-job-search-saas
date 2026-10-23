import { Document, Packer, Paragraph } from "docx"
import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import {
  DOCX_MIME,
  extractResumeText,
  PDF_MIME,
  ResumeFileError,
  validateResumeFile,
} from "@/lib/resume/extract"

async function validDocx() {
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("CV sécurisé TypeScript")] }] }))
}

function syntheticArchive(entries: Array<{ name: string; compressed?: number; uncompressed?: number }>) {
  const central = entries.map(({ name, compressed = 1, uncompressed = 1 }) => {
    const encoded = Buffer.from(name)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(8, 10)
    header.writeUInt32LE(compressed, 20)
    header.writeUInt32LE(uncompressed, 24)
    header.writeUInt16LE(encoded.length, 28)
    return Buffer.concat([header, encoded])
  })
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(0, 16)
  return Buffer.concat([directory, end])
}

describe("resume file safety", () => {
  it("accepts and extracts genuine PDF and DOCX files", async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    const pdfBytes = Buffer.from(await pdf.save())
    expect(() => validateResumeFile(pdfBytes, PDF_MIME)).not.toThrow()

    const docxBytes = await validDocx()
    expect(await extractResumeText(docxBytes, DOCX_MIME)).toContain("TypeScript")
  })

  it("rejects disguised or truncated documents", () => {
    expect(() => validateResumeFile(Buffer.from("not a PDF"), PDF_MIME)).toThrowError(ResumeFileError)
    expect(() => validateResumeFile(Buffer.from("%PDF-1.7 without terminator"), PDF_MIME)).toThrow("MALFORMED_DOCUMENT")
    const malformedZip = Buffer.alloc(22)
    malformedZip.write("PK")
    expect(() => validateResumeFile(malformedZip, DOCX_MIME)).toThrow("MALFORMED_DOCUMENT")
  })

  it("rejects zip bombs, traversal paths, and active DOCX content", () => {
    expect(() => validateResumeFile(syntheticArchive([
      { name: "[Content_Types].xml", compressed: 1, uncompressed: 60 * 1024 * 1024 },
    ]), DOCX_MIME)).toThrow("DOCUMENT_TOO_COMPLEX")

    expect(() => validateResumeFile(syntheticArchive([{ name: "../word/document.xml" }]), DOCX_MIME)).toThrow("UNSAFE_DOCUMENT")
    expect(() => validateResumeFile(syntheticArchive([{ name: "word/vbaProject.bin" }]), DOCX_MIME)).toThrow("UNSAFE_DOCUMENT")
  })
})
