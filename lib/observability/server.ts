type ServerEventFields = Record<string, unknown>

const allowedFields = new Set([
  "count",
  "durationMs",
  "errorCode",
  "operation",
  "outcome",
  "provider",
  "retryAfterSeconds",
  "status",
])
const safeText = /^[a-zA-Z0-9_.:-]{1,64}$/

export function formatServerEvent(event: string, fields: ServerEventFields = {}, now = new Date()) {
  const safeFields: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!allowedFields.has(key)) continue
    if (typeof value === "number" && Number.isFinite(value)) safeFields[key] = value
    else if (typeof value === "boolean") safeFields[key] = value
    else if (typeof value === "string" && safeText.test(value)) safeFields[key] = value
  }
  return JSON.stringify({ timestamp: now.toISOString(), event, ...safeFields })
}

export function observeServerEvent(event: string, fields: ServerEventFields = {}) {
  console.info(formatServerEvent(event, fields))
}
