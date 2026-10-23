import { unstable_cache } from "next/cache"

import { observeServerEvent } from "@/lib/observability/server"

import { filterCatalogJobs } from "./filters"
import { normalizeSourceJob, verifiedJob } from "./normalize"
import { SlidingWindowLimit } from "./request-limit"
import { fetchEasyJobs, EasyJobsHttpError, type EasyJobsSearchOptions } from "./sources/easyjobs"
import { SupabaseJobListingRepository } from "./supabase-repository"
import type { SourceJob } from "./types"
import { isFreshEasyJobsOffer, type EasyJobsSearchPlan } from "./easyjobs-query"
import { createAdminClient } from "../supabase/admin"

const CACHE_SECONDS = 300
const userLimit = new SlidingWindowLimit(12, 60_000)
const outboundLimit = new SlidingWindowLimit(50, 60_000)

export const DYNAMIC_JOB_SELECT = "id,title,company,location,country,work_mode,employment_type,seniority,salary_min,salary_max,salary_currency,description,requirements,source_url,provider,posted_at,dedupe_key,application_mode,application_provider,application_reason"

export type DynamicJobRow = {
  id: string
  title: string
  company: string
  location: string | null
  country: string | null
  work_mode: string | null
  employment_type: string | null
  seniority: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  description: string | null
  requirements: string[]
  source_url: string | null
  provider: string
  posted_at: string | null
  dedupe_key: string
  application_mode: string
  application_provider: string | null
  application_reason: string | null
}

type SearchPayload = Awaited<ReturnType<typeof fetchEasyJobs>>

function partnerCredentials() {
  const partnerId = process.env.EASYJOBS_PARTNER_ID
  const partnerKey = process.env.EASYJOBS_PARTNER_KEY
  if (Boolean(partnerId) !== Boolean(partnerKey)) throw new Error("EasyJobs partner credentials are incomplete")
  return { partnerId, partnerKey }
}

function assertOutboundCapacity() {
  const result = outboundLimit.take("easyjobs")
  if (!result.allowed) throw new EasyJobsHttpError(429, result.retryAfterSeconds)
}

const fetchAnonymousCached = unstable_cache(async (serialized: string) => {
  assertOutboundCapacity()
  return fetchEasyJobs(JSON.parse(serialized) as EasyJobsSearchOptions)
}, ["easyjobs-dynamic-search-v1"], { revalidate: CACHE_SECONDS })

async function searchProvider(options: EasyJobsSearchOptions): Promise<SearchPayload> {
  const credentials = partnerCredentials()
  if (credentials.partnerId && credentials.partnerKey) {
    // EasyJobs marks identified partner responses private/no-store. Never put
    // those personalized responses in the shared Next.js cache.
    assertOutboundCapacity()
    return fetchEasyJobs(options, fetch, credentials)
  }
  return fetchAnonymousCached(JSON.stringify(options))
}

function applyVerifiedQueryFacts(job: SourceJob, options: EasyJobsSearchOptions): SourceJob {
  const workMode = options.remoteWorkMode?.toLowerCase() as SourceJob["workMode"] | undefined
  return {
    ...job,
    workMode: workMode ?? job.workMode,
    employmentType: options.workStudy
      ? "apprenticeship"
      : options.employmentType === "Freelance"
        ? "freelance"
        : job.employmentType,
  }
}

export type DynamicSearchResult = {
  jobs: DynamicJobRow[]
  pagination: SearchPayload["pagination"] | null
  warning: string | null
  unsupported: string[]
}

export async function searchAndCacheEasyJobs(userId: string, plan: EasyJobsSearchPlan): Promise<DynamicSearchResult> {
  const startedAt = Date.now()
  const allowance = userLimit.take(userId)
  if (!allowance.allowed) {
    observeServerEvent("jobs.search", { provider: "easyjobs", outcome: "rate_limited", retryAfterSeconds: allowance.retryAfterSeconds })
    return {
      jobs: [], pagination: null, unsupported: plan.unsupported,
      warning: `Trop de recherches rapprochées. Réessayez dans ${allowance.retryAfterSeconds} s.`,
    }
  }

  try {
    const response = await searchProvider(plan.options)
    const now = new Date()
    const normalized = response.jobs
      .map((job) => normalizeSourceJob(applyVerifiedQueryFacts(job, plan.options)))
      .filter((job): job is SourceJob => Boolean(job))
      .filter((job) => isFreshEasyJobsOffer(job.postedAt, now))
    const relevant = filterCatalogJobs(normalized.map((job) => ({
      source: job,
      title: job.title,
      company: job.company,
      description: job.description,
      location: job.location,
      country: job.country,
      employment_type: job.employmentType ?? null,
      work_mode: job.workMode ?? null,
      salary_min: job.salaryMin ?? null,
      salary_max: job.salaryMax ?? null,
      seniority: job.seniority ?? null,
    })), plan.residualFilters).map((job) => job.source)

    const verifiedAt = new Date()
    const verified = relevant.map((job) => verifiedJob(
      job,
      { status: 200, verifiedAt },
      { status: 200, verifiedAt },
      verifiedAt,
    ))
    const admin = createAdminClient()
    await new SupabaseJobListingRepository(admin).upsert(verified)

    const externalIds = verified.map((job) => job.externalId)
    if (!externalIds.length) {
      observeServerEvent("jobs.search", { provider: "easyjobs", outcome: "succeeded", count: 0, durationMs: Date.now() - startedAt })
      return { jobs: [], pagination: response.pagination, warning: null, unsupported: plan.unsupported }
    }
    const { data, error } = await admin.from("job_listings")
      .select(DYNAMIC_JOB_SELECT)
      .eq("provider", "easyjobs")
      .in("external_id", externalIds)
      .eq("is_active", true)
      .neq("application_mode", "closed_invalid")
    if (error) throw new Error(`Unable to read dynamic jobs: ${error.message}`)
    const jobs = (data ?? []) as unknown as DynamicJobRow[]
    observeServerEvent("jobs.search", { provider: "easyjobs", outcome: "succeeded", count: jobs.length, durationMs: Date.now() - startedAt })
    return {
      jobs,
      pagination: response.pagination,
      warning: null,
      unsupported: plan.unsupported,
    }
  } catch (error) {
    if (error instanceof EasyJobsHttpError && error.status === 429) {
      observeServerEvent("jobs.search", { provider: "easyjobs", outcome: "rate_limited", status: 429, durationMs: Date.now() - startedAt })
      return {
        jobs: [], pagination: null, unsupported: plan.unsupported,
        warning: `EasyJobs limite temporairement les requêtes${error.retryAfterSeconds ? ` (${error.retryAfterSeconds} s)` : ""}. Les offres locales restent disponibles.`,
      }
    }
    observeServerEvent("jobs.search", { provider: "easyjobs", outcome: "failed", errorCode: "PROVIDER_UNAVAILABLE", durationMs: Date.now() - startedAt })
    return {
      jobs: [], pagination: null, unsupported: plan.unsupported,
      warning: "EasyJobs est temporairement indisponible. Les offres locales restent disponibles.",
    }
  }
}
