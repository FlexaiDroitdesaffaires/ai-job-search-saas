import { describe, expect, it } from "vitest"

import { formatServerEvent } from "@/lib/observability/server"
import { sensitiveRateLimitProfiles, takeSensitiveAction } from "@/lib/security/rate-limit"

describe("HTTP security headers", () => {
  it("sets the production browser security baseline", async () => {
    const { buildSecurityHeaders } = await import("../next.config.mjs")
    const headers = Object.fromEntries(buildSecurityHeaders("production").map((header: { key: string; value: string }) => [header.key, header.value]))
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'")
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'")
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'")
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000")
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["X-Frame-Options"]).toBe("DENY")
  })
})

describe("sensitive endpoint rate limits", () => {
  it("returns a retry delay after the configured upload allowance", () => {
    const key = `test-${crypto.randomUUID()}`
    const profile = sensitiveRateLimitProfiles.resume_upload
    for (let index = 0; index < profile.maximum; index += 1) {
      expect(takeSensitiveAction("resume_upload", key, 1_000)).toEqual({ allowed: true })
    }
    expect(takeSensitiveAction("resume_upload", key, 1_000)).toEqual({ allowed: false, retryAfterSeconds: 600 })
  })
})

describe("PII-safe server telemetry", () => {
  it("keeps only allowlisted operational fields", () => {
    const serialized = formatServerEvent("resume.upload", {
      outcome: "rejected",
      errorCode: "MALFORMED_DOCUMENT",
      durationMs: 12,
      email: "candidate@example.com",
      fileName: "CV Jean Dupont.pdf",
      rawText: "private resume content",
    }, new Date("2026-10-23T10:00:00.000Z"))

    expect(JSON.parse(serialized)).toEqual({
      timestamp: "2026-10-23T10:00:00.000Z",
      event: "resume.upload",
      outcome: "rejected",
      errorCode: "MALFORMED_DOCUMENT",
      durationMs: 12,
    })
    expect(serialized).not.toContain("candidate@example.com")
    expect(serialized).not.toContain("Jean Dupont")
    expect(serialized).not.toContain("private resume content")
  })
})
