export const CANONICAL_EMPLOYMENT_TYPES = [
  "permanent",
  "fixed_term",
  "freelance",
  "temporary",
  "apprenticeship",
  "internship",
  "seasonal",
  "occasional",
] as const

export const LEGACY_EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const

export type CanonicalEmploymentType = typeof CANONICAL_EMPLOYMENT_TYPES[number]
export type LegacyEmploymentType = typeof LEGACY_EMPLOYMENT_TYPES[number]
export type EmploymentType = CanonicalEmploymentType | LegacyEmploymentType

type EmploymentSignals = {
  contractType?: string | null
  employmentType?: string | null
  title?: string | null
  description?: string | null
  isWorkStudy?: boolean | null
}

function searchable(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

export function normalizeEmploymentType(signals: EmploymentSignals): EmploymentType | undefined {
  if (signals.isWorkStudy) return "apprenticeship"

  const contract = searchable(signals.contractType).trim()
  const employment = searchable(signals.employmentType).trim()
  // Descriptions often mention benefits (for example "vacation") or generic
  // internship programmes. Contract inference is deliberately limited to the
  // structured contract fields and the job title.
  const text = searchable([signals.contractType, signals.employmentType, signals.title].filter(Boolean).join(" "))

  if (/\b(alternance|alternant|apprentissage|apprenti)\b/.test(text)) return "apprenticeship"
  if (/\b(stage|stagiaire|internship|intern)\b/.test(text)) return "internship"
  if (/\b(saisonnier|saisonniere|seasonal)\b/.test(text)) return "seasonal"
  if (/\b(interim|interimaire|temporary)\b/.test(text) || contract === "interim") return "temporary"
  if (/\b(vacation|vacataire|mission ponctuelle)\b/.test(text)) return "occasional"
  if (/\b(freelance|independant|independante)\b/.test(text)) return "freelance"
  if (/\b(cdd|fixed[ -]?term)\b/.test(text) || contract === "cdd") return "fixed_term"
  if (/\b(cdi|permanent)\b/.test(text) || contract === "cdi") return "permanent"

  // "FullTime" and "Temps plein" describe working time, not a French contract.
  // Never infer a CDI from those values.
  if (employment === "contract") return "contract"
  return undefined
}

export function employmentTypeLabel(value: string | null | undefined) {
  return ({
    permanent: "CDI",
    fixed_term: "CDD",
    freelance: "Freelance / indépendant",
    temporary: "Intérim",
    apprenticeship: "Alternance / apprentissage",
    internship: "Stage",
    seasonal: "Saisonnier",
    occasional: "Vacation / mission ponctuelle",
    full_time: "Temps plein (source historique)",
    part_time: "Temps partiel (source historique)",
    contract: "Contrat non précisé",
  } as Record<string, string>)[value ?? ""] ?? "Contrat non précisé"
}
