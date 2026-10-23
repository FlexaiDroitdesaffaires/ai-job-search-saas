import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Compass, Download, FilePenLine, History as HistoryIcon, Sparkles } from "lucide-react"

import { applicationEventLabel, applicationModeLabel, confirmationLabel } from "@/lib/applications/assisted"
import { applicationProgress } from "@/lib/applications/status"
import { requireUser } from "@/lib/supabase/server"
import { repairUtf8Mojibake } from "@/lib/text"

export default async function DashboardPage() {
  const { supabase, user } = await requireUser()
  if (!user) redirect("/login")
  const [applicationsResult, profileResult, matchesResult] = await Promise.all([
    supabase.from("applications").select("id,job_id,company,job_title,prep_state,submission_method,submission_evidence,submitted_at,created_at,updated_at").not("job_id", "is", null).order("updated_at", { ascending: false }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("job_matches").select("score,job_id").order("score", { ascending: false }).limit(100),
  ])
  const applications = applicationsResult.data
  const applicationIds = applications?.map((item) => item.id) ?? []
  const jobIds = applications?.flatMap((item) => item.job_id ? [item.job_id] : []) ?? []
  const recommendationIds = (matchesResult.data ?? []).map((item) => item.job_id)
  const recommendationJobsPromise = recommendationIds.length
    ? supabase.from("job_listings").select("id,title,company,location,is_active,is_demo").in("id", recommendationIds)
    : Promise.resolve({ data: [] as Recommendation["job"][] })
  const [jobsResult, submissionsResult, dossiersResult, eventsResult, recommendationJobsResult] = applicationIds.length ? await Promise.all([
    supabase.from("job_listings").select("id,provider,application_mode").in("id", jobIds),
    supabase.from("application_submissions").select("application_id,state,method,environment,provider,started_at").in("application_id", applicationIds).order("started_at", { ascending: false }),
    supabase.from("application_dossiers").select("application_id,state,version").in("application_id", applicationIds).in("state", ["draft", "approved"]),
    supabase.from("application_events").select("id,application_id,event_type,created_at").in("application_id", applicationIds).order("created_at", { ascending: false }),
    recommendationJobsPromise,
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, await recommendationJobsPromise]
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
  const recommendationJobs = new Map((recommendationJobsResult.data ?? []).map((item) => [item.id, item]))
  const recommendations = (matchesResult.data ?? []).flatMap((match) => {
    const job = recommendationJobs.get(match.job_id)
    return job?.is_active && !job.is_demo ? [{ score: match.score, job }] : []
  }).slice(0, 3)
  const firstName = profileResult.data?.full_name?.trim().split(/\s+/)[0]
  const stats = {
    recommendations: recommendations.length,
    preparing: rows.filter((row) => !row.dossier || row.dossier.state === "draft").length,
    approved: rows.filter((row) => row.dossier?.state === "approved" && row.application.prep_state !== "submitted").length,
    sent: rows.filter((row) => row.application.prep_state === "submitted").length,
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">Vue d’ensemble</p><h1 className="page-title mt-2">Bonjour{firstName ? ` ${firstName}` : ""}.</h1><p className="mt-3 text-slate-600">Voici l’essentiel pour faire avancer votre recherche aujourd’hui.</p></div>
        <Link className="btn-primary self-start" href="/dashboard/jobs">Explorer les offres <ArrowRight className="size-4" /></Link>
      </header>

      <section aria-label="Résumé" className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Compass} label="Recommandées" tone="indigo" value={stats.recommendations} />
        <StatCard icon={FilePenLine} label="À préparer" tone="amber" value={stats.preparing} />
        <StatCard icon={CheckCircle2} label="Dossiers approuvés" tone="green" value={stats.approved} />
        <StatCard icon={BriefcaseBusiness} label="Déclarées envoyées" tone="slate" value={stats.sent} />
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.65fr)]">
        <section className="surface min-w-0 p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4"><div><p className="eyebrow">Pour vous</p><h2 className="mt-2 text-xl font-semibold tracking-tight">Offres recommandées</h2></div><Link className="text-sm font-semibold text-indigo-600 hover:text-indigo-700" href="/dashboard/jobs">Tout voir</Link></div>
          {recommendations.length ? <div className="mt-6 divide-y divide-slate-100">{recommendations.map(({ job, score }) => <div className="flex items-center gap-4 py-4 first:pt-0 last:pb-0" key={job.id}><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 font-semibold text-slate-600">{job.company.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{job.title}</p><p className="truncate text-sm text-slate-500">{repairUtf8Mojibake(job.company)}{job.location ? ` · ${job.location}` : ""}</p></div><span className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">{score}%</span></div>)}</div> : <EmptyMini text="Explorez les offres pour calculer vos recommandations explicables." />}
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl bg-slate-950 p-6 text-white shadow-sm sm:p-7">
          <span className="grid size-10 place-items-center rounded-xl bg-indigo-500"><Sparkles className="size-4" /></span>
          <p className="mt-6 text-xs font-semibold tracking-[0.12em] text-indigo-300 uppercase">Prochaine action</p>
          <h2 className="mt-2 text-xl font-semibold">{nextAction(rows)}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">Une acceptation crée un brouillon. Un dossier approuvé reste non envoyé tant qu’aucune action réelle n’est confirmée.</p>
          <Link className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white" href={rows.length ? `/dashboard/applications/${rows[0].application.id}` : "/dashboard/jobs"}>Continuer <ArrowRight className="size-4" /></Link>
        </section>
      </div>

      <section className="mt-12 scroll-mt-6" id="applications">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Suivi réel</p><h2 className="section-title mt-2">Mes candidatures</h2><p className="mt-2 text-sm text-slate-500">Une ligne par offre acceptée, protégée contre les doublons.</p></div></div>
        {applicationsResult.error ? <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">Chargement impossible : {applicationsResult.error.message}</p> : rows.length ? <><div className="mt-6 space-y-4 lg:hidden">{rows.map((row) => <ApplicationCard key={row.application.id} row={row} />)}</div><div className="surface mt-6 hidden overflow-x-auto lg:block"><table className="w-full min-w-[1120px] border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase"><tr><th className="p-4">Entreprise / poste</th><th className="p-4">Date</th><th className="p-4">Statut</th><th className="p-4">Source</th><th className="p-4">Documents</th><th className="p-4">Mode</th><th className="p-4">Confirmation</th><th className="p-4">Historique</th><th className="p-4"><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((row) => <ApplicationTableRow key={row.application.id} row={row} />)}</tbody></table></div></> : <div className="surface mt-6 p-10 text-center"><BriefcaseBusiness className="mx-auto size-7 text-slate-300" /><h3 className="mt-4 font-semibold">Aucune candidature en cours</h3><p className="mt-2 text-sm text-slate-500">Acceptez une offre compatible pour créer votre premier brouillon.</p><Link className="btn-secondary mt-5" href="/dashboard/jobs">Découvrir les offres</Link></div>}
      </section>
    </main>
  )
}

type Row = { application: { id: string; company: string; job_title: string; prep_state: string; submission_method: string | null; submission_evidence: unknown; submitted_at: string | null; created_at: string }; job?: { provider: string; application_mode: string }; dossier?: { state: string; version: number }; submission?: { state: string; method: string; environment: string; provider: string | null }; events: Array<{ id: string; event_type: string; created_at: string }> }
type Recommendation = { score: number; job: { id: string; title: string; company: string; location: string | null; is_active: boolean; is_demo: boolean } }

function nextAction(rows: Row[]) {
  if (!rows.length) return "Examinez vos premières offres"
  if (rows.some((row) => !row.dossier)) return "Préparez un dossier accepté"
  if (rows.some((row) => row.dossier?.state === "draft")) return "Relisez un dossier brouillon"
  if (rows.some((row) => row.dossier?.state === "approved" && row.application.prep_state !== "submitted")) return "Terminez une candidature approuvée"
  return "Découvrez de nouvelles opportunités"
}

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Compass; label: string; value: number; tone: "indigo" | "amber" | "green" | "slate" }) {
  const colors = { indigo: "bg-indigo-50 text-indigo-600", amber: "bg-amber-50 text-amber-600", green: "bg-green-50 text-green-600", slate: "bg-slate-100 text-slate-600" }
  return <article className="surface flex items-center gap-4 p-5"><span className={`grid size-11 shrink-0 place-items-center rounded-xl ${colors[tone]}`}><Icon className="size-5" /></span><div><p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p><p className="text-sm text-slate-500">{label}</p></div></article>
}

function EmptyMini({ text }: { text: string }) { return <p className="mt-6 rounded-xl bg-slate-50 p-5 text-sm leading-6 text-slate-500">{text}</p> }

function summary(row: Row) {
  return { status: applicationProgress({ ...row.application, submission: row.submission }), mode: applicationModeLabel({ submissionMethod: row.application.submission_method, applicationMode: row.job?.application_mode }), confirmation: confirmationLabel({ submissionMethod: row.application.submission_method ?? row.submission?.method, submissionState: row.submission?.state, environment: row.submission?.environment }) }
}

function Documents({ row }: { row: Row }) {
  if (!row.dossier) return <span className="text-slate-400">À préparer</span>
  return <span className="flex flex-col gap-1.5"><a className="inline-flex items-center gap-1.5 font-medium text-indigo-600" href={`/api/applications/${row.application.id}/documents/resume`}><Download className="size-3.5" />CV PDF</a><a className="inline-flex items-center gap-1.5 font-medium text-indigo-600" href={`/api/applications/${row.application.id}/documents/cover-letter`}><Download className="size-3.5" />Lettre PDF</a></span>
}

function History({ row }: { row: Row }) {
  if (!row.events.length) return <span className="text-slate-400">Aucun événement</span>
  return <ul className="space-y-1.5 text-xs">{row.events.map((event) => <li key={event.id}>{applicationEventLabel(event.event_type)} <span className="text-slate-400">· {formatDate(event.created_at)}</span></li>)}</ul>
}

function StatusBadge({ value }: { value: string }) { return <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{value}</span> }

function ApplicationTableRow({ row }: { row: Row }) {
  const info = summary(row)
  return <tr className="border-t border-slate-100 align-top transition hover:bg-slate-50/70"><td className="p-4"><p className="font-semibold text-slate-900">{repairUtf8Mojibake(row.application.company)}</p><p className="mt-0.5 text-slate-500">{row.application.job_title}</p></td><td className="p-4 text-slate-600">{formatDate(row.application.submitted_at ?? row.application.created_at)}</td><td className="p-4"><StatusBadge value={info.status} /></td><td className="p-4 text-slate-600">{row.job?.provider ?? "Inconnue"}</td><td className="p-4"><Documents row={row} /></td><td className="max-w-44 p-4 text-slate-600">{info.mode}</td><td className="max-w-48 p-4 text-slate-600">{info.confirmation}</td><td className="max-w-64 p-4"><History row={row} /></td><td className="p-4"><Link className="btn-secondary min-h-9 px-3 py-2" href={`/dashboard/applications/${row.application.id}`}>Consulter</Link></td></tr>
}

function ApplicationCard({ row }: { row: Row }) {
  const info = summary(row)
  return <article className="surface p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">{row.application.job_title}</p><p className="mt-1 text-sm text-slate-500">{repairUtf8Mojibake(row.application.company)}</p></div><StatusBadge value={info.status} /></div><dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-slate-100 pt-5 text-sm"><Item label="Date" value={formatDate(row.application.submitted_at ?? row.application.created_at)} /><Item label="Source" value={row.job?.provider ?? "Inconnue"} /><Item label="Mode" value={info.mode} /><Item label="Confirmation" value={info.confirmation} /><div><dt className="text-xs font-medium text-slate-400">Documents</dt><dd className="mt-1"><Documents row={row} /></dd></div><div><dt className="flex items-center gap-1 text-xs font-medium text-slate-400"><HistoryIcon className="size-3" />Historique</dt><dd className="mt-1"><History row={row} /></dd></div></dl><Link className="btn-secondary mt-5 w-full" href={`/dashboard/applications/${row.application.id}`}>Consulter le dossier <ArrowRight className="size-4" /></Link></article>
}

function Item({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-medium text-slate-400">{label}</dt><dd className="mt-1 text-slate-700">{value}</dd></div> }
function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)) }
