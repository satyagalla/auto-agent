# Decision 05: External Dependencies

## The Problem

The agent needs external services (LLM, search, web fetching) and libraries (validation, logging, testing). Each choice affects cost, reliability, development speed, and what's possible in 5 days.

---

## Architecture Context: Model vs Harness Split

```
Model (Claude via Bedrock) = WHAT to do
  - Decides which tools to call
  - Decides search queries, what to extract, when to delegate
  - Judges when research is complete
  - Synthesizes findings into report

Harness (our code) = HOW to do it
  - Runs the execution loop
  - Executes tool calls (hits external APIs)
  - Retries, rate limits, logs
  - Manages context and budget
  - Spawns subagent API calls
```

The model never sees infrastructure concerns. Our harness handles all of it.

---

## Decisions

### 5.1: LLM — Claude via AWS Bedrock

**Decision: Claude Sonnet via Bedrock for all calls.**

- Fast (~2-5s per response)
- Cost-effective (~$3/M input, $15/M output)
- Good enough for tool selection, reasoning, and synthesis
- Single model simplifies debugging and implementation
- Already have Bedrock API keys

Why not multi-model:
- Adds complexity (model routing logic, different response characteristics)
- Sonnet is good enough for a 5-day build
- Can upgrade to Opus for synthesis later if quality is insufficient

Why not Haiku for subagents:
- Subagents need good reasoning to find relevant info and judge quality
- Cost savings are marginal (subagents make few calls each)
- Debugging is simpler with one model

### 5.2: Web Search — Tavily

**Decision: Tavily as primary search API.**

- Built specifically for AI agents
- Returns: titles, URLs, snippets, AND optionally extracted page content
- Free tier: 1000 searches/month (sufficient for development)
- Simple API: one endpoint, one API key
- Signup: tavily.com, instant

Why Tavily over alternatives:
- vs Serper: Tavily returns page content directly (can skip separate fetch step for some cases). Serper only returns Google snippets.
- vs Brave: Similar quality, but Tavily's agent-focused design returns cleaner structured data.
- vs SearXNG: Self-hosting takes 30+ min setup, unreliable, not worth it on deadline.

Fallback consideration: If Tavily results are insufficient for a query, the agent can use `web_fetch` on specific URLs it discovers. No second search API needed initially.

### 5.3: Web Fetching — fetch + Cheerio (primary) + Jina Reader (fallback)

**Decision: Two-tier fetching approach.**

**Primary — Built-in fetch + Cheerio:**
- Free, fast (< 1s per page)
- Cheerio parses HTML, extracts article text (strips nav, ads, scripts)
- Handles 80% of pages (articles, blogs, news, documentation)
- No external dependency for the common case

**Fallback — Jina Reader API:**
- URL format: `https://r.jina.ai/{url}` (no API key needed for free tier)
- Free: 1000 pages/day, rate limited to 20 rpm
- Handles JS-rendered pages, returns clean markdown
- Used when primary fetch fails (403, empty content, JS-required)

Why not Puppeteer/Playwright:
- 200MB+ install, slow (2-10s/page), memory-hungry
- Overkill for research pages (mostly articles, not SPAs)
- Too heavy for 5-day timeline

Why not Firecrawl:
- Lower free tier (500/month)
- Another API key to manage
- Jina Reader is simpler (just a URL prefix) and more generous free tier

### 5.4: Libraries

| Library | Purpose | Why This One |
|---|---|---|
| **Zod** | Schema definition + runtime validation | Define tool schemas once → get TypeScript types + validation. Industry standard. |
| **pino** | Structured JSON logging | Fast, minimal, production-grade. Satisfies observability requirement. |
| **Vitest** | Testing framework | Fast, native TypeScript, Jest-compatible API. |
| **Built-in fetch** | HTTP client | Standard in Node.js. No reason for axios. |
| **@anthropic-ai/bedrock-sdk** | Claude via Bedrock | Official SDK for Bedrock access. |

### 5.5: Retry & Rate Limiting — Custom Implementation

**Decision: Write our own.**

Retry with exponential backoff:
- Simple: ~20 lines of code
- Retry on: network errors, 429 (rate limit), 500/502/503 (server errors)
- Backoff: 1s, 2s, 4s, 8s (exponential with jitter)
- Max retries: 3

Rate limiting:
- Simple token bucket or sliding window: ~30 lines
- Per-service limits (e.g., Tavily: 20 rpm, Jina: 20 rpm)
- Queue requests when limit is hit

Why custom over p-retry/p-limit/bottleneck:
- The code is trivial (< 50 lines total)
- Demonstrates understanding to evaluators ("production scaffolding" requirement)
- No dependency for something this simple
- Full control over behavior

### 5.6: Storage — In-Memory + Filesystem Output

**Decision: No database.**

- Session state (findings, plan, conversation) lives in memory during execution
- Final report written to filesystem (markdown file)
- Execution trace/logs written to filesystem (JSON lines)
- Nothing persists between sessions (fire-and-forget design)

Why not SQLite:
- No cross-session queries needed
- Agent runs once, produces output, done
- Adds complexity for zero benefit in our use case

---

## Full Dependency List

### External Services (Need API Keys)

| Service | Purpose | Free Tier | Key Setup |
|---|---|---|---|
| AWS Bedrock (Claude) | LLM reasoning | Pay per token | Already have |
| Tavily | Web search | 1000 searches/month | Need to sign up |
| Jina Reader | Fallback page fetching | 1000 pages/day | No key needed |

### npm Packages

| Package | Purpose | Size |
|---|---|---|
| @anthropic-ai/bedrock-sdk | Claude API via Bedrock | - |
| zod | Schema validation + types | ~50kb |
| pino | Structured logging | ~30kb |
| cheerio | HTML parsing | ~200kb |
| vitest | Testing (dev dependency) | - |
| typescript | Type checking (dev dependency) | - |
| tsx | Run TS directly in dev (dev dependency) | - |

### No External Dependencies For

- Retry logic (custom)
- Rate limiting (custom)
- HTTP fetching (built-in fetch)
- State management (in-memory objects)
- Configuration (env vars + simple config file)

---

## Cost Estimate (Per Research Session)

Assuming a 30-step research session:

| Component | Usage | Cost |
|---|---|---|
| Claude Sonnet (Bedrock) | ~100k input + 20k output tokens per session | ~$0.60 |
| Tavily search | ~5-10 searches | Free tier |
| Jina Reader | ~3-5 pages | Free tier |
| fetch + Cheerio | ~10-15 pages | Free |

**Estimated cost per research run: ~$0.50-$1.00**

Development/testing (50+ runs): ~$25-50 total. Very manageable.

---

## Action Items

- [ ] Sign up for Tavily API key (tavily.com)
- [ ] Verify Bedrock access to Claude Sonnet model
- [ ] No other signups needed (Jina Reader is keyless, everything else is local)
