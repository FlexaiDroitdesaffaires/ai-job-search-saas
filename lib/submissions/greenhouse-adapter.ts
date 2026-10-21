import { canonicalJson, sha256Hex } from "@/lib/applications/hash"

import type {
  AdapterCapabilities,
  ApprovedApplicationPackage,
  AtsAdapter,
  PreparedSubmission,
  ReconciliationResult,
  SubmitResult,
} from "./adapter"

type GreenhouseConfig = {
  boardToken: string
  apiKey?: string
  employerAuthorizationId: string
  allowedJobIds: ReadonlySet<string>
  fieldMappings?: Readonly<Record<string, string>>
  submissionEnabled?: boolean
  fetcher?: typeof fetch
}

type GreenhouseTarget = { boardToken: string; jobId: string }
type GreenhouseField = { name: string; type: string }
type GreenhouseQuestion = { label: string; required: boolean; fields: GreenhouseField[] }
type GreenhouseForm = {
  id: number
  title?: string
  questions: GreenhouseQuestion[]
  locationQuestions: GreenhouseQuestion[]
  requiredComplianceFields: string[]
}

const CORE_SCREENING_KEYS = new Set(["first_name", "last_name", "email", "phone", "location", "resume", "cover_letter"])

export class GreenhouseAdapter implements AtsAdapter {
  readonly id = "greenhouse-job-board"
  private readonly fetcher: typeof fetch

  constructor(private readonly config: GreenhouseConfig) {
    this.fetcher = config.fetcher ?? fetch
  }

  capabilities(): AdapterCapabilities {
    const configured = Boolean(
      this.config.submissionEnabled
      && this.config.apiKey
      && this.config.employerAuthorizationId.trim()
      && this.config.boardToken.trim()
      && this.config.allowedJobIds.size,
    )
    return {
      canSubmit: configured,
      canVerifyConfirmation: false,
      // Greenhouse's public Job Board API documentation does not specify an
      // idempotency key. D1 therefore refuses to enqueue this adapter.
      supportsIdempotencyKey: false,
      environments: ["production"],
      limitations: [
        "Requires an employer-controlled Job Board API key and written authorization",
        "No documented idempotency key or application lookup/reconciliation endpoint",
        "A successful HTTP response is not sufficient submission proof",
      ],
    }
  }

  validateDossier(pkg: ApprovedApplicationPackage) {
    const errors: string[] = []
    if (pkg.environment !== "production") errors.push("GREENHOUSE_PRODUCTION_ONLY")
    if (!this.config.submissionEnabled) errors.push("GREENHOUSE_EXTERNAL_SUBMISSION_DISABLED")
    if (!this.config.apiKey) errors.push("GREENHOUSE_API_KEY_REQUIRED")
    if (!this.config.employerAuthorizationId.trim()) errors.push("GREENHOUSE_EMPLOYER_AUTHORIZATION_REQUIRED")
    const target = parseGreenhouseTarget(pkg.targetUrl)
    if (!target) errors.push("GREENHOUSE_TARGET_INVALID")
    else {
      if (target.boardToken !== this.config.boardToken) errors.push("GREENHOUSE_BOARD_NOT_AUTHORIZED")
      if (!this.config.allowedJobIds.has(target.jobId)) errors.push("GREENHOUSE_JOB_NOT_AUTHORIZED")
    }
    if (!pkg.content.resume.contact.email.trim()) errors.push("EMAIL_REQUIRED")
    if (!pkg.content.resume.fullName.trim()) errors.push("NAME_REQUIRED")
    if (pkg.content.missingFields.length) errors.push("DOSSIER_HAS_MISSING_FIELDS")
    for (const answer of pkg.content.screeningAnswers) {
      if (answer.required && (!answer.confirmed || answer.needsReview || answer.sourceKind === "missing" || !answer.answer.trim())) {
        errors.push(`SCREENING_ANSWER_UNCONFIRMED:${answer.key}`)
      }
      if (answer.answer.trim() && !CORE_SCREENING_KEYS.has(answer.key) && !this.config.fieldMappings?.[answer.key]) {
        errors.push(`GREENHOUSE_FIELD_MAPPING_REQUIRED:${answer.key}`)
      }
    }
    return [...new Set(errors)]
  }

  async preparePayload(pkg: ApprovedApplicationPackage): Promise<PreparedSubmission> {
    const target = parseGreenhouseTarget(pkg.targetUrl)
    if (!target) throw new Error("GREENHOUSE_TARGET_INVALID")
    const form = await this.loadForm(target)
    const { firstName, lastName } = splitName(pkg.content.resume.fullName)
    const payload: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      email: pkg.content.resume.contact.email,
      phone: pkg.content.resume.contact.phone || undefined,
      location: pkg.content.resume.contact.location || undefined,
      resume_text: factualResumeText(pkg),
      cover_letter_text: pkg.content.coverLetter.body,
    }
    for (const answer of pkg.content.screeningAnswers) {
      const field = this.config.fieldMappings?.[answer.key]
      if (field && answer.confirmed && !answer.needsReview && answer.sourceKind !== "missing") setPayloadField(payload, field, answer.answer)
    }
    const sanitized = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""))
    const missing = missingRequiredFields(form, sanitized)
    if (missing.length) throw new Error(`GREENHOUSE_REQUIRED_FIELDS_MISSING:${missing.join("|")}`)
    const formFingerprint = sha256Hex(canonicalJson(form))
    return {
      payload: { target, fields: sanitized, dossierHash: pkg.dossierHash, formFingerprint },
      payloadHash: sha256Hex(canonicalJson({ target, fields: sanitized, dossierHash: pkg.dossierHash, formFingerprint })),
    }
  }

  async submit({ pkg, prepared }: { pkg: ApprovedApplicationPackage; prepared: PreparedSubmission }): Promise<SubmitResult> {
    const errors = this.validateDossier(pkg)
    if (errors.length) return { kind: "rejected", message: errors.join(","), code: "GREENHOUSE_NOT_AUTHORIZED" }
    const target = parseGreenhouseTarget(pkg.targetUrl)!
    const fields = prepared.payload.fields
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return { kind: "rejected", message: "GREENHOUSE_PAYLOAD_INVALID", code: "GREENHOUSE_PAYLOAD_INVALID" }
    }
    try {
      const response = await this.fetcher(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.boardToken)}/jobs/${encodeURIComponent(target.jobId)}`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${basicToken(this.config.apiKey!)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(fields),
          signal: AbortSignal.timeout(30_000),
        },
      )
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        return { kind: "rejected", message: `Greenhouse rejected the request (${response.status})`, code: `GREENHOUSE_HTTP_${response.status}` }
      }
      return {
        kind: "uncertain",
        message: `Greenhouse returned HTTP ${response.status} without a documented verifiable application identifier`,
        diagnostic: { httpStatus: response.status, adapter: this.id, dossierHash: pkg.dossierHash },
      }
    } catch (error) {
      return {
        kind: "uncertain",
        message: "Greenhouse request outcome is unknown; automatic replay is forbidden",
        diagnostic: { error: error instanceof Error ? error.name : "UnknownError", adapter: this.id, dossierHash: pkg.dossierHash },
      }
    }
  }

  async reconcile(): Promise<ReconciliationResult> {
    return {
      kind: "inconclusive",
      message: "Greenhouse Job Board API exposes no documented application lookup endpoint for this integration",
    }
  }

  private async loadForm(target: GreenhouseTarget): Promise<GreenhouseForm> {
    const response = await this.fetcher(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.boardToken)}/jobs/${encodeURIComponent(target.jobId)}?questions=true`,
      { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
    )
    if (!response.ok) throw new Error(`GREENHOUSE_FORM_HTTP_${response.status}`)
    const value = await response.json() as Record<string, unknown>
    if (String(value.id ?? "") !== target.jobId) throw new Error("GREENHOUSE_FORM_JOB_MISMATCH")
    const questions = parseQuestions(value.questions)
    const locationQuestions = parseQuestions(value.location_questions)
    const requiredComplianceFields = parseRequiredCompliance(value.data_compliance)
    return { id: Number(value.id), title: typeof value.title === "string" ? value.title : undefined, questions, locationQuestions, requiredComplianceFields }
  }
}

export function parseGreenhouseTarget(value: string | null): GreenhouseTarget | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]).has(url.hostname)) return null
    const parts = url.pathname.split("/").filter(Boolean)
    const jobsIndex = parts.indexOf("jobs")
    const boardToken = jobsIndex > 0 ? parts[jobsIndex - 1] : ""
    const jobId = jobsIndex >= 0 ? parts[jobsIndex + 1] : url.searchParams.get("gh_jid") ?? ""
    return boardToken && /^\d+$/.test(jobId) ? { boardToken, jobId } : null
  } catch {
    return null
  }
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  return parts.length === 1
    ? { firstName: parts[0], lastName: parts[0] }
    : { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

function factualResumeText(pkg: ApprovedApplicationPackage) {
  const resume = pkg.content.resume
  return [
    resume.fullName,
    resume.title,
    resume.summary,
    resume.skills.length ? `Skills: ${resume.skills.map((skill) => skill.name).join(", ")}` : "",
    ...resume.experiences.map((experience) => [experience.title, experience.company, experience.period, experience.description].filter(Boolean).join(" — ")),
    ...resume.education.map((education) => education.text),
  ].filter(Boolean).join("\n\n")
}

function basicToken(apiKey: string) {
  return Buffer.from(`${apiKey}:`, "utf8").toString("base64")
}

function parseQuestions(value: unknown): GreenhouseQuestion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((question) => {
    if (!question || typeof question !== "object") return []
    const item = question as Record<string, unknown>
    const fields = Array.isArray(item.fields)
      ? item.fields.flatMap((field) => {
        if (!field || typeof field !== "object") return []
        const candidate = field as Record<string, unknown>
        return typeof candidate.name === "string" && typeof candidate.type === "string"
          ? [{ name: candidate.name, type: candidate.type }]
          : []
      })
      : []
    return fields.length ? [{ label: String(item.label ?? "Unnamed field"), required: item.required === true, fields }] : []
  })
}

function parseRequiredCompliance(value: unknown) {
  const entries = Array.isArray(value) ? value : []
  const required = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    if (item.requires_consent === true) required.add("gdpr_consent_given")
    if (item.requires_processing_consent === true) required.add("gdpr_processing_consent_given")
    if (item.requires_retention_consent === true) required.add("gdpr_retention_consent_given")
  }
  return [...required]
}

function missingRequiredFields(form: GreenhouseForm, payload: Record<string, unknown>) {
  const missing: string[] = []
  const aliases: Record<string, string> = { resume: "resume_text", cover_letter: "cover_letter_text" }
  for (const question of [...form.questions, ...form.locationQuestions]) {
    if (!question.required) continue
    const answered = question.fields.some((field) => hasValue(payload[field.name]) || hasValue(payload[aliases[field.name]]))
    if (!answered) missing.push(question.label)
  }
  const compliance = payload.data_compliance
  for (const field of form.requiredComplianceFields) {
    if (!compliance || typeof compliance !== "object" || !hasValue((compliance as Record<string, unknown>)[field])) {
      missing.push(`data_compliance.${field}`)
    }
  }
  return [...new Set(missing)]
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
}

function setPayloadField(payload: Record<string, unknown>, field: string, value: string) {
  if (!field.startsWith("data_compliance.")) {
    payload[field] = value
    return
  }
  const key = field.slice("data_compliance.".length)
  const compliance = payload.data_compliance && typeof payload.data_compliance === "object"
    ? payload.data_compliance as Record<string, unknown>
    : {}
  compliance[key] = value === "true" ? true : value === "false" ? false : value
  payload.data_compliance = compliance
}
