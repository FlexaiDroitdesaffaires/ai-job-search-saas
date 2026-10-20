import type {
  CandidateMatchProfile,
  MatchCriterion,
  MatchResult,
  MatchableJob,
} from "./types"

const WEIGHTS = {
  skills: 25,
  experience: 15,
  title: 20,
  location: 10,
  work_mode: 10,
  salary: 10,
  seniority: 5,
  employment_type: 5,
} as const

const STOP_WORDS = new Set([
  "and", "avec", "dans", "des", "for", "les", "pour", "the", "une", "your",
  "vous", "sur", "de", "du", "la", "le", "of", "to", "a", "an", "et",
])

const SENIORITY_ORDER = ["entry", "junior", "mid", "senior", "lead", "executive"]

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalize(value ?? "")).filter(Boolean))].sort()
}

function tokens(value: string) {
  return unique(normalize(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)))
}

function criterion(
  key: MatchCriterion["key"],
  label: string,
  maxPoints: number,
  points: number,
  status: MatchCriterion["status"],
  explanation: string,
  evidence: string[] = [],
): MatchCriterion {
  return { key, label, maxPoints, points: Math.max(0, Math.min(maxPoints, Math.round(points))), status, explanation, evidence: [...evidence].sort() }
}

function skillsCriterion(profile: CandidateMatchProfile, jobText: string) {
  const skills = unique(profile.skills)
  if (!skills.length) return criterion("skills", "Compétences", WEIGHTS.skills, 0, "missing", "Aucune compétence candidat renseignée.")
  if (!jobText) return criterion("skills", "Compétences", WEIGHTS.skills, WEIGHTS.skills / 2, "neutral", "L’offre ne fournit pas assez de texte pour comparer les compétences.")
  const normalizedJob = ` ${normalize(jobText)} `
  const matched = skills.filter((skill) => normalizedJob.includes(` ${skill} `) || (skill.length >= 4 && normalizedJob.includes(skill)))
  const points = WEIGHTS.skills * matched.length / skills.length
  if (!matched.length) return criterion("skills", "Compétences", WEIGHTS.skills, 0, "mismatch", "Aucune compétence déclarée n’est explicitement retrouvée dans l’offre.")
  return criterion("skills", "Compétences", WEIGHTS.skills, points, matched.length === skills.length ? "matched" : "partial", `${matched.length} compétence(s) déclarée(s) retrouvée(s) sur ${skills.length}.`, matched)
}

function experienceCriterion(profile: CandidateMatchProfile, jobText: string) {
  const experienceText = profile.experiences.map((item) => `${item.title ?? ""} ${item.description ?? ""}`).join(" ")
  const experienceTokens = tokens(experienceText)
  if (!experienceTokens.length) return criterion("experience", "Expérience", WEIGHTS.experience, 0, "missing", "Aucune expérience exploitable n’est renseignée.")
  if (!jobText) return criterion("experience", "Expérience", WEIGHTS.experience, WEIGHTS.experience / 2, "neutral", "L’offre ne fournit pas assez de texte pour comparer l’expérience.")
  const jobTokens = new Set(tokens(jobText))
  const overlaps = experienceTokens.filter((token) => jobTokens.has(token)).slice(0, 6)
  if (!overlaps.length) return criterion("experience", "Expérience", WEIGHTS.experience, 0, "mismatch", "Aucun terme d’expérience déclaré ne correspond explicitement au contenu de l’offre.")
  const points = WEIGHTS.experience * Math.min(1, overlaps.length / 3)
  return criterion("experience", "Expérience", WEIGHTS.experience, points, overlaps.length >= 3 ? "matched" : "partial", `${overlaps.length} signal(aux) textuel(s) d’expérience concordent.`, overlaps)
}

function titleCriterion(profile: CandidateMatchProfile, job: MatchableJob) {
  const titles = unique([...(profile.preferences?.targetTitles ?? []), profile.currentTitle])
  if (!titles.length) return criterion("title", "Intitulé", WEIGHTS.title, 0, "missing", "Aucun intitulé cible ou actuel n’est renseigné.")
  const jobTokens = tokens(job.title)
  let bestTitle = titles[0]
  let bestRatio = 0
  for (const title of titles) {
    const candidateTokens = tokens(title)
    const overlap = candidateTokens.filter((token) => jobTokens.includes(token)).length
    const ratio = overlap / Math.max(candidateTokens.length, jobTokens.length, 1)
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestTitle = title
    }
  }
  if (bestRatio === 0) return criterion("title", "Intitulé", WEIGHTS.title, 0, "mismatch", "L’intitulé de l’offre ne recoupe aucun intitulé candidat déclaré.", [bestTitle])
  return criterion("title", "Intitulé", WEIGHTS.title, WEIGHTS.title * bestRatio, bestRatio >= 0.66 ? "matched" : "partial", `L’intitulé correspond à ${Math.round(bestRatio * 100)} % des termes du meilleur intitulé déclaré.`, [bestTitle])
}

function workModeCriterion(profile: CandidateMatchProfile, job: MatchableJob) {
  const preferences = unique(profile.preferences?.workModes ?? [])
  if (!preferences.length) return criterion("work_mode", "Télétravail", WEIGHTS.work_mode, 0, "missing", "Aucune préférence de mode de travail n’est renseignée.")
  if (!job.workMode) return criterion("work_mode", "Télétravail", WEIGHTS.work_mode, WEIGHTS.work_mode / 2, "neutral", "Le mode de travail de l’offre n’est pas indiqué.")
  const mode = normalize(job.workMode)
  const matched = preferences.includes(mode)
  return criterion("work_mode", "Télétravail", WEIGHTS.work_mode, matched ? WEIGHTS.work_mode : 0, matched ? "matched" : "mismatch", matched ? `Mode de travail compatible : ${mode}.` : `Mode de travail ${mode} absent des préférences.`, [mode])
}

function locationCriterion(profile: CandidateMatchProfile, job: MatchableJob) {
  const preferred = unique([...(profile.preferences?.cities ?? []), ...(profile.preferences?.countries ?? []), profile.location])
  if (!preferred.length) return criterion("location", "Localisation", WEIGHTS.location, 0, "missing", "Aucune localisation candidate n’est renseignée.")
  if (normalize(job.workMode ?? "") === "remote" && unique(profile.preferences?.workModes ?? []).includes("remote")) {
    return criterion("location", "Localisation", WEIGHTS.location, WEIGHTS.location, "matched", "L’offre est à distance et le télétravail est accepté.", ["remote"])
  }
  const place = normalize(`${job.location ?? ""} ${job.country ?? ""}`)
  if (!place) return criterion("location", "Localisation", WEIGHTS.location, WEIGHTS.location / 2, "neutral", "La localisation de l’offre n’est pas indiquée.")
  const matched = preferred.filter((item) => place.includes(item) || item.includes(place))
  return criterion("location", "Localisation", WEIGHTS.location, matched.length ? WEIGHTS.location : 0, matched.length ? "matched" : "mismatch", matched.length ? "La localisation recoupe une préférence déclarée." : "La localisation ne recoupe aucune préférence déclarée.", matched)
}

function salaryCriterion(profile: CandidateMatchProfile, job: MatchableJob) {
  const expected = profile.preferences?.salaryMin
  if (expected == null) return criterion("salary", "Salaire", WEIGHTS.salary, 0, "missing", "Aucun salaire minimum candidat n’est renseigné.")
  if (job.salaryMin == null && job.salaryMax == null) return criterion("salary", "Salaire", WEIGHTS.salary, WEIGHTS.salary / 2, "neutral", "Le salaire de l’offre n’est pas indiqué.")
  const preferredCurrency = normalize(profile.preferences?.salaryCurrency ?? "")
  const jobCurrency = normalize(job.salaryCurrency ?? "")
  if (!preferredCurrency) return criterion("salary", "Salaire", WEIGHTS.salary, 0, "missing", "La devise du salaire candidat n’est pas renseignée.")
  if (!jobCurrency) return criterion("salary", "Salaire", WEIGHTS.salary, WEIGHTS.salary / 2, "neutral", "La devise du salaire de l’offre n’est pas indiquée.")
  if (preferredCurrency !== jobCurrency) return criterion("salary", "Salaire", WEIGHTS.salary, 0, "mismatch", `Devise incompatible : ${job.salaryCurrency} au lieu de ${profile.preferences?.salaryCurrency}.`)
  const ceiling = job.salaryMax ?? job.salaryMin ?? 0
  const matched = ceiling >= expected
  return criterion("salary", "Salaire", WEIGHTS.salary, matched ? WEIGHTS.salary : 0, matched ? "matched" : "mismatch", matched ? "Le maximum annoncé atteint le minimum candidat." : "Le maximum annoncé est inférieur au minimum candidat.", [`minimum candidat: ${expected}`, `maximum offre: ${ceiling}`])
}

function seniorityCriterion(profile: CandidateMatchProfile, job: MatchableJob) {
  const preferred = unique([...(profile.preferences?.seniority ?? []), profile.experienceLevel])
  if (!preferred.length) return criterion("seniority", "Séniorité", WEIGHTS.seniority, 0, "missing", "Aucun niveau de séniorité candidat n’est renseigné.")
  if (!job.seniority) return criterion("seniority", "Séniorité", WEIGHTS.seniority, WEIGHTS.seniority / 2, "neutral", "La séniorité de l’offre n’est pas indiquée.")
  const jobIndex = SENIORITY_ORDER.indexOf(normalize(job.seniority))
  if (jobIndex < 0) return criterion("seniority", "Séniorité", WEIGHTS.seniority, WEIGHTS.seniority / 2, "neutral", "La séniorité de l’offre n’est pas reconnue.")
  const preferredIndices = preferred.map((value) => SENIORITY_ORDER.indexOf(value)).filter((index) => index >= 0)
  if (!preferredIndices.length) return criterion("seniority", "Séniorité", WEIGHTS.seniority, 0, "missing", "Le niveau candidat renseigné n’est pas exploitable.")
  const distances = preferredIndices.map((index) => Math.abs(index - jobIndex))
  const distance = distances.length ? Math.min(...distances) : Number.POSITIVE_INFINITY
  if (distance === 0) return criterion("seniority", "Séniorité", WEIGHTS.seniority, WEIGHTS.seniority, "matched", "La séniorité correspond au niveau déclaré.", [job.seniority])
  if (distance === 1) return criterion("seniority", "Séniorité", WEIGHTS.seniority, WEIGHTS.seniority / 2, "partial", "La séniorité diffère d’un niveau du profil déclaré.", [job.seniority])
  return criterion("seniority", "Séniorité", WEIGHTS.seniority, 0, "mismatch", "La séniorité est éloignée du niveau déclaré.", [job.seniority])
}

function employmentCriterion(profile: CandidateMatchProfile, job: MatchableJob) {
  const preferred = unique(profile.preferences?.employmentTypes ?? [])
  if (!preferred.length) return criterion("employment_type", "Type de contrat", WEIGHTS.employment_type, 0, "missing", "Aucun type de contrat préféré n’est renseigné.")
  if (!job.employmentType) return criterion("employment_type", "Type de contrat", WEIGHTS.employment_type, WEIGHTS.employment_type / 2, "neutral", "Le type de contrat de l’offre n’est pas indiqué.")
  const value = normalize(job.employmentType)
  const matched = preferred.includes(value)
  return criterion("employment_type", "Type de contrat", WEIGHTS.employment_type, matched ? WEIGHTS.employment_type : 0, matched ? "matched" : "mismatch", matched ? "Le type de contrat correspond aux préférences." : "Le type de contrat ne correspond pas aux préférences.", [value])
}

export function computeJobMatch(profile: CandidateMatchProfile, job: MatchableJob): MatchResult {
  const jobText = [job.title, job.description ?? "", ...(job.requirements ?? [])].join(" ")
  const criteria = [
    skillsCriterion(profile, jobText),
    experienceCriterion(profile, jobText),
    titleCriterion(profile, job),
    locationCriterion(profile, job),
    workModeCriterion(profile, job),
    salaryCriterion(profile, job),
    seniorityCriterion(profile, job),
    employmentCriterion(profile, job),
  ]
  return {
    version: "deterministic-v1",
    score: Math.max(0, Math.min(100, criteria.reduce((sum, item) => sum + item.points, 0))),
    criteria,
    satisfied: criteria.filter((item) => item.status === "matched" || item.status === "partial").map((item) => item.explanation),
    incompatibilities: criteria.filter((item) => item.status === "mismatch").map((item) => item.explanation),
    missingData: criteria.filter((item) => item.status === "missing" || item.status === "neutral").map((item) => item.explanation),
    disclaimer: "Score de compatibilité déterministe, pas une probabilité de recrutement.",
  }
}
