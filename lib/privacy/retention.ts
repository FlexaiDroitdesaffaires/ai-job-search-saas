import type { SupabaseClient } from "@supabase/supabase-js"

export type PilotRetentionConfig = { inactive_account_days: number; max_resumes_per_user: number; max_resume_bytes_per_user: number }
export async function getPilotRetentionConfig(admin: SupabaseClient): Promise<PilotRetentionConfig> {
  const { data, error } = await admin.from("pilot_retention_config").select("inactive_account_days,max_resumes_per_user,max_resume_bytes_per_user").eq("id", true).single()
  if (error || !data) throw new Error("Retention configuration unavailable")
  return data
}
export function isInactiveBefore(lastActivity: string | null | undefined, createdAt: string, now: Date, days: number) {
  const value = new Date(lastActivity ?? createdAt).getTime()
  return Number.isFinite(value) && value < now.getTime() - days * 86_400_000
}
