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
  publishedWithinDays?: 1 | 3 | 7 | 30
  page?: number
  limit?: number
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

export async function fetchEasyJobs(options: EasyJobsSearchOptions = {}, fetcher: typeof fetch = fetch) {
  const endpoint = new URL(EASYJOBS_ENDPOINT)
  endpoint.searchParams.set("location", options.location ?? "France")
  endpoint.searchParams.set("page", String(Math.min(100, Math.max(1, options.page ?? 1))))
  endpoint.searchParams.set("limit", String(Math.min(50, Math.max(1, options.limit ?? 25))))
  if (options.query) endpoint.searchParams.set("query", options.query)
  if (options.contractType) endpoint.searchParams.set("contract_type", options.contractType)
  if (options.publishedWithinDays) endpoint.searchParams.set("published_within_days", String(options.publishedWithinDays))

  const response = await fetcher(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "AI Job Search SaaS/0.1" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`EasyJobs API returned HTTP ${response.status}`)
  const payload = responseSchema.parse(await response.json())
  return {
    jobs: payload.data.map(parseEasyJobsRecord).filter((job): job is SourceJob => job !== null),
    pagination: payload.pagination,
  }
}
