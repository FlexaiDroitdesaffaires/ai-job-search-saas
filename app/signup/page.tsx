import Link from "next/link"
import { AlertCircle } from "lucide-react"

import { signUp } from "@/app/auth/actions"
import { AuthShell } from "@/components/auth-shell"
import { SubmitButton } from "@/components/submit-button"

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <AuthShell
      alternate={<>Déjà inscrit ? <Link className="font-semibold text-indigo-600 hover:text-indigo-700" href="/login">Se connecter</Link></>}
      description="Quelques minutes suffisent pour créer une base fiable et commencer à comparer les offres."
      eyebrow="Créer votre espace"
      title="Commençons par vous"
    >
        {error && <p className="mb-5 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <form action={signUp} className="space-y-5">
          <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Nom complet</span><input autoComplete="name" className="field" maxLength={200} name="fullName" placeholder="Camille Martin" required /></label>
          <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Adresse email</span><input autoComplete="email" className="field" name="email" placeholder="vous@exemple.fr" required type="email" /></label>
          <label className="block space-y-2 text-sm font-medium text-slate-700"><span>Mot de passe</span><input autoComplete="new-password" className="field" minLength={8} name="password" placeholder="8 caractères minimum" required type="password" /></label>
          <p className="text-xs leading-5 text-slate-500">En continuant, vous créez un espace personnel. Aucun dossier ne sera envoyé sans action explicite de votre part.</p>
          <SubmitButton pendingLabel="Création…">Créer le compte</SubmitButton>
        </form>
    </AuthShell>
  )
}
