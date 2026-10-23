import { NextResponse } from "next/server"

import { isAcceptedAuthType, safeAuthNextPath } from "@/lib/auth/pilot-access"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type")
  const next = safeAuthNextPath(url.searchParams.get("next"))
  if (!tokenHash || !isAcceptedAuthType(type)) {
    return NextResponse.redirect(new URL("/login?error=Invitation%20invalide%20ou%20expir%C3%A9e.", url))
  }
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error) return NextResponse.redirect(new URL("/login?error=Invitation%20invalide%20ou%20expir%C3%A9e.", url))
  const destination = new URL("/auth/set-password", url)
  destination.searchParams.set("next", next)
  return NextResponse.redirect(destination)
}
