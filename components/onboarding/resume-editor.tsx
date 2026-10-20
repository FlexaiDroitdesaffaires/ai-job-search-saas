"use client"

import { useState } from "react"

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
    <section className="space-y-5 rounded-2xl border bg-card p-6">
      <div><h2 className="text-xl font-semibold">CV</h2><p className="mt-1 text-sm text-muted-foreground">PDF ou DOCX, 10 Mo maximum. L’extraction ne fait qu’organiser le texte présent.</p></div>
      <form action={upload} className="flex flex-wrap items-center gap-3">
        <input accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="min-w-0 flex-1 rounded-lg border p-2 text-sm" name="file" required type="file" />
        <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60" disabled={pending} type="submit">Importer</button>
      </form>
      {status && <p aria-live="polite" className="rounded-lg bg-muted p-3 text-sm">{status}</p>}
      {resume && (
        <div className="space-y-4 border-t pt-5">
          <p className="text-sm font-medium">{resume.file_name ?? "CV importé"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Email détecté</span><input className="w-full rounded-lg border bg-background px-3 py-2" onChange={(event) => setData({ ...data, contact: { ...data.contact, email: event.target.value } })} type="email" value={data.contact.email ?? ""} /></label>
            <label className="space-y-1 text-sm"><span>Téléphone détecté</span><input className="w-full rounded-lg border bg-background px-3 py-2" onChange={(event) => setData({ ...data, contact: { ...data.contact, phone: event.target.value } })} value={data.contact.phone ?? ""} /></label>
          </div>
          {(["summary", "experience", "education", "skills"] as const).map((section) => (
            <label className="block space-y-1 text-sm" key={section}><span>{({ summary: "Résumé", experience: "Expérience", education: "Formation", skills: "Compétences" })[section]} — une information par ligne</span><textarea className="min-h-28 w-full rounded-lg border bg-background px-3 py-2" onChange={(event) => setLines(section, event.target.value)} value={data.sections[section].join("\n")} /></label>
          ))}
          <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60" disabled={pending} onClick={saveCorrections} type="button">Enregistrer mes corrections</button>
        </div>
      )}
    </section>
  )
}
