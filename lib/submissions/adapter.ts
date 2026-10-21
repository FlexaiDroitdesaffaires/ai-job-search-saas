import type { ApplicationDossierContent } from "@/lib/applications/dossier-schema"

export type SubmissionEnvironment = "test" | "production"

export type AdapterCapabilities = {
  canSubmit: boolean
  canVerifyConfirmation: boolean
  supportsIdempotencyKey: boolean
  environments: SubmissionEnvironment[]
  limitations: string[]
}

export type ApprovedApplicationPackage = {
  applicationId: string
  dossierId: string
  dossierHash: string
  provider: string
  environment: SubmissionEnvironment
  idempotencyKey: string
  targetUrl: string | null
  content: ApplicationDossierContent
}

export type PreparedSubmission = {
  payload: Record<string, unknown>
  payloadHash: string
}

export type SubmissionProof = {
  providerConfirmed: true
  providerSubmissionId: string
  adapterId: string
  dossierHash: string
  submittedAt: string
  environment: SubmissionEnvironment
  trackingUrl?: string
  test?: true
  rawReference?: Record<string, unknown>
}

export type SubmitResult =
  | { kind: "confirmed"; proof: SubmissionProof }
  | { kind: "rejected"; message: string; code?: string }
  | { kind: "retryable"; message: string; retryAfterMs?: number; sideEffectPossible: false }
  | { kind: "uncertain"; message: string; diagnostic?: Record<string, unknown>; retryAfterMs?: number }

export type ReconciliationResult =
  | { kind: "confirmed"; proof: SubmissionProof }
  | { kind: "not_found"; message: string }
  | { kind: "inconclusive"; message: string; retryAfterMs?: number }

export interface AtsAdapter {
  readonly id: string
  capabilities(): AdapterCapabilities
  validateDossier(pkg: ApprovedApplicationPackage): string[]
  preparePayload(pkg: ApprovedApplicationPackage): Promise<PreparedSubmission>
  submit(input: { pkg: ApprovedApplicationPackage; prepared: PreparedSubmission }): Promise<SubmitResult>
  reconcile(input: { pkg: ApprovedApplicationPackage; providerSubmissionId: string | null }): Promise<ReconciliationResult>
}

export class WorkerCrashError extends Error {
  constructor(readonly phase: "before_dispatch" | "after_dispatch") {
    super(`Simulated worker crash: ${phase}`)
    this.name = "WorkerCrashError"
  }
}
