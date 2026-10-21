export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary"
  | "freelance"

export type Seniority = "entry" | "junior" | "mid" | "senior" | "lead" | "executive"
export type ApplicationMode = "automatic_authorized" | "manual_required" | "unknown" | "closed_invalid"

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
  applicationUrl?: string
  applicationMode?: ApplicationMode
  applicationProvider?: string
  applicationExternalId?: string
  applicationReason?: string
  sourceStatus?: "active" | "closed" | "unknown"
  expiresAt?: string
  postedAt: string
}

export type VerifiedJob = SourceJob & {
  dedupeKey: string
  sourceUrlStatus: number
  sourceUrlVerifiedAt: string
  applicationUrlStatus?: number
  applicationUrlVerifiedAt?: string
  lastSeenAt: string
}

export type IngestionResult = {
  received: number
  normalized: number
  stale: number
  invalidUrl: number
  invalidApplicationUrl: number
  duplicateInBatch: number
  inserted: number
  updated: number
}

export interface JobListingRepository {
  upsert(jobs: VerifiedJob[]): Promise<{ inserted: number; updated: number }>
}
