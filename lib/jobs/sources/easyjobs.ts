import { z } from "zod"

import { normalizeEmploymentType } from "../employment-type"
import type { SourceJob } from "../types"

export const EASYJOBS_ENDPOINT = "https://api.easyjobs.fr/public/v1/jobs/search"
export const EASYJOBS_ATTRIBUTION = "EasyJobs"

const summarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).nullable(),
  company: z.string().min(1).nullable(),
  location: z.string().nullable(),
  contract_type: z.string().nullable().optional(),
  work_hours: z.string().nullable().optional(),
  salary: z.string().nullable().optional(),
  published_at: z.string().min(1).nullable(),
  description_excerpt: z.string().nullable().optional(),
  company_logo_url: z.url().nullable().optional(),
  job_url: z.url(),
  api_url: z.url(),
})

const responseSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({
    page: z.number().int(), limit: z.number().int(), returned: z.number().int(),
    total_results: z.number().int(), total_pages: z.number().int(), has_next_page: z.boolean(),
  }),
})

export type EasyJobsSearchOptions = {
  query?: string
  location?: string
  contractType?: "CDI" | "CDD" | "Intérim" | "Franchise" | "Autre"
  employmentType?: "Temps-plein" | "Temps-partiel" | "Temporaire" | "Freelance"
  experience?: "Débutant accepté" | "Expérience exigée"
  salaryMin?: number
  publishedWithinDays?: 1 | 3 | 7 | 30
  remoteWorkMode?: "ONSITE" | "HYBRID" | "REMOTE"
  workStudy?: boolean
  page?: number
  limit?: number
}

export type EasyJobsClientOptions = {
  partnerId?: string
  partnerKey?: string
}

export class EasyJobsHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`EasyJobs API returned HTTP ${status}`)
    this.name = "EasyJobsHttpError"
  }
}

function date(value: string | null) {
  if (!value) return null
  const parsed = new Date(value.replace(" ", "T"))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function parseEasyJobsRecord(value: unknown): SourceJob | null {
  const parsed = summarySchema.safeParse(value)
  if (!parsed.success) return null
  const record = parsed.data
  const postedAt = date(record.published_at)
  if (!record.title || !record.company || !postedAt) return null

  return {
    provider: "easyjobs",
    externalId: record.id,
    title: record.title,
    company: record.company,
    companyLogoUrl: record.company_logo_url ?? undefined,
    location: record.location ?? undefined,
    country: "France",
    employmentType: normalizeEmploymentType({
      contractType: record.contract_type,
      title: record.title,
      description: record.description_excerpt,
    }),
    description: record.description_excerpt?.trim() || undefined,
    requirements: [],
    sourceUrl: record.job_url,
    applicationUrl: record.job_url,
    applicationMode: "manual_required",
    applicationProvider: "easyjobs",
    applicationReason: "EasyJobs impose de poursuivre sur la fiche attribuée; aucune URL ATS externe n’est exposée.",
    sourceStatus: "active",
    postedAt,
  }
}

export async function fetchEasyJobs(
  options: EasyJobsSearchOptions = {},
  fetcher: typeof fetch = fetch,
  client: EasyJobsClientOptions = {},
) {
  if (Boolean(client.partnerId) !== Boolean(client.partnerKey)) {
    throw new Error("EasyJobs partner credentials must be configured together")
  }
  const endpoint = new URL(EASYJOBS_ENDPOINT)
  endpoint.searchParams.set("location", (options.location ?? "France").slice(0, 160))
  endpoint.searchParams.set("page", String(Math.min(100, Math.max(1, options.page ?? 1))))
  endpoint.searchParams.set("limit", String(Math.min(50, Math.max(1, options.limit ?? 25))))
  if (options.query) endpoint.searchParams.set("query", options.query.slice(0, 160))
  if (options.contractType) endpoint.searchParams.set("contract_type", options.contractType)
  if (options.employmentType) endpoint.searchParams.set("employment_type", options.employmentType)
  if (options.experience) endpoint.searchParams.set("experience", options.experience)
  if (options.salaryMin != null) endpoint.searchParams.set("salary_min", String(Math.min(10_000_000, Math.max(0, options.salaryMin))))
  if (options.publishedWithinDays) endpoint.searchParams.set("published_within_days", String(options.publishedWithinDays))
  if (options.remoteWorkMode) endpoint.searchParams.set("remote_work_mode", options.remoteWorkMode)
  if (options.workStudy) endpoint.searchParams.set("work_study", "true")

  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "AI Job Search SaaS/0.1" }
  if (client.partnerId && client.partnerKey) {
    headers["X-EasyJobs-Partner"] = client.partnerId
    headers["X-EasyJobs-Partner-Key"] = client.partnerKey
  }

  const response = await fetcher(endpoint, {
    headers,
    cache: client.partnerId ? "no-store" : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10)
    throw new EasyJobsHttpError(response.status, Number.isFinite(retryAfter) ? retryAfter : undefined)
  }
  const payload = responseSchema.parse(await response.json())
  return {
    jobs: payload.data.map(parseEasyJobsRecord).filter((job): job is SourceJob => job !== null),
    pagination: payload.pagination,
  }
}
