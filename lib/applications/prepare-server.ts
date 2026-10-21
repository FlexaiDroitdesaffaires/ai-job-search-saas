import type { SupabaseClient, User } from "@supabase/supabase-js"

import type { ApplicationDossierContent } from "./dossier-schema"
import { dossierFingerprint } from "./hash"
import { prepareApplicationContent } from "./preparation"

export async function persistApplicationDossier(
  supabase: SupabaseClient,
  applicationId: string,
  resumeId: string,
  content: ApplicationDossierContent,
) {
  const fingerprint = dossierFingerprint(content)
  return supabase.rpc("prepare_application_dossier", {
    p_application_id: applicationId,
    p_resume_id: resumeId,
    p_content: content,
    p_canonical_content: fingerprint.canonical,
    p_content_hash: fingerprint.hash,
  })
}

export async function prepareApplicationDossierForUser(
  supabase: SupabaseClient,
  user: User,
  applicationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const applicationResult = await supabase.from("applications")
    .select("id,job_id,job_title,company,job_url,prep_state")
    .eq("id", applicationId).eq("user_id", user.id).single()
  if (applicationResult.error || !applicationResult.data?.job_id) return { ok: false, message: "Candidature acceptée introuvable." }
  if (["submitting", "submitted"].includes(applicationResult.data.prep_state)) return { ok: false, message: "Cette candidature est verrouillée." }

  const [profileResult, skillsResult, experiencesResult, preferencesResult, resumeResult, jobResult] = await Promise.all([
    supabase.from("profiles").select("id,email,full_name,phone,location,linkedin_url,current_title,experience_level,summary").eq("id", user.id).single(),
    supabase.from("skills").select("id,name").order("name"),
    supabase.from("career_experiences").select("id,title,company,location,start_date,end_date,is_current,description").order("start_date", { ascending: false }),
    supabase.from("job_preferences").select("target_titles,countries,cities,work_modes,salary_min,salary_currency,employment_types,seniority").eq("user_id", user.id).maybeSingle(),
    supabase.from("resumes").select("id,title,parsed_data,parse_status,is_primary").eq("parse_status", "parsed").order("is_primary", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("job_listings").select("id,title,company,location,country,work_mode,employment_type,seniority,salary_min,salary_max,salary_currency,description,requirements,source_url").eq("id", applicationResult.data.job_id).single(),
  ])
  const failed = [profileResult, skillsResult, experiencesResult, preferencesResult, resumeResult, jobResult].find((result) => result.error)
  if (failed?.error) return { ok: false, message: `Préparation impossible : ${failed.error.message}` }
  if (!profileResult.data?.full_name) return { ok: false, message: "Renseignez votre nom dans le profil avant la préparation." }
  if (!resumeResult.data) return { ok: false, message: "Importez et validez un CV avant la préparation." }
  if (!jobResult.data) return { ok: false, message: "Offre introuvable." }

  const preferences = preferencesResult.data
  const content = prepareApplicationContent({
    profile: profileResult.data,
    skills: skillsResult.data ?? [],
    experiences: experiencesResult.data ?? [],
    resume: resumeResult.data,
    application: applicationResult.data,
    job: {
      id: jobResult.data.id,
      title: jobResult.data.title,
      company: jobResult.data.company,
      location: jobResult.data.location,
      country: jobResult.data.country,
      workMode: jobResult.data.work_mode,
      employmentType: jobResult.data.employment_type,
      seniority: jobResult.data.seniority,
      salaryMin: jobResult.data.salary_min,
      salaryMax: jobResult.data.salary_max,
      salaryCurrency: jobResult.data.salary_currency,
      description: jobResult.data.description,
      requirements: jobResult.data.requirements,
      sourceUrl: jobResult.data.source_url,
    },
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
  })
  const { error } = await persistApplicationDossier(supabase, applicationId, resumeResult.data.id, content)
  return error ? { ok: false, message: `Le dossier n’a pas pu être enregistré : ${error.message}` } : { ok: true }
}
