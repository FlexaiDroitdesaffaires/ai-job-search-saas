import { describe, expect, it } from "vitest"

import { ingestJobs } from "@/lib/jobs/ingest"
import { jobDedupeKey } from "@/lib/jobs/normalize"
import { parseRemoteOkRecord, plainTextDescription } from "@/lib/jobs/sources/remoteok"
import type { JobListingRepository, SourceJob, VerifiedJob } from "@/lib/jobs/types"

const sourceJob: SourceJob = {
  provider: "remoteok",
  externalId: "job-1",
  title: "Senior TypeScript Engineer",
  company: "Example GmbH",
  location: "Remote",
  workMode: "remote",
  requirements: ["typescript", "sql"],
  sourceUrl: "https://remoteok.com/remote-jobs/example-job-1",
  postedAt: "2026-10-19T12:00:00.000Z",
}

class MemoryRepository implements JobListingRepository {
  rows = new Map<string, VerifiedJob>()

  async upsert(jobs: VerifiedJob[]) {
    let inserted = 0
    let updated = 0
    for (const job of jobs) {
      const key = `${job.provider}:${job.externalId}`
      if (this.rows.has(key)) updated += 1
      else inserted += 1
      this.rows.set(key, job)
    }
    return { inserted, updated }
  }
}

describe("job ingestion", () => {
  it("normalise un enregistrement Remote OK sans inventer de contenu", () => {
    const parsed = parseRemoteOkRecord({
      id: "123",
      date: "2026-10-19T12:00:00+00:00",
      company: "Example &amp; Co",
      position: "Senior Backend Engineer",
      tags: ["golang", "senior"],
      description: "<p>Build APIs &amp; services.</p>",
      location: "Europe",
      salary_min: 80_000,
      salary_max: 100_000,
      apply_url: "https://remoteok.com/remote-jobs/example-123",
    })
    expect(parsed).toMatchObject({
      provider: "remoteok",
      externalId: "123",
      company: "Example & Co",
      seniority: "senior",
      workMode: "remote",
      description: "Build APIs & services.",
    })
    expect(plainTextDescription("<p>A</p><p>B</p>")).toBe("A\nB")
  })

  it("produit la même clé pour les variantes typographiques", () => {
    expect(jobDedupeKey(sourceJob)).toBe(jobDedupeKey({
      company: "  EXAMPLE GmbH ",
      title: "Senior TypeScript—Engineer",
      location: "remote",
    }))
  })

  it("filtre les offres périmées, URL invalides et doublons de batch", async () => {
    const repository = new MemoryRepository()
    const result = await ingestJobs({
      jobs: [
        sourceJob,
        { ...sourceJob, title: "Latest title" },
        { ...sourceJob, externalId: "old", postedAt: "2026-01-01T00:00:00Z" },
        { ...sourceJob, externalId: "bad-url", sourceUrl: "https://remoteok.com/missing" },
      ],
      repository,
      now: new Date("2026-10-20T12:00:00Z"),
      verifyUrl: async (url) => url.endsWith("missing") ? null : ({ status: 200, verifiedAt: new Date("2026-10-20T12:00:00Z") }),
      limit: 10,
    })
    expect(result).toMatchObject({
      received: 4,
      normalized: 2,
      stale: 1,
      invalidUrl: 1,
      duplicateInBatch: 1,
      inserted: 1,
      updated: 0,
    })
    expect(repository.rows.get("remoteok:job-1")?.title).toBe("Latest title")
  })

  it("rejoue une ingestion sans créer de doublon", async () => {
    const repository = new MemoryRepository()
    const options = {
      jobs: [sourceJob],
      repository,
      now: new Date("2026-10-20T12:00:00Z"),
      verifyUrl: async () => ({ status: 200, verifiedAt: new Date("2026-10-20T12:00:00Z") }),
    }
    expect(await ingestJobs(options)).toMatchObject({ inserted: 1, updated: 0 })
    expect(await ingestJobs(options)).toMatchObject({ inserted: 0, updated: 1 })
    expect(repository.rows).toHaveLength(1)
  })
})
