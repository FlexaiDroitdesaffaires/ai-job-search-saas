"use client"

import { createBrowserClient } from "@supabase/ssr"

import { getSupabaseEnv } from "./env"

let client: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  const { url, anonKey } = getSupabaseEnv()
  client ??= createBrowserClient(url, anonKey)
  return client
}
