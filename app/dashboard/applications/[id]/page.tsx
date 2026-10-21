import Link from "next/link"
import { notFound, redirect } from "next/navigation"

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
    .eq("application_id", id).order("version", { ascending: false }).limit(1)
  const dossier = dossierRows?.[0] ?? null
  const parsed = dossier ? applicationDossierSchema.safeParse(dossier.content) : null
  const content = parsed?.success ? parsed.data : null
  const invalidDossier = Boolean(dossierError || (dossier && !parsed?.success))
  const locked = application.prep_state === "submitting" || application.prep_state === "submitted"
  const { data: submissionRows } = await supabase.from("application_submissions")
    .select("id,state,method,environment,provider,attempt_count,error_message,provider_submission_id,tracking_url,started_at,confirmed_at")
    .eq("application_id", id).order("started_at", { ascending: false }).limit(1)
  const submission = submissionRows?.[0] ?? null
  const [{ data: job }, { data: assisted }, { data: events }] = await Promise.all([
    supabase.from("job_listings").select("source_url,application_url").eq("id", application.job_id).maybeSingle(),
    supabase.from("assisted_application_states").select("official_url,opened_at,user_decision,decided_at").eq("application_id", id).maybeSingle(),
    supabase.from("application_events").select("id,event_type,created_at").eq("application_id", id).order("created_at", { ascending: false }).limit(12),
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
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Dossier de candidature</p><h1 className="text-3xl font-semibold">{application.job_title}</h1><p className="mt-1 text-muted-foreground">{repairUtf8Mojibake(application.company)}</p></div><Link className="rounded-lg border px-4 py-2 text-sm" href="/dashboard">Retour au suivi</Link></header>
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><strong>Aucun envoi n’est effectué dans cet écran.</strong> Préparer et approuver figent uniquement les documents locaux.</div>
      {submission && <section className="space-y-2 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Traitement technique</h2><p className="font-medium">{applicationProgress({ ...application, submission })}</p>{submission.environment === "test" && <p className="rounded-lg bg-sky-100 p-3 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100"><strong>TEST local.</strong> Cette ligne ne représente pas une candidature envoyée et doit être exclue des métriques réelles.</p>}<dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Adaptateur</dt><dd>{submission.provider ?? "Non défini"}</dd></div><div><dt className="text-muted-foreground">Tentatives</dt><dd>{submission.attempt_count}</dd></div>{submission.provider_submission_id && <div><dt className="text-muted-foreground">Référence fournisseur</dt><dd>{submission.provider_submission_id}</dd></div>}{submission.tracking_url && <div><dt className="text-muted-foreground">Suivi fournisseur</dt><dd><a className="underline" href={submission.tracking_url} rel="noreferrer" target="_blank">Ouvrir le suivi</a></dd></div>}{submission.error_message && <div><dt className="text-muted-foreground">Diagnostic</dt><dd>{submission.error_message}</dd></div>}</dl></section>}
      {notices.error && <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{notices.error}</p>}
      {notices.saved && <p className="rounded-lg bg-muted p-4 text-sm">{notices.saved}</p>}
      {notices.approved && <p className="rounded-lg bg-emerald-100 p-4 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notices.approved}</p>}
      {notices.assisted && <p className="rounded-lg bg-sky-100 p-4 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">{notices.assisted}</p>}
      {invalidDossier && <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">Le dossier enregistré est inaccessible ou invalide. Aucun document n’a été modifié.</p>}

      {!invalidDossier && !content ? (
        <section className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Préparer le dossier</h2><p className="text-sm text-muted-foreground">La préparation déterministe utilisera uniquement le profil, le CV validé et l’offre. Elle ne contacte aucun employeur.</p><form action={prepareApplication}><input name="applicationId" type="hidden" value={application.id} /><SubmitButton pendingLabel="Préparation…">Préparer automatiquement</SubmitButton></form></section>
      ) : content ? (
        <>
          <section className="grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-3"><Metric label="Version" value={String(dossier?.version)} /><Metric label="État" value={dossier?.state === "approved" ? "Approuvé et figé" : dossier?.state === "draft" ? "Prêt à vérifier" : "Version remplacée"} /><Metric label="Empreinte SHA-256" value={dossier?.content_hash ?? ""} mono /></section>

          <section className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Analyse factuelle de l’offre</h2><Columns items={[{ title: "Qualifications extraites", values: content.analysis.qualifications }, { title: "Compétences essentielles détectées", values: content.analysis.essentialSkills }, { title: "Critères obligatoires", values: content.analysis.mandatoryCriteria }]} />{content.analysis.comparison.filter((item) => item.status === "not_evidenced").length > 0 && <div><h3 className="font-medium">Non attesté dans le profil</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{content.analysis.comparison.filter((item) => item.status === "not_evidenced").map((item) => <li key={item.requirement}>{item.requirement}</li>)}</ul></div>}</section>

          <form action={saveApplicationDossier} className="space-y-6">
            <input name="applicationId" type="hidden" value={application.id} /><input name="dossierId" type="hidden" value={dossier!.id} />
            <section className="space-y-4 rounded-2xl border bg-card p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">CV personnalisé</h2><a className="rounded-lg border px-3 py-2 text-sm" href={`/api/applications/${application.id}/documents/resume`}>Exporter en PDF ATS</a></div><label className="block space-y-2 text-sm"><span>Résumé professionnel</span><textarea className="min-h-32 w-full rounded-lg border bg-background px-3 py-2" defaultValue={content.resume.summary} disabled={locked} maxLength={5000} name="summary" /></label><div><h3 className="font-medium">Compétences réordonnées</h3><p className="mt-1 text-sm text-muted-foreground">{content.resume.skills.map((item) => item.name).join(" · ") || "Aucune compétence renseignée."}</p></div><div><h3 className="font-medium">Expériences mises en avant</h3><ul className="mt-2 space-y-2">{content.resume.experiences.map((item) => <li className="rounded-lg bg-muted p-3 text-sm" key={item.sourceReference}><strong>{item.title}</strong> — {item.company}<p className="text-muted-foreground">{item.description}</p></li>)}</ul></div><Link className="text-sm underline" href="/onboarding">Corriger les faits sources dans le profil</Link></section>

            <section className="space-y-4 rounded-2xl border bg-card p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Lettre de motivation</h2><a className="rounded-lg border px-3 py-2 text-sm" href={`/api/applications/${application.id}/documents/cover-letter`}>Exporter en PDF</a></div><textarea className="min-h-80 w-full rounded-lg border bg-background px-3 py-2 text-sm leading-6" defaultValue={repairUtf8Mojibake(content.coverLetter.body)} disabled={locked} maxLength={20000} name="coverLetterBody" /></section>

            <section className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Informations de présélection</h2>{content.screeningAnswers.map((answer) => <label className="block space-y-2 text-sm" key={answer.key}><span>{answer.question}{answer.required ? " *" : ""}</span><input className="w-full rounded-lg border bg-background px-3 py-2" defaultValue={answer.answer} disabled={locked} maxLength={10000} name={`answer:${answer.key}`} /><span className="block text-xs text-muted-foreground">Source : {answer.sourceReference ?? "information manquante"}</span></label>)}{content.missingFields.length > 0 && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">Approbation bloquée : {content.missingFields.join(", ")}</p>}</section>

            {!locked && <section className="space-y-4 rounded-2xl border bg-card p-6"><label className="flex items-start gap-3 text-sm"><input className="mt-1" name="userConfirmed" required type="checkbox" /><span>Je confirme que mes corrections et réponses sont exactes et proviennent de mes informations personnelles.</span></label><SubmitButton pendingLabel="Enregistrement…">Enregistrer une nouvelle version</SubmitButton></section>}
          </form>

          {dossier?.state === "draft" && <section className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Approbation finale</h2><p className="text-sm text-muted-foreground">L’approbation fige exactement cette version. Elle ne soumet pas la candidature.</p><form action={approveApplicationDossier}><input name="applicationId" type="hidden" value={application.id} /><input name="dossierId" type="hidden" value={dossier.id} /><input name="contentHash" type="hidden" value={dossier.content_hash} /><SubmitButton disabled={content.missingFields.length > 0} pendingLabel="Approbation…">Approuver cette version</SubmitButton></form></section>}
          {dossier?.state === "approved" && application.prep_state !== "submitted" && <p className="rounded-xl bg-emerald-100 p-4 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">Version approuvée et immuable. Statut réel : non envoyée tant que vous ne déclarez pas l’envoi.</p>}
          {assistedAvailable && <AssistedApplication applicationId={application.id} answers={content.screeningAnswers.map(({ key, question, answer }) => ({ key, question, answer }))} decision={assisted?.user_decision ?? null} initiallyOpened={Boolean(assisted?.opened_at)} officialUrl={officialUrl} />}
          {events?.length ? <section className="space-y-3 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Historique</h2><ol className="space-y-2">{events.map((event) => <li className="flex flex-col justify-between gap-1 rounded-lg bg-muted p-3 text-sm sm:flex-row" key={event.id}><span>{applicationEventLabel(event.event_type)}</span><time className="text-xs text-muted-foreground" dateTime={event.created_at}>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}</time></li>)}</ol></section> : null}
        </>
      ) : null}
    </main>
  )
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={mono ? "break-all font-mono text-xs" : "font-medium"}>{value}</p></div>
}

function Columns({ items }: { items: Array<{ title: string; values: string[] }> }) {
  return <div className="grid gap-4 md:grid-cols-3">{items.map((item) => <div className="rounded-xl bg-muted p-4" key={item.title}><h3 className="text-sm font-semibold">{item.title}</h3>{item.values.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{item.values.map((value) => <li key={value}>{value}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">Aucune donnée explicite détectée.</p>}</div>)}</div>
}
