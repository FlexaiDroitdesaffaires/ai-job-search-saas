import { execFileSync } from "node:child_process"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"

import { ingestJobs } from "../lib/jobs/ingest"
import { fetchRemoteOkJobs } from "../lib/jobs/sources/remoteok"
import { SupabaseJobListingRepository } from "../lib/jobs/supabase-repository"
import { verifyJobUrl } from "../lib/jobs/verify-url"

type LocalStatus = { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY: string }

function option(name: string, fallback: number) {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1]
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid --${name}`)
  return parsed
}

async function main() {
  if (!process.argv.includes("--local")) {
    throw new Error("Refusing ingestion without the explicit --local flag")
  }

  const root = process.cwd()
  const cli = path.join(root, "node_modules", ".bin", "supabase")
  const status = JSON.parse(execFileSync(cli, [
    "status", "--workdir", root, "--output", "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as LocalStatus

  for (const rawUrl of [status.API_URL, status.DB_URL]) {
    const host = new URL(rawUrl).hostname
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`Refusing non-local Supabase target: ${host}`)
    }
  }

  const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const jobs = await fetchRemoteOkJobs()
  const result = await ingestJobs({
    jobs,
    repository: new SupabaseJobListingRepository(supabase),
    verifyUrl: verifyJobUrl,
    maxAgeDays: option("max-age-days", 45),
    limit: option("limit", 20),
  })

  console.log(JSON.stringify({ source: "remoteok", target: "local", ...result }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown ingestion error")
  process.exitCode = 1
})
