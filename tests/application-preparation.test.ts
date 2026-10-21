import { describe, expect, it } from "vitest"
import { extractText } from "unpdf"

import { dossierFingerprint } from "@/lib/applications/hash"
import { generateCoverLetterPdf, generateResumePdf } from "@/lib/applications/pdf"
import { applyUserEdits, prepareApplicationContent, type PreparationInput } from "@/lib/applications/preparation"

function fixture(): PreparationInput {
  return {
    profile: {
      id: "11111111-1111-1111-8111-111111111111",
      email: "candidate@example.test",
      full_name: "Camille Test",
      phone: null,
      location: "Paris, France",
      linkedin_url: "https://linkedin.com/in/camille-test",
      current_title: "Software Engineer",
      experience_level: "senior",
      summary: "Ingénieure logiciel spécialisée dans les applications web.",
    },
    skills: [
      { id: "skill-1", name: "TypeScript" },
      { id: "skill-2", name: "React" },
      { id: "skill-3", name: "PostgreSQL" },
    ],
    experiences: [{
      id: "experience-1", title: "Software Engineer", company: "Example SAS",
      location: "Paris", start_date: "2022-01-01", end_date: null,
      is_current: true, description: "Développement TypeScript et React.",
    }],
    resume: {
      id: "22222222-2222-2222-8222-222222222222",
      title: "CV principal",
      parsed_data: { sections: { education: ["Master informatique - Université Exemple"] } },
    },
    application: {
      id: "33333333-3333-3333-8333-333333333333",
      job_id: "44444444-4444-4444-8444-444444444444",
      job_title: "Senior TypeScript Engineer",
      company: "Remote Company",
      job_url: "https://example.test/jobs/verified",
    },
    job: {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Senior TypeScript Engineer",
      company: "Remote Company",
      sourceUrl: "https://example.test/jobs/verified",
      location: "Remote", country: "France", workMode: "remote",
      employmentType: "full_time", seniority: "senior",
      salaryMin: 65_000, salaryMax: 80_000, salaryCurrency: "EUR",
      description: "TypeScript and React are required. Kubernetes experience is mandatory.",
      requirements: ["TypeScript", "React", "Kubernetes"],
    },
    preferences: {
      targetTitles: ["Senior TypeScript Engineer"], countries: ["France"],
      cities: ["Paris"], workModes: ["remote"], salaryMin: 60_000,
      salaryCurrency: "EUR", employmentTypes: ["full_time"], seniority: ["senior"],
    },
  }
}

describe("deterministic application preparation", () => {
  it("extracts requirements and uses only candidate facts in generated documents", () => {
    const content = prepareApplicationContent(fixture())
    expect(content.analysis.essentialSkills).toEqual(expect.arrayContaining(["TypeScript", "React", "kubernetes"]))
    expect(content.analysis.mandatoryCriteria.some((value) => value.includes("Kubernetes"))).toBe(true)
    expect(content.analysis.comparison.find((item) => item.requirement === "Kubernetes")?.status).toBe("not_evidenced")
    expect(content.resume.skills.map((item) => item.name)).toEqual(["TypeScript", "React", "PostgreSQL"])
    expect(content.coverLetter.body).toContain("Software Engineer")
    expect(content.coverLetter.body).not.toContain("Kubernetes")
    expect(content.coverLetter.body).not.toContain("10 ans")
    expect(content.generation).toEqual({ method: "deterministic-v1", llmUsed: false })
  })

  it("blocks approval data while required information is missing", () => {
    const content = prepareApplicationContent(fixture())
    expect(content.missingFields).toEqual(["screening.phone"])
    expect(content.screeningAnswers.find((item) => item.key === "phone")).toMatchObject({
      answer: "", required: true, confirmed: false, needsReview: true, sourceKind: "missing",
    })
  })

  it("requires explicit confirmation and traces manual corrections", () => {
    const content = prepareApplicationContent(fixture())
    expect(() => applyUserEdits(content, {
      summary: content.resume.summary,
      coverLetterBody: content.coverLetter.body,
      answers: { phone: "+33 6 00 00 00 00" },
      userConfirmed: false,
    })).toThrow("USER_CONFIRMATION_REQUIRED")

    const edited = applyUserEdits(content, {
      summary: `${content.resume.summary} Disponible immédiatement.`,
      coverLetterBody: `${content.coverLetter.body}\n\nDisponible immédiatement.`,
      answers: { phone: "+33 6 00 00 00 00" },
      userConfirmed: true,
    })
    expect(edited.missingFields).toEqual([])
    expect(edited.resume.summarySourceReferences).toEqual(["user_confirmed:resume.summary"])
    expect(edited.coverLetter).toMatchObject({ editedByUser: true, sourceReferences: ["user_confirmed:cover_letter"] })
    expect(edited.screeningAnswers.find((item) => item.key === "phone")?.sourceReference).toBe("user_confirmed:screening.phone")
  })

  it("calculates a stable SHA-256 fingerprint", () => {
    const content = prepareApplicationContent(fixture())
    const first = dossierFingerprint(content)
    const reordered = Object.fromEntries(Object.entries(content).reverse())
    const second = dossierFingerprint(reordered)
    expect(first).toEqual(second)
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(dossierFingerprint({ ...content, coverLetter: { ...content.coverLetter, body: `${content.coverLetter.body} Modification` } }).hash).not.toBe(first.hash)
  })

  it("generates searchable ATS PDFs for the CV and cover letter", async () => {
    const content = applyUserEdits(prepareApplicationContent(fixture()), {
      summary: prepareApplicationContent(fixture()).resume.summary,
      coverLetterBody: prepareApplicationContent(fixture()).coverLetter.body,
      answers: { phone: "+33 6 00 00 00 00" },
      userConfirmed: true,
    })
    const resume = await generateResumePdf(content)
    const letter = await generateCoverLetterPdf(content)
    expect(Buffer.from(resume).subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(Buffer.from(letter).subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect((await extractText(new Uint8Array(Buffer.from(resume)), { mergePages: true })).text).toContain("Camille Test")
    expect((await extractText(new Uint8Array(Buffer.from(resume)), { mergePages: true })).text).toContain("TypeScript")
    expect((await extractText(new Uint8Array(Buffer.from(letter)), { mergePages: true })).text).toContain("Remote Company")
  })
})
