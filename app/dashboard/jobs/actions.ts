"use server"

import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/supabase/server"

export type JobDecisionResult =
  | { ok: true; decision: "saved" | "skipped"; applicationId: string | null }
  | { ok: false; message: string }

export async function decideJob(jobId: string, decision: "saved" | "skipped"): Promise<JobDecisionResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return { ok: false, message: "Identifiant d’offre invalide." }
  }
  if (decision !== "saved" && decision !== "skipped") {
    return { ok: false, message: "Décision invalide." }
  }

  const { supabase, user } = await requireUser()
  if (!user) return { ok: false, message: "Votre session a expiré. Reconnectez-vous." }

  const { data, error } = await supabase.rpc("decide_job", {
    p_job_id: jobId,
    p_decision: decision,
  })
  if (error) return { ok: false, message: error.message }

  const response = data as { application_id?: string | null } | null
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/jobs")
  return { ok: true, decision, applicationId: response?.application_id ?? null }
}
