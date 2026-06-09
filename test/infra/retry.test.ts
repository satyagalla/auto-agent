import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/infra/retry.js';
import { NetworkError, ValidationError } from '../../src/infra/errors.js';

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10, maxDelay: 100 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on NetworkError and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new NetworkError('timeout'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1, maxDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on ValidationError', async () => {
    const fn = vi.fn().mockRejectedValue(new ValidationError('bad input'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1, maxDelay: 10 })).rejects.toThrow(ValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws last error', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkError('always fails'));
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 1, maxDelay: 10 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
