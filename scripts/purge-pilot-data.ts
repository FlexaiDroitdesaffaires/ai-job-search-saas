import { execFileSync } from "node:child_process"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"

import { deleteAccountCompletely } from "../lib/privacy/account-deletion"
import { isInactiveBefore } from "../lib/privacy/retention"

async function main() {
  const args = new Set(process.argv.slice(2))
  if (!args.has("--local")) throw new Error("Refusing non-local retention purge")
  const cli = path.join(process.cwd(), "node_modules", ".bin", "supabase")
  const status = JSON.parse(execFileSync(cli, ["status", "--workdir", process.cwd(), "--output", "json"], { encoding: "utf8" })) as { API_URL: string; SERVICE_ROLE_KEY: string }
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(status.API_URL).hostname)) throw new Error("Refusing non-local Supabase target")
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: config, error: configError } = await admin.from("pilot_retention_config").select("inactive_account_days").eq("id", true).single()
  if (configError || !config) throw new Error("Retention configuration unavailable")
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  const candidates = data.users.filter((user) => user.email?.endsWith("@example.test") && isInactiveBefore(user.last_sign_in_at, user.created_at, new Date(), config.inactive_account_days))
  console.log(JSON.stringify({ mode: args.has("--execute") ? "execute" : "dry-run", inactiveDays: config.inactive_account_days, candidateCount: candidates.length }, null, 2))
  if (args.has("--execute")) {
    if (!args.has("--confirm-example-test-only")) throw new Error("Execution requires --confirm-example-test-only")
    for (const user of candidates) await deleteAccountCompletely(admin, user.id)
    console.log(`Deleted ${candidates.length} isolated local test account(s).`)
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Retention purge failed"); process.exitCode = 1 })
