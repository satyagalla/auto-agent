# Decision 07: Production Scaffolding

## The Challenge Requirement

> "The build includes observability, retries with exponential backoff, rate limiting on external calls, typed error handling, an evaluation harness, and a test suite covering both unit and integration paths."

Each must be visible in the code, not stubbed.

---

## 7.1: Observability

### What We Log (Every Loop Iteration)

- Step number
- Tool(s) called + inputs (sanitized — no API keys)
- Tool result (truncated to 500 chars if large)
- Tokens consumed (this call + cumulative)
- Latency (ms per tool call)
- Errors encountered
- Current plan state (compact: subtask statuses)

### Format & Output

- **Library:** pino (structured JSON, fast)
- **Format:** One JSON object per event (structured, machine-parseable)
- **Output in dev:** stdout, pretty-printed
- **Output in production:** JSONL file per session at `traces/{session_id}.jsonl`

### Log Levels

| Level | When Used |
|---|---|
| `info` | Tool calls, results, state changes, step transitions |
| `warn` | Retries triggered, stuck detection fired, budget >80% |
| `error` | Tool failures, API errors, unrecoverable issues |
| `debug` | Full tool results, full conversation (verbose, off by default) |

### Trace Structure

```json
{
  "timestamp": "2026-06-07T14:30:00.000Z",
  "session_id": "sess_abc123",
  "step": 12,
  "event": "tool_call",
  "tool": "web_search",
  "input": { "query": "nuclear fusion funding 2024", "type": "news" },
  "output_excerpt": "{ results: [{ title: 'DOE announces...', ... }] }",
  "tokens": { "this_call": 1523, "cumulative": 34500 },
  "latency_ms": 2340,
  "budget_remaining_pct": 72
}
```

---

## 7.2: Retries with Exponential Backoff

### What Gets Retried

| Condition | Retried? | Why |
|---|---|---|
| Network timeout | Yes | Transient |
| HTTP 429 (rate limit) | Yes | Transient — wait and retry |
| HTTP 500/502/503 | Yes | Server-side transient error |
| HTTP 404 | No | Permanent — resource doesn't exist |
| HTTP 403 | No | Permanent — access denied |
| HTTP 400 | No | Our bug — bad input |
| Tool logic error | No | Code issue, not network |

### Backoff Formula

```
delay = min(baseDelay * 2^attempt + jitter, maxDelay)

baseDelay: 1000ms
maxDelay: 30000ms
maxRetries: 3
jitter: random 0-500ms (prevents thundering herd)
```

Attempt sequence: ~1s, ~2.5s, ~5s, then throw.

### Implementation

Custom async wrapper function (~25 lines):

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number, baseDelay: number, maxDelay: number, retryOn: (error: Error) => boolean }
): Promise<T>
```

Wraps any async function. Returns result on success. Throws original error after max retries exhausted.

---

## 7.3: Rate Limiting

### Per-Service Limits

| Service | Limit | Notes |
|---|---|---|
| Tavily (search) | 20 rpm | Free tier |
| Jina Reader (fetch fallback) | 20 rpm | Free tier |
| Claude/Bedrock | Varies by model | Handled by retry on 429 |
| GitHub API | 60 req/hour unauthenticated | Very conservative |
| World Bank / FRED / OpenAlex | 10 rpm default | Safe conservative default |
| Wayback Machine | 15 rpm | Unofficial limit |

### Implementation

Custom token bucket rate limiter (~40 lines):

```typescript
class RateLimiter {
  constructor(maxRequests: number, windowMs: number)
  async acquire(): Promise<void>  // resolves immediately if under limit, delays if at limit
  getWaitTime(): number           // ms until next available slot
}
```

Each service gets its own `RateLimiter` instance. Before any external request, call `await limiter.acquire()`.

Usage:
```typescript
const tavilyLimiter = new RateLimiter(20, 60_000); // 20 per minute

async function searchWeb(query: string) {
  await tavilyLimiter.acquire();
  return await withRetry(() => tavily.search(query), retryConfig);
}
```

---

## 7.4: Typed Error Handling

### Error Hierarchy

```typescript
class AgentError extends Error {
  code: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

class NetworkError extends AgentError { /* transient, retryable */ }
class RateLimitError extends AgentError { /* transient, retryable after delay */ }
class ApiError extends AgentError { /* external service error */ }
class ToolExecutionError extends AgentError { /* tool logic failed */ }
class ValidationError extends AgentError { /* input schema mismatch */ }
class BudgetExhaustedError extends AgentError { /* token/step limit hit */ }
class ArtifactNotFoundError extends AgentError { /* referenced artifact missing */ }
```

### Handling Strategy

| Error Type | Recoverable | What Happens |
|---|---|---|
| NetworkError | Yes | Retry with backoff (invisible to model) |
| RateLimitError | Yes | Wait, then retry (invisible to model) |
| ApiError (5xx) | Yes | Retry with backoff |
| ApiError (4xx) | No | Surface to model as error tool result |
| ToolExecutionError | No | Surface to model as error tool result |
| ValidationError | No | Surface to model (it sent bad input) |
| BudgetExhaustedError | No | Trigger beast mode — force synthesis |
| ArtifactNotFoundError | No | Surface to model (reference stale artifact) |

### Key Principle

Transient errors → retried invisibly by infrastructure. Model never sees them.
Permanent errors → surfaced as tool result with `is_error: true`. Model adapts.

---

## 7.5: Configuration Management

### Environment Variables (.env)

```
# API Keys (secrets — never committed)
BEDROCK_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
TAVILY_API_KEY=...
FRED_API_KEY=...
GITHUB_TOKEN=...  # optional, for higher rate limits

# Runtime
LOG_LEVEL=info
NODE_ENV=development
```

### Application Config (config.ts)

```typescript
export const config = {
  model: "anthropic.claude-sonnet-4-20250514",
  maxSteps: 50,
  tokenBudget: 200_000,
  budgetReservePercent: 15,
  
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30_000,
  },
  
  rateLimits: {
    tavily: { maxRequests: 20, windowMs: 60_000 },
    jina: { maxRequests: 20, windowMs: 60_000 },
    github: { maxRequests: 60, windowMs: 3_600_000 },
    default: { maxRequests: 10, windowMs: 60_000 },
  },
  
  context: {
    maxConversationTokens: 100_000,
    findingsInjectionLimit: 50,
  },
  
  subagent: {
    maxSteps: 15,
    maxTokens: 50_000,
    tools: ["web_search", "web_fetch", "web_get_links", "source_fetch_pdf", "extract_section"],
  },
};
```

No hardcoded values in tool implementations. Everything flows from config.

---

## Summary

| Component | Implementation | Est. Lines |
|---|---|---|
| Observability | pino + JSONL per session | ~30 |
| Retries | Custom `withRetry` wrapper | ~25 |
| Rate limiting | Custom `RateLimiter` class | ~40 |
| Error types | Class hierarchy | ~60 |
| Config | .env + config.ts | ~40 |
| **Total** | | **~195** |

Small, focused, fully demonstrable infrastructure. Each component is its own module, testable independently.
