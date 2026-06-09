import type { AgentToolDefinition, ToolContext } from './types.js';
import { rateLimiters } from '../infra/rate-limiter.js';
import { withRetry } from '../infra/retry.js';
import { ValidationError } from '../infra/errors.js';

export async function executeTool(
  tool: AgentToolDefinition,
  input: unknown,
  context: ToolContext
): Promise<{ result?: unknown; error?: string; isError: boolean }> {
  const start = Date.now();

  // Validate input
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    const msg = `Invalid input for ${tool.name}: ${parsed.error.message}`;
    context.logger.warn({ tool: tool.name, error: msg }, 'Tool input validation failed');
    return { error: msg, isError: true };
  }

  const acquire = async () => {
    if (tool.rateLimitKey) {
      const limiter = rateLimiters[tool.rateLimitKey] ?? rateLimiters.default;
      await limiter.acquire();
    }
  };

  try {
    await acquire();
    const executeFn = () => tool.execute(parsed.data, context);
    const result = tool.retryable ? await withRetry(executeFn) : await executeFn();
    const latencyMs = Date.now() - start;
    const resultStr = JSON.stringify(result);
    context.logger.info(
      {
        tool: tool.name,
        input: JSON.stringify(parsed.data).slice(0, 200),
        output: resultStr.slice(0, 300),
        latencyMs,
      },
      'Tool executed'
    );
    return { result, isError: false };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    context.logger.error({ tool: tool.name, error: msg, latencyMs }, 'Tool execution failed');
    return { error: msg, isError: true };
  }
}
