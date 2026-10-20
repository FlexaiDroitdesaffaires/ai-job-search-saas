import { NextResponse } from "next/server"

import { extractResumeText, DOCX_MIME, MAX_RESUME_BYTES, PDF_MIME } from "@/lib/resume/extract"
import { parseResumeText } from "@/lib/resume/parser"
import { editableResumeDataSchema } from "@/lib/resume/schema"
import { requireUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser()
  if (!user) return jsonError("Authentification requise.", 401)

  const formData = await request.formData().catch(() => null)
  const file = formData?.get("file")
  if (!(file instanceof File)) return jsonError("Fichier CV requis.", 400)
  if (![PDF_MIME, DOCX_MIME].includes(file.type)) return jsonError("Formats acceptés : PDF ou DOCX.", 415)
  if (file.size < 1 || file.size > MAX_RESUME_BYTES) return jsonError("Le CV doit peser moins de 10 Mo.", 413)

  const buffer = Buffer.from(await file.arrayBuffer())
  const extension = file.type === PDF_MIME ? "pdf" : "docx"
  const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await supabase.storage.from("resumes").upload(storagePath, buffer, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) return jsonError("Le CV n’a pas pu être stocké.", 500)

  let parsedData
  let parseStatus: "parsed" | "failed" = "parsed"
  try {
    parsedData = parseResumeText(await extractResumeText(buffer, file.type))
  } catch {
    parseStatus = "failed"
    parsedData = {
      contact: {}, sections: { summary: [], experience: [], education: [], skills: [] },
      rawText: "", extraction: { method: "deterministic", warnings: ["Extraction impossible. Saisissez les données manuellement."] },
    }
  }

  const { count } = await supabase.from("resumes").select("id", { count: "exact", head: true })
  const { data: resume, error: insertError } = await supabase.from("resumes").insert({
    user_id: user.id,
    title: file.name.replace(/\.(pdf|docx)$/i, "").slice(0, 200) || "Mon CV",
    storage_path: storagePath,
    file_name: file.name.slice(0, 255),
    mime_type: file.type,
    file_size: file.size,
    parse_status: parseStatus,
    parsed_data: parsedData,
    is_primary: count === 0,
  }).select("id, title, file_name, parse_status, parsed_data").single()

  if (insertError) {
    await supabase.storage.from("resumes").remove([storagePath])
    return jsonError("Les métadonnées du CV n’ont pas pu être enregistrées.", 500)
  }

  return NextResponse.json({ resume }, { status: parseStatus === "parsed" ? 201 : 202 })
}

export async function PATCH(request: Request) {
  const { supabase, user } = await requireUser()
  if (!user) return jsonError("Authentification requise.", 401)
  const body = await request.json().catch(() => null)
  const resumeId = typeof body?.resumeId === "string" ? body.resumeId : ""
  const parsed = editableResumeDataSchema.safeParse(body?.data)
  if (!resumeId || !parsed.success) return jsonError("Corrections de CV invalides.", 400)

  const { data: current, error: readError } = await supabase.from("resumes")
    .select("parsed_data").eq("id", resumeId).eq("user_id", user.id).single()
  if (readError || !current) return jsonError("CV introuvable.", 404)

  const previous = current.parsed_data && typeof current.parsed_data === "object" ? current.parsed_data : {}
  const { error } = await supabase.from("resumes").update({
    parsed_data: { ...previous, ...parsed.data, corrected_by_user: true },
    parse_status: "parsed",
  }).eq("id", resumeId).eq("user_id", user.id)
  if (error) return jsonError("Les corrections n’ont pas pu être enregistrées.", 500)
  return NextResponse.json({ ok: true })
}
