import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../src/infra/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests under limit', async () => {
    const limiter = new RateLimiter(5, 1000);
    expect(limiter.canAcquire()).toBe(true);
    await limiter.acquire();
    expect(limiter.canAcquire()).toBe(true);
  });

  it('blocks when at limit', async () => {
    const limiter = new RateLimiter(2, 60_000);
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.canAcquire()).toBe(false);
  });

  it('allows again after window expires', async () => {
    const limiter = new RateLimiter(1, 50);
    await limiter.acquire();
    expect(limiter.canAcquire()).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(limiter.canAcquire()).toBe(true);
  });
});
