import Link from "next/link"
import { AlertCircle, Info } from "lucide-react"

import { signIn } from "@/app/auth/actions"
import { AuthShell } from "@/components/auth-shell"
import { SubmitButton } from "@/components/submit-button"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>
}) {
  const params = await searchParams
  return (
    <AuthShell
      alternate={<>Pas encore de compte ? <Link className="font-semibold text-indigo-600 hover:text-indigo-700" href="/signup">Créer mon profil</Link></>}
      description="Retrouvez vos offres, vos dossiers et la prochaine action utile."
      eyebrow="Bon retour"
      title="Connectez-vous"
    >
        {params.error && <p className="mb-5 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{params.error}</p>}
        {params.message && <p className="mb-5 flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-700"><Info className="mt-0.5 size-4 shrink-0" />{params.message}</p>}
        <form action={signIn} className="space-y-5">
          <input name="next" type="hidden" value={params.next ?? "/onboarding"} />
          <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Adresse email</span><input autoComplete="email" className="field" name="email" placeholder="vous@exemple.fr" required type="email" /></label>
          <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Mot de passe</span><input autoComplete="current-password" className="field" minLength={8} name="password" placeholder="8 caractères minimum" required type="password" /></label>
          <SubmitButton pendingLabel="Connexion…">Se connecter</SubmitButton>
        </form>
    </AuthShell>
  )
}
