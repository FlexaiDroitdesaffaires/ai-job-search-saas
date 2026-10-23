import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const container = "supabase_db_ai-job-search-saas"
const sql = readFileSync(new URL("../supabase/tests/core_schema_test.sql", import.meta.url))
const result = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { input: sql, encoding: "utf8" },
)

process.stdout.write(result.stdout ?? "")
process.stderr.write(result.stderr ?? "")
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const output = result.stdout ?? ""
const planned = output.match(/\b1\.\.(\d+)\b/)?.[1]
const passed = output.match(/^\s*ok \d+ - /gm)?.length ?? 0
const failed = output.match(/^\s*not ok \d+ - /gm)?.length ?? 0
if (planned !== "40" || passed !== 40 || failed !== 0) {
  throw new Error(`pgTAP failed: plan=${planned ?? "missing"}, passed=${passed}, failed=${failed}`)
}

console.log("pgTAP summary: 40/40 assertions passed")
