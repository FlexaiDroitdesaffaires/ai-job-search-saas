"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

function authErrorUrl(path: string, message: string) {
  return `${path}?error=${encodeURIComponent(message)}`
}

function safeNextPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/onboarding"
  }
  return value
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = safeNextPath(formData.get("next"))
  if (!email || !password) redirect(authErrorUrl("/login", "Email et mot de passe requis."))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(authErrorUrl("/login", "Identifiants invalides ou compte non confirmé."))
  redirect(next)
}

export async function signUp(formData: FormData) {
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

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
