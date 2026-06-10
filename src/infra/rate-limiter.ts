export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  private cleanup(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
  }

  canAcquire(): boolean {
    this.cleanup();
    return this.timestamps.length < this.maxRequests;
  }

  async acquire(): Promise<void> {
    this.cleanup();
    while (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (Date.now() - oldest) + 10;
      await new Promise(resolve => setTimeout(resolve, Math.max(waitMs, 0)));
      this.cleanup();
    }
    this.timestamps.push(Date.now());
  }
}

export const rateLimiters: Record<string, RateLimiter> = {
  tavily: new RateLimiter(20, 60_000),
  jina: new RateLimiter(20, 60_000),
  github: new RateLimiter(60, 3_600_000),
  bedrock: new RateLimiter(12, 60_000),
  default: new RateLimiter(30, 60_000),
};
