import { verifyJobUrl } from "./verify-url"

export type FreshnessCandidate = {
  provider: string
  source_url: string | null
  last_seen_at: string
  expires_at: string | null
  is_active: boolean
}

export async function isJobFreshForApplication(job: FreshnessCandidate, now = new Date(), fetcher: typeof fetch = fetch) {
  if (!job.is_active) return false
  if (job.expires_at && new Date(job.expires_at).getTime() <= now.getTime()) return false
  if (job.provider !== "easyjobs") return true
  const seenAt = new Date(job.last_seen_at).getTime()
  if (Number.isFinite(seenAt) && seenAt >= now.getTime() - 24 * 60 * 60_000) return true
  if (!job.source_url) return false
  const verification = await verifyJobUrl(job.source_url, fetcher)
  return Boolean(verification && verification.status >= 200 && verification.status < 400)
}
