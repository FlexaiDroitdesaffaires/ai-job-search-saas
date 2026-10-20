import Link from "next/link"

import { signUp } from "@/app/auth/actions"
import { SubmitButton } from "@/components/submit-button"

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <section className="w-full space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <div><h1 className="text-2xl font-semibold">Créer votre profil</h1><p className="mt-2 text-sm text-muted-foreground">Commencez par vos informations réelles. Vous pourrez tout corriger.</p></div>
        {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <form action={signUp} className="space-y-4">
          <label className="block space-y-1 text-sm"><span>Nom complet</span><input className="w-full rounded-lg border bg-background px-3 py-2" maxLength={200} name="fullName" required /></label>
          <label className="block space-y-1 text-sm"><span>Email</span><input className="w-full rounded-lg border bg-background px-3 py-2" name="email" required type="email" /></label>
          <label className="block space-y-1 text-sm"><span>Mot de passe</span><input className="w-full rounded-lg border bg-background px-3 py-2" minLength={8} name="password" required type="password" /></label>
          <SubmitButton pendingLabel="Création…">Créer le compte</SubmitButton>
        </form>
        <p className="text-sm text-muted-foreground">Déjà inscrit ? <Link className="text-foreground underline" href="/login">Se connecter</Link></p>
      </section>
    </main>
  )
}
