import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { Document, Packer, Paragraph } from "docx"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { afterAll, describe, expect, it } from "vitest"

import { dossierFingerprint } from "@/lib/applications/hash"
import { applyUserEdits, prepareApplicationContent } from "@/lib/applications/preparation"
import { prepareApplicationDossierForUser } from "@/lib/applications/prepare-server"
import { DOCX_MIME, extractResumeText, PDF_MIME } from "@/lib/resume/extract"

type LocalStatus = {
  API_URL: string
  DB_URL: string
  ANON_KEY: string
  SERVICE_ROLE_KEY: string
}

const enabled = process.env.RUN_SUPABASE_LOCAL === "1"
const cleanup: Array<() => Promise<unknown>> = []

async function deleteTestUser(service: SupabaseClient, userId: string) {
  const { error } = await service.auth.admin.deleteUser(userId)
  if (error) throw error
}

function localStatus(): LocalStatus {
  const cli = path.join(process.cwd(), "node_modules", ".bin", "supabase")
  const output = execFileSync(cli, [
    "status", "--workdir", process.cwd(), "--output", "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const status = JSON.parse(output) as LocalStatus

  for (const rawUrl of [status.API_URL, status.DB_URL]) {
    const host = new URL(rawUrl).hostname
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`Refusing non-local Supabase target: ${host}`)
    }
  }
  return status
}

function client(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function signUpAndLogin(supabase: SupabaseClient, label: string) {
  const suffix = randomUUID()
  const email = `${label}-${suffix}@example.test`
  const password = `Local-only-${suffix}-42!`
  const { data: signup, error: signupError } = await supabase.auth.signUp({ email, password })
  expect(signupError).toBeNull()
  expect(signup.user).not.toBeNull()
  expect(signup.session).not.toBeNull()

  expect((await supabase.auth.signOut()).error).toBeNull()
  const { data: login, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
  expect(loginError).toBeNull()
  expect(login.session?.user.id).toBe(signup.user?.id)
  expect((await supabase.auth.getSession()).data.session?.user.id).toBe(signup.user?.id)
  expect((await supabase.auth.getUser()).data.user?.id).toBe(signup.user?.id)

  return signup.user!
}

async function pdfFixture() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText("Test Candidate PDF", { x: 50, y: 750, size: 14, font })
  page.drawText("Skills: TypeScript, SQL", { x: 50, y: 720, size: 12, font })
  return Buffer.from(await pdf.save())
}

async function docxFixture() {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph("Test Candidate DOCX"),
        new Paragraph("Skills: TypeScript, Supabase"),
      ],
    }],
  })
  return Packer.toBuffer(document)
}

afterAll(async () => {
  for (const remove of cleanup.reverse()) await remove()
})

describe.runIf(enabled)("Supabase local integration", () => {
  it("validates auth, sessions, RLS and private PDF/DOCX storage", async () => {
    const status = localStatus()
    const userOne = client(status.API_URL, status.ANON_KEY)
    const userTwo = client(status.API_URL, status.ANON_KEY)
    const anonymous = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)

    const first = await signUpAndLogin(userOne, "first")
    const second = await signUpAndLogin(userTwo, "second")
    cleanup.push(() => deleteTestUser(service, first.id))
    cleanup.push(() => deleteTestUser(service, second.id))

    const { data: ownProfiles, error: ownProfilesError } = await userOne
      .from("profiles").select("id").in("id", [first.id, second.id])
    expect(ownProfilesError).toBeNull()
    expect(ownProfiles).toEqual([{ id: first.id }])

    const { data: serverProfiles, error: serverProfilesError } = await service
      .from("profiles").select("id").in("id", [first.id, second.id])
    expect(serverProfilesError).toBeNull()
    expect(serverProfiles).toHaveLength(2)

    const { data: anonymousProfiles, error: anonymousReadError } = await anonymous
      .from("profiles").select("id")
    expect(anonymousReadError?.code).toBe("42501")
    expect(anonymousProfiles).toBeNull()
    expect((await anonymous.from("profiles").update({ locale: "fr" }).eq("id", first.id)).error)
      .not.toBeNull()

    const fixtures = [
      { name: `${randomUUID()}.pdf`, mime: PDF_MIME, bytes: await pdfFixture(), marker: "Test Candidate PDF" },
      { name: `${randomUUID()}.docx`, mime: DOCX_MIME, bytes: await docxFixture(), marker: "Test Candidate DOCX" },
    ]

    for (const fixture of fixtures) {
      const extracted = await extractResumeText(fixture.bytes, fixture.mime)
      expect(extracted).toContain(fixture.marker)

      const storagePath = `${first.id}/${fixture.name}`
      const { error: uploadError } = await userOne.storage.from("resumes").upload(
        storagePath, fixture.bytes, { contentType: fixture.mime, upsert: false },
      )
      expect(uploadError).toBeNull()
      cleanup.push(() => service.storage.from("resumes").remove([storagePath]))

      const { data: ownFile, error: ownDownloadError } = await userOne.storage
        .from("resumes").download(storagePath)
      expect(ownDownloadError).toBeNull()
      expect(ownFile?.size).toBe(fixture.bytes.length)

      const { data: foreignFile, error: foreignDownloadError } = await userTwo.storage
        .from("resumes").download(storagePath)
      expect(foreignFile).toBeNull()
      expect(foreignDownloadError).not.toBeNull()

      const { error: metadataError } = await userOne.from("resumes").insert({
        user_id: first.id,
        title: fixture.marker,
        storage_path: storagePath,
        file_name: fixture.name,
        mime_type: fixture.mime,
        file_size: fixture.bytes.length,
        parse_status: "parsed",
        parsed_data: { verified_fixture: true },
      })
      expect(metadataError).toBeNull()
    }

    const { error: crossFolderError } = await userOne.storage.from("resumes").upload(
      `${second.id}/${randomUUID()}.pdf`, fixtures[0].bytes,
      { contentType: PDF_MIME, upsert: false },
    )
    expect(crossFolderError).not.toBeNull()

    const { data: hiddenResumes, error: hiddenResumesError } = await userTwo
      .from("resumes").select("id").eq("user_id", first.id)
    expect(hiddenResumesError).toBeNull()
    expect(hiddenResumes).toEqual([])

    const { data: serverResumes, error: serverResumesError } = await service
      .from("resumes").select("id").eq("user_id", first.id)
    expect(serverResumesError).toBeNull()
    expect(serverResumes).toHaveLength(2)

    const { data: buckets, error: bucketsError } = await service.storage.listBuckets()
    expect(bucketsError).toBeNull()
    expect(buckets?.find((bucket) => bucket.id === "resumes")?.public).toBe(false)
  }, 120_000)

  it("persists isolated, atomic and idempotent swipe decisions", async () => {
    const status = localStatus()
    const userOne = client(status.API_URL, status.ANON_KEY)
    const userTwo = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)
    const first = await signUpAndLogin(userOne, "swipe-first")
    const second = await signUpAndLogin(userTwo, "swipe-second")
    cleanup.push(() => deleteTestUser(service, first.id))
    cleanup.push(() => deleteTestUser(service, second.id))

    const jobIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const { error: fixtureError } = await service.from("job_listings").insert(jobIds.map((id, index) => ({
      id,
      provider: "local-test",
      external_id: `swipe-${id}`,
      title: `Verified test role ${index}`,
      company: "Local Test Company",
      location: "Remote",
      work_mode: "remote",
      source_url: `https://example.test/jobs/${id}`,
      dedupe_key: index === 3 ? jobIds[1].replaceAll("-", "") : id.replaceAll("-", ""),
      source_url_verified_at: new Date().toISOString(),
      source_url_status: 200,
      is_active: true,
      is_demo: false,
    })))
    expect(fixtureError).toBeNull()
    cleanup.unshift(async () => {
      const { error } = await service.from("job_listings").delete().in("id", jobIds)
      if (error) throw error
    })

    const skipped = await userOne.rpc("decide_job", { p_job_id: jobIds[0], p_decision: "skipped" })
    expect(skipped.error).toBeNull()
    expect(skipped.data).toMatchObject({ decision: "skipped", application_id: null })
    expect((await userOne.from("applications").select("id").eq("job_id", jobIds[0])).data).toEqual([])

    const accepted = await userOne.rpc("decide_job", { p_job_id: jobIds[1], p_decision: "saved" })
    const replay = await userOne.rpc("decide_job", { p_job_id: jobIds[1], p_decision: "saved" })
    expect(accepted.error).toBeNull()
    expect(accepted.data).toMatchObject({ application_status: "saved", preparation_state: "draft" })
    expect(replay.data).toMatchObject({ application_id: accepted.data.application_id, replayed: true })
    const crossSourceReplay = await userOne.rpc("decide_job", { p_job_id: jobIds[3], p_decision: "saved" })
    expect(crossSourceReplay.error).toBeNull()
    expect(crossSourceReplay.data).toMatchObject({ application_id: accepted.data.application_id, replayed: true, canonical_job_id: jobIds[1] })

    const concurrent = await Promise.all([
      userOne.rpc("decide_job", { p_job_id: jobIds[2], p_decision: "saved" }),
      userOne.rpc("decide_job", { p_job_id: jobIds[2], p_decision: "saved" }),
    ])
    expect(concurrent.every((result) => result.error === null)).toBe(true)
    expect(new Set(concurrent.map((result) => result.data.application_id)).size).toBe(1)

    const { data: ownApplications, error: ownApplicationsError } = await userOne
      .from("applications").select("id,status,prep_state,submission_evidence,job_id").in("job_id", jobIds)
    expect(ownApplicationsError).toBeNull()
    expect(ownApplications).toHaveLength(2)
    expect(ownApplications?.every((application) => application.status === "saved" && application.prep_state === "draft" && application.submission_evidence === null)).toBe(true)

    const { data: foreignApplications, error: foreignApplicationsError } = await userTwo
      .from("applications").select("id").in("job_id", jobIds)
    expect(foreignApplicationsError).toBeNull()
    expect(foreignApplications).toEqual([])
    expect((await userTwo.from("saved_jobs").select("id").in("job_id", jobIds)).data).toEqual([])

    const directMutation = await userOne.from("saved_jobs").insert({
      user_id: first.id, job_id: randomUUID(), decision: "saved",
    })
    expect(directMutation.error).not.toBeNull()

    const match = await userOne.from("job_matches").upsert({
      user_id: first.id,
      job_id: jobIds[1],
      score: 73,
      breakdown: { version: "deterministic-v1" },
      explanation: { satisfied: ["fixture"] },
    }, { onConflict: "user_id,job_id" })
    expect(match.error).toBeNull()
    expect((await userTwo.from("job_matches").select("score").eq("job_id", jobIds[1])).data).toEqual([])
    expect((await userOne.from("job_matches").insert({ user_id: second.id, job_id: jobIds[1], score: 100 })).error).not.toBeNull()

    const session = (await userOne.auth.getSession()).data.session
    expect(session).not.toBeNull()
    const reloaded = client(status.API_URL, status.ANON_KEY)
    expect((await reloaded.auth.setSession({ access_token: session!.access_token, refresh_token: session!.refresh_token })).error).toBeNull()
    const persisted = await reloaded.from("saved_jobs").select("job_id,decision").in("job_id", jobIds).order("job_id")
    expect(persisted.error).toBeNull()
    expect(persisted.data).toHaveLength(3)
  }, 120_000)

  it("prepares, approves and invalidates immutable application dossiers", async () => {
    const status = localStatus()
    const userOne = client(status.API_URL, status.ANON_KEY)
    const userTwo = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)
    const first = await signUpAndLogin(userOne, "dossier-first")
    const second = await signUpAndLogin(userTwo, "dossier-second")

    const jobId = randomUUID()
    const { error: jobError } = await service.from("job_listings").insert({
      id: jobId,
      provider: "local-test",
      external_id: `dossier-${jobId}`,
      title: "Senior TypeScript Engineer",
      company: "Local Dossier Company",
      location: "Remote",
      country: "France",
      work_mode: "remote",
      employment_type: "full_time",
      seniority: "senior",
      description: "TypeScript and React are required. Kubernetes is mandatory.",
      requirements: ["TypeScript", "React", "Kubernetes"],
      source_url: `https://example.test/jobs/${jobId}`,
      dedupe_key: jobId.replaceAll("-", ""),
      source_url_verified_at: new Date().toISOString(),
      source_url_status: 200,
      is_active: true,
      is_demo: false,
    })
    expect(jobError).toBeNull()
    cleanup.unshift(async () => {
      const { error } = await service.from("job_listings").delete().eq("id", jobId)
      if (error) throw error
    })
    cleanup.push(() => deleteTestUser(service, first.id))
    cleanup.push(() => deleteTestUser(service, second.id))

    expect((await userOne.from("profiles").update({
      full_name: "Camille Local",
      current_title: "Software Engineer",
      experience_level: "senior",
      location: "Paris, France",
      phone: null,
      summary: "Ingénieure logiciel spécialisée dans les applications web.",
    }).eq("id", first.id)).error).toBeNull()
    expect((await userOne.from("skills").insert([
      { user_id: first.id, name: "TypeScript" },
      { user_id: first.id, name: "React" },
      { user_id: first.id, name: "PostgreSQL" },
    ])).error).toBeNull()
    const experienceId = randomUUID()
    expect((await userOne.from("career_experiences").insert({
      id: experienceId,
      user_id: first.id,
      title: "Software Engineer",
      company: "Example Local",
      description: "Développement TypeScript et React.",
      is_current: true,
    })).error).toBeNull()
    const resumeId = randomUUID()
    expect((await userOne.from("resumes").insert({
      id: resumeId,
      user_id: first.id,
      title: "CV local",
      parse_status: "parsed",
      parsed_data: { sections: { education: ["Master informatique"] } },
      is_primary: true,
    })).error).toBeNull()

    const accepted = await userOne.rpc("decide_job", { p_job_id: jobId, p_decision: "saved" })
    expect(accepted.error).toBeNull()
    const applicationId = accepted.data.application_id as string
    const content = prepareApplicationContent({
      profile: {
        id: first.id,
        email: first.email!,
        full_name: "Camille Local",
        phone: null,
        location: "Paris, France",
        linkedin_url: null,
        current_title: "Software Engineer",
        experience_level: "senior",
        summary: "Ingénieure logiciel spécialisée dans les applications web.",
      },
      skills: [
        { id: randomUUID(), name: "PostgreSQL" },
        { id: randomUUID(), name: "React" },
        { id: randomUUID(), name: "TypeScript" },
      ],
      experiences: [{
        id: experienceId,
        title: "Software Engineer",
        company: "Example Local",
        location: null,
        start_date: null,
        end_date: null,
        is_current: true,
        description: "Développement TypeScript et React.",
      }],
      resume: { id: resumeId, title: "CV local", parsed_data: { sections: { education: ["Master informatique"] } } },
      application: {
        id: applicationId,
        job_id: jobId,
        job_title: "Senior TypeScript Engineer",
        company: "Local Dossier Company",
        job_url: `https://example.test/jobs/${jobId}`,
      },
      job: {
        id: jobId,
        title: "Senior TypeScript Engineer",
        company: "Local Dossier Company",
        sourceUrl: `https://example.test/jobs/${jobId}`,
        location: "Remote",
        country: "France",
        workMode: "remote",
        employmentType: "full_time",
        seniority: "senior",
        description: "TypeScript and React are required. Kubernetes is mandatory.",
        requirements: ["TypeScript", "React", "Kubernetes"],
      },
    })
    const firstFingerprint = dossierFingerprint(content)
    const prepareArgs = {
      p_application_id: applicationId,
      p_resume_id: resumeId,
      p_content: content,
      p_canonical_content: firstFingerprint.canonical,
      p_content_hash: firstFingerprint.hash,
    }
    expect((await userOne.rpc("prepare_application_dossier", {
      ...prepareArgs,
      p_content_hash: "a".repeat(64),
    })).error).not.toBeNull()
    expect(await prepareApplicationDossierForUser(userOne, first, applicationId)).toEqual({ ok: true })
    const prepared = await userOne.rpc("prepare_application_dossier", prepareArgs)
    const replay = await userOne.rpc("prepare_application_dossier", prepareArgs)
    expect(prepared.error).toBeNull()
    expect(prepared.data).toMatchObject({ version: 1, state: "draft", replayed: true })
    expect(replay.data).toMatchObject({ dossier_id: prepared.data.dossier_id, version: 1, replayed: true })
    expect((await userOne.rpc("approve_application_dossier", {
      p_application_id: applicationId,
      p_dossier_id: prepared.data.dossier_id,
      p_expected_hash: firstFingerprint.hash,
    })).error).not.toBeNull()

    const completed = applyUserEdits(content, {
      summary: content.resume.summary,
      coverLetterBody: content.coverLetter.body,
      answers: { phone: "+33 6 00 00 00 00" },
      userConfirmed: true,
    })
    const completedFingerprint = dossierFingerprint(completed)
    const preparedCompleted = await userOne.rpc("prepare_application_dossier", {
      p_application_id: applicationId,
      p_resume_id: resumeId,
      p_content: completed,
      p_canonical_content: completedFingerprint.canonical,
      p_content_hash: completedFingerprint.hash,
    })
    expect(preparedCompleted.error).toBeNull()
    expect(preparedCompleted.data).toMatchObject({ version: 2, state: "draft" })
    const approved = await userOne.rpc("approve_application_dossier", {
      p_application_id: applicationId,
      p_dossier_id: preparedCompleted.data.dossier_id,
      p_expected_hash: completedFingerprint.hash,
    })
    expect(approved.error).toBeNull()
    expect(approved.data).toMatchObject({ version: 2, state: "approved", content_hash: completedFingerprint.hash })

    const dossierMutation = await userOne.from("application_dossiers").update({ content_hash: "a".repeat(64) }).eq("id", preparedCompleted.data.dossier_id)
    expect(dossierMutation.error).not.toBeNull()
    const privilegedMutation = await service.from("application_dossiers").update({ content_hash: "b".repeat(64) }).eq("id", preparedCompleted.data.dossier_id)
    expect(privilegedMutation.error?.message).toContain("immutable")
    expect((await userTwo.from("application_dossiers").select("id").eq("application_id", applicationId)).data).toEqual([])

    const modified = applyUserEdits(completed, {
      summary: completed.resume.summary,
      coverLetterBody: `${completed.coverLetter.body}\n\nTexte corrigé par le candidat.`,
      answers: Object.fromEntries(completed.screeningAnswers.map((item) => [item.key, item.answer])),
      userConfirmed: true,
    })
    const modifiedFingerprint = dossierFingerprint(modified)
    const newVersion = await userOne.rpc("prepare_application_dossier", {
      p_application_id: applicationId,
      p_resume_id: resumeId,
      p_content: modified,
      p_canonical_content: modifiedFingerprint.canonical,
      p_content_hash: modifiedFingerprint.hash,
    })
    expect(newVersion.error).toBeNull()
    expect(newVersion.data).toMatchObject({ version: 3, state: "draft" })
    const directApproval = await userOne.from("applications").update({ prep_state: "approved" }).eq("id", applicationId)
    expect(directApproval.error).not.toBeNull()
    const { data: dossierStates } = await userOne.from("application_dossiers")
      .select("version,state").eq("application_id", applicationId).order("version")
    expect(dossierStates).toEqual([
      { version: 1, state: "superseded" },
      { version: 2, state: "superseded" },
      { version: 3, state: "draft" },
    ])
    const currentApplication = await userOne.from("applications")
      .select("status,prep_state,submitted_at,submission_evidence").eq("id", applicationId).single()
    expect(currentApplication.data).toMatchObject({ status: "prepared", prep_state: "ready_for_review", submitted_at: null, submission_evidence: null })
    const acceptedReplay = await userOne.rpc("decide_job", { p_job_id: jobId, p_decision: "saved" })
    expect(acceptedReplay.error).toBeNull()
    expect(acceptedReplay.data).toMatchObject({
      replayed: true,
      application_id: applicationId,
      application_status: "prepared",
      preparation_state: "ready_for_review",
    })
    expect((await service.from("application_submissions").select("id", { count: "exact", head: true }).eq("application_id", applicationId)).count).toBe(0)
  }, 120_000)

  it("persists an isolated and idempotent assisted application without fabricating ATS proof", async () => {
    const status = localStatus()
    const userOne = client(status.API_URL, status.ANON_KEY)
    const userTwo = client(status.API_URL, status.ANON_KEY)
    const service = client(status.API_URL, status.SERVICE_ROLE_KEY)
    const first = await signUpAndLogin(userOne, "assisted-first")
    const second = await signUpAndLogin(userTwo, "assisted-second")
    cleanup.push(() => deleteTestUser(service, first.id))
    cleanup.push(() => deleteTestUser(service, second.id))

    const jobId = randomUUID()
    const resumeId = randomUUID()
    const resumeVersionId = randomUUID()
    const coverLetterId = randomUUID()
    const applicationId = randomUUID()
    const dossierId = randomUUID()
    const officialUrl = `https://example.test/jobs/${jobId}`
    expect((await service.from("job_listings").insert({
      id: jobId, provider: "local-test", external_id: `assisted-${jobId}`,
      title: "Assisted role", company: "Assisted Company", source_url: officialUrl,
      application_url: officialUrl, application_mode: "manual_required",
      dedupe_key: jobId.replaceAll("-", ""), is_active: true, is_demo: false,
    })).error).toBeNull()
    cleanup.unshift(async () => {
      const { error } = await service.from("job_listings").delete().eq("id", jobId)
      if (error) throw error
    })
    expect((await service.from("resumes").insert({ id: resumeId, user_id: first.id, title: "Assisted CV", parse_status: "parsed" })).error).toBeNull()
    expect((await service.from("resume_versions").insert({ id: resumeVersionId, user_id: first.id, resume_id: resumeId, name: "Assisted CV", content: {}, tailored_for_job_id: jobId })).error).toBeNull()
    expect((await service.from("cover_letters").insert({ id: coverLetterId, user_id: first.id, job_id: jobId, title: "Assisted letter", content: "Letter" })).error).toBeNull()
    expect((await service.from("applications").insert({
      id: applicationId, user_id: first.id, job_id: jobId, company: "Assisted Company",
      job_title: "Assisted role", job_url: officialUrl, status: "prepared", prep_state: "approved",
      resume_version_id: resumeVersionId, cover_letter_id: coverLetterId,
    })).error).toBeNull()
    expect((await service.from("application_dossiers").insert({
      id: dossierId, user_id: first.id, application_id: applicationId, job_id: jobId,
      resume_version_id: resumeVersionId, cover_letter_id: coverLetterId, version: 1,
      schema_version: "application-dossier-v1", content: {}, content_hash: "a".repeat(64),
      state: "approved", approved_at: new Date().toISOString(),
    })).error).toBeNull()

    expect((await userOne.rpc("record_assisted_application_decision", { p_application_id: applicationId, p_decision: "not_sent" })).error?.message).toContain("opened first")
    const opened = await userOne.rpc("open_assisted_application_form", { p_application_id: applicationId })
    const openedReplay = await userOne.rpc("open_assisted_application_form", { p_application_id: applicationId })
    expect(opened.error).toBeNull()
    expect(opened.data).toMatchObject({ official_url: officialUrl, replayed: false })
    expect(openedReplay.data).toMatchObject({ official_url: officialUrl, replayed: true })
    expect((await userTwo.from("assisted_application_states").select("application_id").eq("application_id", applicationId)).data).toEqual([])
    expect((await userTwo.rpc("open_assisted_application_form", { p_application_id: applicationId })).error).not.toBeNull()

    const notSent = await userOne.rpc("record_assisted_application_decision", { p_application_id: applicationId, p_decision: "not_sent" })
    const notSentReplay = await userOne.rpc("record_assisted_application_decision", { p_application_id: applicationId, p_decision: "not_sent" })
    expect(notSent.data).toMatchObject({ decision: "not_sent", replayed: false })
    expect(notSentReplay.data).toMatchObject({ decision: "not_sent", replayed: true })
    expect((await userOne.rpc("record_assisted_application_decision", { p_application_id: applicationId, p_decision: "unable" })).error).toBeNull()
    expect((await userOne.from("applications").select("prep_state,submitted_at,submission_evidence").eq("id", applicationId).single()).data).toMatchObject({ prep_state: "needs_manual_action", submitted_at: null, submission_evidence: null })

    const sent = await userOne.rpc("record_assisted_application_decision", { p_application_id: applicationId, p_decision: "sent" })
    const sentReplay = await userOne.rpc("record_assisted_application_decision", { p_application_id: applicationId, p_decision: "sent" })
    expect(sent.error).toBeNull()
    expect(sent.data).toMatchObject({ decision: "sent", confirmation_source: "user", replayed: false })
    expect(sentReplay.data).toMatchObject({ decision: "sent", confirmation_source: "user", replayed: true })
    const application = await userOne.from("applications").select("status,prep_state,submission_method,submission_evidence").eq("id", applicationId).single()
    expect(application.data).toMatchObject({ status: "applied", prep_state: "submitted", submission_method: "manual", submission_evidence: { confirmed_by_user: true } })
    const submissions = await service.from("application_submissions").select("method,state,provider,provider_submission_id,evidence").eq("application_id", applicationId)
    expect(submissions.data).toHaveLength(1)
    expect(submissions.data?.[0]).toMatchObject({ method: "manual", state: "confirmed", provider: null, provider_submission_id: null, evidence: { confirmed_by_user: true } })
    expect((await service.from("application_events").select("id", { count: "exact", head: true }).eq("application_id", applicationId).eq("event_type", "official_form_opened")).count).toBe(1)
    expect((await service.from("application_events").select("id", { count: "exact", head: true }).eq("application_id", applicationId).eq("event_type", "assisted_application_not_sent")).count).toBe(1)
  }, 120_000)
})
