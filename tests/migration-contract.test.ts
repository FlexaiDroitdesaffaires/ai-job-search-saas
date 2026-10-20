import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261019000000_core_schema.sql"),
  "utf8",
)

describe("core schema safety contract", () => {
  it("couple le statut applied à une soumission confirmée", () => {
    expect(sql).toContain("applications_status_requires_submission")
    expect(sql).toContain("record_manual_submission")
    expect(sql).toContain("confirmed_by_user")
  })

  it("matérialise l'idempotence et bloque deux soumissions actives", () => {
    expect(sql).toContain("unique (user_id, idempotency_key)")
    expect(sql).toContain("application_submissions_one_active_per_app")
    expect(sql).toContain("requires_reconciliation")
  })

  it("refuse l'adoption silencieuse du bucket CV", () => {
    expect(sql).toContain("app_resource_ownership")
    expect(sql).toContain("is not owned by this migration")
  })

  it("limite la vérification RLS aux tables marquées", () => {
    expect(sql).toMatch(/c\.relkind = 'r'[\s\S]{0,160}obj_description\(c\.oid, 'pg_class'\) = 'app:core_schema_v1'/)
  })
})
