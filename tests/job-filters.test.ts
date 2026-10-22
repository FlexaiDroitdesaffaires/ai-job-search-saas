import { describe, expect, it } from "vitest"

import { filterCatalogJobs } from "@/lib/jobs/filters"

const jobs = [
  { title: "Comptable", company: "Alpha", location: "Paris", country: "France", employment_type: "permanent", work_mode: "hybrid", salary_min: 40_000, salary_max: 45_000, seniority: "mid", description: "Clôture annuelle" },
  { title: "Développeuse", company: "Beta", location: "Lyon", country: "France", employment_type: "freelance", work_mode: "remote", salary_min: 60_000, salary_max: 75_000, seniority: "senior", description: "TypeScript" },
  { title: "Infirmier", company: "Gamma", location: "Lille", country: "France", employment_type: null, work_mode: "onsite", salary_min: null, salary_max: null, seniority: null, description: "Service de nuit" },
]

describe("job catalog filters", () => {
  it("combine métier, lieu, contrat, salaire, expérience et mode", () => {
    expect(filterCatalogJobs(jobs, {
      query: "typescript", location: "Lyon", employmentTypes: ["freelance"],
      workModes: ["remote"], salaryMin: 70_000, seniority: "senior",
    })).toEqual([jobs[1]])
  })

  it("ne transforme pas un contrat inconnu en CDI", () => {
    expect(filterCatalogJobs(jobs, {
      employmentTypes: ["permanent"], workModes: [],
    })).toEqual([jobs[0]])
  })
})
