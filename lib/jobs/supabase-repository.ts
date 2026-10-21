import type { SupabaseClient } from "@supabase/supabase-js"

import type { JobListingRepository, VerifiedJob } from "./types"

export class SupabaseJobListingRepository implements JobListingRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async upsert(jobs: VerifiedJob[]) {
    if (jobs.length === 0) return { inserted: 0, updated: 0 }
    const providers = [...new Set(jobs.map((job) => job.provider))]
    if (providers.length !== 1) throw new Error("A repository batch must contain one provider")

    const externalIds = jobs.map((job) => job.externalId)
    const { data: existing, error: readError } = await this.supabase
      .from("job_listings")
      .select("external_id")
      .eq("provider", providers[0])
      .in("external_id", externalIds)
    if (readError) throw new Error(`Unable to read existing jobs: ${readError.message}`)
    const existingIds = new Set((existing ?? []).map((row) => row.external_id as string))

    const rows = jobs.map((job) => ({
      provider: job.provider,
      external_id: job.externalId,
      title: job.title,
      company: job.company,
      company_logo_url: job.companyLogoUrl ?? null,
      location: job.location ?? null,
      country: job.country ?? null,
      work_mode: job.workMode ?? null,
      employment_type: job.employmentType ?? null,
      seniority: job.seniority ?? null,
      salary_min: job.salaryMin ?? null,
      salary_max: job.salaryMax ?? null,
      salary_currency: job.salaryCurrency ?? null,
      description: job.description ?? null,
      requirements: job.requirements,
      source_url: job.sourceUrl,
      application_url: job.applicationUrl ?? null,
      application_mode: job.applicationMode ?? "unknown",
      application_provider: job.applicationProvider ?? null,
      application_external_id: job.applicationExternalId ?? null,
      application_reason: job.applicationReason ?? null,
      source_status: job.sourceStatus ?? "unknown",
      expires_at: job.expiresAt ?? null,
      posted_at: job.postedAt,
      dedupe_key: job.dedupeKey,
      is_demo: false,
      is_active: true,
      last_seen_at: job.lastSeenAt,
      source_url_verified_at: job.sourceUrlVerifiedAt,
      source_url_status: job.sourceUrlStatus,
      application_url_verified_at: job.applicationUrlVerifiedAt ?? null,
      application_url_status: job.applicationUrlStatus ?? null,
    }))
    const { error: writeError } = await this.supabase
      .from("job_listings")
      .upsert(rows, { onConflict: "provider,external_id" })
    if (writeError) throw new Error(`Unable to persist jobs: ${writeError.message}`)

    const updated = jobs.filter((job) => existingIds.has(job.externalId)).length
    return { inserted: jobs.length - updated, updated }
  }
}
