import Link from "next/link"
import { Check, ShieldCheck, Sparkles } from "lucide-react"

import { Brand } from "@/components/brand"

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  alternate,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
  alternate: React.ReactNode
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="pointer-events-none absolute -top-56 left-1/2 h-[540px] w-[760px] -translate-x-1/2 rounded-full bg-indigo-200/35 blur-3xl" />
      <header className="relative z-10 mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Brand />
        <Link className="text-sm font-medium text-slate-600 transition hover:text-slate-950" href="/">
          Retour à l’accueil
        </Link>
      </header>

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-8 sm:px-6 lg:min-h-[calc(100vh-5rem)] lg:grid-cols-[1fr_0.88fr] lg:py-16">
        <section className="hidden max-w-xl lg:block">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-indigo-700 backdrop-blur">
            <Sparkles className="size-3.5" /> Votre recherche, enfin structurée
          </span>
          <h2 className="mt-7 text-5xl font-semibold leading-[1.06] tracking-[-0.05em] text-slate-950">
            Un espace calme pour avancer avec méthode.
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-600">
            Centralisez votre profil, comprenez chaque recommandation et gardez le dernier mot avant toute action.
          </p>
          <ul className="mt-9 space-y-4">
            {["Matching explicable", "Documents préparés à partir de faits vérifiés", "Aucun envoi automatique implicite"].map((item) => (
              <li className="flex items-center gap-3 text-sm font-medium text-slate-700" key={item}>
                <span className="grid size-7 place-items-center rounded-full bg-green-50"><Check className="size-4 text-green-600" /></span>
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-12 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-600 backdrop-blur">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-indigo-600" />
            <p>Vos décisions et les confirmations fournisseur restent clairement distinguées dans le suivi.</p>
          </div>
        </section>

        <section className="surface mx-auto w-full max-w-lg p-6 sm:p-9">
          <div className="mb-8">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">{title}</h1>
            <p className="mt-3 leading-7 text-slate-600">{description}</p>
          </div>
          {children}
          <div className="mt-7 border-t border-slate-100 pt-6 text-center text-sm text-slate-600">{alternate}</div>
        </section>
      </div>
    </main>
  )
}
