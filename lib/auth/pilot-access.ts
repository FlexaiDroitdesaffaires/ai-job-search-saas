const AUTH_TYPES = new Set(["invite", "recovery"])

export function isLocalSupabaseUrl(value = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  if (!value) return false
  try {
    const host = new URL(value).hostname
    return host === "127.0.0.1" || host === "localhost"
  } catch {
    return false
  }
}

export function isPublicSignupEnabled() {
  return process.env.PILOT_ALLOW_LOCAL_SIGNUP === "true" && isLocalSupabaseUrl()
}

export function safeAuthNextPath(value: string | null, fallback = "/onboarding") {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback
}

export function isAcceptedAuthType(value: string | null): value is "invite" | "recovery" {
  return Boolean(value && AUTH_TYPES.has(value))
}
