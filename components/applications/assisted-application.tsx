"use client"

import { useState } from "react"

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
    <section className="space-y-5 rounded-2xl border border-primary/30 bg-card p-5 sm:p-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Candidature assistée</p>
        <h2 className="text-xl font-semibold">Terminer sur le site employeur</h2>
        <p className="text-sm text-muted-foreground">
          Aucun envoi automatique n’est effectué. Téléchargez vos documents, copiez les réponses utiles,
          puis envoyez vous-même la candidature sur le formulaire officiel.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {officialUrl ? (
          <a
            className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground"
            href={`/api/applications/${applicationId}/official-form`}
            onClick={() => setOpened(true)}
            rel="noopener noreferrer"
            target="_blank"
          >
            Ouvrir le formulaire officiel
          </a>
        ) : (
          <span className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
            URL officielle non vérifiée : ouverture bloquée.
          </span>
        )}
        <a className="rounded-lg border px-4 py-3 text-center text-sm" href={`/api/applications/${applicationId}/documents/resume`}>
          Télécharger le CV PDF
        </a>
        <a className="rounded-lg border px-4 py-3 text-center text-sm" href={`/api/applications/${applicationId}/documents/cover-letter`}>
          Télécharger la lettre PDF
        </a>
      </div>
      {officialUrl && <p className="break-all text-xs text-muted-foreground">URL vérifiée depuis l’offre originale : {officialUrl}</p>}

      <div className="space-y-3">
        <h3 className="font-medium">Réponses préparées</h3>
        {answers.length ? answers.map((answer) => (
          <div className="rounded-xl bg-muted p-3" key={answer.key}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{answer.question}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{answer.answer || "Non renseigné"}</p>
              </div>
              <button
                className="shrink-0 rounded-lg border bg-background px-3 py-2 text-xs disabled:opacity-50"
                disabled={!answer.answer}
                onClick={() => copy(answer.key, answer.answer)}
                type="button"
              >
                {copied === answer.key ? "Copié" : "Copier"}
              </button>
            </div>
          </div>
        )) : <p className="text-sm text-muted-foreground">Aucune réponse de présélection préparée.</p>}
      </div>

      <div className="space-y-3 border-t pt-5">
        <div>
          <h3 className="font-medium">Votre déclaration</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Cette déclaration vient de vous. Elle ne constitue jamais une confirmation ATS ou fournisseur.
          </p>
        </div>
        {decision === "sent" ? (
          <p className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            {assistedDecisionLabel(decision)} — aucune confirmation ATS n’a été créée.
          </p>
        ) : (
          <>
            {!opened && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">Ouvrez d’abord le formulaire officiel pour activer votre déclaration.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <form action={recordAssistedApplicationDecision} className="rounded-xl border p-3">
                <input name="applicationId" type="hidden" value={applicationId} />
                <input name="decision" type="hidden" value="sent" />
                <label className="mb-3 flex items-start gap-2 text-xs">
                  <input className="mt-0.5" disabled={!opened} name="userConfirmedSend" required type="checkbox" />
                  <span>Je confirme avoir moi-même envoyé la candidature sur le site employeur.</span>
                </label>
                <button className="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!opened} type="submit">Candidature envoyée</button>
              </form>
              <form action={recordAssistedApplicationDecision}>
                <input name="applicationId" type="hidden" value={applicationId} />
                <input name="decision" type="hidden" value="not_sent" />
                <button className="h-full min-h-12 w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-50" disabled={!opened} type="submit">Pas encore envoyée</button>
              </form>
              <form action={recordAssistedApplicationDecision}>
                <input name="applicationId" type="hidden" value={applicationId} />
                <input name="decision" type="hidden" value="unable" />
                <button className="h-full min-h-12 w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-50" disabled={!opened} type="submit">Impossible de candidater</button>
              </form>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
