import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, Check, CircleUserRound, FileCheck2, SlidersHorizontal, Sparkles } from "lucide-react"

import { addExperience, saveIdentity, savePreferences, saveSkills } from "./actions"
import { Brand } from "@/components/brand"
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
    supabase.from("career_experiences").select("*").eq("user_id", user.id).order("start_date", { ascending: false }),
    supabase.from("skills").select("name").eq("user_id", user.id).order("name"),
    supabase.from("job_preferences").select("*").eq("user_id", user.id).single(),
    supabase.from("resumes").select("id,file_name,parse_status,parsed_data").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
  ])
  const profile = profileResult.data
  const preferences = preferencesResult.data
  const rawResume = resumesResult.data?.[0] ?? null
  const resumeData = rawResume ? editableResumeDataSchema.safeParse(rawResume.parsed_data) : null
  const initialResume = rawResume ? { ...rawResume, parsed_data: resumeData?.success ? resumeData.data : null } : null
  const databaseError = [profileResult, experiencesResult, skillsResult, preferencesResult, resumesResult].some((result) => result.error)
  const checks = [
    Boolean(profile?.full_name),
    Boolean(initialResume),
    Boolean(initialResume?.parsed_data || experiencesResult.data?.length || skillsResult.data?.length),
    Boolean(preferences?.target_titles?.length || preferences?.work_modes?.length),
  ]
  const firstIncomplete = checks.findIndex((done) => !done)
  const currentStep = firstIncomplete === -1 ? 5 : firstIncomplete + 1

  return (
    <main className="min-h-screen bg-slate-50 pb-20">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <Link className="btn-secondary min-h-10 px-4 py-2" href="/dashboard">Quitter et reprendre plus tard</Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-3xl">
          <p className="eyebrow">Configuration de votre espace</p>
          <h1 className="page-title mt-3">Construisons un profil fiable.</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">Avancez à votre rythme. Chaque information extraite reste visible et modifiable avant d’être utilisée.</p>
        </div>

        <OnboardingProgress currentStep={currentStep} completed={checks} />

        {databaseError && <p className="mt-8 rounded-2xl bg-red-50 p-4 text-sm text-red-700" role="alert">La base locale n’est pas prête ou la migration n’est pas appliquée. Consultez la configuration locale avant de tester ce parcours.</p>}
        {params.error && <p className="mt-8 rounded-2xl bg-red-50 p-4 text-sm text-red-700" role="alert">{params.error}</p>}
        {params.saved && <p className="mt-8 rounded-2xl bg-green-50 p-4 text-sm font-medium text-green-700">Section enregistrée. Vous pouvez poursuivre.</p>}

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-7">
            <OnboardingSection icon={CircleUserRound} id="identite" number="01" subtitle="Les coordonnées utilisées dans vos documents." title="Informations personnelles">
              <form action={saveIdentity} className="grid gap-5 sm:grid-cols-2">
                <Field autoComplete="name" defaultValue={profile?.full_name} label="Nom complet" name="fullName" required />
                <Field defaultValue={profile?.current_title} label="Poste actuel" name="currentTitle" />
                <Field autoComplete="address-level2" defaultValue={profile?.location} label="Localisation" name="location" />
                <Field autoComplete="tel" defaultValue={profile?.phone} label="Téléphone" name="phone" />
                <Field defaultValue={profile?.linkedin_url} label="Profil LinkedIn" name="linkedinUrl" placeholder="https://linkedin.com/in/..." type="url" />
                <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2"><span>Résumé professionnel</span><textarea className="field min-h-32 resize-y" defaultValue={profile?.summary ?? ""} maxLength={5000} name="summary" placeholder="Votre expertise, vos domaines de prédilection et le type d’impact recherché." /></label>
                <div className="sm:col-span-2"><SubmitButton>Enregistrer et continuer</SubmitButton></div>
              </form>
            </OnboardingSection>

            <div id="cv"><ResumeEditor initialResume={initialResume} /></div>

            <OnboardingSection icon={FileCheck2} id="verification" number="03" subtitle="Complétez uniquement des faits que vous pouvez confirmer." title="Vérification du profil">
              <div className="space-y-7">
                <div>
                  <div className="mb-4"><h3 className="font-semibold text-slate-900">Expériences</h3><p className="mt-1 text-sm text-slate-500">{experiencesResult.data?.length ? `${experiencesResult.data.length} expérience(s) enregistrée(s)` : "Aucune expérience enregistrée"}</p></div>
                  {experiencesResult.data?.length ? <ul className="mb-5 grid gap-3 sm:grid-cols-2">{experiencesResult.data.map((item) => <li className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" key={item.id}><strong className="block text-slate-900">{item.title}</strong><span className="text-slate-500">{item.company}</span></li>)}</ul> : null}
                  <details className="rounded-2xl border border-slate-200 bg-white p-4" open={!experiencesResult.data?.length}>
                    <summary className="cursor-pointer list-none font-medium text-indigo-700">+ Ajouter une expérience</summary>
                    <form action={addExperience} className="mt-5 grid gap-5 border-t border-slate-100 pt-5 sm:grid-cols-2">
                      <Field label="Intitulé" name="title" required /><Field label="Entreprise" name="company" required /><Field label="Localisation" name="location" /><Field label="Date de début" name="startDate" type="date" /><Field label="Date de fin" name="endDate" type="date" />
                      <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 px-4 py-3 text-sm"><input className="size-4 accent-indigo-600" name="isCurrent" type="checkbox" /> Poste actuel</label>
                      <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2"><span>Description factuelle</span><textarea className="field min-h-28" name="description" /></label>
                      <div className="sm:col-span-2"><SubmitButton>Ajouter l’expérience</SubmitButton></div>
                    </form>
                  </details>
                </div>
                <div className="border-t border-slate-100 pt-7">
                  <h3 className="font-semibold text-slate-900">Compétences</h3>
                  <p className="mt-1 text-sm text-slate-500">Une compétence précise par ligne.</p>
                  <form action={saveSkills} className="mt-4 space-y-4"><textarea className="field min-h-36" defaultValue={skillsResult.data?.map((item) => item.name).join("\n") ?? ""} name="skills" placeholder={"TypeScript\nDesign produit\nGestion de projet"} required /><SubmitButton>Enregistrer les compétences</SubmitButton></form>
                </div>
              </div>
            </OnboardingSection>

            <OnboardingSection icon={SlidersHorizontal} id="preferences" number="04" subtitle="Ces critères servent au classement des offres, pas à une décision automatique." title="Préférences professionnelles">
              <form action={savePreferences} className="grid gap-5 sm:grid-cols-2">
                <TextArea defaultValue={preferences?.target_titles?.join("\n")} label="Postes ciblés" name="targetTitles" /><TextArea defaultValue={preferences?.countries?.join("\n")} label="Pays" name="countries" /><TextArea defaultValue={preferences?.cities?.join("\n")} label="Villes" name="cities" />
                <ChoiceGroup label="Mode de travail" options={[["remote","Télétravail"],["hybrid","Hybride"],["onsite","Sur site"]]} selected={preferences?.work_modes} name="workModes" />
                <ChoiceGroup label="Types de contrat" options={[["permanent","CDI"],["fixed_term","CDD"],["freelance","Freelance / indépendant / prestation"],["temporary","Intérim"],["apprenticeship","Alternance / apprentissage"],["internship","Stage"],["seasonal","Saisonnier"],["occasional","Vacation / mission ponctuelle"]]} selected={preferences?.employment_types} name="employmentTypes" />
                <div className="grid grid-cols-2 gap-3"><Field defaultValue={preferences?.salary_min} label="Salaire minimum" name="salaryMin" type="number" /><Field defaultValue={preferences?.salary_currency ?? "EUR"} label="Devise" name="salaryCurrency" /></div>
                <div className="sm:col-span-2"><SubmitButton pendingLabel="Finalisation…">Enregistrer et voir les offres <ArrowRight className="size-4" /></SubmitButton></div>
              </form>
            </OnboardingSection>
          </div>

          <aside className="surface sticky top-6 hidden p-6 lg:block">
            <span className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Sparkles className="size-5" /></span>
            <h2 className="mt-5 text-lg font-semibold">Pourquoi vérifier ?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Votre CV personnalisé et vos lettres s’appuient uniquement sur ce profil. Une base précise produit des dossiers plus justes.</p>
            <div className="mt-6 border-t border-slate-100 pt-5"><p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Prochaine étape</p><p className="mt-2 text-sm font-medium text-slate-800">Explorer les offres recommandées</p></div>
          </aside>
        </div>
      </div>
    </main>
  )
}

const stepLabels = ["Informations", "CV", "Vérification", "Préférences", "Offres"]

function OnboardingProgress({ currentStep, completed }: { currentStep: number; completed: boolean[] }) {
  return <nav aria-label="Progression de l’onboarding" className="mt-10"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:hidden"><div className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-900">Étape {currentStep} sur 5</span><span className="font-medium text-indigo-600">{stepLabels[currentStep - 1]}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${currentStep * 20}%` }} /></div></div><ol className="hidden min-w-[680px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex">{stepLabels.map((label, index) => { const step = index + 1; const done = step <= 4 && completed[index]; const active = step === currentStep; return <li className="relative flex flex-1 items-center" key={label}><div className="flex items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${done ? "bg-green-600 text-white" : active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>{done ? <Check className="size-4" /> : step}</span><span className={`text-sm font-medium ${active ? "text-slate-950" : "text-slate-500"}`}>{label}</span></div>{index < stepLabels.length - 1 && <span className="mx-4 h-px flex-1 bg-slate-200" />}</li> })}</ol></nav>
}

function OnboardingSection({ icon: Icon, number, title, subtitle, id, children }: { icon: typeof CircleUserRound; number: string; title: string; subtitle: string; id: string; children: React.ReactNode }) {
  return <section className="surface scroll-mt-6 p-5 sm:p-8" id={id}><header className="mb-7 flex items-start gap-4 border-b border-slate-100 pb-6"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon className="size-5" /></span><div><p className="text-xs font-semibold text-indigo-600">ÉTAPE {number}</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p></div></header>{children}</section>
}

function Field({ label, name, defaultValue, type = "text", required = false, placeholder, autoComplete }: { label: string; name: string; defaultValue?: string | number | null; type?: string; required?: boolean; placeholder?: string; autoComplete?: string }) {
  return <label className="space-y-2 text-sm font-medium text-slate-700"><span>{label}{required ? " *" : ""}</span><input autoComplete={autoComplete} className="field" defaultValue={defaultValue ?? ""} name={name} placeholder={placeholder} required={required} type={type} /></label>
}

function TextArea({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string }) {
  return <label className="space-y-2 text-sm font-medium text-slate-700"><span>{label}</span><textarea className="field min-h-28" defaultValue={defaultValue ?? ""} name={name} placeholder="Un choix par ligne" /></label>
}

function ChoiceGroup({ label, options, selected, name }: { label: string; options: string[][]; selected?: string[] | null; name: string }) {
  return <fieldset className="space-y-3"><legend className="text-sm font-medium text-slate-700">{label}</legend><div className="grid gap-2">{options.map(([value, text]) => <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm transition hover:border-indigo-300" key={value}><input className="size-4 accent-indigo-600" defaultChecked={selected?.includes(value)} name={name} type="checkbox" value={value} />{text}</label>)}</div></fieldset>
}
