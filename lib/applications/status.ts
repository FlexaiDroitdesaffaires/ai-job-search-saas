export type ApplicationStatusInput = {
  prep_state: string
  submission_evidence?: unknown
}

export function applicationProgress(input: ApplicationStatusInput) {
  switch (input.prep_state) {
    case "draft": return "Préparation à effectuer"
    case "ready_for_review": return "En cours de préparation"
    case "approved": return "Approuvée"
    case "submitting": return "En cours de préparation"
    case "submitted": return input.submission_evidence ? "Soumise avec preuve" : "État incohérent — preuve absente"
    case "needs_manual_action": return "Intervention nécessaire"
    case "failed": return "Échec"
    default: return "État inconnu"
  }
}
