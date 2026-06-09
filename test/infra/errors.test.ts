import { describe, it, expect } from 'vitest';
import { AgentError, NetworkError, RateLimitError, ApiError, ToolExecutionError, ValidationError, BudgetExhaustedError, ArtifactNotFoundError } from '../../src/infra/errors.js';

describe('Error hierarchy', () => {
  it('AgentError has code, recoverable, context', () => {
    const err = new NetworkError('timeout', { url: 'https://example.com' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.recoverable).toBe(true);
    expect(err.context?.url).toBe('https://example.com');
  });

  it('RateLimitError is recoverable with retryAfterMs', () => {
    const err = new RateLimitError('429', 5000);
    expect(err.recoverable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it('ApiError 4xx is not recoverable', () => {
    const err = new ApiError('Not Found', 404);
    expect(err.recoverable).toBe(false);
    expect(err.status).toBe(404);
  });

  it('ApiError 5xx is recoverable', () => {
    const err = new ApiError('Server Error', 500);
    expect(err.recoverable).toBe(true);
  });

  it('ToolExecutionError is not recoverable', () => {
    const err = new ToolExecutionError('script failed');
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('TOOL_EXECUTION_ERROR');
  });

  it('ArtifactNotFoundError includes artifact ID', () => {
    const err = new ArtifactNotFoundError('art_123');
    expect(err.message).toContain('art_123');
    expect(err.recoverable).toBe(false);
  });

  it('BudgetExhaustedError is not recoverable', () => {
    const err = new BudgetExhaustedError('out of tokens');
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('BUDGET_EXHAUSTED');
  });
});
