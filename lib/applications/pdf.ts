import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

import type { ApplicationDossierContent } from "./dossier-schema"

const PAGE = { width: 595.28, height: 841.89, margin: 48 }

function pdfSafe(value: string) {
  return value
    .replace(/\u00e2\u0080[\u0098\u0099]/g, "'")
    .replace(/\u00e2\u0080[\u009c\u009d]/g, '"')
    .replace(/\u00e2\u0080[\u0093\u0094]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, "-")
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = []
  const encodable = [...pdfSafe(text)].map((character) => {
    try {
      font.encodeText(character)
      return character
    } catch {
      return "?"
    }
  }).join("")
  for (const paragraph of encodable.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("")
      continue
    }
    let current = ""
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width || !current) current = candidate
      else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

class PdfWriter {
  private page!: PDFPage
  private y = 0
  private pageNumber = 0

  constructor(
    private readonly document: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.newPage()
  }

  private newPage() {
    this.page = this.document.addPage([PAGE.width, PAGE.height])
    this.pageNumber += 1
    this.y = PAGE.height - PAGE.margin
    this.page.drawText(`AI Job Search - dossier candidat - page ${this.pageNumber}`, {
      x: PAGE.margin, y: 24, size: 8, font: this.regular, color: rgb(0.38, 0.42, 0.48),
    })
  }

  private ensure(height: number) {
    if (this.y - height < 48) this.newPage()
  }

  heading(text: string, level: 1 | 2 = 2) {
    const size = level === 1 ? 20 : 12
    const spacing = level === 1 ? 26 : 18
    this.ensure(spacing + 12)
    this.page.drawText(pdfSafe(text), {
      x: PAGE.margin, y: this.y, size, font: this.bold,
      color: level === 1 ? rgb(0.08, 0.12, 0.2) : rgb(0.12, 0.28, 0.5),
    })
    this.y -= spacing
  }

  text(text: string, options: { bold?: boolean; size?: number; indent?: number } = {}) {
    const font = options.bold ? this.bold : this.regular
    const size = options.size ?? 10
    const indent = options.indent ?? 0
    const lineHeight = size * 1.42
    for (const line of wrap(text, font, size, PAGE.width - PAGE.margin * 2 - indent)) {
      this.ensure(lineHeight)
      if (line) this.page.drawText(line, { x: PAGE.margin + indent, y: this.y, size, font, color: rgb(0.12, 0.14, 0.18) })
      this.y -= lineHeight
    }
  }

  gap(size = 8) {
    this.y -= size
  }
}

async function documentWriter() {
  const document = await PDFDocument.create()
  const deterministicDate = new Date(0)
  document.setCreationDate(deterministicDate)
  document.setModificationDate(deterministicDate)
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  return { document, writer: new PdfWriter(document, regular, bold) }
}

export async function generateResumePdf(content: ApplicationDossierContent) {
  const { document, writer } = await documentWriter()
  const resume = content.resume
  writer.heading(resume.fullName, 1)
  writer.text([resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedin].filter(Boolean).join(" | "), { size: 9 })
  writer.gap(8)
  writer.heading("Profil")
  writer.text(resume.summary || "Aucun résumé professionnel renseigné.")
  writer.gap()
  writer.heading("Compétences")
  writer.text(resume.skills.map((item) => item.name).join(" - ") || "Aucune compétence renseignée.")
  writer.gap()
  writer.heading("Expériences")
  for (const experience of resume.experiences) {
    writer.text(`${experience.title} - ${experience.company}`, { bold: true })
    writer.text([experience.location, experience.period].filter(Boolean).join(" | "), { size: 9 })
    if (experience.description) writer.text(experience.description)
    writer.gap(6)
  }
  if (resume.education.length) {
    writer.heading("Formation")
    for (const education of resume.education) writer.text(`- ${education.text}`)
  }
  writer.gap(10)
  writer.text(`Version dédiée à ${content.application.jobTitle} chez ${content.application.company}.`, { size: 8 })
  return document.save()
}

export async function generateCoverLetterPdf(content: ApplicationDossierContent) {
  const { document, writer } = await documentWriter()
  writer.heading(content.resume.fullName, 1)
  writer.text([content.resume.contact.email, content.resume.contact.phone, content.resume.contact.location].filter(Boolean).join(" | "), { size: 9 })
  writer.gap(22)
  writer.text(`${content.application.company}\nObjet : Candidature au poste de ${content.application.jobTitle}`, { bold: true })
  writer.gap(18)
  writer.text(content.coverLetter.body, { size: 11 })
  return document.save()
}
