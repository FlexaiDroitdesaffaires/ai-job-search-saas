import { z } from "zod"

import { plainTextDescription } from "./remoteok"
import type { EmploymentType, Seniority, SourceJob } from "../types"

export const AI_DEV_JOBS_ENDPOINT = "https://aidevboard.com/api/v1/jobs"
export const AI_DEV_JOBS_ATTRIBUTION = "AI Dev Jobs"

const recordSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().default(""),
  company_name: z.string().min(1), company_logo_url: z.string().optional().nullable(),
  location: z.string().optional().nullable(), workplace: z.string().optional().nullable(),
  remote_scope: z.string().optional().nullable(), job_type: z.string().optional().nullable(),
  experience_level: z.string().optional().nullable(), tags: z.array(z.string()).default([]),
  salary_min: z.number().optional().nullable(), salary_max: z.number().optional().nullable(),
  apply_url: z.url(), url: z.url(), status: z.string(), published_at: z.iso.datetime({ offset: true }),
  expires_at: z.iso.datetime({ offset: true }).optional().nullable(),
})

const responseSchema = z.object({ jobs: z.array(z.unknown()) })

function employmentType(value?: string | null): EmploymentType | undefined {
  const normalized = value?.toLowerCase().replace(/[ -]+/g, "_")
  return (["full_time", "part_time", "contract", "internship", "temporary", "freelance"] as const)
    .find((item) => item === normalized)
}

function seniority(value?: string | null): Seniority | undefined {
  const normalized = value?.toLowerCase()
  return (["entry", "junior", "mid", "senior", "lead", "executive"] as const)
    .find((item) => item === normalized)
}

export function parseAiDevJobsRecord(value: unknown): SourceJob | null {
  const parsed = recordSchema.safeParse(value)
  if (!parsed.success) return null
  const record = parsed.data
  return {
    provider: "aidevjobs", externalId: record.id, title: record.title,
    company: record.company_name, companyLogoUrl: record.company_logo_url ?? undefined,
    location: record.location ?? undefined,
    workMode: record.workplace === "remote" ? "remote" : record.workplace === "hybrid" ? "hybrid" : record.workplace === "onsite" ? "onsite" : undefined,
    employmentType: employmentType(record.job_type), seniority: seniority(record.experience_level),
    salaryMin: record.salary_min ?? undefined, salaryMax: record.salary_max ?? undefined,
    salaryCurrency: record.salary_min != null || record.salary_max != null ? "USD" : undefined,
    description: plainTextDescription(record.description), requirements: record.tags,
    sourceUrl: record.url, applicationUrl: record.apply_url,
    sourceStatus: record.status === "active" ? "active" : record.status === "closed" ? "closed" : "unknown",
    expiresAt: record.expires_at ?? undefined, postedAt: record.published_at,
  }
}

export async function fetchAiDevJobs(fetcher: typeof fetch = fetch, limit = 25) {
  const endpoint = new URL(AI_DEV_JOBS_ENDPOINT)
  endpoint.searchParams.set("workplace", "remote")
  endpoint.searchParams.set("limit", String(Math.min(50, Math.max(1, limit))))
  endpoint.searchParams.set("page", "1")
  const response = await fetcher(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "AI Job Search SaaS/0.1" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`AI Dev Jobs API returned HTTP ${response.status}`)
  const payload = responseSchema.parse(await response.json())
  return payload.jobs.map(parseAiDevJobsRecord).filter((job): job is SourceJob => job !== null)
}
