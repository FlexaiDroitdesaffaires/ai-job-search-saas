import type { EmploymentType, Seniority, SourceJob } from "../types"

export const REMOTE_OK_ENDPOINT = "https://remoteok.com/api"
export const REMOTE_OK_ATTRIBUTION = "Remote OK"

type RemoteOkRecord = Record<string, unknown>

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const point = code.startsWith("#x")
      ? Number.parseInt(code.slice(2), 16)
      : code.startsWith("#") ? Number.parseInt(code.slice(1), 10) : null
    if (point !== null) return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point) : entity
    return named[code.toLowerCase()] ?? entity
  })
}

export function plainTextDescription(value: string) {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function employmentType(tags: string[], title: string): EmploymentType | undefined {
  const haystack = `${tags.join(" ")} ${title}`.toLowerCase()
  if (/intern(ship)?|praktikum/.test(haystack)) return "internship"
  if (/freelance/.test(haystack)) return "freelance"
  if (/part[ -]?time/.test(haystack)) return "part_time"
  if (/contract/.test(haystack)) return "contract"
  if (/temporary/.test(haystack)) return "temporary"
  return "full_time"
}

function seniority(tags: string[], title: string): Seniority | undefined {
  const haystack = `${tags.join(" ")} ${title}`.toLowerCase()
  if (/chief|c-level|vp |vice president|director/.test(haystack)) return "executive"
  if (/lead|principal|staff/.test(haystack)) return "lead"
  if (/senior|sr\.?\b/.test(haystack)) return "senior"
  if (/junior|jr\.?\b/.test(haystack)) return "junior"
  if (/entry|graduate/.test(haystack)) return "entry"
  return undefined
}

function remoteOkUrl(record: RemoteOkRecord) {
  const raw = text(record.apply_url) || text(record.url)
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== "https:" || (host !== "remoteok.com" && host !== "www.remoteok.com")) return ""
    return url.toString()
  } catch {
    return ""
  }
}

export function parseRemoteOkRecord(record: RemoteOkRecord): SourceJob | null {
  const externalId = String(record.id ?? "").trim() || text(record.slug)
  const title = text(record.position)
  const company = text(record.company)
  const sourceUrl = remoteOkUrl(record)
  const date = text(record.date)
  if (!externalId || !title || !company || !sourceUrl || !date) return null

  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
    : []
  const salaryMin = number(record.salary_min)
  const salaryMax = number(record.salary_max)

  return {
    provider: "remoteok",
    externalId,
    title,
    company: decodeEntities(company),
    companyLogoUrl: text(record.company_logo) || text(record.logo) || undefined,
    location: text(record.location) || "Remote",
    workMode: "remote",
    employmentType: employmentType(tags, title),
    seniority: seniority(tags, title),
    salaryMin: salaryMin && salaryMin > 0 ? Math.round(salaryMin) : undefined,
    salaryMax: salaryMax && salaryMax > 0 ? Math.round(salaryMax) : undefined,
    description: plainTextDescription(text(record.description)),
    requirements: tags,
    sourceUrl,
    postedAt: date,
  }
}

export async function fetchRemoteOkJobs(fetcher: typeof fetch = fetch) {
  const response = await fetcher(REMOTE_OK_ENDPOINT, {
    headers: { Accept: "application/json", "User-Agent": "AI Job Search SaaS/0.1" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Remote OK API returned HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error("Remote OK API returned an invalid payload")
  return payload
    .filter((item): item is RemoteOkRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map(parseRemoteOkRecord)
    .filter((job): job is SourceJob => job !== null)
}
