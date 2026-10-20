export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary"
  | "freelance"

export type Seniority = "entry" | "junior" | "mid" | "senior" | "lead" | "executive"

export type SourceJob = {
  provider: string
  externalId: string
  title: string
  company: string
  companyLogoUrl?: string
  location?: string
  country?: string
  workMode?: "remote" | "hybrid" | "onsite"
  employmentType?: EmploymentType
  seniority?: Seniority
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  description?: string
  requirements: string[]
  sourceUrl: string
  postedAt: string
}

export type VerifiedJob = SourceJob & {
  dedupeKey: string
  sourceUrlStatus: number
  sourceUrlVerifiedAt: string
  lastSeenAt: string
}

export type IngestionResult = {
  received: number
  normalized: number
  stale: number
  invalidUrl: number
  duplicateInBatch: number
  inserted: number
  updated: number
}

export interface JobListingRepository {
  upsert(jobs: VerifiedJob[]): Promise<{ inserted: number; updated: number }>
}
