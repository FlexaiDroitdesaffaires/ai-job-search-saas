import { z } from "zod"

import type { SubmissionEnvironment, SubmissionProof } from "./adapter"

const proofSchema = z.object({
  providerConfirmed: z.literal(true),
  providerSubmissionId: z.string().min(1).max(300),
  adapterId: z.string().min(1).max(80),
  dossierHash: z.string().regex(/^[0-9a-f]{64}$/),
  submittedAt: z.iso.datetime({ offset: true }),
  environment: z.enum(["test", "production"]),
  trackingUrl: z.url().max(2048).optional(),
  test: z.literal(true).optional(),
  rawReference: z.record(z.string(), z.unknown()).optional(),
})

export function validateSubmissionProof(
  value: unknown,
  expected: { adapterId: string; dossierHash: string; environment: SubmissionEnvironment },
): SubmissionProof {
  const proof = proofSchema.parse(value)
  if (proof.adapterId !== expected.adapterId) throw new Error("PROOF_ADAPTER_MISMATCH")
  if (proof.dossierHash !== expected.dossierHash) throw new Error("PROOF_DOSSIER_MISMATCH")
  if (proof.environment !== expected.environment) throw new Error("PROOF_ENVIRONMENT_MISMATCH")
  if (expected.environment === "test" && proof.test !== true) throw new Error("TEST_PROOF_NOT_MARKED")
  if (expected.environment === "production" && proof.test === true) throw new Error("TEST_PROOF_FOR_PRODUCTION")
  return proof
}

export function proofToDatabase(proof: SubmissionProof) {
  return {
    provider_confirmed: proof.providerConfirmed,
    provider_submission_id: proof.providerSubmissionId,
    adapter_id: proof.adapterId,
    dossier_hash: proof.dossierHash,
    submitted_at: proof.submittedAt,
    environment: proof.environment,
    tracking_url: proof.trackingUrl,
    test: proof.test,
    raw_reference: proof.rawReference,
  }
}
