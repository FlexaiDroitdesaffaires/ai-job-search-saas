import { describe, expect, it } from "vitest"

import { ingestJobs } from "@/lib/jobs/ingest"
import { normalizeEmploymentType } from "@/lib/jobs/employment-type"
import { jobDedupeKey } from "@/lib/jobs/normalize"
import { classifyApplicationRoute } from "@/lib/jobs/candidability"
import { jobSourceRegistry } from "@/lib/jobs/source-registry"
import { parseAiDevJobsRecord } from "@/lib/jobs/sources/aidevjobs"
import { fetchEasyJobs, parseEasyJobsRecord } from "@/lib/jobs/sources/easyjobs"
import { parseRemoteOkRecord, plainTextDescription } from "@/lib/jobs/sources/remoteok"
import type { JobListingRepository, SourceJob, VerifiedJob } from "@/lib/jobs/types"
import { verifyJobUrl } from "@/lib/jobs/verify-url"

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
      company: "Société Sothebyâ\u0080\u0099s &amp; Co",
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
      company: "Société Sotheby’s & Co",
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

  it("déduplique une localisation française avec ou sans pays", () => {
    expect(jobDedupeKey({ company: "Exemple", title: "Comptable", location: "Paris, France" }))
      .toBe(jobDedupeKey({ company: "Exemple", title: "Comptable", location: "Paris" }))
  })

  it("normalise les huit contrats français sans transformer un temps plein en CDI", () => {
    expect(normalizeEmploymentType({ contractType: "CDI" })).toBe("permanent")
    expect(normalizeEmploymentType({ contractType: "CDD" })).toBe("fixed_term")
    expect(normalizeEmploymentType({ title: "Consultant freelance" })).toBe("freelance")
    expect(normalizeEmploymentType({ contractType: "Intérim" })).toBe("temporary")
    expect(normalizeEmploymentType({ isWorkStudy: true })).toBe("apprenticeship")
    expect(normalizeEmploymentType({ title: "Stage marketing" })).toBe("internship")
    expect(normalizeEmploymentType({ title: "Serveur saisonnier" })).toBe("seasonal")
    expect(normalizeEmploymentType({ title: "Médecin vacataire" })).toBe("occasional")
    expect(normalizeEmploymentType({ employmentType: "Temps-plein" })).toBeUndefined()
    expect(normalizeEmploymentType({ employmentType: "FullTime" })).toBeUndefined()
  })

  it("normalise EasyJobs en conservant le lien attribué et un contrat inconnu", () => {
    const base = {
      id: "128/1/job", title: "Responsable de site", company: "Exemple SA", location: "Lyon",
      work_hours: "Temps plein", salary: null, published_at: "2026-10-22 10:00:00",
      description_excerpt: "Piloter le site.", company_logo_url: null,
      job_url: "https://www.easyjobs.fr/offre-d-emploi/128/1/job/responsable.html?mtm_source=easyjobs_api",
      api_url: "https://api.easyjobs.fr/public/v1/jobs/128/1/job",
    }
    expect(parseEasyJobsRecord({ ...base, contract_type: "CDI" })).toMatchObject({
      provider: "easyjobs", employmentType: "permanent", country: "France",
      applicationMode: "manual_required", applicationUrl: base.job_url,
    })
    expect(parseEasyJobsRecord({ ...base, contract_type: "Autre" })?.employmentType).toBeUndefined()
  })

  it("lit EasyJobs anonymement avec pagination sans clé", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      data: [{
        id: "128/1/job", title: "Aide-soignant", company: "Clinique", location: "Paris",
        contract_type: "CDD", work_hours: "Temps plein", salary: null,
        published_at: "2026-10-22 10:00:00", description_excerpt: "Accompagner les patients.",
        company_logo_url: null,
        job_url: "https://www.easyjobs.fr/offre-d-emploi/128/1/job/aide-soignant.html?mtm_source=easyjobs_api",
        api_url: "https://api.easyjobs.fr/public/v1/jobs/128/1/job",
      }],
      pagination: { page: 1, limit: 25, returned: 1, total_results: 57_186, total_pages: 2288, has_next_page: true },
    }), { status: 200, headers: { "content-type": "application/json" } })
    const result = await fetchEasyJobs({ contractType: "CDD", limit: 25 }, fetcher as typeof fetch)
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]?.employmentType).toBe("fixed_term")
    expect(result.pagination.total_results).toBe(57_186)
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

  it("normalise AI Dev Jobs et détecte l’ATS sans autoriser automatiquement", () => {
    const job = parseAiDevJobsRecord({
      id: "ai-1", title: "AI Engineer", company_name: "Example AI",
      description: "Build reliable AI systems.", location: "Paris, France",
      workplace: "remote", remote_scope: "restricted", job_type: "full-time",
      experience_level: "senior", tags: ["python", "llm"], salary_min: 90_000,
      salary_max: 120_000, apply_url: "https://job-boards.greenhouse.io/example/jobs/12345",
      url: "https://aidevboard.com/job/ai-1", status: "active",
      published_at: "2026-10-20T12:00:00Z", expires_at: "2026-11-20T12:00:00Z",
    })
    expect(job).toMatchObject({ provider: "aidevjobs", employmentType: "full_time", seniority: "senior" })
    expect(classifyApplicationRoute(job!)).toMatchObject({ mode: "unknown", provider: "greenhouse", externalId: "12345" })
  })

  it("classe sans inventer d’autorisation et ferme les offres expirées", () => {
    expect(classifyApplicationRoute({ applicationUrl: "https://jobs.ashbyhq.com/acme/role/application" }))
      .toMatchObject({ mode: "unknown", provider: "ashby" })
    expect(classifyApplicationRoute({ applicationUrl: "https://company.example/careers/1" }))
      .toMatchObject({ mode: "manual_required" })
    expect(classifyApplicationRoute({ sourceStatus: "closed" }))
      .toMatchObject({ mode: "closed_invalid" })
  })

  it("conserve uniquement les sources compatibles avec le produit", () => {
    expect(jobSourceRegistry.filter((source) => source.decision === "active").map((source) => source.id))
      .toEqual(["easyjobs", "remoteok", "aidevjobs"])
    expect(jobSourceRegistry.find((source) => source.id === "weworkremotely")?.decision).toBe("blocked")
    expect(jobSourceRegistry.find((source) => source.id === "greenhouse-public-boards")?.decision).toBe("blocked")
    expect(jobSourceRegistry.find((source) => source.id === "ashby-public-boards")?.decision).toBe("blocked")
  })

  it("conserve une URL employeur protégée sans la déclarer ouverte", async () => {
    const fetcher = async () => new Response(null, {
      status: 403,
      headers: { location: "https://company.example/jobs/1" },
    })
    const verification = await verifyJobUrl("https://company.example/jobs/1", fetcher as typeof fetch)
    expect(verification?.status).toBe(403)
  })

  it("rejette une URL de candidature définitivement absente", async () => {
    const fetcher = async () => new Response(null, { status: 404 })
    await expect(verifyJobUrl("https://company.example/jobs/missing", fetcher as typeof fetch)).resolves.toBeNull()
  })
})
