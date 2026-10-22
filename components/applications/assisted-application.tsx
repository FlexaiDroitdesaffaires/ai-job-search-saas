"use client"

import { useState } from "react"
import { Check, Clipboard, Download, ExternalLink, MousePointer2, ShieldCheck } from "lucide-react"

import { recordAssistedApplicationDecision } from "@/app/dashboard/applications/actions"
import { assistedDecisionLabel } from "@/lib/applications/assisted"

type Answer = { key: string; question: string; answer: string }

export function AssistedApplication({
  applicationId,
  officialUrl,
  initiallyOpened,
  decision,
  answers,
}: {
  applicationId: string
  officialUrl: string | null
  initiallyOpened: boolean
  decision: string | null
  answers: Answer[]
}) {
  const [opened, setOpened] = useState(initiallyOpened)
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(key: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    window.setTimeout(() => setCopied((current) => current === key ? null : current), 1500)
  }

  return (
    <section className="surface overflow-hidden border-indigo-200">
      <div className="border-b border-indigo-100 bg-indigo-50/60 p-5 sm:p-7">
        <span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><MousePointer2 className="size-5" /></span>
        <p className="eyebrow mt-5">Candidature assistée</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Terminer sur le site employeur</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Aucun envoi automatique n’est effectué. Téléchargez vos documents, copiez les réponses utiles,
          puis envoyez vous-même la candidature sur le formulaire officiel.
        </p>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-7">
        {officialUrl ? (
          <a
            className="btn-primary min-h-12 text-center"
            href={`/api/applications/${applicationId}/official-form`}
            onClick={() => setOpened(true)}
            rel="noopener noreferrer"
            target="_blank"
          >
            Ouvrir le formulaire <ExternalLink className="size-4" />
          </a>
        ) : (
          <span className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            URL officielle non vérifiée : ouverture bloquée.
          </span>
        )}
        <a className="btn-secondary min-h-12 text-center" href={`/api/applications/${applicationId}/documents/resume`}>
          <Download className="size-4" />CV personnalisé
        </a>
        <a className="btn-secondary min-h-12 text-center" href={`/api/applications/${applicationId}/documents/cover-letter`}>
          <Download className="size-4" />Lettre PDF
        </a>
      </div>
      {officialUrl && <p className="mx-5 flex items-start gap-2 break-all rounded-xl bg-green-50 p-3 text-xs text-green-700 sm:mx-7"><ShieldCheck className="size-4 shrink-0" />URL vérifiée depuis l’offre originale : {officialUrl}</p>}

      <div className="space-y-3 p-5 sm:p-7">
        <div><p className="eyebrow">Copier-coller</p><h3 className="mt-1 text-lg font-semibold">Réponses préparées</h3></div>
        {answers.length ? answers.map((answer) => (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={answer.key}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">{answer.question}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{answer.answer || "Non renseigné"}</p>
              </div>
              <button
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 disabled:opacity-50"
                disabled={!answer.answer}
                onClick={() => copy(answer.key, answer.answer)}
                type="button"
              >
                {copied === answer.key ? <><Check className="size-3.5 text-green-600" />Copié</> : <><Clipboard className="size-3.5" />Copier</>}
              </button>
            </div>
          </div>
        )) : <p className="text-sm text-slate-500">Aucune réponse de présélection préparée.</p>}
      </div>

      <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 p-5 sm:p-7">
        <div>
          <h3 className="font-medium">Votre déclaration</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Cette déclaration vient de vous. Elle ne constitue jamais une confirmation ATS ou fournisseur.
          </p>
        </div>
        {decision === "sent" ? (
          <p className="flex items-start gap-2 rounded-xl bg-green-50 p-4 text-sm text-green-800">
            <Check className="mt-0.5 size-4 shrink-0" />
            {assistedDecisionLabel(decision)} — aucune confirmation ATS n’a été créée.
          </p>
        ) : (
          <>
            {!opened && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Ouvrez d’abord le formulaire officiel pour activer votre déclaration.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <form action={recordAssistedApplicationDecision} className="rounded-xl border border-slate-200 bg-white p-4">
                <input name="applicationId" type="hidden" value={applicationId} />
                <input name="decision" type="hidden" value="sent" />
                <label className="mb-3 flex items-start gap-2 text-xs">
                  <input className="mt-0.5" disabled={!opened} name="userConfirmedSend" required type="checkbox" />
                  <span>Je confirme avoir moi-même envoyé la candidature sur le site employeur.</span>
                </label>
                <button className="btn-primary w-full" disabled={!opened} type="submit">Je l’ai envoyée</button>
              </form>
              <form action={recordAssistedApplicationDecision}>
                <input name="applicationId" type="hidden" value={applicationId} />
                <input name="decision" type="hidden" value="not_sent" />
                <button className="btn-secondary h-full min-h-12 w-full bg-white" disabled={!opened} type="submit">Pas encore envoyée</button>
              </form>
              <form action={recordAssistedApplicationDecision}>
                <input name="applicationId" type="hidden" value={applicationId} />
                <input name="decision" type="hidden" value="unable" />
                <button className="btn-secondary h-full min-h-12 w-full bg-white" disabled={!opened} type="submit">Impossible de candidater</button>
              </form>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
