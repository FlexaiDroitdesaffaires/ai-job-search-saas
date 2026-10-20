"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  experienceSchema,
  identitySchema,
  parseList,
  preferencesSchema,
  skillsSchema,
} from "@/lib/onboarding/schemas"
import { requireUser } from "@/lib/supabase/server"

function onboardingError(message: string): never {
  redirect(`/onboarding?error=${encodeURIComponent(message)}`)
}

async function context() {
  const result = await requireUser()
  if (!result.user) redirect("/login")
  return { supabase: result.supabase, user: result.user }
}

export async function saveIdentity(formData: FormData) {
  const parsed = identitySchema.safeParse({
    fullName: formData.get("fullName"),
    currentTitle: formData.get("currentTitle"),
    location: formData.get("location"),
    phone: formData.get("phone"),
    linkedinUrl: formData.get("linkedinUrl"),
    summary: formData.get("summary"),
  })
  if (!parsed.success) onboardingError(parsed.error.issues[0]?.message ?? "Profil invalide.")
  const { supabase, user } = await context()
  const { error } = await supabase.from("profiles").update({
    full_name: parsed.data.fullName,
    current_title: parsed.data.currentTitle,
    location: parsed.data.location,
    phone: parsed.data.phone,
    linkedin_url: parsed.data.linkedinUrl,
    summary: parsed.data.summary,
    onboarding_step: 2,
  }).eq("id", user.id)
  if (error) onboardingError("Le profil n’a pas pu être enregistré.")
  revalidatePath("/onboarding")
  redirect("/onboarding?saved=identity")
}

export async function addExperience(formData: FormData) {
  const parsed = experienceSchema.safeParse({
    title: formData.get("title"), company: formData.get("company"),
    location: formData.get("location"), startDate: formData.get("startDate"),
    endDate: formData.get("endDate"), isCurrent: formData.get("isCurrent") === "on",
    description: formData.get("description"),
  })
  if (!parsed.success) onboardingError(parsed.error.issues[0]?.message ?? "Expérience invalide.")
  const { supabase, user } = await context()
  const { error } = await supabase.from("career_experiences").insert({
    user_id: user.id, title: parsed.data.title, company: parsed.data.company,
    location: parsed.data.location, start_date: parsed.data.startDate,
    end_date: parsed.data.isCurrent ? null : parsed.data.endDate,
    is_current: parsed.data.isCurrent, description: parsed.data.description,
  })
  if (error) onboardingError("L’expérience n’a pas pu être enregistrée.")
  revalidatePath("/onboarding")
  redirect("/onboarding?saved=experience")
}

export async function saveSkills(formData: FormData) {
  const parsed = skillsSchema.safeParse({ skills: parseList(formData.get("skills")) })
  if (!parsed.success) onboardingError(parsed.error.issues[0]?.message ?? "Compétences invalides.")
  const { supabase, user } = await context()
  const { error } = await supabase.from("skills").upsert(
    parsed.data.skills.map((name) => ({ user_id: user.id, name })),
    { onConflict: "user_id,name" },
  )
  if (error) onboardingError("Les compétences n’ont pas pu être enregistrées.")
  revalidatePath("/onboarding")
  redirect("/onboarding?saved=skills")
}

export async function savePreferences(formData: FormData) {
  const salaryValue = String(formData.get("salaryMin") ?? "").trim()
  const parsed = preferencesSchema.safeParse({
    targetTitles: parseList(formData.get("targetTitles")),
    countries: parseList(formData.get("countries")),
    cities: parseList(formData.get("cities")),
    workModes: formData.getAll("workModes"),
    employmentTypes: formData.getAll("employmentTypes"),
    salaryMin: salaryValue ? Number(salaryValue) : null,
    salaryCurrency: String(formData.get("salaryCurrency") ?? "EUR").toUpperCase(),
  })
  if (!parsed.success) onboardingError(parsed.error.issues[0]?.message ?? "Préférences invalides.")
  const { supabase, user } = await context()
  const { error } = await supabase.from("job_preferences").upsert({
    user_id: user.id, target_titles: parsed.data.targetTitles,
    countries: parsed.data.countries, cities: parsed.data.cities,
    work_modes: parsed.data.workModes, employment_types: parsed.data.employmentTypes,
    salary_min: parsed.data.salaryMin, salary_currency: parsed.data.salaryCurrency,
  })
  if (error) onboardingError("Les préférences n’ont pas pu être enregistrées.")
  await supabase.from("profiles").update({ onboarding_step: 5, onboarding_completed: true }).eq("id", user.id)
  revalidatePath("/onboarding")
  redirect("/dashboard")
}
