import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"

import { LocalTestAtsAdapter, type LocalTestScenario } from "../lib/submissions/local-test-adapter"
import { SupabaseSubmissionRepository } from "../lib/submissions/supabase-repository"
import { SubmissionWorker } from "../lib/submissions/worker"

type LocalStatus = { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY: string }

const scenarios = new Set<LocalTestScenario>([
  "confirmed",
  "provider_rejection",
  "timeout_before_send",
  "timeout_after_send",
  "success_without_confirmation",
  "duplicate",
  "crash_before_submit",
  "crash_after_submit",
  "retry_then_confirm",
  "reconcile_positive",
  "reconcile_negative",
])

function scenarioOption(): LocalTestScenario {
  const value = process.argv.find((argument) => argument.startsWith("--scenario="))?.split("=")[1] ?? "confirmed"
  if (!scenarios.has(value as LocalTestScenario)) throw new Error(`Unknown local TEST scenario: ${value}`)
  return value as LocalTestScenario
}

function localStatus(root: string) {
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
  if (!status.SERVICE_ROLE_KEY) throw new Error("Local Supabase service role key is unavailable")
  return status
}

async function main() {
  if (!process.argv.includes("--local")) {
    throw new Error("Refusing to start the submission worker without the explicit --local flag")
  }

  const scenario = scenarioOption()
  const status = localStatus(process.cwd())
  const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const adapter = new LocalTestAtsAdapter(scenario)
  const controller = new AbortController()
  const worker = new SubmissionWorker(
    new SupabaseSubmissionRepository(supabase),
    new Map([[adapter.id, adapter]]),
    { workerId: `local-test-${randomUUID()}`, leaseSeconds: 30, pollMs: 1_000 },
  )

  const stop = () => {
    worker.stop()
    controller.abort()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)

  console.log(JSON.stringify({ target: "local", environment: "test", adapter: adapter.id, scenario }))
  if (process.argv.includes("--once")) await worker.runOnce()
  else await worker.run(controller.signal)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown worker error")
  process.exitCode = 1
})
