# Implementation Guide

This document contains step-by-step instructions for building the deep research agent. Follow in order — each step builds on the previous.

Read the decision documents (01-09) in this directory for architectural context. This guide tells you WHAT to build and HOW to structure it.

---

## Step 1: Project Initialization

### Create project structure

```
deep-research-agent/
├── src/
│   ├── index.ts
│   ├── agent/
│   ├── tools/
│   ├── infra/
│   ├── llm/
│   └── store/
├── test/
├── eval/
├── traces/
├── output/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### package.json

```json
{
  "name": "deep-research-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "eval": "tsx eval/runner.ts",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "latest",
    "zod": "^3.23",
    "pino": "^9",
    "pino-pretty": "^11",
    "cheerio": "^1.0",
    "mathjs": "^13",
    "compromise": "^14",
    "pdf-parse": "^1.1"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "tsx": "^4",
    "vitest": "^2",
    "@types/node": "^20"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
  },
});
```

### .env.example

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
TAVILY_API_KEY=
FRED_API_KEY=
LOG_LEVEL=info
```

### .gitignore

```
node_modules/
dist/
.env
traces/
output/
eval/results/
*.log
```

### Initialize

```bash
pnpm init
# Copy package.json contents above
pnpm install
git init
git add -A
git commit -m "init: project setup with TypeScript, Vitest, pino"
```

---

## Step 2: Infrastructure (`src/infra/`)

Build these modules first — everything else depends on them.

### `src/infra/errors.ts`

Define the error hierarchy:

```typescript
export class AgentError extends Error {
  code: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

export class NetworkError extends AgentError { /* recoverable: true */ }
export class RateLimitError extends AgentError { /* recoverable: true */ }
export class ApiError extends AgentError { /* recoverable depends on status */ }
export class ToolExecutionError extends AgentError { /* recoverable: false */ }
export class ValidationError extends AgentError { /* recoverable: false */ }
export class BudgetExhaustedError extends AgentError { /* recoverable: false */ }
export class ArtifactNotFoundError extends AgentError { /* recoverable: false */ }
```

Each class should:
- Set `code` to a unique string (e.g., "NETWORK_ERROR")
- Set `recoverable` appropriately
- Accept `context` object for debugging info
- Call `super(message)` properly

### `src/infra/logger.ts`

Set up pino with:
- JSON output in production (LOG_LEVEL from env)
- Pretty output in development (detect via NODE_ENV)
- Export a singleton logger instance
- Export a `createChildLogger(context)` for per-session/per-tool logging

### `src/infra/config.ts`

Load configuration from env + defaults:

```typescript
export const config = {
  aws: { region, accessKeyId, secretAccessKey },
  tavily: { apiKey },
  model: "anthropic.claude-sonnet-4-20250514",
  maxSteps: 50,
  tokenBudget: 200_000,
  budgetReservePercent: 15,
  retry: { maxRetries: 3, baseDelay: 1000, maxDelay: 30_000 },
  rateLimits: {
    tavily: { maxRequests: 20, windowMs: 60_000 },
    jina: { maxRequests: 20, windowMs: 60_000 },
    default: { maxRequests: 10, windowMs: 60_000 },
  },
  subagent: { maxSteps: 15 },
};
```

Validate that required env vars exist. Throw on missing API keys.

### `src/infra/retry.ts`

Implement `withRetry`:

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T>
```

- Retry on: NetworkError, RateLimitError, HTTP 429/500/502/503
- Don't retry on: ValidationError, ToolExecutionError, 400/403/404
- Exponential backoff: `min(baseDelay * 2^attempt + jitter, maxDelay)`
- Jitter: random 0-500ms
- After max retries exhausted: throw the last error

### `src/infra/rate-limiter.ts`

Implement token bucket rate limiter:

```typescript
export class RateLimiter {
  constructor(maxRequests: number, windowMs: number)
  async acquire(): Promise<void>  // blocks until slot available
  canAcquire(): boolean           // check without blocking
}
```

- Track timestamps of recent requests
- If at limit, calculate wait time and delay
- Clean up old timestamps outside the window

### `src/infra/budget.ts`

Track token and step budget:

```typescript
export class BudgetTracker {
  constructor(tokenBudget: number, maxSteps: number, reservePercent: number)
  recordTokens(input: number, output: number): void
  recordStep(): void
  get tokensSpent(): number
  get tokensRemaining(): number
  get stepsRemaining(): number
  get isExhausted(): boolean      // true when budget exceeded
  get shouldSynthesize(): boolean // true when only reserve remains
  getStatus(): BudgetStatus       // for session_check_budget tool
}
```

**Commit after Step 2:** `"infra: add error hierarchy, logger, config, retry, rate limiter, budget tracker"`

---

## Step 3: Stores (`src/store/`)

### `src/store/artifacts.ts`

In-memory + filesystem artifact store:

```typescript
export class ArtifactStore {
  write(content: string, metadata: { title?, source_url?, type? }): string  // returns artifact_id
  read(artifactId: string): { content, metadata }  // throws ArtifactNotFoundError
  readSection(artifactId: string, offset?: number, limit?: number): string
  list(type?: string): ArtifactMetadata[]
  getMetadata(artifactId: string): ArtifactMetadata
}
```

- Generate unique IDs (e.g., `art_${nanoid()}` or incrementing counter)
- Store content on filesystem under `traces/{session_id}/artifacts/`
- Keep metadata in memory for fast listing
- Throw ArtifactNotFoundError for missing IDs

### `src/store/knowledge.ts`

In-memory knowledge state:

```typescript
export class KnowledgeStore {
  addFinding(fact: string, sourceUrl: string, confidence: string, subtaskId?: string, tags?: string[]): string
  addSource(url: string, title: string, type: string, reliability?: string): string
  searchFindings(query?: string, tags?: string[], subtaskId?: string): Finding[]
  listSources(type?: string): Source[]
  noteContradiction(findingIdA: string, findingIdB: string, description: string): string
  getContradictions(): Contradiction[]
  getSummary(): KnowledgeSummary
  markOutdated(findingId: string, reason: string): void
  
  // For context injection
  getFindings(): Finding[]  // all findings, for injecting into system prompt
}
```

### `src/store/plan.ts`

In-memory plan state:

```typescript
export class PlanStore {
  create(question: string, subtasks: { description: string, priority?: string }[]): Plan
  updateStatus(subtaskId: string, status: string, summary?: string): Plan
  addSubtask(description: string, priority?: string): string
  removeSubtask(subtaskId: string, reason: string): void
  getStatus(): PlanStatus  // { plan, completed, remaining, blocked, progress_pct }
  
  // For context injection
  getPlanSummary(): string  // compact representation for system prompt
}
```

**Commit:** `"feat: add artifact, knowledge, and plan stores"`

---

## Step 4: LLM Provider (`src/llm/`)

### `src/llm/provider.ts`

Define the interface:

```typescript
export interface LLMMessage {
  role: "user" | "assistant";
  content: ContentBlock[];  // text blocks and tool_use/tool_result blocks
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: object;  // JSON Schema
}

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

export interface LLMProvider {
  chat(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options?: { maxTokens?: number }
  ): Promise<LLMResponse>;
}
```

### `src/llm/bedrock.ts`

Implement LLMProvider using AWS Bedrock:

- Use `@aws-sdk/client-bedrock-runtime` with `InvokeModelCommand` or the Converse API
- Send system prompt, messages, and tool definitions in Claude's format
- Parse response into our LLMResponse type
- Wrap errors: network issues → NetworkError, throttling → RateLimitError
- Apply retry via `withRetry` from infra
- Apply rate limiting via RateLimiter from infra

Important: Use the Bedrock **Converse API** (not raw InvokeModel) — it handles tool_use natively.

### `src/llm/prompts.ts`

System prompt templates:

```typescript
export function buildSystemPrompt(params: {
  planSummary: string;
  findingsList: string;
  budgetStatus: string;
  toolHint?: string;
}): string
```

The system prompt should include:
1. Agent identity: "You are a deep research agent. Your job is to research questions thoroughly and produce comprehensive reports."
2. Instructions: When to plan, when to delegate, when to synthesize
3. Current plan state (from PlanStore)
4. Current findings (from KnowledgeStore — compact list)
5. Budget status (tokens/steps remaining)
6. Tool selection guidance: "All tools are available. Namespace prefixes indicate tool purpose."
7. Termination guidance: "When you have sufficient findings across all planned subtasks, produce your final synthesis report directly (don't call any tools)."

Also export:
```typescript
export function buildSubagentPrompt(subtopic: string, parentQuestion: string, visitedUrls: string[]): string
export function buildBeastModePrompt(findings: Finding[]): string
```

**Commit:** `"feat: add LLM provider interface and Bedrock implementation"`

---

## Step 5: Tool System (`src/tools/`)

### `src/tools/types.ts`

Define the tool interface:

```typescript
import { z } from "zod";

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  namespace: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
  retryable?: boolean;  // should this tool retry on transient errors?
  rateLimitKey?: string; // which rate limiter to use (e.g., "tavily", "jina")
}

export interface ToolContext {
  artifactStore: ArtifactStore;
  knowledgeStore: KnowledgeStore;
  planStore: PlanStore;
  budgetTracker: BudgetTracker;
  logger: Logger;
  sessionId: string;
}
```

### `src/tools/registry.ts`

Tool registry:

```typescript
export class ToolRegistry {
  register(tool: ToolDefinition): void
  get(name: string): ToolDefinition | undefined
  getAll(): ToolDefinition[]
  getByNamespace(namespace: string): ToolDefinition[]
  toLLMTools(): LLMToolDefinition[]  // Convert to Claude's tool format
}
```

`toLLMTools()` converts each registered tool into the format Claude expects:
```json
{ "name": "web_search", "description": "...", "input_schema": { "type": "object", "properties": {...} } }
```

Use Zod's `.describe()` and `zodToJsonSchema()` (or manual conversion) to produce JSON Schema from Zod schemas.

### `src/tools/executor.ts`

Common tool execution wrapper:

```typescript
export async function executeTool(
  tool: ToolDefinition,
  input: unknown,
  context: ToolContext
): Promise<{ result?: any; error?: string; isError: boolean }>
```

This function:
1. Validates input against `tool.inputSchema` (Zod parse). If fails → return error result.
2. If `tool.rateLimitKey` → acquire from the appropriate RateLimiter.
3. If `tool.retryable` → wrap in `withRetry`.
4. Execute `tool.execute(validatedInput, context)`.
5. Log: tool name, input (truncated), output (truncated), latency.
6. On success: return `{ result, isError: false }`.
7. On permanent error: return `{ error: message, isError: true }`.
8. Transient errors are handled by retry (transparent). If retries exhausted, surface as error.

### Tool Implementation Files

Each namespace is ONE file exporting an array of ToolDefinition objects.

#### `src/tools/web.ts` (4 tools)

**web_search:**
- Input: `{ query: string, maxResults?: number, type?: "general"|"academic"|"news", recency?: { daysBack: number } }`
- Output: `{ results: [{ title, url, snippet, publishedDate?, authors?, year? }] }`
- Implementation: Call Tavily API. Map response to output schema. Set `retryable: true`, `rateLimitKey: "tavily"`.
- If `type === "academic"`: add "scholarly" to query or use Tavily's search depth parameter
- If `recency`: add Tavily's `days` parameter

**web_fetch:**
- Input: `{ url: string }`
- Output: `{ artifact_id, title, byline?, wordCount, excerpt }`
- Implementation: 
  1. fetch(url) + cheerio to extract article text (strip nav, ads, scripts, keep article body)
  2. If fetch fails or content is empty/too short → fallback to Jina Reader (`https://r.jina.ai/${url}`)
  3. Store extracted text in ArtifactStore
  4. Return artifact_id + metadata + first 200 chars as excerpt
- Set `retryable: true`, `rateLimitKey: "default"`

**web_fetch_batch:**
- Input: `{ urls: string[] }`
- Output: `{ results: [{ url, artifact_id?, title?, error? }] }`
- Implementation: Call web_fetch for each URL using Promise.allSettled. Respect rate limits.

**web_get_links:**
- Input: `{ url: string, filter?: string }`
- Output: `{ links: [{ text, url, context }] }`
- Implementation: fetch + cheerio, extract all `<a>` tags. If filter provided, only return links matching filter string. `context` = surrounding text of the link.

#### `src/tools/source.ts` (5 tools)

**source_fetch_pdf:**
- Input: `{ url: string }`
- Output: `{ artifact_id, title?, pageCount, excerpt }`
- Implementation: fetch the PDF as buffer → pdf-parse to extract text → store in ArtifactStore.

**source_fetch_arxiv:**
- Input: `{ arxiv_id: string }`
- Output: `{ artifact_id, title, authors[], abstract, year }`
- Implementation: Fetch `https://export.arxiv.org/api/query?id_list={arxiv_id}` (Atom XML). Parse XML for title, authors, abstract, published date. Fetch PDF link and extract text. Store in artifact.

**source_fetch_wikipedia:**
- Input: `{ topic: string }`
- Output: `{ artifact_id, title, summary, sections[], references[] }`
- Implementation: Fetch `https://en.wikipedia.org/api/rest_v1/page/summary/{topic}` for summary. Fetch `/page/html/{topic}` for full content. Parse sections. Store in artifact.

**source_fetch_youtube_transcript:**
- Input: `{ videoId: string }`
- Output: `{ artifact_id, title, duration, excerpt }`
- Implementation: Use youtube-transcript package or fetch from YouTube's timedtext API. Store transcript in artifact.
- Note: If this is complex to implement, stub it (return a ToolExecutionError saying "YouTube transcript unavailable") and implement later.

**source_parse_csv:**
- Input: `{ url: string }`
- Output: `{ artifact_id, headers[], rowCount, sample[] }`
- Implementation: fetch URL → parse CSV text → extract headers and first 10 rows as sample. Store full CSV in artifact.

#### `src/tools/extract.ts` (4 tools)

**extract_entities:**
- Input: `{ artifact_id: string }`
- Output: `{ entities: [{ name, type, frequency, context }] }`
- Implementation: Read artifact content → run compromise.js NLP → extract people, places, organizations → count frequency → include surrounding sentence as context.

**extract_statistics:**
- Input: `{ artifact_id: string }`
- Output: `{ statistics: [{ value, unit?, metric, context }] }`
- Implementation: Read artifact → regex patterns for: `$X billion/million`, `X%`, `X,XXX`, numbers with context. Return the number, detected unit, and surrounding sentence.

**extract_references:**
- Input: `{ artifact_id: string }`
- Output: `{ references: [{ title?, authors?, url?, year?, doi? }] }`
- Implementation: Read artifact → regex for DOIs (`10.XXXX/...`), URLs (`https://...`), citation patterns (`Author (Year)`), numbered references `[1] ...`.

**extract_section:**
- Input: `{ artifact_id: string, section: string }`
- Output: `{ content, startOffset, wordCount }`
- Implementation: Read artifact → find heading matching `section` (case-insensitive) → return text until next heading. If no heading match, search for paragraph containing the keyword.

#### `src/tools/data.ts` (5 tools)

**data_calculate:**
- Input: `{ expression: string }`
- Output: `{ result, formatted }`
- Implementation: Use mathjs `evaluate(expression)`. Format result with appropriate precision. Catch errors → ToolExecutionError.

**data_aggregate:**
- Input: `{ values: number[], operations?: string[] }`
- Output: `{ results: { sum, average, median, stddev, min, max, count } }`
- Implementation: Pure math. Compute all stats. If `operations` specified, only return those.

**data_convert_units:**
- Input: `{ value: number, from: string, to: string }`
- Output: `{ result, formatted }`
- Implementation: For common units (km/mi, kg/lb, C/F, etc.) use a conversion table. For currency, could use a free exchange rate API or hardcode approximate rates. Keep it simple.

**data_inflation_adjust:**
- Input: `{ amount: number, fromYear: number, toYear: number }`
- Output: `{ adjusted, cumulativeInflation, formatted }`
- Implementation: Bundled CPI data (hardcode a table of US CPI values by year from BLS). Calculate: adjusted = amount * (CPI[toYear] / CPI[fromYear]).

**data_build_timeline:**
- Input: `{ events: [{ date: string, label: string, value?: number }] }`
- Output: `{ timeline: [{ date, label, daysSincePrevious? }], totalSpan }`
- Implementation: Parse dates → sort chronologically → compute days between consecutive events → compute total span.

#### `src/tools/code.ts` (3 tools)

**code_execute_js:**
- Input: `{ code: string, artifact_ids?: string[] }`
- Output: `{ stdout, result?, error? }`
- Implementation: Use Node's `vm` module. Create a script context with: console.log captured to stdout, artifact contents available as variables. Set timeout (5 seconds). Run code. Return stdout + last expression result.
- Security: Use `vm.createContext` with limited globals (no fs, no require, no process).

**code_regex_extract:**
- Input: `{ artifact_id: string, pattern: string, flags?: string }`
- Output: `{ matches[], groups?, matchCount }`
- Implementation: Read artifact → new RegExp(pattern, flags) → matchAll → return matches and capture groups.

**code_json_query:**
- Input: `{ artifact_id: string, path: string }`
- Output: `{ result }`
- Implementation: Read artifact (must be JSON) → parse → navigate path (simple dot-notation path like "data.results[0].name"). Don't need full JSONPath library — implement basic path traversal.

#### `src/tools/datasource.ts` (6 tools)

**datasource_query_wikidata:**
- Input: `{ query: string, entity_type?: string }`
- Output: `{ results: [{ entity, property, value, qualifiers? }] }`
- Implementation: Construct SPARQL query → POST to `https://query.wikidata.org/sparql` → parse JSON results.
- Note: SPARQL construction is complex. Start simple: search for entity by name, return properties. Can be enhanced later.

**datasource_query_world_bank:**
- Input: `{ indicator: string, country?: string, yearRange?: { from, to } }`
- Output: `{ data: [{ country, year, value }], metadata: { indicator_name, source } }`
- Implementation: Fetch `https://api.worldbank.org/v2/country/{country}/indicator/{indicator}?date={from}:{to}&format=json`. Parse response.

**datasource_query_fred:**
- Input: `{ series_id: string, startDate?, endDate? }`
- Output: `{ data: [{ date, value }], metadata: { title, units, frequency } }`
- Implementation: Fetch `https://api.stlouisfed.org/fred/series/observations?series_id={id}&api_key={key}&file_type=json`. Requires FRED API key.
- If no FRED API key configured, return ToolExecutionError saying "FRED API key not configured."

**datasource_query_github:**
- Input: `{ owner: string, repo: string }`
- Output: `{ stars, forks, openIssues, language, contributors?, createdAt }`
- Implementation: Fetch `https://api.github.com/repos/{owner}/{repo}`. Parse response. Optional: fetch contributors count from `/contributors?per_page=1` header.

**datasource_query_openalex:**
- Input: `{ query: string, type?: "works"|"authors"|"institutions", sort? }`
- Output: `{ results: [{ title?, author?, citations?, year?, doi? }], totalCount }`
- Implementation: Fetch `https://api.openalex.org/{type}?search={query}&sort={sort}`. Parse response. Free, no API key needed.

**datasource_query_countries:**
- Input: `{ country: string }`
- Output: `{ name, population, area, capital, region, currencies, languages, borders }`
- Implementation: Fetch `https://restcountries.com/v3.1/name/{country}`. Parse first result.

#### `src/tools/verify.ts` (4 tools)

**verify_cross_reference:**
- Input: `{ claim: string, exclude_sources?: string[] }`
- Output: `{ corroborations: [{ source_url, excerpt }], count }`
- Implementation: Use web_search internally (call Tavily with claim as query). For each result, check token overlap between claim and snippet. If overlap > threshold and URL not in exclude_sources, count as corroboration.

**verify_wayback_lookup:**
- Input: `{ url: string, date?: string }`
- Output: `{ available, closest_snapshot?: { url, timestamp }, archived_count? }`
- Implementation: Fetch `https://archive.org/wayback/available?url={url}&timestamp={date}`. Parse response.

**verify_check_retraction:**
- Input: `{ title?: string, doi?: string }`
- Output: `{ retracted, correction?, source }`
- Implementation: If DOI provided, check CrossRef API (`https://api.crossref.org/works/{doi}`). Look for "update-to" field indicating retraction. If only title, search CrossRef by title.
- If API unavailable or no result, return `{ retracted: false, source: "crossref (no data found)" }`.

**verify_domain_info:**
- Input: `{ domain: string }`
- Output: `{ tld_type, registered_date?, country?, is_government, is_academic }`
- Implementation: Parse TLD from domain. Check against known lists: `.gov` → government, `.edu`/`.ac.uk` → academic, etc. For registration date, could use WHOIS but that's complex — simplify to just TLD classification for now.

#### `src/tools/planning.ts` (5 tools)

**planning_create:**
- Input: `{ question: string, subtasks: [{ description, priority? }], replaces_plan_id? }`
- Output: `{ plan_id, subtasks: [{ id, description, status, priority }] }`
- Implementation: Call `planStore.create(...)`. Return the created plan.

**planning_update_status:**
- Input: `{ subtask_id: string, status: "done"|"in_progress"|"blocked", summary? }`
- Output: `{ updated: true, plan_summary }`
- Implementation: Call `planStore.updateStatus(...)`. Return updated plan summary.

**planning_add_subtask:**
- Input: `{ description: string, priority?: string }`
- Output: `{ subtask_id, plan_summary }`
- Implementation: Call `planStore.addSubtask(...)`.

**planning_remove_subtask:**
- Input: `{ subtask_id: string, reason: string }`
- Output: `{ removed: true, plan_summary }`
- Implementation: Call `planStore.removeSubtask(...)`. Log the reason.

**planning_get_status:**
- Input: `{}`
- Output: `{ plan, completed, remaining, blocked, progress_pct }`
- Implementation: Call `planStore.getStatus()`.

#### `src/tools/knowledge.ts` (7 tools)

All thin wrappers around KnowledgeStore methods:

- **knowledge_add_finding** → `knowledgeStore.addFinding(...)`
- **knowledge_add_source** → `knowledgeStore.addSource(...)`
- **knowledge_search_findings** → `knowledgeStore.searchFindings(...)`
- **knowledge_list_sources** → `knowledgeStore.listSources(...)`
- **knowledge_note_contradiction** → `knowledgeStore.noteContradiction(...)`
- **knowledge_get_contradictions** → `knowledgeStore.getContradictions()`
- **knowledge_get_summary** → `knowledgeStore.getSummary()`

Each still needs proper Zod schemas for input/output.

#### `src/tools/session.ts` (3 tools)

**session_check_budget:**
- Input: `{}`
- Output: `{ tokens_spent, tokens_remaining, steps_taken, steps_remaining, budget_pct_used }`
- Implementation: Read from BudgetTracker.

**session_list_artifacts:**
- Input: `{ type?: string }`
- Output: `{ artifacts: [{ id, title, type, wordCount, source_url }] }`
- Implementation: Call `artifactStore.list(type)`.

**session_get_artifact_content:**
- Input: `{ artifact_id: string, offset?: number, limit?: number }`
- Output: `{ content, wordCount, truncated }`
- Implementation: Call `artifactStore.readSection(...)`. If limit specified and content longer, set truncated=true.

#### `src/tools/output.ts` (3 tools)

**output_write_report:**
- Input: `{ filename: string, content: string, title: string }`
- Output: `{ path, wordCount }`
- Implementation: Write to `output/{filename}.md` with title as H1 header. Return path and word count.

**output_export_findings_json:**
- Input: `{ filename?: string }`
- Output: `{ path, finding_count, source_count }`
- Implementation: Get all findings + sources from KnowledgeStore. Serialize to JSON. Write to `output/{filename || "findings"}.json`.

**output_create_bibliography:**
- Input: `{ style?: "apa"|"mla"|"chicago" }`
- Output: `{ bibliography, source_count }`
- Implementation: Get all sources from KnowledgeStore. Format each based on style (APA default). Simple template-based formatting.

#### `src/tools/agent-tools.ts` (2 tools)

**agent_delegate_research:**
- Input: `{ subtopic, parent_question, visited_urls?, depth?, max_steps? }`
- Output: `{ findings: [{ fact, source, confidence }], sources: [{ url, title }], gaps[] }`
- Implementation: Call `spawnSubagent()` from `src/agent/subagent.ts`. See Step 6.

**agent_verify_claim:**
- Input: `{ claim: string, context? }`
- Output: `{ verified, evidence_for[], evidence_against[], confidence }`
- Implementation: Call `spawnSubagent()` with a verification-focused prompt and limited tools (web_search, web_fetch, verify_cross_reference).

**Commit after all tools:** `"feat: add 51 tools across 10 namespaces"`

(Or commit per namespace as you build them.)

---

## Step 6: Agent Core (`src/agent/`)

### `src/agent/loop.ts`

The main execution loop:

```typescript
export async function runAgent(question: string): Promise<string> {
  // 1. Initialize: create session, stores, budget tracker, logger
  // 2. Build initial messages: [{ role: "user", content: question }]
  // 3. Loop:
  //    while (true):
  //      a. Build system prompt (inject plan, findings, budget)
  //      b. Get all tool definitions from registry
  //      c. Call LLM provider with system prompt + messages + tools
  //      d. Record tokens in budget tracker
  //      e. If stop_reason === "end_turn" → break (model is done)
  //      f. If budget.isExhausted → beast mode (one final synthesis call) → break
  //      g. For each tool_use block in response:
  //           - Execute tool via executor
  //           - Collect results
  //      h. Append assistant message + tool results to messages
  //      i. Record step in budget
  //      j. Stuck detection: check for 3x duplicate tool+input
  //      k. If stuck → inject guidance message
  //      l. Context management: if messages > threshold, drop old tool results
  //         (keep findings in system prompt, so nothing critical is lost)
  //    end while
  // 4. Return the final assistant text as the research report
}
```

Key details:
- Messages follow Claude's format: assistant messages with tool_use blocks, user messages with tool_result blocks
- When model returns multiple tool_use blocks, execute ALL and return all results in one user message
- Beast mode: if budget hits reserve threshold, make one final call with buildBeastModePrompt() and NO tools available (forces text output)
- Stuck detection: keep array of last 5 tool calls `[{name, input}]`. If same name+input appears 3 times, inject guidance.

### `src/agent/context.ts`

Context assembly:

```typescript
export function buildMessages(
  conversationHistory: LLMMessage[],
  maxTokens?: number
): LLMMessage[]
```

- Return full conversation if under threshold
- If over threshold: keep last 8 messages in full, summarize/drop older ones
- "Dropping" means replacing old tool_result content with "[Result processed — findings recorded]"
- Findings are safe to drop from messages because they live in the system prompt (injected via prompts.ts)

Also:
```typescript
export function formatToolResult(toolName: string, result: any, isError: boolean): ContentBlock
```

### `src/agent/subagent.ts`

Subagent spawning:

```typescript
export async function spawnSubagent(params: {
  subtopic: string;
  parentQuestion: string;
  visitedUrls?: string[];
  depth?: "standard" | "thorough";
  maxSteps?: number;
  mode: "research" | "verify";
}): Promise<SubagentResult>
```

Implementation:
1. Build subagent system prompt using `buildSubagentPrompt()` from prompts.ts
2. Select scoped tools from registry (only web, source, extract namespaces for research; web + verify for verification)
3. Create fresh messages: [{ role: "user", content: focused prompt }]
4. Run a mini execution loop (same logic as main loop but with scoped tools and lower budget)
5. Extract structured result from subagent's final response
6. Parse into SubagentResult type: `{ findings[], sources[], gaps[] }`
7. Return to parent

The subagent has its own BudgetTracker (limited to `config.subagent.maxSteps`).

**Commit:** `"feat: add agent execution loop, context management, and subagent spawning"`

---

## Step 7: Entry Point (`src/index.ts`)

Simple CLI entry:

```typescript
import { runAgent } from "./agent/loop.js";

const question = process.argv.slice(2).join(" ");

if (!question) {
  console.error("Usage: pnpm dev \"your research question\"");
  process.exit(1);
}

console.log(`\nResearching: ${question}\n`);

const report = await runAgent(question);

console.log("\n--- RESEARCH REPORT ---\n");
console.log(report);
```

**Commit:** `"feat: add CLI entry point"`

---

## Step 8: Register All Tools

Create a file that imports all tool files and registers them with the registry:

```typescript
// src/tools/register-all.ts
import { registry } from "./registry.js";
import { webTools } from "./web.js";
import { sourceTools } from "./source.js";
// ... etc

export function registerAllTools() {
  [...webTools, ...sourceTools, ...extractTools, ...dataTools, 
   ...codeTools, ...datasourceTools, ...verifyTools, ...planningTools,
   ...knowledgeTools, ...sessionTools, ...outputTools, ...agentTools
  ].forEach(tool => registry.register(tool));
}
```

Call `registerAllTools()` at the start of `runAgent()`.

---

## Step 9: First Working Run

At this point:
1. Run `pnpm dev "What is nuclear fusion and what are the current approaches?"`
2. Verify: agent creates a plan, searches, fetches pages, records findings, produces a report
3. Check traces/ for JSONL log
4. Check output/ for the report

Fix bugs until it produces a real report. This is the critical milestone.

**Commit:** `"feat: first working end-to-end research run"`

---

## Step 10: Tests (Day 5)

See `plans/08-testing-and-evaluation.md` for full details. Build:
- 7 unit test files (19 tests)
- 5 integration test files (5 tests)
- Eval harness with 2-3 cases

**Commit:** `"test: add unit and integration tests"` then `"test: add evaluation harness"`

---

## Step 11: Polish (Day 5)

- CLI progress display (if time permits)
- MEMO.md
- README.md
- Clean up commit history
- Record video

---

## Implementation Priority (If Running Out of Time)

If you can't finish everything, prioritize in this order:

1. Infrastructure (retry, rate limit, errors, logger) — required for challenge
2. Stores (artifact, knowledge, plan) — required for tools to work
3. LLM provider + prompts — required for agent to think
4. Core tools (web_search, web_fetch, planning_*, knowledge_*, session_check_budget, output_write_report) — minimum viable agent
5. Agent loop — makes it all work end-to-end
6. Remaining tools — expand to 51
7. Subagent — required for challenge
8. Tests — required for challenge
9. Eval harness — required for challenge
10. CLI display — nice to have

Items 1-5 give you a working agent (~15 tools). Items 6-9 satisfy all challenge requirements. Item 10 is polish.
