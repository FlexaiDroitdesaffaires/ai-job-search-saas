"use client"

import { useEffect } from "react"

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Application error", error.digest ?? error.message)
  }, [error])

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6">
      <section className="space-y-4 rounded-2xl border bg-card p-6">
        <h1 className="text-xl font-semibold">Une erreur empêche le chargement</h1>
        <p className="text-sm text-muted-foreground">Aucune candidature n’a été envoyée. Vérifiez la configuration Supabase ou réessayez.</p>
        <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={reset}>Réessayer</button>
      </section>
    </main>
  )
}
