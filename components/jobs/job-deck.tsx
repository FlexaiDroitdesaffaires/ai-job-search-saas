"use client"

import { useRef, useState, useTransition } from "react"
import { ArrowLeft, ArrowRight, Banknote, BriefcaseBusiness, Check, CircleAlert, ExternalLink, MapPin, RotateCcw, Sparkles, Wifi, X } from "lucide-react"

import { decideJob } from "@/app/dashboard/jobs/actions"
import { employmentTypeLabel } from "@/lib/jobs/employment-type"
import type { MatchResult } from "@/lib/matching/types"

export type DiscoverableJob = {
  id: string
  title: string
  company: string
  location: string | null
  country: string | null
  work_mode: string | null
  employment_type: string | null
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
  const [dragX, setDragX] = useState(0)
  const startX = useRef<number | null>(null)
  const locked = useRef(false)
  const job = jobs[0]

  function submit(decision: "saved" | "skipped") {
    if (!job || locked.current) return
    locked.current = true
    setError(null)
    setDragX(decision === "saved" ? 120 : -120)
    startTransition(async () => {
      const result = await decideJob(job.id, decision)
      if (!result.ok) {
        setError(result.message)
        setDragX(0)
        locked.current = false
        return
      }
      setJobs((current) => current.filter((item) => item.id !== job.id))
      setDragX(0)
      locked.current = false
    })
  }

  if (!job) {
    return <section className="surface px-6 py-16 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Check className="size-6" /></span><h2 className="mt-5 text-2xl font-semibold tracking-tight">Vous avez tout examiné</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Les nouvelles offres réelles apparaîtront ici après la prochaine ingestion.</p></section>
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 text-sm"><p aria-live="polite" className="text-slate-500"><strong className="text-slate-900">{jobs.length}</strong> offre{jobs.length > 1 ? "s" : ""} à examiner</p><p className="hidden items-center gap-2 text-slate-400 sm:flex"><ArrowLeft className="size-3.5" /> Glissez pour décider <ArrowRight className="size-3.5" /></p></div>
      {error && <p aria-live="assertive" className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
      <article
        className="surface touch-pan-y overflow-hidden transition duration-300 ease-out"
        onPointerDown={(event) => { if (!isPending) { startX.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId) } }}
        onPointerMove={(event) => { if (startX.current != null && !isPending) setDragX(Math.max(-140, Math.min(140, event.clientX - startX.current))) }}
        onPointerUp={(event) => {
          if (startX.current == null || isPending) return
          const distance = event.clientX - startX.current
          startX.current = null
          if (Math.abs(distance) >= SWIPE_THRESHOLD) submit(distance > 0 ? "saved" : "skipped")
          else setDragX(0)
        }}
        style={{ opacity: isPending ? 0.72 : 1, transform: `translateX(${dragX}px) rotate(${dragX / 55}deg)` }}
      >
        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.7fr)]">
          <div className="p-5 sm:p-8 lg:p-10">
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0"><p className="text-sm font-semibold text-indigo-600">{job.company}</p><h2 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.035em] text-slate-950 sm:text-3xl">{job.title}</h2></div>
              <Score value={job.match.score} />
            </header>

            <div className="mt-6 flex flex-wrap gap-2 text-sm text-slate-600">
              <Pill icon={MapPin}>{job.location || job.country || "Localisation inconnue"}</Pill>
              <Pill icon={Wifi}>{workModeLabel(job.work_mode)}</Pill>
              <Pill icon={BriefcaseBusiness}>{employmentTypeLabel(job.employment_type)}</Pill>
              <Pill icon={Banknote}>{salary(job)}</Pill>
            </div>

            <div className="mt-8 border-t border-slate-100 pt-7">
              <h3 className="text-sm font-semibold text-slate-900">À propos du poste</h3>
              <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-line pr-2 text-sm leading-7 text-slate-600">{job.description || "Description non fournie par la source."}</p>
            </div>

            <div className="mt-7 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-6">
              <div className="text-sm text-slate-500"><a className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-indigo-600" href={job.source_url} rel="noopener noreferrer" target="_blank">Voir l’offre originale <ExternalLink className="size-3.5" /></a><p className="mt-1 text-xs">{sourceLabel(job.provider)} · {job.posted_at ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(job.posted_at)) : "Date inconnue"}</p></div>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">{applicationLabel(job.application_mode)}</span>
            </div>
          </div>

          <aside className="border-t border-slate-200 bg-slate-50/70 p-5 sm:p-8 lg:border-t-0 lg:border-l lg:p-9">
            <div className="flex items-center gap-2"><Sparkles className="size-4 text-indigo-600" /><h3 className="font-semibold text-slate-900">Pourquoi ce match ?</h3></div>
            <p className="mt-2 text-sm leading-6 text-slate-500">Le score est décomposé à partir de votre profil et de vos préférences.</p>
            <div className="mt-6 space-y-5">
              <Explanation icon={Check} tone="green" title="Points forts" items={job.match.satisfied} empty="Aucun critère confirmé." />
              <Explanation icon={X} tone="red" title="Incompatibilités" items={job.match.incompatibilities} empty="Aucune incompatibilité explicite." />
              <Explanation icon={CircleAlert} tone="amber" title="À compléter" items={job.match.missingData} empty="Aucune donnée manquante." />
            </div>
            <p className="mt-6 rounded-xl bg-white p-3 text-xs leading-5 text-slate-500">{job.match.disclaimer}</p>
          </aside>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-center text-xs text-slate-400 sm:text-left">Votre décision est enregistrée et protégée contre les doublons.</p>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <button aria-label="Refuser cette offre" className="btn-secondary min-h-12 px-5" disabled={isPending} onClick={() => submit("skipped")} type="button"><X className="size-4" />Passer</button>
            <button aria-label="Accepter cette offre et créer un brouillon de candidature" className="btn-primary min-h-12 px-5" disabled={isPending} onClick={() => submit("saved")} type="button">Préparer <ArrowRight className="size-4" /></button>
          </div>
        </footer>
        {isPending && <p aria-live="polite" className="flex items-center justify-center gap-2 border-t border-slate-100 bg-indigo-50 p-3 text-sm font-medium text-indigo-700"><RotateCcw className="size-4 animate-spin" />Enregistrement de la décision…</p>}
      </article>
    </div>
  )
}

function Score({ value }: { value: number }) {
  return <div aria-label={`Score de compatibilité ${value} sur 100`} className="relative grid size-20 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#4f46e5 ${value * 3.6}deg, #e2e8f0 0deg)` }}><span className="grid size-[66px] place-items-center rounded-full bg-white text-center"><span><strong className="block text-xl leading-5 text-slate-950">{value}</strong><small className="text-[9px] font-semibold tracking-wide text-slate-400 uppercase">match</small></span></span></div>
}

function Pill({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) { return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5"><Icon className="size-3.5 text-slate-400" />{children}</span> }

function sourceLabel(provider: string) {
  if (provider === "easyjobs") return "EasyJobs"
  if (provider === "remoteok") return "Remote OK"
  if (provider === "aidevjobs") return "AI Dev Jobs"
  return provider
}

function workModeLabel(value: string | null) { return value === "remote" ? "Télétravail" : value === "hybrid" ? "Hybride" : value === "onsite" ? "Sur site" : "Mode non précisé" }
function applicationLabel(mode: string) {
  if (mode === "automatic_authorized") return "Automatisation autorisée"
  if (mode === "manual_required") return "Candidature assistée"
  if (mode === "closed_invalid") return "Offre fermée"
  return "Mode à confirmer"
}

function Explanation({ icon: Icon, title, items, empty, tone }: { icon: typeof Check; title: string; items: string[]; empty: string; tone: "green" | "red" | "amber" }) {
  const colors = { green: "bg-green-50 text-green-600", red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600" }
  return <div><h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className={`grid size-6 place-items-center rounded-lg ${colors[tone]}`}><Icon className="size-3.5" /></span>{title}</h4>{items.length ? <ul className="mt-2 space-y-2 pl-8 text-xs leading-5 text-slate-600">{items.map((item) => <li className="list-disc" key={item}>{item}</li>)}</ul> : <p className="mt-2 pl-8 text-xs text-slate-400">{empty}</p>}</div>
}
