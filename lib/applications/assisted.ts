export type AssistedDecision = "sent" | "not_sent" | "unable"

export function verifiedOfficialUrl(input: {
  storedUrl: string | null
  sourceUrl: string | null
  applicationUrl: string | null
}) {
  const stored = input.storedUrl?.trim()
  if (!stored || (stored !== input.sourceUrl?.trim() && stored !== input.applicationUrl?.trim())) return null
  try {
    const url = new URL(stored)
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export function assistedDecisionLabel(decision: string | null | undefined) {
  switch (decision) {
    case "sent": return "Envoi déclaré par l’utilisateur"
    case "not_sent": return "Pas encore envoyée"
    case "unable": return "Impossible de candidater"
    default: return "Aucune décision déclarée"
  }
}

export function confirmationLabel(input: {
  submissionMethod?: string | null
  submissionState?: string | null
  environment?: string | null
}) {
  if (input.environment === "test" && input.submissionState === "confirmed") {
    return "Test local — aucune confirmation réelle"
  }
  if (input.submissionState !== "confirmed") return "Aucune confirmation"
  return input.submissionMethod === "manual"
    ? "Déclaration utilisateur — aucune confirmation ATS"
    : "Confirmation fournisseur"
}

export function applicationModeLabel(input: {
  submissionMethod?: string | null
  applicationMode?: string | null
}) {
  if (input.submissionMethod === "manual") return "Assistée (envoi utilisateur)"
  if (input.submissionMethod === "adapter") return "Adaptateur ATS"
  if (input.applicationMode === "automatic_authorized") return "Automatisation autorisée"
  return "Assistée / manuelle"
}

export function applicationEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    official_form_opened: "Formulaire officiel ouvert",
    assisted_application_not_sent: "Déclarée pas encore envoyée",
    assisted_application_unable: "Déclarée impossible",
    manual_submission_recorded: "Envoi déclaré par l’utilisateur",
    dossier_prepared: "Dossier préparé",
    dossier_approved: "Dossier approuvé",
  }
  return labels[eventType] ?? eventType.replaceAll("_", " ")
}
