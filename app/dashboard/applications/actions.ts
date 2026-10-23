"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { type AssistedDecision } from "@/lib/applications/assisted"
import { applicationDossierSchema } from "@/lib/applications/dossier-schema"
import { applyUserEdits } from "@/lib/applications/preparation"
import { persistApplicationDossier, prepareApplicationDossierForUser } from "@/lib/applications/prepare-server"
import { takeSensitiveAction } from "@/lib/security/rate-limit"
import { requireUser } from "@/lib/supabase/server"

const idSchema = z.uuid()

function destination(applicationId: string, key: "error" | "saved" | "approved" | "assisted", message: string): never {
  redirect(`/dashboard/applications/${applicationId}?${key}=${encodeURIComponent(message)}`)
}

async function authenticated() {
  const result = await requireUser()
  if (!result.user) redirect("/login")
  const rateLimit = await takeSensitiveAction("application_action", result.user.id)
  if (!rateLimit.allowed) redirect("/dashboard?error=Trop%20de%20tentatives.%20R%C3%A9essayez%20plus%20tard.")
  return { supabase: result.supabase, user: result.user }
}

export async function prepareApplication(formData: FormData) {
  const applicationId = idSchema.safeParse(formData.get("applicationId"))
  if (!applicationId.success) redirect("/dashboard?error=Identifiant%20invalide")
  const { supabase, user } = await authenticated()

  const result = await prepareApplicationDossierForUser(supabase, user, applicationId.data)
  if (!result.ok) destination(applicationId.data, "error", result.message)
  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/applications/${applicationId.data}`)
  destination(applicationId.data, "saved", "Dossier préparé sans envoi.")
}

export async function saveApplicationDossier(formData: FormData) {
  const applicationId = idSchema.safeParse(formData.get("applicationId"))
  const dossierId = idSchema.safeParse(formData.get("dossierId"))
  if (!applicationId.success || !dossierId.success) redirect("/dashboard?error=Identifiant%20invalide")
  const { supabase, user } = await authenticated()
  const { data: dossier, error: readError } = await supabase.from("application_dossiers")
    .select("content,content_hash")
    .eq("id", dossierId.data).eq("application_id", applicationId.data).eq("user_id", user.id).single()
  const parsed = applicationDossierSchema.safeParse(dossier?.content)
  if (readError || !parsed.success) destination(applicationId.data, "error", "Dossier introuvable ou invalide.")

  const answers = Object.fromEntries(parsed.data.screeningAnswers.map((item) => [item.key, String(formData.get(`answer:${item.key}`) ?? "")]))
  let content
  try {
    content = applyUserEdits(parsed.data, {
      summary: String(formData.get("summary") ?? ""),
      coverLetterBody: String(formData.get("coverLetterBody") ?? ""),
      answers,
      userConfirmed: formData.get("userConfirmed") === "on",
    })
  } catch {
    destination(applicationId.data, "error", "Confirmez que les corrections saisies sont exactes.")
  }
  const { error } = await persistApplicationDossier(supabase, applicationId.data, content.resume.sourceResumeId, content)
  if (error) destination(applicationId.data, "error", "La nouvelle version n’a pas pu être enregistrée.")
  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/applications/${applicationId.data}`)
  destination(applicationId.data, "saved", "Nouvelle version enregistrée. Toute approbation antérieure est invalidée.")
}

export async function approveApplicationDossier(formData: FormData) {
  const applicationId = idSchema.safeParse(formData.get("applicationId"))
  const dossierId = idSchema.safeParse(formData.get("dossierId"))
  const contentHash = z.string().regex(/^[0-9a-f]{64}$/).safeParse(formData.get("contentHash"))
  if (!applicationId.success || !dossierId.success || !contentHash.success) redirect("/dashboard?error=Approbation%20invalide")
  const { supabase } = await authenticated()
  const { error } = await supabase.rpc("approve_application_dossier", {
    p_application_id: applicationId.data,
    p_dossier_id: dossierId.data,
    p_expected_hash: contentHash.data,
  })
  if (error) destination(applicationId.data, "error", "Approbation impossible. Réessayez plus tard.")
  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/applications/${applicationId.data}`)
  destination(applicationId.data, "approved", "Dossier approuvé et figé. Il n’est pas envoyé.")
}

export async function recordAssistedApplicationDecision(formData: FormData) {
  const applicationId = idSchema.safeParse(formData.get("applicationId"))
  const decision = z.enum(["sent", "not_sent", "unable"]).safeParse(formData.get("decision"))
  if (!applicationId.success || !decision.success) redirect("/dashboard?error=Déclaration%20invalide")
  if (decision.data === "sent" && formData.get("userConfirmedSend") !== "on") {
    destination(applicationId.data, "error", "Confirmez que vous avez vous-même envoyé la candidature.")
  }
  const { supabase } = await authenticated()
  const { error } = await supabase.rpc("record_assisted_application_decision", {
    p_application_id: applicationId.data,
    p_decision: decision.data satisfies AssistedDecision,
  })
  if (error) destination(applicationId.data, "error", "Déclaration impossible. Réessayez plus tard.")

  const messages: Record<AssistedDecision, string> = {
    sent: "Déclaration enregistrée : vous indiquez avoir envoyé la candidature. Aucune confirmation ATS n’a été créée.",
    not_sent: "Décision enregistrée : candidature pas encore envoyée.",
    unable: "Décision enregistrée : impossible de candidater.",
  }
  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/applications/${applicationId.data}`)
  destination(applicationId.data, "assisted", messages[decision.data])
}
