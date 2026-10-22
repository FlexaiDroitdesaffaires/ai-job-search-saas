export class SlidingWindowLimit {
  private readonly attempts = new Map<string, number[]>()

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()) {
    const recent = (this.attempts.get(key) ?? []).filter((value) => value > now - this.windowMs)
    if (recent.length >= this.maximum) {
      this.attempts.set(key, recent)
      return { allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)) }
    }
    recent.push(now)
    this.attempts.set(key, recent)
    if (this.attempts.size > 5_000) {
      for (const [candidate, values] of this.attempts) {
        if (!values.some((value) => value > now - this.windowMs)) this.attempts.delete(candidate)
      }
    }
    return { allowed: true as const }
  }
}
