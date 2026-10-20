import Link from "next/link"
import { redirect } from "next/navigation"

import { signOut } from "@/app/auth/actions"
import { applicationProgress } from "@/lib/applications/status"
import { requireUser } from "@/lib/supabase/server"

export default async function DashboardPage() {
  const { supabase, user } = await requireUser()
  if (!user) redirect("/login")
  const { data: applications, error } = await supabase
    .from("applications")
    .select("id,company,job_title,status,prep_state,submission_evidence,updated_at")
    .not("job_id", "is", null)
    .order("updated_at", { ascending: false })
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-12">
      <div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Compte connecté</p><h1 className="text-3xl font-semibold">Tableau de bord</h1></div><form action={signOut}><button className="rounded-lg border px-4 py-2 text-sm">Déconnexion</button></form></div>
      <section className="rounded-2xl border bg-card p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Moteur de candidatures</h2><p className="mt-2 text-sm text-muted-foreground">Consultez les offres réelles. Une acceptation crée un brouillon, jamais un envoi.</p></div><Link className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" href="/dashboard/jobs">Voir les offres</Link></div></section>
      <section className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Candidatures acceptées</h2>{error ? <p className="text-sm text-destructive">Chargement impossible : {error.message}</p> : applications?.length ? <ul className="space-y-3">{applications.map((application) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-4" key={application.id}><div><p className="font-medium">{application.job_title}</p><p className="text-sm text-muted-foreground">{application.company}</p></div><div className="text-right"><p className="text-sm font-medium">Acceptée</p><p className="text-xs text-muted-foreground">{applicationProgress(application)}</p></div></li>)}</ul> : <p className="text-sm text-muted-foreground">Aucune offre acceptée.</p>}</section>
    </main>
  )
}
