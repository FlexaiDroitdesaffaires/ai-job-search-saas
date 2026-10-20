import { describe, expect, it } from "vitest"

import { parseResumeText } from "@/lib/resume/parser"
import { editableResumeDataSchema } from "@/lib/resume/schema"

describe("parseResumeText", () => {
  it("classe uniquement le texte réellement présent", () => {
    const parsed = parseResumeText(`Jane Doe
jane@example.com

Expérience professionnelle
Développeuse — Exemple SAS
Automatisation de rapports

Compétences
TypeScript, SQL; Supabase

Formation
Master informatique`)

    expect(parsed.contact.email).toBe("jane@example.com")
    expect(parsed.sections.experience).toEqual([
      "Développeuse — Exemple SAS",
      "Automatisation de rapports",
    ])
    expect(parsed.sections.skills).toEqual(["TypeScript", "SQL", "Supabase"])
    expect(parsed.sections.education).toEqual(["Master informatique"])
    expect(parsed.rawText).not.toContain("React")
  })

  it("conserve le texte brut quand aucun titre de section n'est reconnu", () => {
    const parsed = parseResumeText("Une ligne factuelle\nUne seconde ligne")
    expect(parsed.sections.summary).toEqual(["Une ligne factuelle", "Une seconde ligne"])
    expect(parsed.rawText).toBe("Une ligne factuelle\nUne seconde ligne")
  })
})

describe("editableResumeDataSchema", () => {
  it("refuse une correction de contact invalide", () => {
    const result = editableResumeDataSchema.safeParse({
      contact: { email: "pas-un-email" },
      sections: { summary: [], experience: [], education: [], skills: [] },
    })
    expect(result.success).toBe(false)
  })
})
