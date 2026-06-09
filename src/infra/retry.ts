import { AgentError, NetworkError, RateLimitError, ApiError } from './errors.js';
import { config } from './config.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RateLimitError || error instanceof NetworkError) return true;
  if (error instanceof ApiError && error.status >= 500) return true;
  if (error instanceof AgentError) return error.recoverable;
  // Treat fetch/network errors as retryable
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  return false;
}

function getRetryDelay(attempt: number, error: unknown, opts: RetryOptions): number {
  if (error instanceof RateLimitError && error.retryAfterMs) {
    return Math.min(error.retryAfterMs, opts.maxDelay);
  }
  const jitter = Math.random() * 500;
  return Math.min(opts.baseDelay * Math.pow(2, attempt) + jitter, opts.maxDelay);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts: RetryOptions = {
    maxRetries: options?.maxRetries ?? config.retry.maxRetries,
    baseDelay: options?.baseDelay ?? config.retry.baseDelay,
    maxDelay: options?.maxDelay ?? config.retry.maxDelay,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === opts.maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt, error, opts);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
