import { describe, expect, it } from "vitest"

import { buildEasyJobsSearchPlan, isFreshEasyJobsOffer, parseEasyJobsPage, withCandidateDefaults } from "@/lib/jobs/easyjobs-query"
import { SlidingWindowLimit } from "@/lib/jobs/request-limit"

describe("dynamic EasyJobs search planning", () => {
  it("uses candidate defaults without widening the API page", () => {
    const filters = withCandidateDefaults({ employmentTypes: [], workModes: [] }, {
      currentTitle: "Développeur TypeScript",
      cities: ["Lyon"],
      employmentTypes: ["permanent"],
      workModes: ["remote"],
      salaryMin: 55_000,
      seniority: ["senior"],
    })
    const plan = buildEasyJobsSearchPlan(filters, 3)
    expect(plan.options).toMatchObject({
      query: "Développeur TypeScript",
      location: "Lyon",
      contractType: "CDI",
      remoteWorkMode: "REMOTE",
      salaryMin: 55_000,
      experience: "Expérience exigée",
      publishedWithinDays: 30,
      page: 3,
      limit: 25,
    })
    expect(plan.residualFilters).toMatchObject({ employmentTypes: [], workModes: [], salaryMin: undefined, seniority: undefined })
  })

  it("keeps unsupported OR filters for bounded post-filtering", () => {
    const plan = buildEasyJobsSearchPlan({
      query: "chef de projet",
      employmentTypes: ["permanent", "fixed_term"],
      workModes: ["hybrid", "remote"],
    }, 1)
    expect(plan.options.contractType).toBeUndefined()
    expect(plan.options.remoteWorkMode).toBeUndefined()
    expect(plan.residualFilters.employmentTypes).toEqual(["permanent", "fixed_term"])
    expect(plan.unsupported).toEqual(["plusieurs types de contrat", "plusieurs modes de travail"])
  })

  it("bounds invalid pagination values", () => {
    expect(parseEasyJobsPage("-4")).toBe(1)
    expect(parseEasyJobsPage("500")).toBe(100)
    expect(parseEasyJobsPage("oops")).toBe(1)
  })

  it("keeps only current offers and tolerates at most one day of clock skew", () => {
    const now = new Date("2026-10-23T12:00:00Z")
    expect(isFreshEasyJobsOffer("2026-09-24T12:00:00Z", now)).toBe(true)
    expect(isFreshEasyJobsOffer("2026-09-22T11:59:59Z", now)).toBe(false)
    expect(isFreshEasyJobsOffer("2026-10-24T12:00:00Z", now)).toBe(true)
    expect(isFreshEasyJobsOffer("2026-10-24T12:00:01Z", now)).toBe(false)
  })
})

describe("EasyJobs request limits", () => {
  it("rejects excess requests and allows them after the window", () => {
    const limit = new SlidingWindowLimit(2, 1_000)
    expect(limit.take("candidate", 0).allowed).toBe(true)
    expect(limit.take("candidate", 100).allowed).toBe(true)
    expect(limit.take("candidate", 200)).toMatchObject({ allowed: false, retryAfterSeconds: 1 })
    expect(limit.take("candidate", 1_101).allowed).toBe(true)
  })
})
