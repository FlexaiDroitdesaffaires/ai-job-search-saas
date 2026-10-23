import { SlidingWindowLimit } from "@/lib/jobs/request-limit"

export type SensitiveAction = "resume_upload" | "resume_update" | "document_export" | "official_form" | "application_action" | "job_decision"

export const sensitiveRateLimitProfiles: Record<SensitiveAction, { maximum: number; windowMs: number }> = {
  resume_upload: { maximum: 5, windowMs: 10 * 60_000 },
  resume_update: { maximum: 30, windowMs: 60_000 },
  document_export: { maximum: 20, windowMs: 60_000 },
  official_form: { maximum: 10, windowMs: 5 * 60_000 },
  application_action: { maximum: 30, windowMs: 60_000 },
  job_decision: { maximum: 60, windowMs: 60_000 },
}

const limits = Object.fromEntries(
  Object.entries(sensitiveRateLimitProfiles).map(([action, profile]) => [
    action,
    new SlidingWindowLimit(profile.maximum, profile.windowMs),
  ]),
) as Record<SensitiveAction, SlidingWindowLimit>

export function takeSensitiveAction(action: SensitiveAction, userId: string, now = Date.now()) {
  return limits[action].take(userId, now)
}
