export type MatchStatus = "matched" | "partial" | "mismatch" | "missing" | "neutral"

export type MatchCriterion = {
  key: "skills" | "experience" | "title" | "location" | "work_mode" | "salary" | "seniority" | "employment_type"
  label: string
  points: number
  maxPoints: number
  status: MatchStatus
  explanation: string
  evidence: string[]
}

export type CandidateMatchProfile = {
  currentTitle?: string | null
  experienceLevel?: string | null
  location?: string | null
  skills: string[]
  experiences: Array<{ title?: string | null; description?: string | null }>
  preferences?: {
    targetTitles?: string[] | null
    countries?: string[] | null
    cities?: string[] | null
    workModes?: string[] | null
    salaryMin?: number | null
    salaryCurrency?: string | null
    employmentTypes?: string[] | null
    seniority?: string[] | null
  } | null
}

export type MatchableJob = {
  id: string
  title: string
  location?: string | null
  country?: string | null
  workMode?: string | null
  employmentType?: string | null
  seniority?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  description?: string | null
  requirements?: string[] | null
}

export type MatchResult = {
  version: "deterministic-v1"
  score: number
  criteria: MatchCriterion[]
  satisfied: string[]
  incompatibilities: string[]
  missingData: string[]
  disclaimer: string
}
