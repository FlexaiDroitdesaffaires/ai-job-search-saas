import { describe, expect, it } from "vitest"

import { applicationProgress } from "@/lib/applications/status"
import { computeJobMatch } from "@/lib/matching/engine"
import type { CandidateMatchProfile, MatchableJob } from "@/lib/matching/types"

const profile: CandidateMatchProfile = {
  currentTitle: "Software Engineer",
  experienceLevel: "senior",
  location: "Paris",
  skills: ["TypeScript", "PostgreSQL", "React"],
  experiences: [{ title: "Senior Software Engineer", description: "TypeScript React PostgreSQL APIs" }],
  preferences: {
    targetTitles: ["Senior Software Engineer"],
    countries: ["France"],
    cities: ["Paris"],
    workModes: ["remote", "hybrid"],
    salaryMin: 60_000,
    salaryCurrency: "EUR",
    employmentTypes: ["full_time"],
    seniority: ["senior"],
  },
}

const job: MatchableJob = {
  id: "job-1",
  title: "Senior Software Engineer",
  location: "Paris, France",
  country: "France",
  workMode: "remote",
  employmentType: "full_time",
  seniority: "senior",
  salaryMin: 65_000,
  salaryMax: 80_000,
  salaryCurrency: "EUR",
  description: "Build React APIs with TypeScript and PostgreSQL.",
  requirements: ["TypeScript", "React", "PostgreSQL"],
}

describe("deterministic explainable matching", () => {
  it("is stable and independent from candidate array ordering", () => {
    const first = computeJobMatch(profile, job)
    const second = computeJobMatch({
      ...profile,
      skills: [...profile.skills].reverse(),
      preferences: { ...profile.preferences, targetTitles: [...(profile.preferences?.targetTitles ?? [])].reverse() },
    }, job)
    expect(first).toEqual(second)
    expect(first.score).toBe(100)
    expect(first.disclaimer).toContain("pas une probabilité")
    expect(first.criteria).toHaveLength(8)
  })

  it("makes missing candidate and job data explicit", () => {
    const result = computeJobMatch({ skills: [], experiences: [] }, {
      id: "sparse", title: "Engineer",
    })
    expect(result.score).toBe(0)
    expect(result.missingData).toHaveLength(8)
    expect(result.incompatibilities).toEqual([])
  })

  it("reports explicit incompatibilities without inventing qualifications", () => {
    const result = computeJobMatch(profile, {
      ...job,
      title: "Chief Financial Officer",
      location: "Tokyo, Japan",
      country: "Japan",
      workMode: "onsite",
      employmentType: "internship",
      seniority: "entry",
      salaryMin: 20_000,
      salaryMax: 30_000,
      salaryCurrency: "JPY",
      description: "Accounting audit and treasury.",
      requirements: ["CPA"],
    })
    expect(result.score).toBe(0)
    expect(result.incompatibilities).toHaveLength(8)
    expect(JSON.stringify(result)).not.toContain("probabilité de recrutement: ")
  })

  it("does not compare salary amounts when the job currency is missing", () => {
    const result = computeJobMatch(profile, { ...job, salaryCurrency: null })
    const salary = result.criteria.find((item) => item.key === "salary")
    expect(salary).toMatchObject({ points: 5, status: "neutral" })
    expect(result.missingData).toContain("La devise du salaire de l’offre n’est pas indiquée.")
  })
})

describe("application progress labels", () => {
  it("never labels submitted without evidence as a proven submission", () => {
    expect(applicationProgress({ prep_state: "submitted" })).toContain("incohérent")
    expect(applicationProgress({ prep_state: "submitted", submission_method: "adapter", submission_evidence: { receipt: "ok" } })).toBe("Soumission confirmée par le fournisseur")
    expect(applicationProgress({ prep_state: "submitted", submission_method: "manual", submission_evidence: { confirmed_by_user: true } })).toBe("Envoi déclaré par l’utilisateur")
  })

  it.each([
    ["draft", "Préparation à effectuer"],
    ["ready_for_review", "En cours de préparation"],
    ["approved", "Dossier approuvé"],
    ["needs_manual_action", "Intervention nécessaire"],
    ["failed", "Échec confirmé"],
  ])("maps %s to %s", (prepState, label) => {
    expect(applicationProgress({ prep_state: prepState })).toBe(label)
  })

  it("keeps local test confirmations distinct from real submissions", () => {
    expect(applicationProgress({
      prep_state: "approved",
      submission: { state: "confirmed", environment: "test" },
    })).toBe("Test local confirmé — aucune candidature réelle")
    expect(applicationProgress({
      prep_state: "submitting",
      submission: { state: "requires_reconciliation", environment: "production" },
    })).toBe("Résultat incertain")
  })
})
