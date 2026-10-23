"use server"
import { redirect } from "next/navigation"
import { deleteAccountCompletely } from "@/lib/privacy/account-deletion"
import { takeSensitiveAction } from "@/lib/security/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/supabase/server"

export async function deleteOwnAccount(formData: FormData) {
  const { supabase, user } = await requireUser()
  if (!user?.email) redirect("/login")
  if (String(formData.get("confirmation") ?? "") !== "SUPPRIMER") redirect("/dashboard/account?error=Saisissez%20SUPPRIMER%20pour%20confirmer.")
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: String(formData.get("password") ?? "") })
  if (error) redirect("/dashboard/account?error=Mot%20de%20passe%20incorrect.")
  if (!(await takeSensitiveAction("application_action", user.id)).allowed) redirect("/dashboard/account?error=Action%20temporairement%20indisponible.")
  try { await deleteAccountCompletely(createAdminClient(), user.id) } catch { redirect("/dashboard/account?error=La%20suppression%20n%E2%80%99a%20pas%20pu%20%C3%AAtre%20v%C3%A9rifi%C3%A9e.") }
  redirect("/login?message=Compte%20et%20donn%C3%A9es%20supprim%C3%A9s.")
}
