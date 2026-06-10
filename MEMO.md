# Deep Research Agent — Engineering Memo

## What I Built

An autonomous research agent that takes any natural language question and produces a comprehensive, cited research report. The agent plans its own approach, searches the web, reads sources, delegates subquestions to child agents, computes over data, and synthesizes findings — all driven by the model with no hand-routing in the code.

The core architecture is a budget-bounded execution loop where Claude drives every decision. It selects from a registry of 51 tools, builds and revises its own research plan, records findings as it works, and either terminates naturally when it judges the research complete or falls back to forced synthesis when the token budget runs low. The infrastructure's job is to make that loop reliable and cheap — not to constrain what the model does inside it.

**51 tools across 10 namespaces:**

| Namespace | Purpose | Tools |
|-----------|---------|-------|
| `web_*` | Discovery and retrieval | search, fetch, batch fetch, link extraction |
| `source_*` | Multi-format ingestion | PDF, arXiv, Wikipedia, YouTube transcripts, CSV |
| `extract_*` | Deterministic extraction | entities (NLP), statistics (regex), references, sections |
| `data_*` | Computation | math eval, aggregation, unit conversion, inflation adjustment, timelines |
| `code_*` | Sandbox execution | JavaScript, regex, JSONPath queries |
| `datasource_*` | Structured APIs | World Bank, FRED, Wikidata, GitHub, OpenAlex, REST Countries |
| `verify_*` | Fact-checking | cross-reference, Wayback Machine, retraction checks, domain info |
| `planning_*` | Research planning | create, update, add/remove subtasks, status |
| `knowledge_*` | Findings store | add finding, search, list sources, contradictions, summary |
| `output_*` | Report generation | markdown report, JSON export, bibliography |

**The artifact system** keeps context from bloating. Tools that fetch content — web pages, PDFs, transcripts — write to disk and return a pointer (`artifact_id`) with metadata and a short excerpt. The model never sees 3,000-token page bodies in the conversation; downstream tools like `extract_section` or `code_json_query` read from disk directly. This decouples content size from context cost.

**Subagent orchestration** follows the agent-as-tool pattern: `agent_delegate_research` is a tool whose implementation spins up a fresh Claude API call with isolated context and a scoped tool set (web/source/extract only). From the parent's perspective it looks like a slow tool call. The child returns `{ findings, sources, gaps }` — structured data that merges into the parent's knowledge store, not a free-text blob. Subagent logs are routed into the parent's session trace file, so a single `traces/<sessionId>/run.log` captures the full execution including delegated work. Because delegation is a tool like any other, Claude can issue multiple delegation calls in one turn and they run in parallel through the same concurrent execution infrastructure that handles all tool calls.

**KV-cache-aligned context management** went through two iterations. The first pass added Bedrock prompt caching for the static system prompt and tool schemas — straightforward and immediately effective. Running a session, I spotted a problem in traces: `cacheReadTokens` was stuck at ~4,600 across 14 steps while `cacheWriteTokens` climbed to 35K. The dynamic section of the system prompt (plan summary, findings list, budget status) was mutating every turn and invalidating the prefix cache key, meaning cache writes were paid on every step but never read. The fix was to make the system prompt fully static and move plan/findings state into conversation history where they belong — tools already write this information as tool results, the system prompt was just redundant. Added explicit `cachePoint` markers on the second-to-last user message for message-level caching, and replaced the fixed-window pruning strategy with token-threshold compaction (compact only when approaching 60% of the 200K context window). The result: three cache points per call (static system, tools, conversation prefix), message history stays immutable between turns so prefix matches hold, and compaction only fires when actually needed rather than on every session.

**Production scaffolding** that's in the code, not stubs: typed error hierarchy (`AgentError`, `ToolExecutionError`, `ApiError`, `NetworkError`, `RateLimitError`) with retry behavior keyed per error type; per-service rate limiters (Tavily, Jina, GitHub, default) with token-bucket semantics; structured pino logging with session IDs, step numbers, token counts, and tool call traces; Zod schemas for every tool's input and output; budget tracking that reserves 15% of the token budget for the final synthesis call so the agent always produces output even when cut short; and an evaluation harness for measuring report quality across a question bank.

---

## What I Cut and Why

**Multi-session memory** — each research session is stateless; findings don't persist across runs. Deliberate scope call. The artifact store and knowledge store are session-scoped because the primary use case is single-shot research. Persistence would require a session registry, artifact addressing by content hash, and de-duplication of findings — sensible follow-on work, but it doesn't change the architectural story.

**Semantic tool retrieval** — I evaluated embedding tool descriptions and retrieving the top-K most relevant tools per step (how systems handle 200+ tools). At 51 tools it's overkill: the embedding infrastructure adds latency and a black-box selection layer that's hard to debug when the agent picks wrong. Namespace prefixing and description quality carry the load up to around 80 tools. Documented as a deliberate decision, not an oversight.

**Subagent recursion** — Subagents cannot delegate further. One level only. Complexity, budget accounting, and debugging difficulty don't justify recursive delegation at this scale.

**Fan-out parallelism controls** — parallel subagent execution works because delegation is a tool like any other, and the loop already runs all tool calls concurrently. What's missing is explicit concurrency caps on subagents specifically. Two or three parallel delegations is fine; ten would overwhelm rate limits. Left it to the existing per-service rate limiters, which throttle external calls regardless of source. A dedicated subagent semaphore would be cleaner.

---

## What More Time Would Address

**Evaluation harness depth** — the runner and fixtures exist, but the question bank is thin and scoring rubrics are rough. Real confidence in report quality requires 20–30 diverse questions, human-labeled reference answers, and automated scoring across citation accuracy, coverage, and factual precision. The harness infrastructure is there; it just needs the data.

**Stuck detection** currently catches repeated identical tool calls (same tool, same input, 3× in a row). A more robust version would detect semantic loops: rephrasing the same search query, revisiting the same domain across multiple fetches, or oscillating between two states. The current version handles the common case; the edge cases need pattern analysis across a real trace dataset before it's worth guessing at heuristics.

**Streaming output** — The user waits for the full report. Adding streaming would improve perceived latency.

---

## The Design Decision I'd Defend

**Sending all 51 tools every API call, with no dynamic filtering.**

The obvious alternative — filter tools by current plan phase, surface only the 10–12 most relevant at each step — looks appealing on paper. Saves roughly 1,500 tokens per call, reduces the surface area the model has to reason over, feels like a cleaner separation of concerns.

I chose against it for one reason: research is non-linear, and phase boundaries are fiction.

An agent in "synthesis mode" may discover a gap and need `web_search` again. An agent in "data gathering" may want to immediately verify a suspicious statistic with `verify_cross_reference`. An agent mid-way through a plan may realize the question requires reframing and need `planning_create` again. Any code that decides which tools to expose is making assumptions about what the model should do next — which is precisely what "model-driven tool selection" exists to prevent.

The cost of phase filtering isn't just the token savings you lose. It's the brittleness you introduce when research doesn't follow the assumed phase sequence, and the violation of the design principle that the model — not the code — drives execution. An agent that can't reach for the tool it needs is an agent that gets stuck.

What makes flat registry workable at 51 tools is description quality and naming discipline. Tool names follow `{namespace}_{verb}_{noun}` — `web_search`, `extract_statistics`, `knowledge_add_finding` — so the model gets structural orientation from the name alone. Every description answers "use when..." before describing what the tool does. The system prompt lists available namespaces and current plan context, which orients the model without restricting it.

At 200+ tools, I'd revisit this. Semantic retrieval becomes justified when description quality can no longer carry the disambiguation load and model confusion starts showing in traces. But for 51 tools with clear namespace separation, availability beats efficiency every time.
