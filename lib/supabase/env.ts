const requiredPublicEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const

export function getSupabaseEnv() {
  const values = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }

  if (!values.url || !values.anonKey) {
    throw new Error(
      `Configuration Supabase manquante: ${requiredPublicEnv
        .filter((name) => !process.env[name])
        .join(", ")}`,
    )
  }

  return { url: values.url, anonKey: values.anonKey }
}
