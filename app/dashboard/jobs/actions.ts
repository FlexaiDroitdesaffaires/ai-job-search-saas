"use server"

import { revalidatePath } from "next/cache"

import { prepareApplicationDossierForUser } from "@/lib/applications/prepare-server"
import { takeSensitiveAction } from "@/lib/security/rate-limit"
import { requireUser } from "@/lib/supabase/server"

export type JobDecisionResult =
  | { ok: true; decision: "saved" | "skipped"; applicationId: string | null; preparation: "prepared" | "pending" | null }
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
  if (!takeSensitiveAction("job_decision", user.id).allowed) {
    return { ok: false, message: "Trop de décisions rapprochées. Réessayez plus tard." }
  }

  const { data, error } = await supabase.rpc("decide_job", {
    p_job_id: jobId,
    p_decision: decision,
  })
  if (error) return { ok: false, message: "La décision n’a pas pu être enregistrée." }

  const response = data as { application_id?: string | null; replayed?: boolean } | null
  const applicationId = response?.application_id ?? null
  let preparation: "prepared" | "pending" | null = null
  if (decision === "saved" && applicationId && !response?.replayed) {
    preparation = (await prepareApplicationDossierForUser(supabase, user, applicationId)).ok ? "prepared" : "pending"
  }
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/jobs")
  return { ok: true, decision, applicationId, preparation }
}
