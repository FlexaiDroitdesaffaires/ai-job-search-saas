import { z } from "zod"

const lines = z.array(z.string().trim().min(1).max(2000)).max(200)

export const editableResumeDataSchema = z.object({
  contact: z.object({
    email: z.union([z.literal(""), z.email()]).optional(),
    phone: z.string().trim().max(40).optional(),
    linkedin: z.union([z.literal(""), z.url().max(300)]).optional(),
  }),
  sections: z.object({
    summary: lines,
    experience: lines,
    education: lines,
    skills: lines,
  }),
})

export type EditableResumeData = z.infer<typeof editableResumeDataSchema>

export type ParsedResumeData = EditableResumeData & {
  rawText: string
  extraction: {
    method: "deterministic"
    warnings: string[]
  }
}
