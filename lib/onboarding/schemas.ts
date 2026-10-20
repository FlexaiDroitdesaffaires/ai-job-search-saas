import { z } from "zod"

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null)

export const identitySchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  currentTitle: optionalText(200),
  location: optionalText(200),
  phone: optionalText(40),
  linkedinUrl: z.union([z.literal(""), z.url().max(300)]).transform((value) => value || null),
  summary: optionalText(5000),
})

export const experienceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  location: optionalText(200),
  startDate: z.union([z.literal(""), z.iso.date()]).transform((value) => value || null),
  endDate: z.union([z.literal(""), z.iso.date()]).transform((value) => value || null),
  isCurrent: z.boolean(),
  description: optionalText(10000),
}).refine(
  (value) => value.isCurrent || !value.startDate || !value.endDate || value.endDate >= value.startDate,
  { message: "La date de fin doit être postérieure à la date de début." },
)

export const skillsSchema = z.object({
  skills: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
})

export const preferencesSchema = z.object({
  targetTitles: z.array(z.string().trim().min(1).max(200)).max(20),
  countries: z.array(z.string().trim().min(1).max(100)).max(50),
  cities: z.array(z.string().trim().min(1).max(100)).max(50),
  workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3),
  employmentTypes: z.array(z.enum(["full_time", "part_time", "contract", "internship", "temporary", "freelance"])).max(6),
  salaryMin: z.number().int().min(0).max(10_000_000).nullable(),
  salaryCurrency: z.string().regex(/^[A-Z]{3}$/),
})

export function parseList(value: FormDataEntryValue | null) {
  return [...new Set(String(value ?? "").split(/[\n,;]/).map((item) => item.trim()).filter(Boolean))]
}
