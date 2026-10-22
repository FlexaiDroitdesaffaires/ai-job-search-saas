export type JobCatalogFilters = {
  query?: string
  location?: string
  employmentTypes: string[]
  workModes: string[]
  salaryMin?: number
  seniority?: string
}

type FilterableJob = {
  title: string
  company: string
  description?: string | null
  location?: string | null
  country?: string | null
  employment_type?: string | null
  work_mode?: string | null
  salary_min?: number | null
  salary_max?: number | null
  seniority?: string | null
}

function normalized(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

export function filterCatalogJobs<T extends FilterableJob>(jobs: T[], filters: JobCatalogFilters) {
  const query = normalized(filters.query)
  const location = normalized(filters.location)
  return jobs.filter((job) => {
    if (query && !normalized(`${job.title} ${job.company} ${job.description ?? ""}`).includes(query)) return false
    if (location && !normalized(`${job.location ?? ""} ${job.country ?? ""}`).includes(location)) return false
    if (filters.employmentTypes.length && (!job.employment_type || !filters.employmentTypes.includes(job.employment_type))) return false
    if (filters.workModes.length && (!job.work_mode || !filters.workModes.includes(job.work_mode))) return false
    if (filters.salaryMin != null && (job.salary_max ?? job.salary_min ?? -1) < filters.salaryMin) return false
    if (filters.seniority && job.seniority !== filters.seniority) return false
    return true
  })
}
