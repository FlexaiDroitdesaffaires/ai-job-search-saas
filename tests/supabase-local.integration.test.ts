import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { Document, Packer, Paragraph } from "docx"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { afterAll, describe, expect, it } from "vitest"

import { DOCX_MIME, extractResumeText, PDF_MIME } from "@/lib/resume/extract"

type LocalStatus = {
  API_URL: string
  DB_URL: string
  ANON_KEY: string
  SERVICE_ROLE_KEY: string
}

const enabled = process.env.RUN_SUPABASE_LOCAL === "1"
const cleanup: Array<() => Promise<unknown>> = []

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
    cleanup.push(() => service.auth.admin.deleteUser(first.id))
    cleanup.push(() => service.auth.admin.deleteUser(second.id))

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
})
