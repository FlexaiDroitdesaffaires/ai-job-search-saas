import { normalizeSourceJob, verifiedJob } from "./normalize"
import type { IngestionResult, JobListingRepository, SourceJob } from "./types"
import type { UrlVerification } from "./verify-url"

type IngestOptions = {
  jobs: SourceJob[]
  repository: JobListingRepository
  verifyUrl: (url: string) => Promise<UrlVerification | null>
  now?: Date
  maxAgeDays?: number
  limit?: number
}

export async function ingestJobs({
  jobs,
  repository,
  verifyUrl,
  now = new Date(),
  maxAgeDays = 45,
  limit = 25,
}: IngestOptions): Promise<IngestionResult> {
  const result: IngestionResult = {
    received: jobs.length,
    normalized: 0,
    stale: 0,
    invalidUrl: 0,
    invalidApplicationUrl: 0,
    duplicateInBatch: 0,
    inserted: 0,
    updated: 0,
  }
  const minimumDate = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000
  const maximumDate = now.getTime() + 24 * 60 * 60 * 1000
  const unique = new Map<string, SourceJob>()

  for (const rawJob of jobs) {
    const job = normalizeSourceJob(rawJob)
    if (!job) continue
    const postedAt = new Date(job.postedAt).getTime()
    if (postedAt < minimumDate || postedAt > maximumDate) {
      result.stale += 1
      continue
    }
    const key = `${job.provider}:${job.externalId}`
    if (unique.has(key)) result.duplicateInBatch += 1
    unique.set(key, job)
  }

  const candidates = [...unique.values()].slice(0, Math.max(0, limit))
  result.normalized = candidates.length
  const verified = []
  for (let offset = 0; offset < candidates.length; offset += 5) {
    const batch = candidates.slice(offset, offset + 5)
    const checks = await Promise.all(batch.map(async (job) => {
      const verification = await verifyUrl(job.sourceUrl)
      const applicationVerification = job.applicationUrl && job.applicationUrl !== job.sourceUrl
        ? await verifyUrl(job.applicationUrl)
        : verification
      return { job, verification, applicationVerification }
    }))
    for (const { job, verification, applicationVerification } of checks) {
      if (!verification) {
        result.invalidUrl += 1
        continue
      }
      if (job.applicationUrl && !applicationVerification) {
        result.invalidApplicationUrl += 1
        continue
      }
      verified.push(verifiedJob(job, verification, applicationVerification ?? undefined, now))
    }
  }

  const persisted = await repository.upsert(verified)
  result.inserted = persisted.inserted
  result.updated = persisted.updated
  return result
}
