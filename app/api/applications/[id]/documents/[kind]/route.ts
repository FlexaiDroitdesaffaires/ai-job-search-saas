import { NextResponse } from "next/server"

import { applicationDossierSchema } from "@/lib/applications/dossier-schema"
import { generateCoverLetterPdf, generateResumePdf } from "@/lib/applications/pdf"
import { takeSensitiveAction } from "@/lib/security/rate-limit"
import { requireUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params
  if (kind !== "resume" && kind !== "cover-letter") return NextResponse.json({ error: "Document inconnu." }, { status: 404 })
  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 })
  const rateLimit = await takeSensitiveAction("document_export", user.id)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Trop de téléchargements. Réessayez plus tard." }, {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(rateLimit.retryAfterSeconds) },
    })
  }

  const { data, error } = await supabase.from("application_dossiers")
    .select("content,version")
    .eq("application_id", id).eq("user_id", user.id)
    .in("state", ["draft", "approved"])
    .order("version", { ascending: false }).limit(1).maybeSingle()
  const parsed = applicationDossierSchema.safeParse(data?.content)
  if (error || !parsed.success) return NextResponse.json({ error: "Dossier introuvable." }, { status: 404 })

  const bytes = kind === "resume" ? await generateResumePdf(parsed.data) : await generateCoverLetterPdf(parsed.data)
  const fileName = `${kind === "resume" ? "cv" : "lettre"}-${id}-v${data!.version}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
