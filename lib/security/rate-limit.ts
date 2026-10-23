import { createHash } from "node:crypto"

import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"

export type SensitiveAction = "resume_upload" | "resume_update" | "document_export" | "official_form" | "application_action" | "job_decision" | "easyjobs_user" | "easyjobs_global"

export const sensitiveRateLimitProfiles: Record<SensitiveAction, { maximum: number; windowMs: number }> = {
  resume_upload: { maximum: 5, windowMs: 10 * 60_000 },
  resume_update: { maximum: 30, windowMs: 60_000 },
  document_export: { maximum: 20, windowMs: 60_000 },
  official_form: { maximum: 10, windowMs: 5 * 60_000 },
  application_action: { maximum: 30, windowMs: 60_000 },
  job_decision: { maximum: 60, windowMs: 60_000 },
  easyjobs_user: { maximum: 12, windowMs: 60_000 },
  easyjobs_global: { maximum: 50, windowMs: 60_000 },
}

const responseSchema = z.object({
  allowed: z.boolean(),
  remaining: z.number().int().nonnegative(),
  retry_after_seconds: z.number().int().nonnegative(),
})

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number; unavailable?: boolean }

export function hashRateLimitSubject(action: SensitiveAction, subject: string) {
  return createHash("sha256").update(`${action}:${subject}`).digest("hex")
}

export async function takeSensitiveAction(action: SensitiveAction, subject: string): Promise<RateLimitResult> {
  try {
    const { data, error } = await createAdminClient().rpc("consume_pilot_rate_limit", {
      p_action: action,
      p_subject_hash: hashRateLimitSubject(action, subject),
    })
    const parsed = responseSchema.safeParse(data)
    if (error || !parsed.success) return { allowed: false, retryAfterSeconds: 60, unavailable: true }
    return parsed.data.allowed
      ? { allowed: true, remaining: parsed.data.remaining }
      : { allowed: false, retryAfterSeconds: parsed.data.retry_after_seconds }
  } catch {
    return { allowed: false, retryAfterSeconds: 60, unavailable: true }
  }
}
