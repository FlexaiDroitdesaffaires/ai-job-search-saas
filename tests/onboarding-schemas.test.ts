import { describe, expect, it } from "vitest"

import { experienceSchema, parseList, preferencesSchema } from "@/lib/onboarding/schemas"

describe("onboarding validation", () => {
  it("normalise et déduplique les listes", () => {
    expect(parseList("TypeScript, SQL\nTypeScript; Supabase")).toEqual([
      "TypeScript", "SQL", "Supabase",
    ])
  })

  it("refuse une expérience dont la fin précède le début", () => {
    const result = experienceSchema.safeParse({
      title: "Développeuse", company: "Exemple", location: "",
      startDate: "2025-02-01", endDate: "2024-01-01", isCurrent: false,
      description: "",
    })
    expect(result.success).toBe(false)
  })

  it("refuse un mode de travail inconnu", () => {
    const result = preferencesSchema.safeParse({
      targetTitles: [], countries: [], cities: [], workModes: ["anywhere"],
      employmentTypes: [], salaryMin: null, salaryCurrency: "EUR",
    })
    expect(result.success).toBe(false)
  })
})
