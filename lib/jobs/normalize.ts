import { createHash } from "node:crypto"

import type { SourceJob, VerifiedJob } from "./types"

function canonical(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function jobDedupeKey(job: Pick<SourceJob, "company" | "title" | "location">) {
  const identity = [canonical(job.company), canonical(job.title), canonical(job.location)].join("|")
  return createHash("sha256").update(identity).digest("hex")
}

export function normalizeSourceJob(job: SourceJob): SourceJob | null {
  const title = job.title.replace(/\s+/g, " ").trim()
  const company = job.company.replace(/\s+/g, " ").trim()
  const externalId = job.externalId.trim()
  if (!title || !company || !externalId) return null

  let sourceUrl: URL
  try {
    sourceUrl = new URL(job.sourceUrl)
  } catch {
    return null
  }
  if (sourceUrl.protocol !== "https:") return null

  const postedAt = new Date(job.postedAt)
  if (Number.isNaN(postedAt.getTime())) return null

  return {
    ...job,
    externalId,
    title,
    company,
    location: job.location?.replace(/\s+/g, " ").trim() || undefined,
    description: job.description?.trim() || undefined,
    requirements: [...new Set(job.requirements.map((value) => value.trim()).filter(Boolean))].slice(0, 100),
    sourceUrl: sourceUrl.toString(),
    postedAt: postedAt.toISOString(),
  }
}

export function verifiedJob(
  job: SourceJob,
  verification: { status: number; verifiedAt: Date },
  seenAt: Date,
): VerifiedJob {
  return {
    ...job,
    dedupeKey: jobDedupeKey(job),
    sourceUrlStatus: verification.status,
    sourceUrlVerifiedAt: verification.verifiedAt.toISOString(),
    lastSeenAt: seenAt.toISOString(),
  }
}
