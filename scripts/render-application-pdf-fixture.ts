import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { generateCoverLetterPdf, generateResumePdf } from "../lib/applications/pdf"
import { prepareApplicationContent } from "../lib/applications/preparation"

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error("Usage: tsx scripts/render-application-pdf-fixture.ts <output-directory>")

const content = prepareApplicationContent({
  profile: {
    id: "11111111-1111-1111-8111-111111111111",
    email: "camille@example.test",
    full_name: "Camille Exemple",
    phone: "+33 6 00 00 00 00",
    location: "Paris, France",
    linkedin_url: "https://linkedin.com/in/camille-exemple",
    current_title: "Software Engineer",
    experience_level: "senior",
    summary: "Ingénieure logiciel spécialisée dans les applications web fiables et accessibles.",
  },
  skills: [
    { id: "skill-1", name: "TypeScript" },
    { id: "skill-2", name: "React" },
    { id: "skill-3", name: "PostgreSQL" },
  ],
  experiences: [{
    id: "experience-1",
    title: "Software Engineer",
    company: "Entreprise Exemple",
    location: "Paris",
    start_date: "2022-01-01",
    end_date: null,
    is_current: true,
    description: "Développement et maintenance d'applications TypeScript et React connectées à PostgreSQL.",
  }],
  resume: {
    id: "22222222-2222-2222-8222-222222222222",
    title: "CV principal",
    parsed_data: { sections: { education: ["Master informatique - Université Exemple"] } },
  },
  application: {
    id: "33333333-3333-3333-8333-333333333333",
    job_id: "44444444-4444-4444-8444-444444444444",
    job_title: "Senior TypeScript Engineer",
    company: "Remote Company",
    job_url: "https://example.test/jobs/verified",
  },
  job: {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Senior TypeScript Engineer",
    company: "Remote Company",
    sourceUrl: "https://example.test/jobs/verified",
    location: "Remote",
    country: "France",
    workMode: "remote",
    employmentType: "full_time",
    seniority: "senior",
    description: "TypeScript and React are required. Kubernetes experience is mandatory.",
    requirements: ["TypeScript", "React", "Kubernetes"],
  },
})

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(path.join(outputDirectory, "cv-fixture.pdf"), await generateResumePdf(content)),
    writeFile(path.join(outputDirectory, "lettre-fixture.pdf"), await generateCoverLetterPdf(content)),
  ])
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
