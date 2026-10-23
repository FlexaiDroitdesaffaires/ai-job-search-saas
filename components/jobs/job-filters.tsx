import Link from "next/link"
import { Search, SlidersHorizontal } from "lucide-react"

import { employmentTypeLabel } from "@/lib/jobs/employment-type"
import type { JobCatalogFilters } from "@/lib/jobs/filters"

const contracts = ["permanent", "fixed_term", "freelance", "temporary", "apprenticeship", "internship", "seasonal", "occasional"]
const workModes = [["onsite", "Sur site"], ["hybrid", "Hybride"], ["remote", "Télétravail"]]

export function JobFilters({ filters }: { filters: JobCatalogFilters }) {
  return (
    <details className="surface mt-7 p-5" open={Boolean(filters.query || filters.location || filters.employmentTypes.length || filters.workModes.length || filters.salaryMin || filters.seniority)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-slate-900"><SlidersHorizontal className="size-4 text-indigo-600" />Filtrer les offres</summary>
      <form className="mt-5 grid gap-5 border-t border-slate-100 pt-5 md:grid-cols-2 xl:grid-cols-3" method="get">
        <input name="filters" type="hidden" value="1" />
        <label className="space-y-2 text-sm font-medium text-slate-700"><span>Métier ou mot-clé</span><div className="relative"><Search className="absolute top-3 left-3 size-4 text-slate-400" /><input className="field pl-9" defaultValue={filters.query} name="q" placeholder="Comptable, infirmier, développeur…" /></div></label>
        <label className="space-y-2 text-sm font-medium text-slate-700"><span>Localisation</span><input className="field" defaultValue={filters.location} name="location" placeholder="Paris, Lyon, France…" /></label>
        <label className="space-y-2 text-sm font-medium text-slate-700"><span>Salaire minimum annuel</span><input className="field" defaultValue={filters.salaryMin} min="0" name="salaryMin" step="1000" type="number" /></label>
        <fieldset className="space-y-2 md:col-span-2 xl:col-span-3"><legend className="text-sm font-medium text-slate-700">Contrats</legend><div className="flex flex-wrap gap-2">{contracts.map((value) => <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 has-checked:border-indigo-500 has-checked:bg-indigo-50 has-checked:text-indigo-700" key={value}><input className="sr-only" defaultChecked={filters.employmentTypes.includes(value)} name="contract" type="checkbox" value={value} />{employmentTypeLabel(value)}</label>)}</div></fieldset>
        <fieldset className="space-y-2 md:col-span-2"><legend className="text-sm font-medium text-slate-700">Mode de travail</legend><div className="flex flex-wrap gap-2">{workModes.map(([value, label]) => <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 has-checked:border-indigo-500 has-checked:bg-indigo-50 has-checked:text-indigo-700" key={value}><input className="sr-only" defaultChecked={filters.workModes.includes(value)} name="workMode" type="checkbox" value={value} />{label}</label>)}</div></fieldset>
        <label className="space-y-2 text-sm font-medium text-slate-700"><span>Expérience</span><select className="field" defaultValue={filters.seniority ?? ""} name="experience"><option value="">Tous niveaux</option><option value="entry">Débutant</option><option value="junior">Junior</option><option value="mid">Intermédiaire</option><option value="senior">Senior</option><option value="lead">Lead</option><option value="executive">Direction</option></select></label>
        <div className="flex items-center gap-3 md:col-span-2 xl:col-span-3"><button className="btn-primary" type="submit">Appliquer les filtres</button><Link className="btn-secondary" href="/dashboard/jobs">Effacer</Link></div>
      </form>
    </details>
  )
}
