import { NextResponse } from "next/server"
import { z } from "zod"

import { takeSensitiveAction } from "@/lib/security/rate-limit"
import { requireUser } from "@/lib/supabase/server"
import { isJobFreshForApplication } from "@/lib/jobs/freshness"

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
  const rateLimit = await takeSensitiveAction("official_form", user.id)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, {
      status: rateLimit.unavailable ? 503 : 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(rateLimit.retryAfterSeconds) },
    })
  }

  const { data: application } = await supabase.from("applications").select("job_id").eq("id", id).eq("user_id", user.id).maybeSingle()
  const { data: job } = application?.job_id
    ? await supabase.from("job_listings").select("provider,source_url,last_seen_at,expires_at,is_active").eq("id", application.job_id).maybeSingle()
    : { data: null }
  if (!job || !(await isJobFreshForApplication(job))) {
    const dossier = new URL(`/dashboard/applications/${id}`, request.url)
    dossier.searchParams.set("error", "Cette offre n’est plus disponible ou sa fraîcheur ne peut pas être confirmée.")
    return NextResponse.redirect(dossier)
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
