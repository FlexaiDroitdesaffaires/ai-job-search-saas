import type { ParsedResumeData } from "./schema"

type Section = keyof ParsedResumeData["sections"]

const headings: Record<string, Section> = {
  profil: "summary", profile: "summary", resume: "summary", summary: "summary",
  "a propos": "summary", "professional summary": "summary",
  experience: "experience", experiences: "experience",
  "experience professionnelle": "experience", "experiences professionnelles": "experience",
  employment: "experience", "work experience": "experience",
  formation: "education", formations: "education", education: "education",
  diplômes: "education", diplomes: "education",
  competences: "skills", "compétences": "skills", skills: "skills",
  technologies: "skills", outils: "skills",
}

function normalizedHeading(value: string) {
  return value
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[:|–—-]+$/g, "")
    .trim()
}

function compactLines(text: string) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

export function parseResumeText(input: string): ParsedResumeData {
  const rawText = input.trim().slice(0, 100_000)
  const sections: ParsedResumeData["sections"] = {
    summary: [], experience: [], education: [], skills: [],
  }
  const warnings: string[] = []
  let current: Section = "summary"

  for (const line of compactLines(rawText)) {
    const heading = headings[normalizedHeading(line)]
    if (heading) {
      current = heading
      continue
    }
    const values = current === "skills"
      ? line.split(/[•·,;|]/).map((value) => value.trim()).filter(Boolean)
      : [line]
    for (const value of values) {
      if (!sections[current].includes(value)) sections[current].push(value)
    }
  }

  const email = rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  const linkedin = rawText.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0]
  const phone = rawText.match(/(?:\+\d{1,3}[ .-]?)?(?:\d[ .-]?){8,14}\d/)?.[0]?.trim()
  if (!rawText) warnings.push("Aucun texte extractible détecté.")
  if (!Object.values(sections).some((values) => values.length)) {
    warnings.push("Aucune section reconnue automatiquement.")
  }

  return {
    contact: { email, phone, linkedin },
    sections,
    rawText,
    extraction: { method: "deterministic", warnings },
  }
}
