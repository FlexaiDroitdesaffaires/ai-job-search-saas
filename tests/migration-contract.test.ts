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
const submissionWorkerSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261023000000_submission_worker.sql"),
  "utf8",
)
const expiredClaimSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261023020000_submission_expired_claim_limit.sql"),
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

describe("durable submission worker safety contract", () => {
  it("separates queueing, dispatch and confirmation", () => {
    expect(submissionWorkerSql).toContain("'queued'")
    expect(submissionWorkerSql).toContain("mark_application_submission_dispatched")
    expect(submissionWorkerSql).toContain("validated provider evidence required")
  })

  it("routes expired post-dispatch claims to reconciliation", () => {
    expect(submissionWorkerSql).toContain("when external_attempted then 'requires_reconciliation'")
    expect(submissionWorkerSql).toContain("lease_expired_uncertain")
  })

  it("keeps TEST confirmations from marking applications submitted", () => {
    expect(submissionWorkerSql).toContain("if v_submission.environment = 'production'")
    expect(submissionWorkerSql).toMatch(/else\s+update public\.applications set prep_state = 'approved'/)
    expect(submissionWorkerSql).toContain("test_confirmation_recorded")
  })

  it("fails an exhausted pre-dispatch crash instead of stranding the queue", () => {
    expect(expiredClaimSql).toContain("when attempt_count >= max_attempts then 'failed'")
    expect(expiredClaimSql).toContain("lease_expired_attempts_exhausted")
    expect(expiredClaimSql).toMatch(/update public\.applications a\s+set prep_state = 'failed'/)
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
