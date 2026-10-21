import type { SupabaseClient } from "@supabase/supabase-js"

import { applicationDossierSchema } from "@/lib/applications/dossier-schema"

import type { ApprovedApplicationPackage, AtsAdapter, SubmissionEnvironment } from "./adapter"
import type { SubmissionClaim, SubmissionPackageData, SubmissionRepository } from "./worker"

type SubmissionRow = {
  id: string
  application_id: string
  dossier_id: string
  dossier_hash: string
  idempotency_key: string
  provider: string
  payload_hash: string
  environment: SubmissionEnvironment
  provider_submission_id: string | null
}

export class SupabaseSubmissionRepository implements SubmissionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimSubmission(workerId: string, leaseSeconds: number) {
    const { data, error } = await this.supabase.rpc("claim_application_submission", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    })
    if (error) throw error
    return data ? mapClaim(data as SubmissionRow) : null
  }

  async claimReconciliation(workerId: string, leaseSeconds: number) {
    const { data, error } = await this.supabase.rpc("claim_application_reconciliation", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    })
    if (error) throw error
    return data ? mapClaim(data as SubmissionRow) : null
  }

  async loadPackage(claim: SubmissionClaim): Promise<SubmissionPackageData> {
    const [dossier, application] = await Promise.all([
      this.supabase.from("application_dossiers")
        .select("id,state,content,content_hash")
        .eq("id", claim.dossierId).eq("application_id", claim.applicationId).single(),
      this.supabase.from("applications").select("id,job_url").eq("id", claim.applicationId).single(),
    ])
    if (dossier.error) throw dossier.error
    if (application.error) throw application.error
    if (dossier.data.content_hash !== claim.dossierHash) throw new Error("DOSSIER_HASH_MISMATCH")
    return {
      content: applicationDossierSchema.parse(dossier.data.content),
      dossierState: dossier.data.state,
      targetUrl: application.data.job_url,
    }
  }

  async markDispatched(submissionId: string, workerId: string) {
    const { error } = await this.supabase.rpc("mark_application_submission_dispatched", {
      p_submission_id: submissionId,
      p_worker_id: workerId,
    })
    if (error) throw error
  }

  async finishAttempt(input: Parameters<SubmissionRepository["finishAttempt"]>[0]) {
    const { error } = await this.supabase.rpc("finish_application_submission_attempt", {
      p_submission_id: input.submissionId,
      p_worker_id: input.workerId,
      p_outcome: input.outcome,
      p_error_message: input.errorMessage ?? null,
      p_provider_submission_id: input.providerSubmissionId ?? null,
      p_evidence: input.evidence ?? null,
      p_tracking_url: input.trackingUrl ?? null,
      p_retry_delay_seconds: input.retryDelaySeconds ?? 30,
      p_side_effect_possible: input.sideEffectPossible ?? false,
    })
    if (error) throw error
  }

  async finishReconciliation(input: Parameters<SubmissionRepository["finishReconciliation"]>[0]) {
    const { error } = await this.supabase.rpc("finish_application_reconciliation", {
      p_submission_id: input.submissionId,
      p_worker_id: input.workerId,
      p_outcome: input.outcome,
      p_error_message: input.errorMessage ?? null,
      p_provider_submission_id: input.providerSubmissionId ?? null,
      p_evidence: input.evidence ?? null,
      p_tracking_url: input.trackingUrl ?? null,
      p_retry_delay_seconds: input.retryDelaySeconds ?? 60,
      p_max_reconciliation_attempts: 3,
    })
    if (error) throw error
  }
}

export async function enqueueApprovedApplication(
  supabase: SupabaseClient,
  adapter: AtsAdapter,
  input: {
    applicationId: string
    dossierId: string
    idempotencyKey: string
    environment: SubmissionEnvironment
    maxAttempts?: number
  },
) {
  const capabilities = adapter.capabilities()
  if (!capabilities.canSubmit || !capabilities.supportsIdempotencyKey || !capabilities.environments.includes(input.environment)) {
    throw new Error("ADAPTER_CAPABILITY_MISMATCH")
  }
  const repository = new SupabaseSubmissionRepository(supabase)
  const provisional: SubmissionClaim = {
    id: "pending",
    applicationId: input.applicationId,
    dossierId: input.dossierId,
    dossierHash: "",
    idempotencyKey: input.idempotencyKey,
    provider: adapter.id,
    payloadHash: "",
    environment: input.environment,
    providerSubmissionId: null,
  }
  const { data: dossier, error: dossierError } = await supabase.from("application_dossiers")
    .select("content_hash").eq("id", input.dossierId).eq("application_id", input.applicationId).single()
  if (dossierError) throw dossierError
  provisional.dossierHash = dossier.content_hash
  const data = await repository.loadPackage(provisional)
  if (data.dossierState !== "approved") throw new Error("DOSSIER_NOT_APPROVED")
  const pkg: ApprovedApplicationPackage = {
    applicationId: input.applicationId,
    dossierId: input.dossierId,
    dossierHash: dossier.content_hash,
    provider: adapter.id,
    environment: input.environment,
    idempotencyKey: input.idempotencyKey,
    targetUrl: data.targetUrl,
    content: data.content,
  }
  const validationErrors = adapter.validateDossier(pkg)
  if (validationErrors.length) throw new Error(`DOSSIER_INVALID:${validationErrors.join(",")}`)
  const prepared = await adapter.preparePayload(pkg)
  const { data: result, error } = await supabase.rpc("enqueue_application_submission", {
    p_application_id: input.applicationId,
    p_dossier_id: input.dossierId,
    p_idempotency_key: input.idempotencyKey,
    p_provider: adapter.id,
    p_payload_hash: prepared.payloadHash,
    p_environment: input.environment,
    p_max_attempts: input.maxAttempts ?? 5,
  })
  if (error) throw error
  return result as { submission_id: string; state: string; replayed: boolean }
}

function mapClaim(row: SubmissionRow): SubmissionClaim {
  if (!row.dossier_id || !row.dossier_hash || !row.provider || !row.payload_hash) {
    throw new Error("INCOMPLETE_SUBMISSION_CLAIM")
  }
  return {
    id: row.id,
    applicationId: row.application_id,
    dossierId: row.dossier_id,
    dossierHash: row.dossier_hash,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    payloadHash: row.payload_hash,
    environment: row.environment,
    providerSubmissionId: row.provider_submission_id,
  }
}
