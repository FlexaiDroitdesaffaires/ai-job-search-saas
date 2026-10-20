import Link from "next/link"
import { redirect } from "next/navigation"

import { addExperience, saveIdentity, savePreferences, saveSkills } from "./actions"
import { ResumeEditor } from "@/components/onboarding/resume-editor"
import { SubmitButton } from "@/components/submit-button"
import { editableResumeDataSchema } from "@/lib/resume/schema"
import { requireUser } from "@/lib/supabase/server"

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { supabase, user } = await requireUser()
  if (!user) redirect("/login")
  const params = await searchParams
  const [profileResult, experiencesResult, skillsResult, preferencesResult, resumesResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("career_experiences").select("*").order("start_date", { ascending: false }),
    supabase.from("skills").select("name").order("name"),
    supabase.from("job_preferences").select("*").eq("user_id", user.id).single(),
    supabase.from("resumes").select("id,file_name,parse_status,parsed_data").order("created_at", { ascending: false }).limit(1),
  ])
  const profile = profileResult.data
  const preferences = preferencesResult.data
  const rawResume = resumesResult.data?.[0] ?? null
  const resumeData = rawResume ? editableResumeDataSchema.safeParse(rawResume.parsed_data) : null
  const initialResume = rawResume ? { ...rawResume, parsed_data: resumeData?.success ? resumeData.data : null } : null
  const databaseError = [profileResult, experiencesResult, skillsResult, preferencesResult, resumesResult].some((result) => result.error)

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-muted-foreground">Étape 1</p><h1 className="text-3xl font-semibold">Votre profil candidat</h1><p className="mt-2 max-w-2xl text-muted-foreground">Saisissez uniquement des informations exactes. Tout contenu extrait du CV reste modifiable avant utilisation.</p></div><Link className="rounded-lg border px-4 py-2 text-sm" href="/dashboard">Tableau de bord</Link></header>
      {databaseError && <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">La base locale n’est pas prête ou la migration n’est pas appliquée. Consultez la configuration locale avant de tester ce parcours.</p>}
      {params.error && <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{params.error}</p>}
      {params.saved && <p className="rounded-lg bg-muted p-4 text-sm">Section enregistrée.</p>}

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Identité</h2>
        <form action={saveIdentity} className="grid gap-4 sm:grid-cols-2">
          <Field defaultValue={profile?.full_name} label="Nom complet" name="fullName" required />
          <Field defaultValue={profile?.current_title} label="Poste actuel" name="currentTitle" />
          <Field defaultValue={profile?.location} label="Localisation" name="location" />
          <Field defaultValue={profile?.phone} label="Téléphone" name="phone" />
          <Field defaultValue={profile?.linkedin_url} label="LinkedIn" name="linkedinUrl" type="url" />
          <label className="space-y-1 text-sm sm:col-span-2"><span>Résumé professionnel</span><textarea className="min-h-28 w-full rounded-lg border bg-background px-3 py-2" defaultValue={profile?.summary ?? ""} maxLength={5000} name="summary" /></label>
          <div className="sm:col-span-2"><SubmitButton>Enregistrer l’identité</SubmitButton></div>
        </form>
      </section>

      <ResumeEditor initialResume={initialResume} />

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Expérience professionnelle</h2>
        {experiencesResult.data?.length ? <ul className="space-y-2 text-sm">{experiencesResult.data.map((item) => <li className="rounded-lg bg-muted p-3" key={item.id}><strong>{item.title}</strong> — {item.company}</li>)}</ul> : <p className="text-sm text-muted-foreground">Aucune expérience enregistrée.</p>}
        <form action={addExperience} className="grid gap-4 sm:grid-cols-2">
          <Field label="Intitulé" name="title" required /><Field label="Entreprise" name="company" required /><Field label="Localisation" name="location" /><Field label="Date de début" name="startDate" type="date" /><Field label="Date de fin" name="endDate" type="date" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input name="isCurrent" type="checkbox" /> Poste actuel</label>
          <label className="space-y-1 text-sm sm:col-span-2"><span>Description factuelle</span><textarea className="min-h-24 w-full rounded-lg border bg-background px-3 py-2" name="description" /></label>
          <div className="sm:col-span-2"><SubmitButton>Ajouter l’expérience</SubmitButton></div>
        </form>
      </section>

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Compétences</h2>
        <form action={saveSkills} className="space-y-4"><label className="block space-y-1 text-sm"><span>Une compétence par ligne</span><textarea className="min-h-32 w-full rounded-lg border bg-background px-3 py-2" defaultValue={skillsResult.data?.map((item) => item.name).join("\n") ?? ""} name="skills" required /></label><SubmitButton>Enregistrer les compétences</SubmitButton></form>
      </section>

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Préférences d’emploi</h2>
        <form action={savePreferences} className="grid gap-4 sm:grid-cols-2">
          <TextArea defaultValue={preferences?.target_titles?.join("\n")} label="Postes ciblés" name="targetTitles" /><TextArea defaultValue={preferences?.countries?.join("\n")} label="Pays" name="countries" /><TextArea defaultValue={preferences?.cities?.join("\n")} label="Villes" name="cities" />
          <div className="space-y-2 text-sm"><span>Mode de travail</span>{[["remote","Télétravail"],["hybrid","Hybride"],["onsite","Sur site"]].map(([value,label]) => <label className="flex gap-2" key={value}><input defaultChecked={preferences?.work_modes?.includes(value)} name="workModes" type="checkbox" value={value} />{label}</label>)}</div>
          <div className="space-y-2 text-sm"><span>Type de contrat</span>{[["full_time","CDI / temps plein"],["contract","Contrat"],["freelance","Freelance"],["internship","Stage"]].map(([value,label]) => <label className="flex gap-2" key={value}><input defaultChecked={preferences?.employment_types?.includes(value)} name="employmentTypes" type="checkbox" value={value} />{label}</label>)}</div>
          <Field defaultValue={preferences?.salary_min} label="Salaire minimum" name="salaryMin" type="number" /><Field defaultValue={preferences?.salary_currency ?? "EUR"} label="Devise" name="salaryCurrency" />
          <div className="sm:col-span-2"><SubmitButton pendingLabel="Finalisation…">Terminer l’onboarding</SubmitButton></div>
        </form>
      </section>
    </main>
  )
}

function Field({ label, name, defaultValue, type = "text", required = false }: { label: string; name: string; defaultValue?: string | number | null; type?: string; required?: boolean }) {
  return <label className="space-y-1 text-sm"><span>{label}</span><input className="w-full rounded-lg border bg-background px-3 py-2" defaultValue={defaultValue ?? ""} name={name} required={required} type={type} /></label>
}

function TextArea({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string }) {
  return <label className="space-y-1 text-sm"><span>{label} — un par ligne</span><textarea className="min-h-28 w-full rounded-lg border bg-background px-3 py-2" defaultValue={defaultValue ?? ""} name={name} /></label>
}
