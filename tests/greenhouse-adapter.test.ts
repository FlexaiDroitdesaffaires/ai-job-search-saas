import { describe, expect, it, vi } from "vitest"

import { applicationDossierSchema } from "@/lib/applications/dossier-schema"
import type { ApprovedApplicationPackage } from "@/lib/submissions/adapter"
import { GreenhouseAdapter, parseGreenhouseTarget } from "@/lib/submissions/greenhouse-adapter"

const jobId = "12345"

function applicationPackage(): ApprovedApplicationPackage {
  const applicationId = "11111111-1111-4111-8111-111111111111"
  return {
    applicationId,
    dossierId: "22222222-2222-4222-8222-222222222222",
    dossierHash: "a".repeat(64), provider: "greenhouse-job-board", environment: "production",
    idempotencyKey: "greenhouse-test-key", targetUrl: `https://job-boards.greenhouse.io/example/jobs/${jobId}`,
    content: applicationDossierSchema.parse({
      schemaVersion: "application-dossier-v1", generation: { method: "deterministic-v1", llmUsed: false },
      application: { applicationId, jobId: "33333333-3333-4333-8333-333333333333", jobTitle: "Engineer", company: "Example", sourceUrl: `https://job-boards.greenhouse.io/example/jobs/${jobId}` },
      analysis: { qualifications: [], essentialSkills: ["TypeScript"], mandatoryCriteria: [], comparison: [], matching: {} },
      resume: {
        title: "CV", sourceResumeId: "44444444-4444-4444-8444-444444444444", fullName: "Candidate Test",
        contact: { email: "candidate@example.test", phone: "+33000000000", location: "Paris", linkedin: "" },
        summary: "Software engineer", summarySourceReferences: ["profiles.summary"],
        skills: [{ name: "TypeScript", sourceReference: "skills:TypeScript" }], experiences: [], education: [],
      },
      coverLetter: { title: "Letter", body: "Factual letter.", sourceReferences: ["profiles.summary"], editedByUser: false },
      screeningAnswers: [{ key: "work_auth", question: "Authorized?", answer: "Yes", required: true, confirmed: true, needsReview: false, sourceKind: "user_confirmed", sourceReference: "user:work_auth" }],
      missingFields: [],
    }),
  }
}

function greenhouseForm(overrides: Record<string, unknown> = {}) {
  return {
    id: Number(jobId), title: "Engineer", data_compliance: [], location_questions: [],
    questions: [
      { required: true, label: "First Name", fields: [{ name: "first_name", type: "input_text" }] },
      { required: true, label: "Last Name", fields: [{ name: "last_name", type: "input_text" }] },
      { required: true, label: "Email", fields: [{ name: "email", type: "input_text" }] },
      { required: true, label: "Resume", fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
      { required: true, label: "Work authorization", fields: [{ name: "question_42", type: "input_text" }] },
    ],
    ...overrides,
  }
}

function adapter(fetcher?: typeof fetch) {
  const form = {
    ...greenhouseForm(),
  }
  return new GreenhouseAdapter({
    boardToken: "example", apiKey: "TEST-KEY-NOT-REAL", employerAuthorizationId: "TEST-AUTHORIZATION",
    allowedJobIds: new Set([jobId]), fieldMappings: { work_auth: "question_42" }, submissionEnabled: true,
    fetcher: fetcher ?? (async () => Response.json(form)) as typeof fetch,
  })
}

describe("Greenhouse adapter preparation", () => {
  it("extracts only explicit Greenhouse board targets", () => {
    expect(parseGreenhouseTarget(`https://job-boards.greenhouse.io/example/jobs/${jobId}`)).toEqual({ boardToken: "example", jobId })
    expect(parseGreenhouseTarget("https://example.test/jobs/12345")).toBeNull()
  })

  it("builds a factual stable payload but stays ineligible for the D1 worker", async () => {
    const instance = adapter()
    expect(instance.capabilities()).toMatchObject({ canSubmit: true, supportsIdempotencyKey: false, canVerifyConfirmation: false })
    const pkg = applicationPackage()
    expect(instance.validateDossier(pkg)).toEqual([])
    const first = await instance.preparePayload(pkg)
    const second = await instance.preparePayload(pkg)
    expect(first).toEqual(second)
    expect(first.payload).toMatchObject({ fields: { first_name: "Candidate", last_name: "Test", email: "candidate@example.test", question_42: "Yes" } })
    const fields = first.payload.fields as Record<string, string>
    expect(fields.resume_content_filename).toBe("resume.pdf")
    expect(fields.cover_letter_content_filename).toBe("cover-letter.pdf")
    expect(Buffer.from(fields.resume_content, "base64").subarray(0, 4).toString()).toBe("%PDF")
    expect(Buffer.from(fields.cover_letter_content, "base64").subarray(0, 4).toString()).toBe("%PDF")
    expect(fields.resume_text).toBeUndefined()
    expect(fields.cover_letter_text).toBeUndefined()
    expect(JSON.stringify(first.payload)).not.toContain("invented")
  })

  it("refuses an employer or job outside the explicit authorization", () => {
    const pkg = applicationPackage()
    pkg.targetUrl = "https://job-boards.greenhouse.io/other/jobs/99999"
    expect(adapter().validateDossier(pkg)).toEqual(expect.arrayContaining(["GREENHOUSE_BOARD_NOT_AUTHORIZED", "GREENHOUSE_JOB_NOT_AUTHORIZED"]))
  })

  it("never converts an HTTP 200 into confirmed evidence", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({}) : Response.json(greenhouseForm()))
    const instance = adapter(fetchMock as unknown as typeof fetch)
    const pkg = applicationPackage()
    const result = await instance.submit({ pkg, prepared: await instance.preparePayload(pkg) })
    expect(result).toMatchObject({ kind: "uncertain", diagnostic: { httpStatus: 200 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "POST"])
  })

  it("keeps a network outcome uncertain and cannot reconcile it automatically", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") return Response.json(greenhouseForm())
      throw new TypeError("timeout")
    }) as unknown as typeof fetch
    const instance = adapter(fetcher)
    const pkg = applicationPackage()
    expect(await instance.submit({ pkg, prepared: await instance.preparePayload(pkg) })).toMatchObject({ kind: "uncertain" })
    expect(await instance.reconcile()).toMatchObject({ kind: "inconclusive" })
  })

  it("blocks preparation when the official form has an unanswered required field", async () => {
    const fetcher = vi.fn(async () => Response.json(greenhouseForm({
      location_questions: [{ required: true, label: "Latitude", fields: [{ name: "latitude", type: "input_hidden" }] }],
    }))) as unknown as typeof fetch
    await expect(adapter(fetcher).preparePayload(applicationPackage()))
      .rejects.toThrow("GREENHOUSE_REQUIRED_FIELDS_MISSING:Latitude")
  })

  it("requires explicit confirmed compliance consent when the employer form requires it", async () => {
    const fetcher = vi.fn(async () => Response.json(greenhouseForm({
      data_compliance: [{ type: "gdpr", requires_processing_consent: true }],
    }))) as unknown as typeof fetch
    await expect(adapter(fetcher).preparePayload(applicationPackage()))
      .rejects.toThrow("GREENHOUSE_REQUIRED_FIELDS_MISSING:data_compliance.gdpr_processing_consent_given")
  })
})
