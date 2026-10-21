import type { ApplicationMode, SourceJob } from "./types"

export type ApplicationRoute = {
  mode: ApplicationMode
  provider?: string
  externalId?: string
  reason: string
}

export function classifyApplicationRoute(
  job: Pick<SourceJob, "applicationUrl" | "sourceStatus" | "expiresAt">,
  now = new Date(),
): ApplicationRoute {
  if (job.sourceStatus === "closed") {
    return { mode: "closed_invalid", reason: "La source indique que l’offre est fermée." }
  }
  if (job.expiresAt) {
    const expiry = new Date(job.expiresAt)
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) {
      return { mode: "closed_invalid", reason: "La date d’expiration fournie par la source est dépassée." }
    }
  }
  if (!job.applicationUrl) {
    return { mode: "manual_required", reason: "Aucune interface de soumission structurée n’est fournie." }
  }

  let url: URL
  try {
    url = new URL(job.applicationUrl)
  } catch {
    return { mode: "closed_invalid", reason: "L’URL de candidature fournie est invalide." }
  }
  const host = url.hostname.toLowerCase()
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const externalId = url.searchParams.get("gh_jid") ?? url.pathname.match(/\/jobs\/(\d+)/)?.[1]
    return {
      mode: "unknown",
      provider: "greenhouse",
      externalId,
      reason: "Greenhouse détecté, mais aucune autorisation employeur n’est enregistrée.",
    }
  }
  if (host === "jobs.ashbyhq.com") {
    const segments = url.pathname.split("/").filter(Boolean)
    return {
      mode: "unknown",
      provider: "ashby",
      externalId: segments.at(-2) ?? segments.at(-1),
      reason: "Ashby détecté, mais aucune autorisation employeur n’est enregistrée.",
    }
  }
  if (host === "jobs.lever.co") {
    return {
      mode: "unknown",
      provider: "lever",
      externalId: url.pathname.split("/").filter(Boolean).at(-1),
      reason: "Lever détecté, mais aucune autorisation employeur n’est enregistrée.",
    }
  }
  return {
    mode: "manual_required",
    reason: "Aucun adaptateur autorisé n’est disponible pour cette URL.",
  }
}
