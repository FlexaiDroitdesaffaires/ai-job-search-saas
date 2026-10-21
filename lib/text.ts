export function repairUtf8Mojibake(value: string) {
  const repaired = value
    .replace(/\u00e2\u0080[\u0098\u0099]/g, "’")
    .replace(/\u00e2\u0080[\u009c\u009d]/g, '"')
    .replace(/\u00e2\u0080\u0093/g, "–")
    .replace(/\u00e2\u0080\u0094/g, "—")
  if (!/[\u0080-\u009f]/.test(repaired)) return repaired
  const points = [...repaired].map((character) => character.codePointAt(0) ?? 0)
  if (points.some((point) => point > 0xff)) return value
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(points))
  } catch {
    return repaired
  }
}
