import { NextResponse } from "next/server"
import { z } from "zod"

import { takeSensitiveAction } from "@/lib/security/rate-limit"
import { requireUser } from "@/lib/supabase/server"

const resultSchema = z.object({ official_url: z.url() })

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 })
  const { supabase, user } = await requireUser()
  if (!user) {
    const login = new URL("/login", request.url)
    login.searchParams.set("next", `/dashboard/applications/${id}`)
    return NextResponse.redirect(login)
  }
  const rateLimit = takeSensitiveAction("official_form", user.id)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(rateLimit.retryAfterSeconds) },
    })
  }

  const { data, error } = await supabase.rpc("open_assisted_application_form", {
    p_application_id: id,
  })
  const parsed = resultSchema.safeParse(data)
  if (error || !parsed.success) {
    const dossier = new URL(`/dashboard/applications/${id}`, request.url)
    dossier.searchParams.set("error", "Formulaire officiel indisponible.")
    return NextResponse.redirect(dossier)
  }

  const target = new URL(parsed.data.official_url)
  if (target.protocol !== "https:" || target.username || target.password) {
    return NextResponse.json({ error: "URL officielle invalide." }, { status: 400 })
  }
  return NextResponse.redirect(target)
}
