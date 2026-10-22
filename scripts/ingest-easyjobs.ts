import { execFileSync } from "node:child_process"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"

import { ingestJobs } from "../lib/jobs/ingest"
import { fetchEasyJobs, type EasyJobsSearchOptions } from "../lib/jobs/sources/easyjobs"
import { SupabaseJobListingRepository } from "../lib/jobs/supabase-repository"
import { verifyJobUrl } from "../lib/jobs/verify-url"

type LocalStatus = { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY: string }

function numberOption(name: string, fallback: number) {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1]
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid --${name}`)
  return parsed
}

function textOption(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || undefined
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  if (!dryRun && !process.argv.includes("--local")) {
    throw new Error("Refusing ingestion without --local; use --dry-run for a read-only API check")
  }

  const limit = Math.min(50, numberOption("limit", 25))
  const contract = textOption("contract")
  const allowedContracts = new Set(["CDI", "CDD", "Intérim", "Franchise", "Autre"])
  if (contract && !allowedContracts.has(contract)) throw new Error("Invalid --contract")

  const options: EasyJobsSearchOptions = {
    query: textOption("query"),
    contractType: contract as EasyJobsSearchOptions["contractType"],
    publishedWithinDays: 30,
    limit,
  }
  const response = await fetchEasyJobs(options)
  if (dryRun) {
    const contracts = response.jobs.reduce<Record<string, number>>((counts, job) => {
      const key = job.employmentType ?? "unknown"
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {})
    console.log(JSON.stringify({
      source: "easyjobs", target: "none", received: response.jobs.length,
      available: response.pagination.total_results, unique: new Set(response.jobs.map((job) => job.externalId)).size,
      contracts,
    }, null, 2))
    return
  }

  const root = process.cwd()
  const cli = path.join(root, "node_modules", ".bin", "supabase")
  const status = JSON.parse(execFileSync(cli, ["status", "--workdir", root, "--output", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  })) as LocalStatus
  for (const rawUrl of [status.API_URL, status.DB_URL]) {
    const host = new URL(rawUrl).hostname
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local Supabase target: ${host}`)
  }
  const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const result = await ingestJobs({
    jobs: response.jobs,
    repository: new SupabaseJobListingRepository(supabase),
    verifyUrl: verifyJobUrl,
    maxAgeDays: 30,
    limit,
  })
  console.log(JSON.stringify({ source: "easyjobs", target: "local", ...result }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown ingestion error")
  process.exitCode = 1
})
