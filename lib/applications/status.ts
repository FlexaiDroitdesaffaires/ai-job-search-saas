export type ApplicationStatusInput = {
  prep_state: string
  submission_evidence?: unknown
  submission?: {
    state: string
    environment?: string | null
  } | null
}

export function applicationProgress(input: ApplicationStatusInput) {
  if (input.submission) {
    if (input.submission.environment === "test" && input.submission.state === "confirmed") {
      return "Test local confirmé — aucune candidature réelle"
    }
    switch (input.submission.state) {
      case "queued":
      case "retry_scheduled": return "En attente de traitement"
      case "processing": return "En cours de traitement"
      case "requires_reconciliation": return "Résultat incertain"
      case "needs_manual_action": return "Intervention nécessaire"
      case "failed": return "Échec confirmé"
      case "confirmed":
        return input.prep_state === "submitted" && input.submission_evidence
          ? "Soumission confirmée"
          : "État incohérent — confirmation sans preuve applicative"
    }
  }
  switch (input.prep_state) {
    case "draft": return "Préparation à effectuer"
    case "ready_for_review": return "En cours de préparation"
    case "approved": return "Dossier approuvé"
    case "submitting": return "En cours de traitement"
    case "submitted": return input.submission_evidence ? "Soumise avec preuve" : "État incohérent — preuve absente"
    case "needs_manual_action": return "Intervention nécessaire"
    case "failed": return "Échec confirmé"
    default: return "État inconnu"
  }
}
