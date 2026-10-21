import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261019000000_core_schema.sql"),
  "utf8",
)
const matchingSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261021000000_matching_swipe.sql"),
  "utf8",
)
const preparationSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261022000000_application_preparation.sql"),
  "utf8",
)
const screeningCleanupSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261022040000_screening_answer_auth_cleanup.sql"),
  "utf8",
)
const preparedReplaySql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261022050000_decide_job_prepared_replay.sql"),
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

describe("matching and swipe safety contract", () => {
  it("enforces one application per user and job", () => {
    expect(matchingSql).toContain("applications_one_per_user_job_idx")
    expect(matchingSql).toContain("on conflict (user_id, job_id) where job_id is not null do nothing")
  })

  it("keeps decisions immutable and available only through the atomic RPC", () => {
    expect(matchingSql).toContain("revoke insert, update, delete on table public.saved_jobs from authenticated")
    expect(matchingSql).toContain("Job decision is immutable once recorded")
    expect(matchingSql).toContain("grant execute on function public.decide_job(uuid, text) to authenticated")
  })

  it("creates only a saved draft when accepting", () => {
    expect(matchingSql).toMatch(/'saved',\s*'draft'/)
    expect(matchingSql).not.toMatch(/insert into public\.applications[\s\S]*?'applied'/)
  })
})

describe("application dossier safety contract", () => {
  it("recomputes SHA-256 and keeps one current immutable dossier", () => {
    expect(preparationSql).toContain("extensions.digest(convert_to(p_canonical_content, 'UTF8'), 'sha256')")
    expect(preparationSql).toContain("application_dossiers_one_current_idx")
    expect(preparationSql).toContain("application dossier content is immutable")
  })

  it("blocks direct approval and client writes to preparation artifacts", () => {
    expect(preparationSql).toContain("application approval must use approve_application_dossier")
    expect(preparationSql).toContain("revoke insert, update, delete on table public.resume_versions from authenticated")
    expect(preparationSql).toContain("revoke insert, update, delete on table public.screening_answers from authenticated")
  })

  it("never starts or confirms a submission", () => {
    expect(preparationSql).not.toContain("start_application_submission(")
    expect(preparationSql).not.toContain("confirm_application_submission(")
    expect(preparationSql).not.toMatch(/prep_state\s*=\s*'submitted'/)
  })

  it("allows Auth cleanup without weakening JWT submission locks", () => {
    expect(screeningCleanupSql).toContain("security definer")
    expect(screeningCleanupSql).toContain("(select auth.role()) in ('authenticated', 'anon')")
    expect(screeningCleanupSql).toContain("screening answers are locked while submitting/submitted")
  })

  it("replays an accepted decision without moving a prepared application backwards", () => {
    expect(preparedReplaySql).toContain("if not v_replayed")
    expect(preparedReplaySql).toContain("'application_status', v_application.status")
    expect(preparedReplaySql).not.toMatch(/update public\.applications[\s\S]*?'draft'/)
  })
})
