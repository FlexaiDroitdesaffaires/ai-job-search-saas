export default function JobsLoading() {
  return (
    <main aria-busy="true" aria-label="Chargement des offres" className="mx-auto max-w-6xl animate-pulse px-4 py-8 sm:px-6 sm:py-12">
      <div className="h-3 w-20 rounded bg-slate-200" />
      <div className="mt-4 h-10 max-w-xl rounded-xl bg-slate-200" />
      <div className="mt-4 h-5 max-w-2xl rounded bg-slate-100" />
      <div className="mt-8 h-20 rounded-2xl border border-slate-200 bg-white" />
      <div className="mt-9 h-[32rem] rounded-3xl border border-slate-200 bg-white" />
      <span className="sr-only">Recherche et calcul du matching en cours…</span>
    </main>
  )
}
