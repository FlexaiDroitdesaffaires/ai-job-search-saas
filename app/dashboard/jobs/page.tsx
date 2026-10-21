import Link from "next/link"
import { redirect } from "next/navigation"

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
    supabase.from("saved_jobs").select("job_id,job_listings(dedupe_key)"),
  ])

  const failure = [profileResult, skillsResult, experiencesResult, preferencesResult, jobsResult, decisionsResult].find((result) => result.error)
  if (failure?.error) {
    return <main className="mx-auto min-h-screen max-w-5xl px-6 py-12"><p className="rounded-lg bg-destructive/10 p-4 text-destructive">Impossible de charger les offres : {failure.error.message}</p></main>
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
  const decided = new Set((decisionsResult.data ?? []).map((item) => item.job_listings?.[0]?.dedupe_key).filter(Boolean))
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
      return <main className="mx-auto min-h-screen max-w-5xl px-6 py-12"><p className="rounded-lg bg-destructive/10 p-4 text-destructive">Le matching n’a pas pu être enregistré : {error.message}</p></main>
    }
  }

  const visibleJobs: DiscoverableJob[] = jobs
    .filter(({ row }) => !decided.has(row.dedupe_key))
    .sort((a, b) => b.match.score - a.match.score || a.row.id.localeCompare(b.row.id))
    .map(({ row, match }) => ({ ...row, source_url: row.source_url!, match }))

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Lot B</p><h1 className="text-3xl font-semibold">Offres compatibles</h1><p className="mt-2 max-w-2xl text-muted-foreground">Accepter crée uniquement un brouillon de candidature. Aucun envoi n’est effectué.</p></div><div className="flex gap-2"><Link className="rounded-lg border px-4 py-2 text-sm" href="/onboarding">Modifier le profil</Link><Link className="rounded-lg border px-4 py-2 text-sm" href="/dashboard">Suivi</Link></div></header>
      <JobDeck initialJobs={visibleJobs} />
    </main>
  )
}
