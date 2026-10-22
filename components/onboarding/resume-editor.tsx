"use client"

import { useState } from "react"
import { CheckCircle2, FileText, UploadCloud } from "lucide-react"

import type { EditableResumeData } from "@/lib/resume/schema"

type ResumeRecord = {
  id: string
  file_name: string | null
  parse_status: string
  parsed_data: (EditableResumeData & { extraction?: { warnings?: string[] } }) | null
}

const emptyData: EditableResumeData = {
  contact: {},
  sections: { summary: [], experience: [], education: [], skills: [] },
}

export function ResumeEditor({ initialResume }: { initialResume: ResumeRecord | null }) {
  const [resume, setResume] = useState(initialResume)
  const [data, setData] = useState<EditableResumeData>(initialResume?.parsed_data ?? emptyData)
  const [status, setStatus] = useState<string>("")
  const [pending, setPending] = useState(false)

  async function upload(formData: FormData) {
    setPending(true)
    setStatus("Import et extraction en cours…")
    try {
      const response = await fetch("/api/resumes", { method: "POST", body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Import impossible.")
      setResume(result.resume)
      setData(result.resume.parsed_data ?? emptyData)
      setStatus(result.resume.parse_status === "parsed" ? "CV extrait. Vérifiez chaque information." : "Extraction impossible. Complétez les champs manuellement.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import impossible.")
    } finally {
      setPending(false)
    }
  }

  async function saveCorrections() {
    if (!resume) return
    setPending(true)
    setStatus("Enregistrement des corrections…")
    try {
      const response = await fetch("/api/resumes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId: resume.id, data }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Correction impossible.")
      setStatus("Corrections enregistrées.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Correction impossible.")
    } finally {
      setPending(false)
    }
  }

  function setLines(section: keyof EditableResumeData["sections"], value: string) {
    setData((current) => ({
      ...current,
      sections: { ...current.sections, [section]: value.split("\n").map((line) => line.trim()).filter(Boolean) },
    }))
  }

  return (
    <section className="surface scroll-mt-6 p-5 sm:p-8">
      <header className="mb-7 flex items-start gap-4 border-b border-slate-100 pb-6"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><FileText className="size-5" /></span><div><p className="text-xs font-semibold text-indigo-600">ÉTAPE 02</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">Import du CV</h2><p className="mt-1 text-sm leading-6 text-slate-500">PDF ou DOCX, 10 Mo maximum. L’extraction organise uniquement le texte présent.</p></div></header>
      <form action={upload} className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-5 sm:p-6">
        <UploadCloud className="mb-3 size-7 text-indigo-600" />
        <label className="block text-sm font-medium text-slate-800" htmlFor="resume-file">Choisir un document</label>
        <input accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="mt-3 block w-full text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2.5 file:font-medium file:text-indigo-700 file:shadow-sm hover:file:bg-indigo-50" id="resume-file" name="file" required type="file" />
        <button className="btn-primary mt-5" disabled={pending} type="submit">{pending ? "Import en cours…" : "Importer et analyser"}</button>
      </form>
      {status && <p aria-live="polite" className="mt-5 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{status}</p>}
      {resume && (
        <div className="mt-6 space-y-5 border-t border-slate-100 pt-6">
          <p className="flex items-center gap-2 text-sm font-medium text-green-700"><CheckCircle2 className="size-4" />{resume.file_name ?? "CV importé"}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700"><span>Email détecté</span><input className="field" onChange={(event) => setData({ ...data, contact: { ...data.contact, email: event.target.value } })} type="email" value={data.contact.email ?? ""} /></label>
            <label className="space-y-2 text-sm font-medium text-slate-700"><span>Téléphone détecté</span><input className="field" onChange={(event) => setData({ ...data, contact: { ...data.contact, phone: event.target.value } })} value={data.contact.phone ?? ""} /></label>
          </div>
          {(["summary", "experience", "education", "skills"] as const).map((section) => (
            <label className="block space-y-2 text-sm font-medium text-slate-700" key={section}><span>{({ summary: "Résumé", experience: "Expérience", education: "Formation", skills: "Compétences" })[section]} <span className="font-normal text-slate-400">— une information par ligne</span></span><textarea className="field min-h-28" onChange={(event) => setLines(section, event.target.value)} value={data.sections[section].join("\n")} /></label>
          ))}
          <button className="btn-primary" disabled={pending} onClick={saveCorrections} type="button">Enregistrer mes corrections</button>
        </div>
      )}
    </section>
  )
}
