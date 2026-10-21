import Link from "next/link"
import { redirect } from "next/navigation"

import { signOut } from "@/app/auth/actions"
import { applicationEventLabel, applicationModeLabel, confirmationLabel } from "@/lib/applications/assisted"
import { applicationProgress } from "@/lib/applications/status"
import { requireUser } from "@/lib/supabase/server"
import { repairUtf8Mojibake } from "@/lib/text"

export default async function DashboardPage() {
  const { supabase, user } = await requireUser()
  if (!user) redirect("/login")
  const { data: applications, error } = await supabase.from("applications")
    .select("id,job_id,company,job_title,prep_state,submission_method,submission_evidence,submitted_at,created_at,updated_at")
    .not("job_id", "is", null).order("updated_at", { ascending: false })

  const applicationIds = applications?.map((item) => item.id) ?? []
  const jobIds = applications?.flatMap((item) => item.job_id ? [item.job_id] : []) ?? []
  const [jobsResult, submissionsResult, dossiersResult, eventsResult] = applicationIds.length ? await Promise.all([
    supabase.from("job_listings").select("id,provider,application_mode").in("id", jobIds),
    supabase.from("application_submissions").select("application_id,state,method,environment,provider,started_at").in("application_id", applicationIds).order("started_at", { ascending: false }),
    supabase.from("application_dossiers").select("application_id,state,version").in("application_id", applicationIds).in("state", ["draft", "approved"]),
    supabase.from("application_events").select("id,application_id,event_type,created_at").in("application_id", applicationIds).order("created_at", { ascending: false }),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
  const jobs = new Map((jobsResult.data ?? []).map((item) => [item.id, item]))
  const dossiers = new Map((dossiersResult.data ?? []).map((item) => [item.application_id, item]))
  const submissions = new Map<string, NonNullable<typeof submissionsResult.data>[number]>()
  for (const item of submissionsResult.data ?? []) if (!submissions.has(item.application_id)) submissions.set(item.application_id, item)
  const events = new Map<string, NonNullable<typeof eventsResult.data>>()
  for (const event of eventsResult.data ?? []) {
    const current = events.get(event.application_id) ?? []
    if (current.length < 3) events.set(event.application_id, [...current, event])
  }
  const rows = (applications ?? []).map((application) => ({ application, job: application.job_id ? jobs.get(application.job_id) : undefined, dossier: dossiers.get(application.id), submission: submissions.get(application.id), events: events.get(application.id) ?? [] }))

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-muted-foreground">Compte connecté</p><h1 className="text-3xl font-semibold">Suivi des candidatures</h1></div><form action={signOut}><button className="rounded-lg border px-4 py-2 text-sm">Déconnexion</button></form></div>
      <section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Moteur de candidatures</h2><p className="mt-2 text-sm text-muted-foreground">Une acceptation crée un brouillon. Seule une preuve fournisseur ou votre déclaration explicite peut ensuite marquer un envoi.</p></div><Link className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" href="/dashboard/jobs">Voir les offres</Link></div></section>
      <section className="space-y-4"><div><h2 className="text-xl font-semibold">Candidatures acceptées</h2><p className="mt-1 text-sm text-muted-foreground">Une ligne par offre acceptée, protégée contre les doublons.</p></div>{error ? <p className="rounded-xl border bg-card p-4 text-sm text-destructive">Chargement impossible : {error.message}</p> : rows.length ? <><div className="space-y-4 md:hidden">{rows.map((row) => <ApplicationCard key={row.application.id} row={row} />)}</div><div className="hidden overflow-x-auto rounded-2xl border bg-card md:block"><table className="w-full min-w-[1180px] border-collapse text-left text-sm"><thead className="bg-muted/70 text-xs text-muted-foreground"><tr><th className="p-3">Entreprise / poste</th><th className="p-3">Date</th><th className="p-3">Statut</th><th className="p-3">Source</th><th className="p-3">Documents</th><th className="p-3">Mode</th><th className="p-3">Confirmation</th><th className="p-3">Historique</th><th className="p-3"><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((row) => <ApplicationTableRow key={row.application.id} row={row} />)}</tbody></table></div></> : <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Aucune offre acceptée.</p>}</section>
    </main>
  )
}

type Row = { application: { id: string; company: string; job_title: string; prep_state: string; submission_method: string | null; submission_evidence: unknown; submitted_at: string | null; created_at: string }; job?: { provider: string; application_mode: string }; dossier?: { state: string; version: number }; submission?: { state: string; method: string; environment: string; provider: string | null }; events: Array<{ id: string; event_type: string; created_at: string }> }

function summary(row: Row) {
  return { status: applicationProgress({ ...row.application, submission: row.submission }), mode: applicationModeLabel({ submissionMethod: row.application.submission_method, applicationMode: row.job?.application_mode }), confirmation: confirmationLabel({ submissionMethod: row.application.submission_method ?? row.submission?.method, submissionState: row.submission?.state, environment: row.submission?.environment }) }
}

function Documents({ row }: { row: Row }) {
  if (!row.dossier) return <span className="text-muted-foreground">À préparer</span>
  return <span className="flex flex-col gap-1"><a className="underline" href={`/api/applications/${row.application.id}/documents/resume`}>CV PDF</a><a className="underline" href={`/api/applications/${row.application.id}/documents/cover-letter`}>Lettre PDF</a></span>
}

function History({ row }: { row: Row }) {
  if (!row.events.length) return <span className="text-muted-foreground">Aucun événement</span>
  return <ul className="space-y-1 text-xs">{row.events.map((event) => <li key={event.id}>{applicationEventLabel(event.event_type)} <span className="text-muted-foreground">· {formatDate(event.created_at)}</span></li>)}</ul>
}

function ApplicationTableRow({ row }: { row: Row }) {
  const info = summary(row)
  return <tr className="border-t align-top"><td className="p-3"><p className="font-medium">{repairUtf8Mojibake(row.application.company)}</p><p className="text-muted-foreground">{row.application.job_title}</p></td><td className="p-3">{formatDate(row.application.submitted_at ?? row.application.created_at)}</td><td className="p-3 font-medium">{info.status}</td><td className="p-3">{row.job?.provider ?? "Inconnue"}</td><td className="p-3"><Documents row={row} /></td><td className="p-3">{info.mode}</td><td className="p-3">{info.confirmation}</td><td className="max-w-64 p-3"><History row={row} /></td><td className="p-3"><Link className="rounded-lg border px-3 py-2" href={`/dashboard/applications/${row.application.id}`}>Consulter</Link></td></tr>
}

function ApplicationCard({ row }: { row: Row }) {
  const info = summary(row)
  return <article className="space-y-4 rounded-2xl border bg-card p-5"><div><p className="font-semibold">{row.application.job_title}</p><p className="text-sm text-muted-foreground">{repairUtf8Mojibake(row.application.company)}</p></div><dl className="grid grid-cols-2 gap-3 text-sm"><Item label="Date" value={formatDate(row.application.submitted_at ?? row.application.created_at)} /><Item label="Statut" value={info.status} /><Item label="Source" value={row.job?.provider ?? "Inconnue"} /><Item label="Mode" value={info.mode} /><div className="col-span-2"><dt className="text-xs text-muted-foreground">Confirmation</dt><dd>{info.confirmation}</dd></div><div><dt className="text-xs text-muted-foreground">Documents</dt><dd><Documents row={row} /></dd></div><div><dt className="text-xs text-muted-foreground">Historique</dt><dd><History row={row} /></dd></div></dl><Link className="block rounded-lg border px-3 py-2 text-center text-sm" href={`/dashboard/applications/${row.application.id}`}>Consulter le dossier</Link></article>
}

function Item({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd>{value}</dd></div> }
function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)) }
