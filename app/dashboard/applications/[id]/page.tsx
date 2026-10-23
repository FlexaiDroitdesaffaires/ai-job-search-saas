import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, Check, Download, FileText, LockKeyhole, ScanSearch, ShieldCheck } from "lucide-react"

import { approveApplicationDossier, prepareApplication, saveApplicationDossier } from "../actions"
import { AssistedApplication } from "@/components/applications/assisted-application"
import { SubmitButton } from "@/components/submit-button"
import { applicationEventLabel, verifiedOfficialUrl } from "@/lib/applications/assisted"
import { applicationDossierSchema } from "@/lib/applications/dossier-schema"
import { applicationProgress } from "@/lib/applications/status"
import { requireUser } from "@/lib/supabase/server"
import { repairUtf8Mojibake } from "@/lib/text"

export default async function ApplicationPreparationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; saved?: string; approved?: string; assisted?: string }>
}) {
  const { id } = await params
  const notices = await searchParams
  const { supabase, user } = await requireUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/dashboard/applications/${id}`)}`)
  const { data: application, error } = await supabase.from("applications")
    .select("id,job_id,job_title,company,job_url,prep_state,status,submitted_at,submission_method,submission_evidence")
    .eq("id", id).eq("user_id", user.id).single()
  if (error || !application) notFound()

  const { data: dossierRows, error: dossierError } = await supabase.from("application_dossiers")
    .select("id,version,state,content,content_hash,missing_fields,prepared_at,approved_at")
    .eq("application_id", id).eq("user_id", user.id).order("version", { ascending: false }).limit(1)
  const dossier = dossierRows?.[0] ?? null
  const parsed = dossier ? applicationDossierSchema.safeParse(dossier.content) : null
  const content = parsed?.success ? parsed.data : null
  const invalidDossier = Boolean(dossierError || (dossier && !parsed?.success))
  const locked = application.prep_state === "submitting" || application.prep_state === "submitted"
  const { data: submissionRows } = await supabase.from("application_submissions")
    .select("id,state,method,environment,provider,attempt_count,error_message,provider_submission_id,tracking_url,started_at,confirmed_at")
    .eq("application_id", id).eq("user_id", user.id).order("started_at", { ascending: false }).limit(1)
  const submission = submissionRows?.[0] ?? null
  const [{ data: job }, { data: assisted }, { data: events }] = await Promise.all([
    supabase.from("job_listings").select("source_url,application_url").eq("id", application.job_id).maybeSingle(),
    supabase.from("assisted_application_states").select("official_url,opened_at,user_decision,decided_at").eq("application_id", id).eq("user_id", user.id).maybeSingle(),
    supabase.from("application_events").select("id,event_type,created_at").eq("application_id", id).eq("user_id", user.id).order("created_at", { ascending: false }).limit(12),
  ])
  const officialUrl = verifiedOfficialUrl({
    storedUrl: application.job_url,
    sourceUrl: job?.source_url ?? null,
    applicationUrl: job?.application_url ?? null,
  })
  const assistedAvailable = dossier?.state === "approved"
    && (["approved", "needs_manual_action"].includes(application.prep_state)
      || (application.prep_state === "submitted" && application.submission_method === "manual"))

  return (
    <main className="mx-auto max-w-6xl space-y-7 px-4 py-8 sm:px-6 sm:py-12">
      <Link className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900" href="/dashboard#applications"><ArrowLeft className="size-4" />Retour aux candidatures</Link>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Dossier de candidature</p><h1 className="page-title mt-2">{application.job_title}</h1><p className="mt-2 text-lg text-slate-500">{repairUtf8Mojibake(application.company)}</p></div><span className="self-start rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">{applicationProgress({ ...application, submission })}</span></header>
      <DossierProgress prepared={Boolean(content)} approved={dossier?.state === "approved"} assisted={assistedAvailable} submitted={application.prep_state === "submitted"} />
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><p><strong>Aucun envoi n’est effectué dans cet écran.</strong> Préparer et approuver figent uniquement les documents locaux.</p></div>
      {submission && <section className="surface space-y-3 p-6"><h2 className="text-xl font-semibold">Traitement technique</h2><p className="font-medium">{applicationProgress({ ...application, submission })}</p>{submission.environment === "test" && <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-800"><strong>TEST local.</strong> Cette ligne ne représente pas une candidature envoyée et doit être exclue des métriques réelles.</p>}<dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-400">Adaptateur</dt><dd>{submission.provider ?? "Non défini"}</dd></div><div><dt className="text-slate-400">Tentatives</dt><dd>{submission.attempt_count}</dd></div>{submission.provider_submission_id && <div><dt className="text-slate-400">Référence fournisseur</dt><dd>{submission.provider_submission_id}</dd></div>}{submission.tracking_url && <div><dt className="text-slate-400">Suivi fournisseur</dt><dd><a className="font-medium text-indigo-600" href={submission.tracking_url} rel="noreferrer" target="_blank">Ouvrir le suivi</a></dd></div>}{submission.error_message && <div><dt className="text-slate-400">Diagnostic</dt><dd>{submission.error_message}</dd></div>}</dl></section>}
      {notices.error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{notices.error}</p>}
      {notices.saved && <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">{notices.saved}</p>}
      {notices.approved && <p className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{notices.approved}</p>}
      {notices.assisted && <p className="rounded-xl bg-sky-50 p-4 text-sm text-sky-800">{notices.assisted}</p>}
      {invalidDossier && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Le dossier enregistré est inaccessible ou invalide. Aucun document n’a été modifié.</p>}

      {!invalidDossier && !content ? (
        <section className="surface p-6 sm:p-8"><span className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><FileText className="size-5" /></span><h2 className="mt-5 text-2xl font-semibold tracking-tight">Préparer le dossier</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">La préparation déterministe utilisera uniquement le profil, le CV validé et l’offre. Elle ne contacte aucun employeur.</p><form action={prepareApplication} className="mt-6"><input name="applicationId" type="hidden" value={application.id} /><SubmitButton pendingLabel="Préparation…">Préparer le dossier</SubmitButton></form></section>
      ) : content ? (
        <>
          <section className="surface grid gap-5 p-5 sm:grid-cols-3 sm:p-6"><Metric label="Version" value={String(dossier?.version)} /><Metric label="État" value={dossier?.state === "approved" ? "Approuvé et figé" : dossier?.state === "draft" ? "Prêt à vérifier" : "Version remplacée"} /><Metric label="Empreinte SHA-256" value={dossier?.content_hash ?? ""} mono /></section>

          <section className="surface space-y-5 p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><ScanSearch className="size-4" /></span><div><p className="eyebrow">Analyse</p><h2 className="mt-1 text-xl font-semibold">Lecture factuelle de l’offre</h2></div></div><Columns items={[{ title: "Qualifications extraites", values: content.analysis.qualifications }, { title: "Compétences essentielles détectées", values: content.analysis.essentialSkills }, { title: "Critères obligatoires", values: content.analysis.mandatoryCriteria }]} />{content.analysis.comparison.filter((item) => item.status === "not_evidenced").length > 0 && <div className="rounded-xl bg-amber-50 p-4"><h3 className="font-medium text-amber-900">Non attesté dans le profil</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{content.analysis.comparison.filter((item) => item.status === "not_evidenced").map((item) => <li key={item.requirement}>{item.requirement}</li>)}</ul></div>}</section>

          <form action={saveApplicationDossier} className="space-y-6">
            <input name="applicationId" type="hidden" value={application.id} /><input name="dossierId" type="hidden" value={dossier!.id} />
            <section className="surface space-y-5 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Document 01</p><h2 className="mt-1 text-xl font-semibold">CV personnalisé</h2></div><a className="btn-secondary min-h-10 px-3 py-2" href={`/api/applications/${application.id}/documents/resume`}><Download className="size-4" />Télécharger le PDF</a></div><label className="block space-y-2 text-sm font-medium text-slate-700"><span>Résumé professionnel</span><textarea className="field min-h-32" defaultValue={content.resume.summary} disabled={locked} maxLength={5000} name="summary" /></label><div><h3 className="font-medium">Compétences réordonnées</h3><p className="mt-2 text-sm leading-6 text-slate-500">{content.resume.skills.map((item) => item.name).join(" · ") || "Aucune compétence renseignée."}</p></div><div><h3 className="font-medium">Expériences mises en avant</h3><ul className="mt-3 grid gap-3 sm:grid-cols-2">{content.resume.experiences.map((item) => <li className="rounded-xl bg-slate-50 p-4 text-sm" key={item.sourceReference}><strong>{item.title}</strong> — {item.company}<p className="mt-1 leading-6 text-slate-500">{item.description}</p></li>)}</ul></div><Link className="text-sm font-semibold text-indigo-600" href="/onboarding">Corriger les faits sources dans le profil</Link></section>

            <section className="surface space-y-5 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Document 02</p><h2 className="mt-1 text-xl font-semibold">Lettre de motivation</h2></div><a className="btn-secondary min-h-10 px-3 py-2" href={`/api/applications/${application.id}/documents/cover-letter`}><Download className="size-4" />Télécharger le PDF</a></div><textarea className="field min-h-80 text-sm leading-7" defaultValue={repairUtf8Mojibake(content.coverLetter.body)} disabled={locked} maxLength={20000} name="coverLetterBody" /></section>

            <section className="surface space-y-5 p-5 sm:p-7"><div><p className="eyebrow">Vérification</p><h2 className="mt-1 text-xl font-semibold">Réponses de présélection</h2></div>{content.screeningAnswers.map((answer) => <label className="block space-y-2 text-sm font-medium text-slate-700" key={answer.key}><span>{answer.question}{answer.required ? " *" : ""}</span><input className="field" defaultValue={answer.answer} disabled={locked} maxLength={10000} name={`answer:${answer.key}`} /><span className="block text-xs font-normal text-slate-400">Source : {answer.sourceReference ?? "information manquante"}</span></label>)}{content.missingFields.length > 0 && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>Approbation bloquée :</strong> {content.missingFields.join(", ")}</p>}</section>

            {!locked && <section className="surface flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><label className="flex max-w-2xl items-start gap-3 text-sm leading-6 text-slate-600"><input className="mt-1 size-4 accent-indigo-600" name="userConfirmed" required type="checkbox" /><span>Je confirme que mes corrections et réponses sont exactes et proviennent de mes informations personnelles.</span></label><SubmitButton pendingLabel="Enregistrement…">Enregistrer cette version</SubmitButton></section>}
          </form>

          {dossier?.state === "draft" && <section className="overflow-hidden rounded-2xl bg-slate-950 p-6 text-white sm:p-8"><span className="grid size-11 place-items-center rounded-xl bg-indigo-500"><LockKeyhole className="size-5" /></span><h2 className="mt-5 text-2xl font-semibold">Approbation finale</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">L’approbation fige exactement cette version. Elle ne soumet pas la candidature.</p><form action={approveApplicationDossier} className="mt-6"><input name="applicationId" type="hidden" value={application.id} /><input name="dossierId" type="hidden" value={dossier.id} /><input name="contentHash" type="hidden" value={dossier.content_hash} /><SubmitButton disabled={content.missingFields.length > 0} pendingLabel="Approbation…">Approuver cette version</SubmitButton></form></section>}
          {dossier?.state === "approved" && application.prep_state !== "submitted" && <p className="flex items-start gap-3 rounded-2xl bg-green-50 p-4 text-sm leading-6 text-green-800"><Check className="mt-0.5 size-5 shrink-0" /><span><strong>Version approuvée et immuable.</strong> Statut réel : non envoyée tant que vous ne déclarez pas l’envoi.</span></p>}
          {assistedAvailable && <AssistedApplication applicationId={application.id} answers={content.screeningAnswers.map(({ key, question, answer }) => ({ key, question, answer }))} decision={assisted?.user_decision ?? null} initiallyOpened={Boolean(assisted?.opened_at)} officialUrl={officialUrl} />}
          {events?.length ? <section className="surface p-5 sm:p-7"><p className="eyebrow">Traçabilité</p><h2 className="mt-1 text-xl font-semibold">Historique</h2><ol className="mt-5 border-l border-slate-200 pl-5">{events.map((event) => <li className="relative pb-5 text-sm last:pb-0" key={event.id}><span className="absolute -left-[25px] top-1 size-2 rounded-full bg-indigo-500 ring-4 ring-white" /><span className="font-medium text-slate-700">{applicationEventLabel(event.event_type)}</span><time className="mt-1 block text-xs text-slate-400" dateTime={event.created_at}>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}</time></li>)}</ol></section> : null}
        </>
      ) : null}
    </main>
  )
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs font-medium text-slate-400">{label}</p><p className={mono ? "mt-1 break-all font-mono text-[10px] text-slate-500" : "mt-1 font-semibold text-slate-800"}>{value}</p></div>
}

function Columns({ items }: { items: Array<{ title: string; values: string[] }> }) {
  return <div className="grid gap-4 md:grid-cols-3">{items.map((item) => <div className="rounded-xl bg-slate-50 p-4" key={item.title}><h3 className="text-sm font-semibold text-slate-800">{item.title}</h3>{item.values.length ? <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-5 text-slate-500">{item.values.map((value) => <li key={value}>{value}</li>)}</ul> : <p className="mt-3 text-xs text-slate-400">Aucune donnée explicite détectée.</p>}</div>)}</div>
}

function DossierProgress({ prepared, approved, assisted, submitted }: { prepared: boolean; approved: boolean; assisted: boolean; submitted: boolean }) {
  const steps = [{ label: "Brouillon", done: true }, { label: "Préparation", done: prepared }, { label: "Approbation", done: approved }, { label: submitted ? "Confirmée" : assisted ? "À terminer" : "Envoi", done: submitted }]
  return <nav aria-label="Progression du dossier"><ol className="grid grid-cols-4 items-start rounded-2xl border border-slate-200 bg-white p-3 sm:flex sm:items-center sm:p-4">{steps.map((step, index) => <li className="flex min-w-0 flex-col items-center gap-1.5 sm:flex-1 sm:flex-row sm:gap-0" key={step.label}><span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${step.done ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"}`}>{step.done ? <Check className="size-4" /> : index + 1}</span><span className={`max-w-full truncate text-center text-[10px] font-medium sm:ml-2 sm:text-left sm:text-sm ${step.done ? "text-slate-800" : "text-slate-400"}`}>{step.label}</span>{index < steps.length - 1 && <span className={`mx-3 hidden h-px flex-1 sm:block ${step.done ? "bg-indigo-200" : "bg-slate-200"}`} />}</li>)}</ol></nav>
}
