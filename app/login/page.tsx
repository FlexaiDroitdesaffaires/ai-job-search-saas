import Link from "next/link"

import { signIn } from "@/app/auth/actions"
import { SubmitButton } from "@/components/submit-button"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>
}) {
  const params = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <section className="w-full space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Connexion</h1>
          <p className="mt-2 text-sm text-muted-foreground">Retrouvez votre profil et vos candidatures.</p>
        </div>
        {params.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{params.error}</p>}
        {params.message && <p className="rounded-lg bg-muted p-3 text-sm">{params.message}</p>}
        <form action={signIn} className="space-y-4">
          <input name="next" type="hidden" value={params.next ?? "/onboarding"} />
          <label className="block space-y-1 text-sm"><span>Email</span><input className="w-full rounded-lg border bg-background px-3 py-2" name="email" required type="email" /></label>
          <label className="block space-y-1 text-sm"><span>Mot de passe</span><input className="w-full rounded-lg border bg-background px-3 py-2" minLength={8} name="password" required type="password" /></label>
          <SubmitButton pendingLabel="Connexion…">Se connecter</SubmitButton>
        </form>
        <p className="text-sm text-muted-foreground">Pas encore de compte ? <Link className="text-foreground underline" href="/signup">Créer un profil</Link></p>
      </section>
    </main>
  )
}
