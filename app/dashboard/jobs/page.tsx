import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertTriangle, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react"

import { JobDeck, type DiscoverableJob } from "@/components/jobs/job-deck"
import { JobFilters } from "@/components/jobs/job-filters"
import { buildEasyJobsSearchPlan, parseEasyJobsPage, withCandidateDefaults } from "@/lib/jobs/easyjobs-query"
import { DYNAMIC_JOB_SELECT, searchAndCacheEasyJobs, type DynamicJobRow } from "@/lib/jobs/easyjobs-search"
import { filterCatalogJobs, type JobCatalogFilters } from "@/lib/jobs/filters"
import { computeJobMatch } from "@/lib/matching/engine"
import type { CandidateMatchProfile, MatchableJob } from "@/lib/matching/types"
import { requireUser } from "@/lib/supabase/server"

type SearchParams = Record<string, string | string[] | undefined>

function values(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : []
}

function pageHref(params: SearchParams, page: number) {
  const target = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value == null) continue
    for (const item of Array.isArray(value) ? value : [value]) target.append(key, item)
  }
  if (page > 1) target.set("page", String(page))
  const query = target.toString()
  return query ? `/dashboard/jobs?${query}` : "/dashboard/jobs"
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { supabase, user } = await requireUser()
  if (!user) redirect("/login")
  const params = await searchParams
  const filtersWereSubmitted = (Array.isArray(params.filters) ? params.filters[0] : params.filters) === "1"
  const salaryRaw = String(Array.isArray(params.salaryMin) ? params.salaryMin[0] ?? "" : params.salaryMin ?? "").trim()
  const salary = salaryRaw ? Number(salaryRaw) : Number.NaN
  const requestedFilters: JobCatalogFilters = {
    query: Array.isArray(params.q) ? params.q[0] : params.q,
    location: Array.isArray(params.location) ? params.location[0] : params.location,
    employmentTypes: values(params.contract),
    workModes: values(params.workMode),
    salaryMin: Number.isFinite(salary) && salary >= 0 ? salary : undefined,
    seniority: Array.isArray(params.experience) ? params.experience[0] : params.experience,
  }
  const page = parseEasyJobsPage(params.page)

  const [profileResult, skillsResult, experiencesResult, preferencesResult] = await Promise.all([
    supabase.from("profiles").select("current_title,experience_level,location").eq("id", user.id).single(),
    supabase.from("skills").select("name").eq("user_id", user.id).order("name"),
    supabase.from("career_experiences").select("title,description").eq("user_id", user.id).order("start_date", { ascending: false }),
    supabase.from("job_preferences").select("target_titles,countries,cities,work_modes,salary_min,salary_currency,employment_types,seniority").eq("user_id", user.id).maybeSingle(),
  ])
  const profileFailure = [profileResult, skillsResult, experiencesResult, preferencesResult].find((result) => result.error)
  if (profileFailure?.error) {
    return <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><p className="rounded-2xl bg-red-50 p-4 text-red-700">Impossible de charger votre profil. Réessayez plus tard.</p></main>
  }

  const preferences = preferencesResult.data
  const filters = withCandidateDefaults(requestedFilters, {
    currentTitle: profileResult.data?.current_title,
    location: profileResult.data?.location,
    targetTitles: preferences?.target_titles,
    countries: preferences?.countries,
    cities: preferences?.cities,
    workModes: preferences?.work_modes,
    salaryMin: preferences?.salary_min,
    employmentTypes: preferences?.employment_types,
    seniority: preferences?.seniority,
  }, !filtersWereSubmitted)
  const easyJobsPlan = buildEasyJobsSearchPlan(filters, page)

  const localJobsQuery = supabase.from("job_listings")
    .select(DYNAMIC_JOB_SELECT)
    .eq("is_active", true)
    .eq("is_demo", false)
    .neq("provider", "easyjobs")
    .neq("application_mode", "closed_invalid")
    .not("source_url", "is", null)
    .order("posted_at", { ascending: false })
    .limit(100)
  const [localJobsResult, decisionsResult, dynamicResult] = await Promise.all([
    localJobsQuery,
    supabase.from("saved_jobs").select("job_id,job:job_listings(dedupe_key)").eq("user_id", user.id),
    searchAndCacheEasyJobs(user.id, easyJobsPlan),
  ])
  const catalogFailure = [localJobsResult, decisionsResult].find((result) => result.error)
  if (catalogFailure?.error) {
    return <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><p className="rounded-2xl bg-red-50 p-4 text-red-700">Impossible de charger les offres. Réessayez plus tard.</p></main>
  }

  const profile: CandidateMatchProfile = {
    currentTitle: profileResult.data?.current_title,
    experienceLevel: profileResult.data?.experience_level,
    location: profileResult.data?.location,
    skills: (skillsResult.data ?? []).map((item) => item.name),
    experiences: experiencesResult.data ?? [],
    preferences: preferences ? {
      targetTitles: preferences.target_titles,
      countries: preferences.countries,
      cities: preferences.cities,
      workModes: preferences.work_modes,
      salaryMin: preferences.salary_min,
      salaryCurrency: preferences.salary_currency,
      employmentTypes: preferences.employment_types,
      seniority: preferences.seniority,
    } : null,
  }
  const decided = new Set((decisionsResult.data ?? []).map((item) => {
    const job = item.job as unknown as { dedupe_key?: string } | Array<{ dedupe_key?: string }> | null
    return Array.isArray(job) ? job[0]?.dedupe_key : job?.dedupe_key
  }).filter(Boolean))

  const localJobs = page === 1
    ? filterCatalogJobs((localJobsResult.data ?? []) as unknown as DynamicJobRow[], filters)
    : []
  const canonical = new Map<string, DynamicJobRow>()
  for (const row of [...localJobs, ...dynamicResult.jobs]) {
    if (!canonical.has(row.dedupe_key)) canonical.set(row.dedupe_key, row)
  }
  const jobs = [...canonical.values()].map((row) => {
    const matchable: MatchableJob = {
      id: row.id, title: row.title, location: row.location, country: row.country,
      workMode: row.work_mode, employmentType: row.employment_type, seniority: row.seniority,
      salaryMin: row.salary_min, salaryMax: row.salary_max, salaryCurrency: row.salary_currency,
      description: row.description, requirements: row.requirements,
    }
    return { row, match: computeJobMatch(profile, matchable) }
  })

  if (jobs.length) {
    const { error } = await supabase.from("job_matches").upsert(
      jobs.map(({ row, match }) => ({
        user_id: user.id,
        job_id: row.id,
        score: match.score,
        breakdown: { version: match.version, criteria: match.criteria },
        explanation: { satisfied: match.satisfied, incompatibilities: match.incompatibilities, missing_data: match.missingData, disclaimer: match.disclaimer },
        computed_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,job_id" },
    )
    if (error) {
      return <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><p className="rounded-2xl bg-red-50 p-4 text-red-700">Le matching n’a pas pu être enregistré. Réessayez plus tard.</p></main>
    }
  }

  const visibleJobs: DiscoverableJob[] = jobs
    .filter(({ row }) => !decided.has(row.dedupe_key) && Boolean(row.source_url))
    .sort((a, b) => b.match.score - a.match.score || a.row.id.localeCompare(b.row.id))
    .map(({ row, match }) => ({ ...row, source_url: row.source_url!, match }))
  const pagination = dynamicResult.pagination
  const hasPrevious = page > 1
  const hasNext = Boolean(pagination?.has_next_page) && page < 100
  const deckKey = JSON.stringify({ filters, page })

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Découvrir</p><h1 className="page-title mt-2">Trouvez l’offre qui vous ressemble.</h1><p className="mt-3 max-w-2xl text-slate-600">Recherche française à la demande, avec provenance et raisons du matching. Accepter crée un brouillon — aucun envoi n’est effectué.</p></div><Link className="btn-secondary self-start" href="/onboarding#preferences"><SlidersHorizontal className="size-4" />Ajuster mes critères</Link></header>
      <JobFilters filters={filters} />
      {dynamicResult.warning && <p aria-live="polite" className="mt-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{dynamicResult.warning}</p>}
      {dynamicResult.unsupported.length > 0 && <p className="mt-3 text-xs leading-5 text-slate-500">EasyJobs ne sait pas combiner directement : {dynamicResult.unsupported.join(", ")}. Ces critères sont appliqués uniquement aux résultats qui exposent les données nécessaires.</p>}
      <div className="mt-9">
        <JobDeck key={deckKey} initialJobs={visibleJobs} emptyMessage={dynamicResult.warning ? "Aucune offre locale ne correspond pour le moment. Réessayez lorsque la source externe sera disponible." : "Aucune offre disponible pour ces critères. Modifiez les filtres ou consultez une autre page."} />
      </div>
      {(hasPrevious || hasNext) && <nav aria-label="Pagination des offres" className="mt-6 flex items-center justify-between gap-4">
        {hasPrevious ? <Link className="btn-secondary" href={pageHref(params, page - 1)}><ChevronLeft className="size-4" />Précédent</Link> : <span />}
        <span className="text-sm text-slate-500">Page {page}{pagination?.total_pages ? ` sur ${Math.min(100, pagination.total_pages)}` : ""}</span>
        {hasNext ? <Link className="btn-secondary" href={pageHref(params, page + 1)}>Suivant<ChevronRight className="size-4" /></Link> : <span />}
      </nav>}
      <p className="mt-5 text-center text-xs leading-5 text-slate-400">Les offres EasyJobs sont recherchées par page et conservées uniquement comme cache opérationnel nécessaire au matching et au suivi. Leur disponibilité finale est confirmée sur la fiche originale.</p>
    </main>
  )
}
