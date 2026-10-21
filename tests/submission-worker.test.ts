import { describe, expect, it } from "vitest"

import { applicationDossierSchema, type ApplicationDossierContent } from "@/lib/applications/dossier-schema"
import type { AtsAdapter } from "@/lib/submissions/adapter"
import { WorkerCrashError } from "@/lib/submissions/adapter"
import { LocalTestAtsAdapter, type LocalTestScenario } from "@/lib/submissions/local-test-adapter"
import { SubmissionWorker, type SubmissionClaim, type SubmissionRepository } from "@/lib/submissions/worker"

const ids = {
  application: "11111111-1111-4111-8111-111111111111",
  dossier: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  resume: "44444444-4444-4444-8444-444444444444",
}

function dossier(): ApplicationDossierContent {
  return applicationDossierSchema.parse({
    schemaVersion: "application-dossier-v1",
    generation: { method: "deterministic-v1", llmUsed: false },
    application: { applicationId: ids.application, jobId: ids.job, jobTitle: "Engineer", company: "Example", sourceUrl: "https://example.test/job" },
    analysis: { qualifications: [], essentialSkills: ["TypeScript"], mandatoryCriteria: [], comparison: [], matching: {} },
    resume: {
      title: "CV", sourceResumeId: ids.resume, fullName: "Candidate Test",
      contact: { email: "candidate@example.test", phone: "+33000000000", location: "Paris", linkedin: "" },
      summary: "Software engineer", summarySourceReferences: ["profiles.summary"],
      skills: [{ name: "TypeScript", sourceReference: "skills:TypeScript" }], experiences: [], education: [],
    },
    coverLetter: { title: "Letter", body: "Test letter", sourceReferences: ["profiles.summary"], editedByUser: false },
    screeningAnswers: [{ key: "email", question: "Email?", answer: "candidate@example.test", required: true, confirmed: true, needsReview: false, sourceKind: "profile", sourceReference: "profiles.email" }],
    missingFields: [],
  })
}

class MemoryRepository implements SubmissionRepository {
  state: "queued" | "processing" | "retry_scheduled" | "requires_reconciliation" | "confirmed" | "failed" | "needs_manual_action" = "queued"
  dispatched = false
  finishes: Array<Record<string, unknown>> = []
  claim!: SubmissionClaim
  dossierState = "approved"

  async claimSubmission() {
    if (this.state !== "queued" && this.state !== "retry_scheduled") return null
    this.state = "processing"
    this.dispatched = false
    return this.claim
  }
  async claimReconciliation() {
    return this.state === "requires_reconciliation" ? this.claim : null
  }
  async loadPackage() {
    return { content: dossier(), dossierState: this.dossierState, targetUrl: "https://example.test/job" }
  }
  async markDispatched() { this.dispatched = true }
  async finishAttempt(input: Parameters<SubmissionRepository["finishAttempt"]>[0]) {
    this.finishes.push(input)
    this.state = input.outcome === "confirmed" ? "confirmed"
      : input.outcome === "uncertain" || input.sideEffectPossible ? "requires_reconciliation"
        : input.outcome === "retryable" ? "retry_scheduled" : "failed"
  }
  async finishReconciliation(input: Parameters<SubmissionRepository["finishReconciliation"]>[0]) {
    this.finishes.push(input)
    this.state = input.outcome === "confirmed" ? "confirmed"
      : input.outcome === "not_found" ? "needs_manual_action" : "requires_reconciliation"
  }
}

async function fixture(scenario: LocalTestScenario, override?: AtsAdapter) {
  const adapter = override ?? new LocalTestAtsAdapter(scenario)
  const repository = new MemoryRepository()
  const pkg = {
    applicationId: ids.application,
    dossierId: ids.dossier,
    dossierHash: "a".repeat(64),
    provider: adapter.id,
    environment: "test" as const,
    idempotencyKey: "test-idempotency-key",
    targetUrl: "https://example.test/job",
    content: dossier(),
  }
  const prepared = scenario === "crash_before_submit"
    ? await new LocalTestAtsAdapter("confirmed").preparePayload(pkg)
    : await adapter.preparePayload(pkg)
  repository.claim = {
    id: "55555555-5555-4555-8555-555555555555",
    applicationId: ids.application,
    dossierId: ids.dossier,
    dossierHash: pkg.dossierHash,
    idempotencyKey: pkg.idempotencyKey,
    provider: adapter.id,
    payloadHash: prepared.payloadHash,
    environment: "test",
    providerSubmissionId: null,
  }
  const worker = new SubmissionWorker(repository, new Map([[adapter.id, adapter]]), { workerId: "worker-one", leaseSeconds: 30, pollMs: 1 })
  return { adapter, repository, worker }
}

describe("durable submission worker", () => {
  it("records a confirmed local result only as explicit TEST evidence", async () => {
    const { repository, worker } = await fixture("confirmed")
    await worker.runOnce()
    expect(repository.state).toBe("confirmed")
    expect(repository.finishes[0]).toMatchObject({ outcome: "confirmed", evidence: { test: true, environment: "test", provider_confirmed: true } })
  })

  it("retries only failures declared safe before external side effects", async () => {
    const { repository, worker } = await fixture("retry_then_confirm")
    await worker.runOnce()
    expect(repository.state).toBe("retry_scheduled")
    expect(repository.finishes[0]).toMatchObject({ outcome: "retryable", sideEffectPossible: false })
    await worker.runOnce()
    expect(repository.state).toBe("confirmed")
  })

  it("reconciles a timeout after send without a second submission", async () => {
    const { repository, worker } = await fixture("timeout_after_send")
    await worker.runOnce()
    expect(repository.state).toBe("requires_reconciliation")
    expect(repository.finishes[0]).toMatchObject({ outcome: "uncertain", sideEffectPossible: true })
    await worker.runOnce()
    expect(repository.state).toBe("confirmed")
    expect(repository.finishes).toHaveLength(2)
  })

  it("requires human action after a negative reconciliation", async () => {
    const { repository, worker } = await fixture("reconcile_negative")
    await worker.runOnce()
    await worker.runOnce()
    expect(repository.state).toBe("needs_manual_action")
    expect(repository.finishes[1]).toMatchObject({ outcome: "not_found" })
  })

  it("reconciles the exact immutable snapshot after a newer dossier supersedes it", async () => {
    const { repository, worker } = await fixture("timeout_after_send")
    await worker.runOnce()
    repository.dossierState = "superseded"
    await worker.runOnce()
    expect(repository.state).toBe("confirmed")
    expect(repository.finishes).toHaveLength(2)
  })

  it("leaves the lease recoverable when the worker crashes before dispatch", async () => {
    const adapter = new LocalTestAtsAdapter("crash_before_submit")
    const { repository, worker } = await fixture("crash_before_submit", adapter)
    await expect(worker.runOnce()).rejects.toEqual(expect.objectContaining<Partial<WorkerCrashError>>({ phase: "before_dispatch" }))
    expect(repository.dispatched).toBe(false)
    expect(repository.finishes).toEqual([])
  })

  it("leaves an after-dispatch crash for reconciliation", async () => {
    const { repository, worker } = await fixture("crash_after_submit")
    await expect(worker.runOnce()).rejects.toEqual(expect.objectContaining<Partial<WorkerCrashError>>({ phase: "after_dispatch" }))
    expect(repository.dispatched).toBe(true)
    expect(repository.finishes).toEqual([])
  })

  it("rejects invalid proof instead of confirming an HTTP-level success", async () => {
    const base = new LocalTestAtsAdapter("confirmed")
    const adapter: AtsAdapter = {
      ...base,
      id: base.id,
      capabilities: () => base.capabilities(),
      validateDossier: (pkg) => base.validateDossier(pkg),
      preparePayload: (pkg) => base.preparePayload(pkg),
      reconcile: (input) => base.reconcile(input),
      submit: async ({ pkg }) => ({ kind: "confirmed", proof: { ...(await base.submit({ pkg, prepared: await base.preparePayload(pkg) }) as Extract<Awaited<ReturnType<AtsAdapter["submit"]>>, { kind: "confirmed" }>).proof, dossierHash: "b".repeat(64) } }),
    }
    const { repository, worker } = await fixture("confirmed", adapter)
    await worker.runOnce()
    expect(repository.state).toBe("requires_reconciliation")
    expect(repository.finishes[0]).toMatchObject({ outcome: "uncertain", sideEffectPossible: true })
  })

  it("stops its polling loop through AbortSignal", async () => {
    const { worker, repository } = await fixture("confirmed")
    repository.state = "failed"
    const controller = new AbortController()
    const running = worker.run(controller.signal)
    controller.abort()
    await expect(running).resolves.toBeUndefined()
  })
})
