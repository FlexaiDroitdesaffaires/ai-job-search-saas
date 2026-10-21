import { applicationDossierSchema, type ApplicationDossierContent } from "./dossier-schema"
import { computeJobMatch } from "@/lib/matching/engine"
import type { CandidateMatchProfile, MatchableJob } from "@/lib/matching/types"

type ProfileRow = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  location: string | null
  linkedin_url: string | null
  current_title: string | null
  experience_level: string | null
  summary: string | null
}

type ExperienceRow = {
  id: string
  title: string
  company: string
  location: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
}

type ResumeRow = {
  id: string
  title: string
  parsed_data: unknown
}

type ApplicationRow = {
  id: string
  job_id: string
  job_title: string
  company: string
  job_url: string | null
}

type JobRow = MatchableJob & { company: string; sourceUrl: string | null }

export type PreparationInput = {
  profile: ProfileRow
  skills: Array<{ id: string; name: string }>
  experiences: ExperienceRow[]
  resume: ResumeRow
  application: ApplicationRow
  job: JobRow
  preferences?: CandidateMatchProfile["preferences"]
}

const KNOWN_SKILLS = [
  "aws", "azure", "css", "docker", "figma", "gcp", "git", "go", "graphql",
  "java", "javascript", "kotlin", "kubernetes", "next.js", "node.js", "php",
  "postgresql", "python", "react", "ruby", "rust", "sql", "supabase", "swift",
  "terraform", "typescript", "vue",
]

const MANDATORY_PATTERN = /\b(must|required|mandatory|essential|obligatoire|exig[eé]|imp[eé]ratif|minimum)\b/i

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim()
}

function unique(values: string[]) {
  const seen = new Set<string>()
  return values.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => {
    const key = normalize(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function descriptionCriteria(description: string) {
  return description
    .replace(/<[^>]+>/g, " ")
    .split(/[\n•]|(?<=[.!?])\s+/)
    .map((value) => value.replace(/^[-*]\s*/, "").trim())
    .filter((value) => value.length >= 8 && value.length <= 2000)
}

function period(experience: ExperienceRow) {
  const start = experience.start_date ?? "Date non précisée"
  const end = experience.is_current ? "Aujourd’hui" : experience.end_date ?? "Date non précisée"
  return `${start} - ${end}`
}

function relevance(value: ExperienceRow, jobText: string) {
  const terms = normalize(`${value.title} ${value.description ?? ""}`).split(" ").filter((term) => term.length > 2)
  const haystack = ` ${normalize(jobText)} `
  return terms.filter((term) => haystack.includes(` ${term} `)).length
}

function parsedSection(resume: ResumeRow, section: "education") {
  const data = resume.parsed_data as { sections?: { education?: unknown } } | null
  return Array.isArray(data?.sections?.[section])
    ? data.sections[section].filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

export function prepareApplicationContent(input: PreparationInput): ApplicationDossierContent {
  const jobText = [input.job.title, input.job.description ?? "", ...(input.job.requirements ?? [])].join(" ")
  const normalizedJob = ` ${normalize(jobText)} `
  const candidateSkills = unique(input.skills.map((skill) => skill.name))
  const detectedSkills = unique([
    ...candidateSkills.filter((skill) => normalizedJob.includes(` ${normalize(skill)} `)),
    ...KNOWN_SKILLS.filter((skill) => normalizedJob.includes(` ${normalize(skill)} `)),
  ])
  const describedCriteria = descriptionCriteria(input.job.description ?? "")
  const qualifications = unique([...(input.job.requirements ?? []), ...describedCriteria.filter((line) => MANDATORY_PATTERN.test(line))]).slice(0, 50)
  const mandatoryCriteria = unique(describedCriteria.filter((line) => MANDATORY_PATTERN.test(line))).slice(0, 50)
  const candidateFacts = normalize([
    input.profile.current_title ?? "", input.profile.summary ?? "",
    ...candidateSkills,
    ...input.experiences.flatMap((item) => [item.title, item.description ?? ""]),
  ].join(" "))
  const comparison = qualifications.map((requirement) => {
    const terms = normalize(requirement).split(" ").filter((term) => term.length >= 3)
    const evidence = candidateSkills.filter((skill) => normalize(requirement).includes(normalize(skill)))
    const lexicalEvidence = terms.filter((term) => ` ${candidateFacts} `.includes(` ${term} `)).slice(0, 5)
    const matched = evidence.length > 0 || lexicalEvidence.length >= Math.min(2, Math.max(1, terms.length))
    return { requirement, status: matched ? "matched" as const : "not_evidenced" as const, evidence: unique([...evidence, ...lexicalEvidence]) }
  })

  const matchProfile: CandidateMatchProfile = {
    currentTitle: input.profile.current_title,
    experienceLevel: input.profile.experience_level,
    location: input.profile.location,
    skills: candidateSkills,
    experiences: input.experiences,
    preferences: input.preferences,
  }
  const matching = computeJobMatch(matchProfile, input.job)
  const relevantSkills = candidateSkills.filter((skill) => normalizedJob.includes(` ${normalize(skill)} `))
  const orderedSkills = [...relevantSkills, ...candidateSkills.filter((skill) => !relevantSkills.includes(skill))]
  const orderedExperiences = [...input.experiences].sort((left, right) => relevance(right, jobText) - relevance(left, jobText) || left.id.localeCompare(right.id))

  const summaryParts = [input.profile.summary?.trim()].filter(Boolean) as string[]
  if (input.profile.current_title) summaryParts.push(`Profil déclaré : ${input.profile.current_title}.`)
  if (relevantSkills.length) summaryParts.push(`Compétences déclarées pertinentes pour cette offre : ${relevantSkills.join(", ")}.`)
  const summary = unique(summaryParts).join(" ")

  const letterFacts: string[] = []
  if (input.profile.current_title) letterFacts.push(`Mon poste actuel déclaré est ${input.profile.current_title}.`)
  if (relevantSkills.length) letterFacts.push(`Mon profil mentionne les compétences suivantes en lien avec l’offre : ${relevantSkills.join(", ")}.`)
  if (orderedExperiences[0]) letterFacts.push(`Mon expérience déclarée comprend le poste de ${orderedExperiences[0].title} chez ${orderedExperiences[0].company}.`)
  const name = input.profile.full_name?.trim() || "Candidat"
  const body = [
    "Madame, Monsieur,",
    `Je vous adresse ma candidature au poste de ${input.job.title} chez ${input.job.company}.`,
    ...letterFacts,
    "Je souhaite échanger avec vous afin d’évaluer l’adéquation de ces éléments avec vos besoins.",
    `Cordialement,\n${name}`,
  ].join("\n\n")

  const answers: ApplicationDossierContent["screeningAnswers"] = [
    answer("full_name", "Quel est votre nom complet ?", input.profile.full_name, true, "profile", "profiles.full_name"),
    answer("email", "Quelle est votre adresse e-mail ?", input.profile.email, true, "profile", "profiles.email"),
    answer("phone", "Quel est votre numéro de téléphone ?", input.profile.phone, true, "profile", "profiles.phone"),
    answer("location", "Quelle est votre localisation actuelle ?", input.profile.location, false, "profile", "profiles.location"),
  ]
  const missingFields = answers.filter((item) => item.required && item.needsReview).map((item) => `screening.${item.key}`)

  return applicationDossierSchema.parse({
    schemaVersion: "application-dossier-v1",
    generation: { method: "deterministic-v1", llmUsed: false },
    application: {
      applicationId: input.application.id, jobId: input.application.job_id,
      jobTitle: input.application.job_title, company: input.application.company,
      sourceUrl: input.application.job_url,
    },
    analysis: { qualifications, essentialSkills: detectedSkills, mandatoryCriteria, comparison, matching },
    resume: {
      title: `CV - ${input.job.title}`,
      sourceResumeId: input.resume.id,
      fullName: name,
      contact: {
        email: input.profile.email,
        phone: input.profile.phone ?? "",
        location: input.profile.location ?? "",
        linkedin: input.profile.linkedin_url ?? "",
      },
      summary,
      summarySourceReferences: unique([input.profile.summary ? "profiles.summary" : "", input.profile.current_title ? "profiles.current_title" : "", ...relevantSkills.map((skill) => `skills:${skill}`)]),
      skills: orderedSkills.map((skill) => ({ name: skill, sourceReference: `skills:${skill}` })),
      experiences: orderedExperiences.map((item) => ({
        title: item.title, company: item.company, location: item.location ?? "",
        period: period(item), description: item.description ?? "",
        sourceReference: `career_experiences:${item.id}`,
      })),
      education: parsedSection(input.resume, "education").map((text, index) => ({ text, sourceReference: `resumes:${input.resume.id}:education:${index}` })),
    },
    coverLetter: {
      title: `Lettre - ${input.job.title}`,
      body,
      sourceReferences: unique(["applications.job_title", "applications.company", input.profile.current_title ? "profiles.current_title" : "", ...relevantSkills.map((skill) => `skills:${skill}`), orderedExperiences[0] ? `career_experiences:${orderedExperiences[0].id}` : ""]),
      editedByUser: false,
    },
    screeningAnswers: answers,
    missingFields,
  })
}

function answer(
  key: string,
  question: string,
  rawAnswer: string | null,
  required: boolean,
  sourceKind: "profile" | "resume",
  sourceReference: string,
): ApplicationDossierContent["screeningAnswers"][number] {
  const value = rawAnswer?.trim() ?? ""
  return {
    key, question, answer: value, required,
    confirmed: Boolean(value), needsReview: required && !value,
    sourceKind: value ? sourceKind : "missing",
    sourceReference: value ? sourceReference : null,
  }
}

export type DossierEdits = {
  summary: string
  coverLetterBody: string
  answers: Record<string, string>
  userConfirmed: boolean
}

export function applyUserEdits(content: ApplicationDossierContent, edits: DossierEdits) {
  if (!edits.userConfirmed) throw new Error("USER_CONFIRMATION_REQUIRED")
  const next = structuredClone(content)
  if (edits.summary.trim() !== next.resume.summary) {
    next.resume.summary = edits.summary.trim()
    next.resume.summarySourceReferences = ["user_confirmed:resume.summary"]
  }
  if (edits.coverLetterBody.trim() !== next.coverLetter.body) {
    next.coverLetter.body = edits.coverLetterBody.trim()
    next.coverLetter.sourceReferences = ["user_confirmed:cover_letter"]
    next.coverLetter.editedByUser = true
  }
  next.screeningAnswers = next.screeningAnswers.map((item) => {
    const value = (edits.answers[item.key] ?? item.answer).trim()
    if (value === item.answer && !item.needsReview) return item
    return {
      ...item,
      answer: value,
      confirmed: Boolean(value),
      needsReview: item.required && !value,
      sourceKind: value === item.answer ? item.sourceKind : "user_confirmed",
      sourceReference: value === item.answer ? item.sourceReference : `user_confirmed:screening.${item.key}`,
    }
  })
  const phone = next.screeningAnswers.find((item) => item.key === "phone")?.answer ?? ""
  next.resume.contact.phone = phone
  next.missingFields = next.screeningAnswers.filter((item) => item.required && item.needsReview).map((item) => `screening.${item.key}`)
  return applicationDossierSchema.parse(next)
}
