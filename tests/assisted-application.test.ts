import { describe, expect, it } from "vitest"

import {
  applicationModeLabel,
  assistedDecisionLabel,
  confirmationLabel,
  verifiedOfficialUrl,
} from "@/lib/applications/assisted"

describe("assisted application presentation", () => {
  it("accepts only the HTTPS URL persisted from the original job", () => {
    expect(verifiedOfficialUrl({ storedUrl: "https://jobs.example.test/42", sourceUrl: "https://jobs.example.test/42", applicationUrl: null })).toBe("https://jobs.example.test/42")
    expect(verifiedOfficialUrl({ storedUrl: "https://apply.example.test/42", sourceUrl: "https://jobs.example.test/42", applicationUrl: "https://apply.example.test/42" })).toBe("https://apply.example.test/42")
    expect(verifiedOfficialUrl({ storedUrl: "https://evil.example/42", sourceUrl: "https://jobs.example.test/42", applicationUrl: null })).toBeNull()
    expect(verifiedOfficialUrl({ storedUrl: "http://jobs.example.test/42", sourceUrl: "http://jobs.example.test/42", applicationUrl: null })).toBeNull()
  })

  it("keeps user declarations separate from provider confirmations", () => {
    expect(confirmationLabel({ submissionMethod: "manual", submissionState: "confirmed" })).toContain("Déclaration utilisateur")
    expect(confirmationLabel({ submissionMethod: "adapter", submissionState: "confirmed" })).toBe("Confirmation fournisseur")
    expect(confirmationLabel({ submissionMethod: "adapter", submissionState: "confirmed", environment: "test" })).toContain("aucune confirmation réelle")
    expect(assistedDecisionLabel("not_sent")).toBe("Pas encore envoyée")
    expect(applicationModeLabel({ submissionMethod: "manual" })).toContain("Assistée")
  })
})
