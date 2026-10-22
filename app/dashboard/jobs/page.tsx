import { redirect } from "next/navigation"
import Link from "next/link"
import { SlidersHorizontal } from "lucide-react"

import { JobDeck, type DiscoverableJob } from "@/components/jobs/job-deck"
import { computeJobMatch } from "@/lib/matching/engine"
import type { CandidateMatchProfile, MatchableJob } from "@/lib/matching/types"
import { requireUser } from "@/lib/supabase/server"

export default async function JobsPage() {
  const { supabase, user } = await requireUser()
  if (!user) redirect("/login")

  const [profileResult, skillsResult, experiencesResult, preferencesResult, jobsResult, decisionsResult] = await Promise.all([
    supabase.from("profiles").select("current_title,experience_level,location").eq("id", user.id).single(),
    supabase.from("skills").select("name").order("name"),
    supabase.from("career_experiences").select("title,description").order("start_date", { ascending: false }),
    supabase.from("job_preferences").select("target_titles,countries,cities,work_modes,salary_min,salary_currency,employment_types,seniority").eq("user_id", user.id).maybeSingle(),
    supabase.from("job_listings").select("id,title,company,location,country,work_mode,employment_type,seniority,salary_min,salary_max,salary_currency,description,requirements,source_url,provider,posted_at,dedupe_key,application_mode,application_provider,application_reason").eq("is_active", true).eq("is_demo", false).neq("application_mode", "closed_invalid").not("source_url", "is", null).order("posted_at", { ascending: false }).limit(100),
    supabase.from("saved_jobs").select("job_id,job:job_listings(dedupe_key)"),
  ])

  const failure = [profileResult, skillsResult, experiencesResult, preferencesResult, jobsResult, decisionsResult].find((result) => result.error)
  if (failure?.error) {
    return <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><p className="rounded-2xl bg-red-50 p-4 text-red-700">Impossible de charger les offres : {failure.error.message}</p></main>
  }

  const preferences = preferencesResult.data
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
  const canonicalJobs = [...new Map((jobsResult.data ?? []).map((row) => [row.dedupe_key, row])).values()]
  const jobs = canonicalJobs.map((row) => {
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
      return <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><p className="rounded-2xl bg-red-50 p-4 text-red-700">Le matching n’a pas pu être enregistré : {error.message}</p></main>
    }
  }

  const visibleJobs: DiscoverableJob[] = jobs
    .filter(({ row }) => !decided.has(row.dedupe_key))
    .sort((a, b) => b.match.score - a.match.score || a.row.id.localeCompare(b.row.id))
    .map(({ row, match }) => ({ ...row, source_url: row.source_url!, match }))

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Découvrir</p><h1 className="page-title mt-2">Trouvez l’offre qui vous ressemble.</h1><p className="mt-3 max-w-2xl text-slate-600">Une offre à la fois, avec les raisons du matching. Accepter crée un brouillon — aucun envoi n’est effectué.</p></div><Link className="btn-secondary self-start" href="/onboarding#preferences"><SlidersHorizontal className="size-4" />Ajuster mes critères</Link></header>
      <div className="mt-9">
      <JobDeck initialJobs={visibleJobs} />
      </div>
    </main>
  )
}
