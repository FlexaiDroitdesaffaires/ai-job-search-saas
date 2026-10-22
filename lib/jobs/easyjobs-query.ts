import type { JobCatalogFilters } from "./filters"
import type { EasyJobsSearchOptions } from "./sources/easyjobs"

export const EASYJOBS_PAGE_SIZE = 25
export const EASYJOBS_MAX_PAGE = 100

type CandidateSearchDefaults = {
  currentTitle?: string | null
  location?: string | null
  targetTitles?: string[] | null
  countries?: string[] | null
  cities?: string[] | null
  workModes?: string[] | null
  salaryMin?: number | null
  employmentTypes?: string[] | null
  seniority?: string[] | null
}

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined
}

export function parseEasyJobsPage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const page = Number.parseInt(raw ?? "1", 10)
  return Number.isInteger(page) ? Math.min(EASYJOBS_MAX_PAGE, Math.max(1, page)) : 1
}

export function isFreshEasyJobsOffer(postedAt: string, now = new Date(), maxAgeDays = 30) {
  const timestamp = new Date(postedAt).getTime()
  return Number.isFinite(timestamp)
    && timestamp >= now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000
    && timestamp <= now.getTime() + 24 * 60 * 60 * 1000
}

export function withCandidateDefaults(filters: JobCatalogFilters, defaults: CandidateSearchDefaults): JobCatalogFilters {
  return {
    query: clean(filters.query) ?? clean(defaults.targetTitles?.[0]) ?? clean(defaults.currentTitle),
    location: clean(filters.location) ?? clean(defaults.cities?.[0]) ?? clean(defaults.countries?.[0]) ?? clean(defaults.location) ?? "France",
    employmentTypes: filters.employmentTypes.length ? filters.employmentTypes : (defaults.employmentTypes ?? []),
    workModes: filters.workModes.length ? filters.workModes : (defaults.workModes ?? []),
    salaryMin: filters.salaryMin ?? defaults.salaryMin ?? undefined,
    seniority: filters.seniority ?? (defaults.seniority?.length === 1 ? defaults.seniority[0] : undefined),
  }
}

export type EasyJobsSearchPlan = {
  options: EasyJobsSearchOptions
  residualFilters: JobCatalogFilters
  unsupported: string[]
}

export function buildEasyJobsSearchPlan(filters: JobCatalogFilters, page: number): EasyJobsSearchPlan {
  const options: EasyJobsSearchOptions = {
    query: clean(filters.query),
    location: clean(filters.location) ?? "France",
    publishedWithinDays: 30,
    page: Math.min(EASYJOBS_MAX_PAGE, Math.max(1, page)),
    limit: EASYJOBS_PAGE_SIZE,
  }
  const residualFilters: JobCatalogFilters = {
    query: undefined,
    location: undefined,
    employmentTypes: [...filters.employmentTypes],
    workModes: [...filters.workModes],
    salaryMin: filters.salaryMin,
    seniority: filters.seniority,
  }
  const unsupported: string[] = []

  if (filters.employmentTypes.length === 1) {
    const employment = filters.employmentTypes[0]
    const contracts = { permanent: "CDI", fixed_term: "CDD", temporary: "Intérim" } as const
    if (employment in contracts) options.contractType = contracts[employment as keyof typeof contracts]
    else if (employment === "freelance") options.employmentType = "Freelance"
    else if (employment === "apprenticeship") options.workStudy = true
    else unsupported.push("type de contrat")
    if (!unsupported.includes("type de contrat")) residualFilters.employmentTypes = []
  } else if (filters.employmentTypes.length > 1) {
    unsupported.push("plusieurs types de contrat")
  }

  if (filters.workModes.length === 1) {
    const modes = { onsite: "ONSITE", hybrid: "HYBRID", remote: "REMOTE" } as const
    const mode = modes[filters.workModes[0] as keyof typeof modes]
    if (mode) {
      options.remoteWorkMode = mode
      residualFilters.workModes = []
    }
  } else if (filters.workModes.length > 1) {
    unsupported.push("plusieurs modes de travail")
  }

  if (filters.salaryMin != null) {
    options.salaryMin = filters.salaryMin
    residualFilters.salaryMin = undefined
  }

  if (filters.seniority) {
    options.experience = filters.seniority === "entry" ? "Débutant accepté" : "Expérience exigée"
    residualFilters.seniority = undefined
  }

  return { options, residualFilters, unsupported }
}
