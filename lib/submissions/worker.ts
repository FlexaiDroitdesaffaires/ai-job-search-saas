import type { ApplicationDossierContent } from "@/lib/applications/dossier-schema"

import type { ApprovedApplicationPackage, AtsAdapter, SubmissionEnvironment } from "./adapter"
import { WorkerCrashError } from "./adapter"
import { proofToDatabase, validateSubmissionProof } from "./evidence"

export type SubmissionClaim = {
  id: string
  applicationId: string
  dossierId: string
  dossierHash: string
  idempotencyKey: string
  provider: string
  payloadHash: string
  environment: SubmissionEnvironment
  providerSubmissionId: string | null
}

export type SubmissionPackageData = {
  content: ApplicationDossierContent
  dossierState: string
  targetUrl: string | null
}

export interface SubmissionRepository {
  claimSubmission(workerId: string, leaseSeconds: number): Promise<SubmissionClaim | null>
  claimReconciliation(workerId: string, leaseSeconds: number): Promise<SubmissionClaim | null>
  loadPackage(claim: SubmissionClaim): Promise<SubmissionPackageData>
  markDispatched(submissionId: string, workerId: string): Promise<void>
  finishAttempt(input: {
    submissionId: string
    workerId: string
    outcome: "confirmed" | "retryable" | "uncertain" | "failed"
    errorMessage?: string
    providerSubmissionId?: string
    evidence?: Record<string, unknown>
    trackingUrl?: string
    retryDelaySeconds?: number
    sideEffectPossible?: boolean
  }): Promise<void>
  finishReconciliation(input: {
    submissionId: string
    workerId: string
    outcome: "confirmed" | "not_found" | "inconclusive"
    errorMessage?: string
    providerSubmissionId?: string
    evidence?: Record<string, unknown>
    trackingUrl?: string
    retryDelaySeconds?: number
  }): Promise<void>
}

export class SubmissionWorker {
  private stopped = false

  constructor(
    private readonly repository: SubmissionRepository,
    private readonly adapters: ReadonlyMap<string, AtsAdapter>,
    private readonly options: { workerId: string; leaseSeconds?: number; pollMs?: number },
  ) {}

  stop() {
    this.stopped = true
  }

  async run(signal?: AbortSignal) {
    this.stopped = false
    while (!this.stopped && !signal?.aborted) {
      const worked = await this.runOnce()
      if (!worked) await wait(this.options.pollMs ?? 1_000, signal)
    }
  }

  async runOnce() {
    const leaseSeconds = this.options.leaseSeconds ?? 60
    const claim = await this.repository.claimSubmission(this.options.workerId, leaseSeconds)
    if (claim) {
      await this.processSubmission(claim)
      return true
    }
    const reconciliation = await this.repository.claimReconciliation(this.options.workerId, leaseSeconds)
    if (reconciliation) {
      await this.processReconciliation(reconciliation)
      return true
    }
    return false
  }

  private adapterFor(claim: SubmissionClaim) {
    const adapter = this.adapters.get(claim.provider)
    if (!adapter) throw new Error(`ADAPTER_NOT_REGISTERED:${claim.provider}`)
    const capabilities = adapter.capabilities()
    if (!capabilities.canSubmit || !capabilities.supportsIdempotencyKey || !capabilities.environments.includes(claim.environment)) {
      throw new Error(`ADAPTER_CAPABILITY_MISMATCH:${claim.provider}`)
    }
    return adapter
  }

  private async packageFor(
    claim: SubmissionClaim,
    options: { allowSuperseded?: boolean } = {},
  ): Promise<{ adapter: AtsAdapter; pkg: ApprovedApplicationPackage }> {
    const adapter = this.adapterFor(claim)
    const data = await this.repository.loadPackage(claim)
    if (data.dossierState !== "approved" && !(options.allowSuperseded && data.dossierState === "superseded")) {
      throw new Error("DOSSIER_NOT_APPROVED")
    }
    const pkg: ApprovedApplicationPackage = {
      applicationId: claim.applicationId,
      dossierId: claim.dossierId,
      dossierHash: claim.dossierHash,
      provider: claim.provider,
      environment: claim.environment,
      idempotencyKey: claim.idempotencyKey,
      targetUrl: data.targetUrl,
      content: data.content,
    }
    const errors = adapter.validateDossier(pkg)
    if (errors.length) throw new Error(`DOSSIER_INVALID:${errors.join(",")}`)
    return { adapter, pkg }
  }

  private async processSubmission(claim: SubmissionClaim) {
    let adapter: AtsAdapter
    let pkg: ApprovedApplicationPackage
    let dispatched = false
    try {
      ({ adapter, pkg } = await this.packageFor(claim))
      const prepared = await adapter.preparePayload(pkg)
      if (prepared.payloadHash !== claim.payloadHash) throw new Error("PAYLOAD_HASH_MISMATCH")
      await this.repository.markDispatched(claim.id, this.options.workerId)
      dispatched = true
      const result = await adapter.submit({ pkg, prepared })
      if (result.kind === "confirmed") {
        const proof = validateSubmissionProof(result.proof, {
          adapterId: adapter.id, dossierHash: claim.dossierHash, environment: claim.environment,
        })
        await this.repository.finishAttempt({
          submissionId: claim.id, workerId: this.options.workerId, outcome: "confirmed",
          providerSubmissionId: proof.providerSubmissionId,
          evidence: proofToDatabase(proof), trackingUrl: proof.trackingUrl,
        })
      } else if (result.kind === "rejected") {
        await this.repository.finishAttempt({ submissionId: claim.id, workerId: this.options.workerId, outcome: "failed", errorMessage: result.message })
      } else if (result.kind === "retryable") {
        await this.repository.finishAttempt({
          submissionId: claim.id, workerId: this.options.workerId, outcome: "retryable",
          errorMessage: result.message, retryDelaySeconds: msToSeconds(result.retryAfterMs), sideEffectPossible: false,
        })
      } else {
        await this.repository.finishAttempt({
          submissionId: claim.id, workerId: this.options.workerId, outcome: "uncertain",
          errorMessage: result.message, retryDelaySeconds: msToSeconds(result.retryAfterMs), sideEffectPossible: true,
        })
      }
    } catch (error) {
      if (error instanceof WorkerCrashError) throw error
      const message = errorMessage(error)
      const permanent = /^(ADAPTER_|DOSSIER_|PAYLOAD_HASH_)/.test(message)
      await this.repository.finishAttempt({
        submissionId: claim.id,
        workerId: this.options.workerId,
        outcome: dispatched ? "uncertain" : permanent ? "failed" : "retryable",
        errorMessage: message,
        sideEffectPossible: dispatched,
      })
    }
  }

  private async processReconciliation(claim: SubmissionClaim) {
    try {
      // The exact immutable snapshot may have become superseded after a
      // possibly successful dispatch. It must still be reconciled by hash.
      const { adapter, pkg } = await this.packageFor(claim, { allowSuperseded: true })
      if (!adapter.capabilities().canVerifyConfirmation) {
        await this.repository.finishReconciliation({
          submissionId: claim.id, workerId: this.options.workerId,
          outcome: "not_found", errorMessage: "Adapter cannot verify confirmation",
        })
        return
      }
      const result = await adapter.reconcile({ pkg, providerSubmissionId: claim.providerSubmissionId })
      if (result.kind === "confirmed") {
        const proof = validateSubmissionProof(result.proof, {
          adapterId: adapter.id, dossierHash: claim.dossierHash, environment: claim.environment,
        })
        await this.repository.finishReconciliation({
          submissionId: claim.id, workerId: this.options.workerId, outcome: "confirmed",
          providerSubmissionId: proof.providerSubmissionId,
          evidence: proofToDatabase(proof), trackingUrl: proof.trackingUrl,
        })
      } else {
        await this.repository.finishReconciliation({
          submissionId: claim.id, workerId: this.options.workerId, outcome: result.kind,
          errorMessage: result.message,
          retryDelaySeconds: result.kind === "inconclusive" ? msToSeconds(result.retryAfterMs) : undefined,
        })
      }
    } catch (error) {
      if (error instanceof WorkerCrashError) throw error
      await this.repository.finishReconciliation({
        submissionId: claim.id, workerId: this.options.workerId,
        outcome: "inconclusive", errorMessage: errorMessage(error),
      })
    }
  }
}

function msToSeconds(value = 30_000) {
  return Math.max(0, Math.ceil(value / 1_000))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown worker error"
}

function wait(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
  })
}
