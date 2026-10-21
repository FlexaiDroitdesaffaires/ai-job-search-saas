import { canonicalJson, sha256Hex } from "@/lib/applications/hash"

import type {
  AdapterCapabilities,
  ApprovedApplicationPackage,
  AtsAdapter,
  PreparedSubmission,
  ReconciliationResult,
  SubmissionProof,
  SubmitResult,
} from "./adapter"
import { WorkerCrashError } from "./adapter"

export type LocalTestScenario =
  | "confirmed"
  | "provider_rejection"
  | "timeout_before_send"
  | "timeout_after_send"
  | "success_without_confirmation"
  | "duplicate"
  | "crash_before_submit"
  | "crash_after_submit"
  | "retry_then_confirm"
  | "reconcile_positive"
  | "reconcile_negative"

export class LocalTestAtsAdapter implements AtsAdapter {
  readonly id = "local-test-ats"
  private calls = 0
  private readonly receipts = new Map<string, SubmissionProof>()

  constructor(private readonly scenario: LocalTestScenario = "confirmed") {}

  capabilities(): AdapterCapabilities {
    return {
      canSubmit: true,
      canVerifyConfirmation: true,
      supportsIdempotencyKey: true,
      environments: ["test"],
      limitations: ["Strictly local fixture", "Never contacts an external ATS"],
    }
  }

  validateDossier(pkg: ApprovedApplicationPackage) {
    const errors: string[] = []
    if (pkg.environment !== "test") errors.push("LOCAL_ADAPTER_TEST_ONLY")
    if (!pkg.content.resume.contact.email) errors.push("EMAIL_REQUIRED")
    if (pkg.content.missingFields.length) errors.push("DOSSIER_HAS_MISSING_FIELDS")
    return errors
  }

  async preparePayload(pkg: ApprovedApplicationPackage): Promise<PreparedSubmission> {
    if (this.scenario === "crash_before_submit") throw new WorkerCrashError("before_dispatch")
    const payload = {
      test: true,
      applicationId: pkg.applicationId,
      dossierId: pkg.dossierId,
      dossierHash: pkg.dossierHash,
      idempotencyKey: pkg.idempotencyKey,
      candidate: {
        name: pkg.content.resume.fullName,
        email: pkg.content.resume.contact.email,
      },
      job: pkg.content.application,
      screeningAnswers: pkg.content.screeningAnswers,
    }
    return { payload, payloadHash: sha256Hex(canonicalJson(payload)) }
  }

  async submit({ pkg }: { pkg: ApprovedApplicationPackage; prepared: PreparedSubmission }): Promise<SubmitResult> {
    this.calls += 1
    const existing = this.receipts.get(pkg.idempotencyKey)
    if (existing) return { kind: "confirmed", proof: existing }

    if (this.scenario === "provider_rejection") return { kind: "rejected", message: "TEST provider refusal", code: "TEST_REJECTED" }
    if (this.scenario === "timeout_before_send") return { kind: "retryable", message: "TEST timeout before send", sideEffectPossible: false, retryAfterMs: 1 }
    if (this.scenario === "retry_then_confirm" && this.calls === 1) return { kind: "retryable", message: "TEST transient network failure", sideEffectPossible: false, retryAfterMs: 1 }

    const proof = this.proof(pkg)
    if (["timeout_after_send", "success_without_confirmation", "crash_after_submit", "reconcile_positive", "duplicate"].includes(this.scenario)) {
      this.receipts.set(pkg.idempotencyKey, proof)
    }
    if (this.scenario === "crash_after_submit") throw new WorkerCrashError("after_dispatch")
    if (this.scenario === "timeout_after_send") return { kind: "uncertain", message: "TEST timeout after send", retryAfterMs: 1 }
    if (this.scenario === "success_without_confirmation") return { kind: "uncertain", message: "TEST response lacked business confirmation", retryAfterMs: 1 }
    if (this.scenario === "reconcile_positive" || this.scenario === "reconcile_negative") return { kind: "uncertain", message: "TEST reconciliation required", retryAfterMs: 1 }

    this.receipts.set(pkg.idempotencyKey, proof)
    return { kind: "confirmed", proof }
  }

  async reconcile({ pkg }: { pkg: ApprovedApplicationPackage; providerSubmissionId: string | null }): Promise<ReconciliationResult> {
    if (this.scenario === "reconcile_negative") return { kind: "not_found", message: "TEST provider lookup returned no confirmation" }
    const proof = this.receipts.get(pkg.idempotencyKey)
    return proof
      ? { kind: "confirmed", proof }
      : { kind: "inconclusive", message: "TEST confirmation still unavailable", retryAfterMs: 1 }
  }

  private proof(pkg: ApprovedApplicationPackage): SubmissionProof {
    const providerSubmissionId = `TEST-${sha256Hex(pkg.idempotencyKey).slice(0, 16)}`
    return {
      providerConfirmed: true,
      providerSubmissionId,
      adapterId: this.id,
      dossierHash: pkg.dossierHash,
      submittedAt: new Date().toISOString(),
      environment: "test",
      trackingUrl: `https://example.test/submissions/${providerSubmissionId}`,
      test: true,
      rawReference: { fixture: true, scenario: this.scenario },
    }
  }
}
