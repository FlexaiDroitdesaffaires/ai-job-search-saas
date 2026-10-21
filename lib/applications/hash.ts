import { createHash } from "node:crypto"

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortValue(value))
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function dossierFingerprint(value: unknown) {
  const canonical = canonicalJson(value)
  return { canonical, hash: sha256Hex(canonical) }
}
