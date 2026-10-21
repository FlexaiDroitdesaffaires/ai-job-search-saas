import { z } from "zod"

const sourcedAnswerSchema = z.object({
  key: z.string().min(1).max(100),
  question: z.string().min(1).max(2000),
  answer: z.string().max(10000),
  required: z.boolean(),
  confirmed: z.boolean(),
  needsReview: z.boolean(),
  sourceKind: z.enum(["profile", "resume", "user_confirmed", "missing"]),
  sourceReference: z.string().max(500).nullable(),
})

export const applicationDossierSchema = z.object({
  schemaVersion: z.literal("application-dossier-v1"),
  generation: z.object({
    method: z.literal("deterministic-v1"),
    llmUsed: z.literal(false),
  }),
  application: z.object({
    applicationId: z.uuid(),
    jobId: z.uuid(),
    jobTitle: z.string().min(1).max(500),
    company: z.string().min(1).max(500),
    sourceUrl: z.url().max(2048).nullable(),
  }),
  analysis: z.object({
    qualifications: z.array(z.string().min(1).max(2000)).max(50),
    essentialSkills: z.array(z.string().min(1).max(200)).max(100),
    mandatoryCriteria: z.array(z.string().min(1).max(2000)).max(50),
    comparison: z.array(z.object({
      requirement: z.string().min(1).max(2000),
      status: z.enum(["matched", "not_evidenced"]),
      evidence: z.array(z.string().min(1).max(500)).max(20),
    })).max(100),
    matching: z.record(z.string(), z.unknown()),
  }),
  resume: z.object({
    title: z.string().min(1).max(200),
    sourceResumeId: z.uuid(),
    fullName: z.string().min(1).max(200),
    contact: z.object({
      email: z.string().max(320),
      phone: z.string().max(80),
      location: z.string().max(300),
      linkedin: z.string().max(500),
    }),
    summary: z.string().max(5000),
    summarySourceReferences: z.array(z.string().min(1).max(500)).max(20),
    skills: z.array(z.object({ name: z.string().min(1).max(200), sourceReference: z.string().min(1).max(500) })).max(200),
    experiences: z.array(z.object({
      title: z.string().min(1).max(200), company: z.string().min(1).max(200),
      location: z.string().max(300), period: z.string().max(100),
      description: z.string().max(10000), sourceReference: z.string().min(1).max(500),
    })).max(100),
    education: z.array(z.object({ text: z.string().min(1).max(2000), sourceReference: z.string().min(1).max(500) })).max(100),
  }),
  coverLetter: z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(20000),
    sourceReferences: z.array(z.string().min(1).max(500)).max(100),
    editedByUser: z.boolean(),
  }),
  screeningAnswers: z.array(sourcedAnswerSchema).max(100),
  missingFields: z.array(z.string().min(1).max(500)).max(100),
})

export type ApplicationDossierContent = z.infer<typeof applicationDossierSchema>
