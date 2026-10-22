export type JobSourceRegistryEntry = {
  id: string
  name: string
  catalogUrl: string
  interface: "json_api" | "rss" | "unknown"
  commercialUse: "allowed_with_conditions" | "blocked" | "requires_permission"
  redistribution: "allowed_with_attribution" | "blocked" | "unclear"
  geography: string
  freshness: string
  atsCompatibility: string
  cost: string
  decision: "active" | "candidate" | "blocked"
  reason: string
}

export const jobSourceRegistry: readonly JobSourceRegistryEntry[] = [
  {
    id: "easyjobs", name: "EasyJobs", catalogUrl: "https://api.easyjobs.fr/public/docs/",
    interface: "json_api", commercialUse: "allowed_with_conditions",
    redistribution: "allowed_with_attribution", geography: "France, tous secteurs",
    freshness: "Offres actives; filtres 1, 3, 7 ou 30 jours",
    atsCompatibility: "Lien EasyJobs attribué obligatoire; aucune URL ATS externe exposée",
    cost: "Lecture anonyme gratuite, 60 requêtes/minute observées", decision: "active",
    reason: "Usage applicatif autorisé avec attribution; import plafonné, sans reconstruction substantielle de la base.",
  },
  {
    id: "remoteok", name: "Remote OK", catalogUrl: "https://remoteok.com/api",
    interface: "json_api", commercialUse: "allowed_with_conditions",
    redistribution: "allowed_with_attribution", geography: "Monde, télétravail",
    freshness: "Flux courant; contrôle local limité à 45 jours",
    atsCompatibility: "URL Remote OK intermédiaire; ATS final non garanti",
    cost: "Gratuit, attribution et lien source obligatoires", decision: "active",
    reason: "Connecteur Lot A déjà validé.",
  },
  {
    id: "aidevjobs", name: "AI Dev Jobs", catalogUrl: "https://aidevboard.com/api/v1/jobs",
    interface: "json_api", commercialUse: "allowed_with_conditions",
    redistribution: "allowed_with_attribution", geography: "Monde, rôles IA/ML",
    freshness: "Statut et dates de publication/expiration fournis",
    atsCompatibility: "URL directe Greenhouse, Ashby, Lever ou autre ATS",
    cost: "Lecture publique gratuite avec limitation horaire", decision: "active",
    reason: "API structurée; usage applicatif permis, revente du jeu brut interdite.",
  },
  {
    id: "himalayas", name: "Himalayas", catalogUrl: "https://himalayas.app/jobs/api",
    interface: "json_api", commercialUse: "allowed_with_conditions",
    redistribution: "allowed_with_attribution", geography: "Monde, télétravail",
    freshness: "Rafraîchissement quotidien; date d’expiration fournie",
    atsCompatibility: "Lien de candidature fourni, routage via Himalayas obligatoire",
    cost: "Gratuit; clé facultative et quotas documentés", decision: "candidate",
    reason: "Candidat suivant; ne pas republier vers un autre job board.",
  },
  {
    id: "remotive", name: "Remotive", catalogUrl: "https://remotive.com/remote-jobs/api",
    interface: "json_api", commercialUse: "requires_permission", redistribution: "unclear",
    geography: "Monde, télétravail", freshness: "Flux public retardé de 24 heures",
    atsCompatibility: "Lien Remotive obligatoire", cost: "API privée payante disponible",
    decision: "blocked", reason: "Le flux public interdit de conditionner l’affichage à une inscription.",
  },
  {
    id: "weworkremotely", name: "We Work Remotely", catalogUrl: "https://weworkremotely.com/remote-jobs.rss",
    interface: "rss", commercialUse: "blocked", redistribution: "blocked",
    geography: "Monde, télétravail", freshness: "RSS public courant",
    atsCompatibility: "Candidature obligatoirement routée via WWR", cost: "RSS gratuit",
    decision: "blocked", reason: "Les conditions API interdisent un service de recherche d’emploi concurrent.",
  },
  {
    id: "arbeitnow", name: "Arbeitnow", catalogUrl: "https://www.arbeitnow.com/api/job-board-api",
    interface: "json_api", commercialUse: "requires_permission", redistribution: "unclear",
    geography: "Europe, surtout Allemagne", freshness: "Offres supprimées à expiration ou après 30 jours",
    atsCompatibility: "Nombreuses sources ATS; candidature parfois via JOIN",
    cost: "API publique gratuite, offre privée payante", decision: "blocked",
    reason: "La clause API exige l’attribution mais la licence générale limite l’usage commercial; accord requis.",
  },
  {
    id: "greenhouse-public-boards", name: "Greenhouse Job Board API", catalogUrl: "https://developers.greenhouse.io/job-board.html",
    interface: "json_api", commercialUse: "requires_permission", redistribution: "unclear",
    geography: "Boards employeurs, dont France", freshness: "Jobs publiés et updated_at fournis",
    atsCompatibility: "Lien employeur direct; GET public sans authentification", cost: "Lecture publique gratuite",
    decision: "blocked", reason: "API publiquement lisible, mais aucune licence générale de republication commerciale multi-employeurs identifiée.",
  },
  {
    id: "ashby-public-boards", name: "Ashby Job Postings API", catalogUrl: "https://developers.ashbyhq.com/docs/public-job-posting-api",
    interface: "json_api", commercialUse: "requires_permission", redistribution: "unclear",
    geography: "Boards employeurs, dont France", freshness: "Postes publiés avec publishedAt",
    atsCompatibility: "Liens jobUrl et applyUrl directs", cost: "Lecture publique gratuite par board",
    decision: "blocked", reason: "Le flux public vise la page carrière de sa propre organisation; l’agrégation partenaire passe par un flux dédié avec opt-in employeur.",
  },
] as const
