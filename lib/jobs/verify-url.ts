export type UrlVerification = { status: number; verifiedAt: Date }

export async function verifyJobUrl(url: string, fetcher: typeof fetch = fetch): Promise<UrlVerification | null> {
  const options = {
    redirect: "follow" as const,
    headers: { "User-Agent": "AI Job Search SaaS/0.1", Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(10_000),
  }

  try {
    let response = await fetcher(url, { ...options, method: "HEAD" })
    if (response.status === 403 || response.status === 405) {
      response = await fetcher(url, { ...options, method: "GET", headers: { ...options.headers, Range: "bytes=0-0" } })
    }
    // Some employer career sites deliberately reject automated requests while
    // still proving that the HTTPS endpoint exists. Preserve those URLs with
    // their restricted status; callers must not treat 401/403 as an open-job
    // confirmation. Definitive not-found and server failures remain invalid.
    if ((response.status < 200 || response.status >= 400) && response.status !== 401 && response.status !== 403) return null
    const finalUrl = new URL(response.url || url)
    if (finalUrl.protocol !== "https:") return null
    return { status: response.status, verifiedAt: new Date() }
  } catch {
    return null
  }
}
