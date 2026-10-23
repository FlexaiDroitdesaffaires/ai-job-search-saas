import Link from "next/link"
import { redirect } from "next/navigation"

import { setInvitedPassword } from "@/app/auth/actions"
import { AuthShell } from "@/components/auth-shell"
import { SubmitButton } from "@/components/submit-button"
import { safeAuthNextPath } from "@/lib/auth/pilot-access"
import { requireUser } from "@/lib/supabase/server"

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next: rawNext } = await searchParams
  const { user } = await requireUser()
  if (!user) redirect("/login?error=Invitation%20invalide%20ou%20expir%C3%A9e.")
  const next = safeAuthNextPath(rawNext ?? null)
  return <AuthShell alternate={<Link className="font-semibold text-indigo-600" href="/login">Retour à la connexion</Link>} eyebrow="Invitation acceptée" title="Créez votre mot de passe" description="Finalisez votre accès personnel au pilote fermé.">
    {error && <p className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <form action={setInvitedPassword} className="space-y-5">
      <input name="next" type="hidden" value={next} />
      <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Mot de passe</span><input autoComplete="new-password" className="field" minLength={8} name="password" required type="password" /></label>
      <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Confirmation</span><input autoComplete="new-password" className="field" minLength={8} name="confirmation" required type="password" /></label>
      <label className="flex items-start gap-3 text-sm leading-6 text-slate-600"><input className="mt-1" name="privacyAcknowledged" required type="checkbox" /> <span>J’ai consulté la <Link className="font-semibold text-indigo-600" href="/privacy" target="_blank">notice de confidentialité</Link>.</span></label>
      <SubmitButton pendingLabel="Enregistrement…">Accéder au pilote</SubmitButton>
    </form>
  </AuthShell>
}
