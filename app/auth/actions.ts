"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { isPublicSignupEnabled, safeAuthNextPath } from "@/lib/auth/pilot-access"

function authErrorUrl(path: string, message: string) {
  return `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = safeAuthNextPath(typeof formData.get("next") === "string" ? String(formData.get("next")) : null)
  if (!email || !password) redirect(authErrorUrl("/login", "Email et mot de passe requis."))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(authErrorUrl("/login", "Identifiants invalides ou compte non confirmé."))
  redirect(next)
}

export async function signUp(formData: FormData) {
  if (!isPublicSignupEnabled()) redirect(authErrorUrl("/signup", "Pilote sur invitation uniquement."))
  const fullName = String(formData.get("fullName") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!fullName || !email || password.length < 8) {
    redirect(authErrorUrl("/signup", "Nom, email et mot de passe de 8 caractères minimum requis."))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) redirect(authErrorUrl("/signup", "Impossible de créer le compte avec ces informations."))
  if (!data.session) redirect("/login?message=Vérifiez votre email avant de vous connecter.")
  redirect("/onboarding")
}

export async function setInvitedPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "")
  const confirmation = String(formData.get("confirmation") ?? "")
  const next = safeAuthNextPath(String(formData.get("next") ?? ""))
  if (password.length < 8 || password !== confirmation) {
    redirect(authErrorUrl(`/auth/set-password?next=${encodeURIComponent(next)}`, "Les mots de passe doivent correspondre et contenir au moins 8 caractères."))
  }
  if (formData.get("privacyAcknowledged") !== "on") {
    redirect(authErrorUrl(`/auth/set-password?next=${encodeURIComponent(next)}`, "Consultez la notice de confidentialité avant de continuer."))
  }
  const supabase = await createClient()
  const { data: session } = await supabase.auth.getUser()
  if (!session.user) redirect(authErrorUrl("/login", "Invitation invalide ou expirée."))
  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect(authErrorUrl("/auth/set-password", "Le mot de passe n’a pas pu être enregistré."))
  redirect(next)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
