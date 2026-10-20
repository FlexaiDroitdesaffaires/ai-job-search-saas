import { redirect } from "next/navigation"

import { signOut } from "@/app/auth/actions"
import { requireUser } from "@/lib/supabase/server"

export default async function DashboardPage() {
  const { user } = await requireUser()
  if (!user) redirect("/login")
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-12">
      <div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Compte connecté</p><h1 className="text-3xl font-semibold">Tableau de bord</h1></div><form action={signOut}><button className="rounded-lg border px-4 py-2 text-sm">Déconnexion</button></form></div>
      <section className="rounded-2xl border bg-card p-6"><h2 className="font-medium">Moteur de candidatures</h2><p className="mt-2 text-sm text-muted-foreground">Aucune candidature n’est simulée. L’ingestion des vraies offres et le moteur de décision constituent la prochaine verticale.</p></section>
    </main>
  )
}
