import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"
import { afterAll, describe, expect, it } from "vitest"

import { applyUserEdits } from "@/lib/applications/preparation"
import { prepareApplicationDossierForUser, persistApplicationDossier } from "@/lib/applications/prepare-server"
import { WorkerCrashError } from "@/lib/submissions/adapter"
import { LocalTestAtsAdapter } from "@/lib/submissions/local-test-adapter"
import { enqueueApprovedApplication, SupabaseSubmissionRepository } from "@/lib/submissions/supabase-repository"
import { SubmissionWorker } from "@/lib/submissions/worker"

type LocalStatus = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string }
const enabled = process.env.RUN_SUPABASE_LOCAL === "1"
const cleanup: Array<() => Promise<unknown>> = []

function localStatus(): LocalStatus {
  const cli = path.join(process.cwd(), "node_modules", ".bin", "supabase")
  const status = JSON.parse(execFileSync(cli, ["status", "--workdir", process.cwd(), "--output", "json"], { encoding: "utf8" })) as LocalStatus
  const host = new URL(status.API_URL).hostname
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local Supabase target: ${host}`)
  return status
}

function client(url: string, key: string) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function signUp(supabase: SupabaseClient, label: string) {
  const suffix = randomUUID()
  const { data, error } = await supabase.auth.signUp({ email: `${label}-${suffix}@example.test`, password: `Local-only-${suffix}-42!` })
  if (error || !data.user) throw error ?? new Error("Missing local user")
  return data.user
}

type ApprovedFixture = { applicationId: string; dossierId: string; jobId: string; content: Record<string, unknown> }

async function approvedFixture(
  userClient: SupabaseClient,
  service: SupabaseClient,
  user: User,
  label: string,
): Promise<ApprovedFixture> {
  const jobId = randomUUID()
  const { error: jobError } = await service.from("job_listings").insert({
    id: jobId,
    provider: "local-test",
    external_id: `${label}-${jobId}`,
    title: "TypeScript Engineer",
    company: "Local Submission Fixture",
    location: "Remote",
    work_mode: "remote",
    description: "TypeScript is required.",
    requirements: ["TypeScript"],
    source_url: `https://example.test/jobs/${jobId}`,
    dedupe_key: jobId.replaceAll("-", ""),
    source_url_verified_at: new Date().toISOString(),
    source_url_status: 200,
    is_active: true,
    is_demo: false,
  })
  if (jobError) throw jobError
  cleanup.unshift(async () => {
    const { error } = await service.from("job_listings").delete().eq("id", jobId)
    if (error) throw error
  })

  const accepted = await userClient.rpc("decide_job", { p_job_id: jobId, p_decision: "saved" })
  if (accepted.error) throw accepted.error
  const applicationId = accepted.data.application_id as string
  const prepared = await prepareApplicationDossierForUser(userClient, user, applicationId)
  if (!prepared.ok) throw new Error(prepared.message)
  const dossierResult = await userClient.from("application_dossiers")
    .select("id,content,content_hash").eq("application_id", applicationId).eq("state", "draft").single()
  if (dossierResult.error) throw dossierResult.error
  const approved = await userClient.rpc("approve_application_dossier", {
    p_application_id: applicationId,
    p_dossier_id: dossierResult.data.id,
    p_expected_hash: dossierResult.data.content_hash,
  })
  if (approved.error) throw approved.error
  return { applicationId, dossierId: dossierResult.data.id, jobId, content: dossierResult.data.content as Record<string, unknown> }
}

afterAll(async () => {
  for (const remove of cleanup.reverse()) await remove()
})

describe.runIf(enabled)("submission worker with local Supabase", () => {
  it("serializes two workers and records a TEST confirmation without submitted", async () => {
    const status = localStatus()
    const userClient = client(status.API_URL, status.ANON_KEY)
    const foreignClient = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)
    const user = await signUp(userClient, "submission-owner")
    const foreign = await signUp(foreignClient, "submission-foreign")
    cleanup.push(async () => { const { error } = await service.auth.admin.deleteUser(user.id); if (error) throw error })
    cleanup.push(async () => { const { error } = await service.auth.admin.deleteUser(foreign.id); if (error) throw error })
    expect((await userClient.from("profiles").update({ full_name: "Candidate Local", phone: "+33 6 00 00 00 00", current_title: "Engineer" }).eq("id", user.id)).error).toBeNull()
    expect((await userClient.from("skills").insert({ user_id: user.id, name: "TypeScript" })).error).toBeNull()
    expect((await userClient.from("resumes").insert({ user_id: user.id, title: "CV", parse_status: "parsed", parsed_data: {}, is_primary: true })).error).toBeNull()
    const fixture = await approvedFixture(userClient, service, user, "concurrent")
    const adapter = new LocalTestAtsAdapter("confirmed")
    const idempotencyKey = `test:${fixture.applicationId}`
    const first = await enqueueApprovedApplication(service, adapter, { applicationId: fixture.applicationId, dossierId: fixture.dossierId, idempotencyKey, environment: "test" })
    const replay = await enqueueApprovedApplication(service, adapter, { applicationId: fixture.applicationId, dossierId: fixture.dossierId, idempotencyKey, environment: "test" })
    expect(replay).toMatchObject({ submission_id: first.submission_id, replayed: true })

    const repository = new SupabaseSubmissionRepository(service)
    const adapters = new Map([[adapter.id, adapter]])
    const workers = [
      new SubmissionWorker(repository, adapters, { workerId: "worker-a" }),
      new SubmissionWorker(repository, adapters, { workerId: "worker-b" }),
    ]
    const processed = await Promise.all(workers.map((worker) => worker.runOnce()))
    expect(processed.filter(Boolean)).toHaveLength(1)

    const submission = await service.from("application_submissions").select("state,environment,evidence,attempt_count").eq("id", first.submission_id).single()
    expect(submission.data).toMatchObject({ state: "confirmed", environment: "test", attempt_count: 1, evidence: { test: true, provider_confirmed: true } })
    const application = await service.from("applications").select("status,prep_state,submitted_at,submission_evidence").eq("id", fixture.applicationId).single()
    expect(application.data).toMatchObject({ status: "prepared", prep_state: "approved", submitted_at: null, submission_evidence: null })
    expect((await foreignClient.from("application_submissions").select("id").eq("id", first.submission_id)).data).toEqual([])
    expect((await userClient.from("application_submissions").select("id").eq("id", first.submission_id)).data).toEqual([{ id: first.submission_id }])
    expect((await service.from("applications").select("id", { count: "exact", head: true }).eq("job_id", fixture.jobId)).count).toBe(1)
  }, 120_000)

  it("recovers retries and post-dispatch crashes through reconciliation", async () => {
    const status = localStatus()
    const userClient = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)
    const user = await signUp(userClient, "submission-recovery")
    cleanup.push(async () => { const { error } = await service.auth.admin.deleteUser(user.id); if (error) throw error })
    expect((await userClient.from("profiles").update({ full_name: "Recovery Local", phone: "+33 6 00 00 00 01", current_title: "Engineer" }).eq("id", user.id)).error).toBeNull()
    expect((await userClient.from("skills").insert({ user_id: user.id, name: "TypeScript" })).error).toBeNull()
    expect((await userClient.from("resumes").insert({ user_id: user.id, title: "CV", parse_status: "parsed", parsed_data: {}, is_primary: true })).error).toBeNull()

    const retryFixture = await approvedFixture(userClient, service, user, "retry")
    const retryAdapter = new LocalTestAtsAdapter("retry_then_confirm")
    const retryIntent = await enqueueApprovedApplication(service, retryAdapter, { applicationId: retryFixture.applicationId, dossierId: retryFixture.dossierId, idempotencyKey: `test:${retryFixture.applicationId}`, environment: "test" })
    const retryWorker = new SubmissionWorker(new SupabaseSubmissionRepository(service), new Map([[retryAdapter.id, retryAdapter]]), { workerId: "worker-retry" })
    await retryWorker.runOnce()
    expect((await service.from("application_submissions").select("state").eq("id", retryIntent.submission_id).single()).data?.state).toBe("retry_scheduled")
    await service.from("application_submissions").update({ next_attempt_at: new Date(0).toISOString() }).eq("id", retryIntent.submission_id)
    await retryWorker.runOnce()
    expect((await service.from("application_submissions").select("state,attempt_count").eq("id", retryIntent.submission_id).single()).data).toMatchObject({ state: "confirmed", attempt_count: 2 })

    const exhaustedFixture = await approvedFixture(userClient, service, user, "crash-before-limit")
    const enqueueAdapter = new LocalTestAtsAdapter("confirmed")
    const exhaustedIntent = await enqueueApprovedApplication(service, enqueueAdapter, {
      applicationId: exhaustedFixture.applicationId,
      dossierId: exhaustedFixture.dossierId,
      idempotencyKey: `test:${exhaustedFixture.applicationId}`,
      environment: "test",
      maxAttempts: 1,
    })
    const beforeDispatchCrash = new LocalTestAtsAdapter("crash_before_submit")
    const beforeDispatchWorker = new SubmissionWorker(
      new SupabaseSubmissionRepository(service),
      new Map([[beforeDispatchCrash.id, beforeDispatchCrash]]),
      { workerId: "worker-crash-before", leaseSeconds: 5 },
    )
    await expect(beforeDispatchWorker.runOnce()).rejects.toBeInstanceOf(WorkerCrashError)
    await service.from("application_submissions").update({ claim_expires_at: new Date(0).toISOString() }).eq("id", exhaustedIntent.submission_id)
    expect((await service.rpc("claim_application_submission", { p_worker_id: "worker-expiry", p_lease_seconds: 30 })).data).toBeNull()
    expect((await service.from("application_submissions").select("state,external_attempted,attempt_count").eq("id", exhaustedIntent.submission_id).single()).data)
      .toMatchObject({ state: "failed", external_attempted: false, attempt_count: 1 })
    expect((await service.from("applications").select("prep_state,submitted_at").eq("id", exhaustedFixture.applicationId).single()).data)
      .toMatchObject({ prep_state: "failed", submitted_at: null })

    const crashFixture = await approvedFixture(userClient, service, user, "crash")
    const crashAdapter = new LocalTestAtsAdapter("crash_after_submit")
    const crashIntent = await enqueueApprovedApplication(service, crashAdapter, { applicationId: crashFixture.applicationId, dossierId: crashFixture.dossierId, idempotencyKey: `test:${crashFixture.applicationId}`, environment: "test" })
    const crashWorker = new SubmissionWorker(new SupabaseSubmissionRepository(service), new Map([[crashAdapter.id, crashAdapter]]), { workerId: "worker-crash", leaseSeconds: 5 })
    await expect(crashWorker.runOnce()).rejects.toBeInstanceOf(WorkerCrashError)
    await service.from("application_submissions").update({ claim_expires_at: new Date(0).toISOString() }).eq("id", crashIntent.submission_id)
    await crashWorker.runOnce()
    expect((await service.from("application_submissions").select("state,reconciliation_attempt_count").eq("id", crashIntent.submission_id).single()).data).toMatchObject({ state: "confirmed", reconciliation_attempt_count: 1 })
    expect((await service.from("application_submission_events").select("event_type").eq("submission_id", crashIntent.submission_id).order("created_at")).data?.map((event) => event.event_type)).toContain("lease_expired_uncertain")
  }, 120_000)

  it("rejects stale dossiers and invalid proof without a false submission", async () => {
    const status = localStatus()
    const userClient = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)
    const user = await signUp(userClient, "submission-integrity")
    cleanup.push(async () => { const { error } = await service.auth.admin.deleteUser(user.id); if (error) throw error })
    expect((await userClient.from("profiles").update({ full_name: "Integrity Local", phone: "+33 6 00 00 00 02", current_title: "Engineer" }).eq("id", user.id)).error).toBeNull()
    expect((await userClient.from("skills").insert({ user_id: user.id, name: "TypeScript" })).error).toBeNull()
    expect((await userClient.from("resumes").insert({ user_id: user.id, title: "CV", parse_status: "parsed", parsed_data: {}, is_primary: true })).error).toBeNull()

    const staleFixture = await approvedFixture(userClient, service, user, "stale")
    const adapter = new LocalTestAtsAdapter("confirmed")
    const staleIntent = await enqueueApprovedApplication(service, adapter, { applicationId: staleFixture.applicationId, dossierId: staleFixture.dossierId, idempotencyKey: `test:${staleFixture.applicationId}`, environment: "test" })
    const edited = applyUserEdits(staleFixture.content as never, {
      summary: "Summary explicitly corrected by the user.",
      coverLetterBody: "Letter explicitly corrected by the user.",
      answers: { full_name: "Integrity Local", email: user.email!, phone: "+33 6 00 00 00 02", location: "" },
      userConfirmed: true,
    })
    const resumeId = edited.resume.sourceResumeId
    expect((await persistApplicationDossier(userClient, staleFixture.applicationId, resumeId, edited)).error).toBeNull()
    expect((await service.rpc("claim_application_submission", { p_worker_id: "worker-stale", p_lease_seconds: 30 })).data).toBeNull()
    expect((await service.from("application_submissions").select("state,error_message").eq("id", staleIntent.submission_id).single()).data).toMatchObject({ state: "failed", error_message: "Approved dossier changed before claim" })

    const proofFixture = await approvedFixture(userClient, service, user, "proof")
    const proofIntent = await enqueueApprovedApplication(service, adapter, { applicationId: proofFixture.applicationId, dossierId: proofFixture.dossierId, idempotencyKey: `test:${proofFixture.applicationId}`, environment: "test" })
    const claim = await service.rpc("claim_application_submission", { p_worker_id: "worker-proof", p_lease_seconds: 30 })
    expect(claim.error).toBeNull()
    expect((await service.rpc("mark_application_submission_dispatched", { p_submission_id: proofIntent.submission_id, p_worker_id: "worker-proof" })).error).toBeNull()
    const invalid = await service.rpc("finish_application_submission_attempt", {
      p_submission_id: proofIntent.submission_id,
      p_worker_id: "worker-proof",
      p_outcome: "confirmed",
      p_provider_submission_id: "TEST-invalid",
      p_evidence: { provider_confirmed: true, adapter_id: adapter.id, dossier_hash: "b".repeat(64), submitted_at: new Date().toISOString(), environment: "test", test: true },
      p_tracking_url: null,
      p_retry_delay_seconds: 0,
      p_side_effect_possible: true,
    })
    expect(invalid.error).not.toBeNull()
    expect((await service.from("applications").select("prep_state,submitted_at,submission_evidence").eq("id", proofFixture.applicationId).single()).data).toMatchObject({ prep_state: "submitting", submitted_at: null, submission_evidence: null })
  }, 120_000)
})
