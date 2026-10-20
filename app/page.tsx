import Link from "next/link"

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-16">
      <div className="max-w-2xl space-y-5">
        <p className="text-sm font-medium text-muted-foreground">AI Job Search</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Des candidatures préparées avec vous, jamais inventées.
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Créez votre profil, importez votre CV et gardez le contrôle sur chaque
          candidature. Une offre acceptée ne sera jamais présentée comme envoyée
          sans confirmation réelle.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link className="rounded-lg bg-primary px-5 py-3 text-primary-foreground" href="/signup">
          Créer mon profil
        </Link>
        <Link className="rounded-lg border px-5 py-3" href="/login">
          Se connecter
        </Link>
      </div>
    </main>
  )
}
