import { describe, expect, it } from "vitest"
import { isAcceptedAuthType, isLocalSupabaseUrl, safeAuthNextPath } from "@/lib/auth/pilot-access"
import { isJobFreshForApplication } from "@/lib/jobs/freshness"
import { isInactiveBefore } from "@/lib/privacy/retention"

describe("closed pilot access", () => {
  it("accepts only isolated Supabase hosts and safe return paths", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true)
    expect(isLocalSupabaseUrl("https://project.supabase.co")).toBe(false)
    expect(safeAuthNextPath("//evil.example")).toBe("/onboarding")
    expect(safeAuthNextPath("/dashboard")).toBe("/dashboard")
    expect(isAcceptedAuthType("invite")).toBe(true)
    expect(isAcceptedAuthType("signup")).toBe(false)
  })
})

describe("retention and stale offers", () => {
  it("selects only accounts older than the configured inactivity window", () => {
    expect(isInactiveBefore(null, "2026-01-01T00:00:00Z", new Date("2026-03-01T00:00:00Z"), 30)).toBe(true)
    expect(isInactiveBefore("2026-02-20T00:00:00Z", "2026-01-01T00:00:00Z", new Date("2026-03-01T00:00:00Z"), 30)).toBe(false)
  })

  it("requires an open response for an old EasyJobs offer", async () => {
    const base = { provider: "easyjobs", source_url: "https://example.test/job", last_seen_at: "2026-10-20T00:00:00Z", expires_at: null, is_active: true }
    const open = async () => new Response(null, { status: 200 })
    const restricted = async () => new Response(null, { status: 403 })
    expect(await isJobFreshForApplication(base, new Date("2026-10-23T00:00:00Z"), open as typeof fetch)).toBe(true)
    expect(await isJobFreshForApplication(base, new Date("2026-10-23T00:00:00Z"), restricted as typeof fetch)).toBe(false)
    expect(await isJobFreshForApplication({ ...base, expires_at: "2026-10-22T00:00:00Z" }, new Date("2026-10-23T00:00:00Z"), open as typeof fetch)).toBe(false)
  })
})
