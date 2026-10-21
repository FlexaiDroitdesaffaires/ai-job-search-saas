"use client"

import { useRef, useState, useTransition } from "react"
import { ArrowLeft, ArrowRight, ExternalLink, MapPin } from "lucide-react"

import { decideJob } from "@/app/dashboard/jobs/actions"
import type { MatchResult } from "@/lib/matching/types"

export type DiscoverableJob = {
  id: string
  title: string
  company: string
  location: string | null
  country: string | null
  work_mode: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  description: string | null
  source_url: string
  provider: string
  posted_at: string | null
  dedupe_key: string
  application_mode: string
  application_provider: string | null
  application_reason: string | null
  match: MatchResult
}

const SWIPE_THRESHOLD = 80

function salary(job: DiscoverableJob) {
  if (job.salary_min == null && job.salary_max == null) return "Salaire non communiqué"
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
  const range = [job.salary_min, job.salary_max].filter((value): value is number => value != null).map((value) => formatter.format(value)).join(" – ")
  return `${range} ${job.salary_currency ?? "devise non précisée"}`
}

export function JobDeck({ initialJobs }: { initialJobs: DiscoverableJob[] }) {
  const [jobs, setJobs] = useState(initialJobs)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const startX = useRef<number | null>(null)
  const locked = useRef(false)
  const job = jobs[0]

  function submit(decision: "saved" | "skipped") {
    if (!job || locked.current) return
    locked.current = true
    setError(null)
    startTransition(async () => {
      const result = await decideJob(job.id, decision)
      if (!result.ok) {
        setError(result.message)
        locked.current = false
        return
      }
      setJobs((current) => current.filter((item) => item.id !== job.id))
      locked.current = false
    })
  }

  if (!job) {
    return <section className="rounded-2xl border bg-card p-8 text-center"><h2 className="text-xl font-semibold">Toutes les offres ont été examinées</h2><p className="mt-2 text-sm text-muted-foreground">Les nouvelles offres réelles apparaîtront ici après la prochaine ingestion.</p></section>
  }

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="text-sm text-muted-foreground">{jobs.length} offre(s) à examiner. Glissez ou utilisez les boutons.</p>
      {error && <p aria-live="assertive" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <article
        className="touch-pan-y space-y-6 rounded-3xl border bg-card p-6 shadow-sm sm:p-8"
        onPointerDown={(event) => { if (!isPending) startX.current = event.clientX }}
        onPointerUp={(event) => {
          if (startX.current == null || isPending) return
          const distance = event.clientX - startX.current
          startX.current = null
          if (Math.abs(distance) >= SWIPE_THRESHOLD) submit(distance > 0 ? "saved" : "skipped")
        }}
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-medium text-muted-foreground">{job.company}</p><h2 className="text-2xl font-semibold">{job.title}</h2></div>
          <div aria-label={`Score de compatibilité ${job.match.score} sur 100`} className="rounded-full border px-4 py-2 text-lg font-semibold">{job.match.score}/100</div>
        </header>

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-muted px-3 py-1"><MapPin className="mr-1 inline size-4" />{job.location || job.country || "Localisation inconnue"}</span>
          <span className="rounded-full bg-muted px-3 py-1">{job.work_mode === "remote" ? "Télétravail" : job.work_mode ?? "Mode non précisé"}</span>
          <span className="rounded-full bg-muted px-3 py-1">{salary(job)}</span>
          <span className="rounded-full bg-muted px-3 py-1">{applicationLabel(job.application_mode)}</span>
        </div>

        {job.application_reason && <p className="text-sm text-muted-foreground">Candidabilité : {job.application_reason}</p>}

        <p className="max-h-56 overflow-y-auto whitespace-pre-line text-sm leading-6 text-muted-foreground">{job.description || "Description non fournie par la source."}</p>

        <section className="grid gap-3 md:grid-cols-3" aria-label="Explication du matching">
          <Explanation title="Critères satisfaits" items={job.match.satisfied} empty="Aucun critère confirmé." />
          <Explanation title="Incompatibilités" items={job.match.incompatibilities} empty="Aucune incompatibilité explicite." />
          <Explanation title="Données manquantes" items={job.match.missingData} empty="Aucune donnée manquante." />
        </section>
        <p className="text-xs text-muted-foreground">{job.match.disclaimer}</p>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <div className="text-sm text-muted-foreground">
            <a className="font-medium underline underline-offset-4" href={job.source_url} rel="noopener noreferrer" target="_blank">Source : {sourceLabel(job.provider)} <ExternalLink className="inline size-3" /></a>
            <p>{job.posted_at ? `Publiée le ${new Intl.DateTimeFormat("fr-FR").format(new Date(job.posted_at))}` : "Date de publication inconnue"}</p>
          </div>
          <div className="flex gap-3">
            <button aria-label="Refuser cette offre" className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 font-medium disabled:opacity-50" disabled={isPending} onClick={() => submit("skipped")} type="button"><ArrowLeft /> Refuser</button>
            <button aria-label="Accepter cette offre et créer un brouillon de candidature" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50" disabled={isPending} onClick={() => submit("saved")} type="button">Accepter <ArrowRight /></button>
          </div>
        </footer>
        {isPending && <p aria-live="polite" className="text-center text-sm">Enregistrement de la décision…</p>}
      </article>
    </div>
  )
}

function sourceLabel(provider: string) {
  if (provider === "remoteok") return "Remote OK"
  if (provider === "aidevjobs") return "AI Dev Jobs"
  return provider
}

function applicationLabel(mode: string) {
  if (mode === "automatic_authorized") return "Soumission automatique autorisée"
  if (mode === "manual_required") return "Soumission manuelle nécessaire"
  if (mode === "closed_invalid") return "Offre fermée ou invalide"
  return "Compatibilité de soumission inconnue"
}

function Explanation({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <div className="rounded-xl bg-muted p-4"><h3 className="text-sm font-semibold">{title}</h3>{items.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{empty}</p>}</div>
}
