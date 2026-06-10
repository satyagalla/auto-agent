# Deep Research Agent

An autonomous research agent that takes a natural language question and produces a comprehensive, cited markdown report. Built in TypeScript on AWS Bedrock (Claude Sonnet).

## How It Works

The agent runs a budget-bounded execution loop. Claude selects from 51 tools each turn — searching the web, reading sources, recording findings, delegating subtopics to subagents — and either terminates naturally when it judges the research complete or falls back to forced synthesis when the token budget runs low. No hand-routing in the code.

```
pnpm dev "What are the economic costs of climate change?"
```

The final report is printed to stdout and saved to `traces/<sessionId>/report.md`. Structured logs go to `traces/<sessionId>/run.log`.

## Setup

**Requirements:** Node.js 20+, pnpm, AWS credentials with Bedrock access.

```bash
pnpm install
cp .env.example .env   # fill in credentials
```

**.env**
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
TAVILY_API_KEY=...      # required for web search
FRED_API_KEY=...        # optional — economic data
GITHUB_TOKEN=...        # optional — raises API rate limit
```

## Commands

```bash
pnpm dev "your question"   # run the agent
pnpm test                  # unit tests
pnpm eval                  # evaluation harness (3 cases)
pnpm eval nuclear-fusion   # single eval case
pnpm lint                  # type check
```

## Architecture

**51 tools across 10 namespaces** — the model selects freely from the full set each turn:

| Namespace | Purpose |
|-----------|---------|
| `web_*` | Web search (Tavily) and page fetching |
| `source_*` | PDF, arXiv, Wikipedia, CSV ingestion |
| `extract_*` | Entities, statistics, references, sections |
| `data_*` | Math, aggregation, unit conversion, timelines |
| `code_*` | JavaScript sandbox, regex, JSONPath |
| `datasource_*` | World Bank, FRED, Wikidata, GitHub APIs |
| `verify_*` | Cross-reference, retraction checks, Wayback |
| `planning_*` | Research plan creation and tracking |
| `knowledge_*` | Findings store with search and dedup |
| `output_*` | Report generation and bibliography |

**Artifact system** — fetched content is written to disk and referenced by `artifact_id`. The conversation stays compact; downstream tools read artifacts directly.

**Subagents** — `agent_delegate_research` spawns a fresh Claude API call with isolated context and a scoped tool set (web/source/extract only). Returns `{ findings, sources, gaps }`. Multiple delegations in one turn run in parallel.

**KV-cache alignment** — static system prompt + tool schemas cached at step 1. Explicit `cachePoint` injected on the second-to-last user message caches the growing conversation prefix. Message history stays immutable between turns so prefix matches hold each step.

**Production scaffolding** — typed error hierarchy, retry with exponential backoff, per-service rate limiting (Tavily, Jina, GitHub, Bedrock), pino structured logging, Zod schemas on all tool I/O, budget tracker with forced synthesis reserve.

## Project Structure

```
src/
  agent/       # execution loop, context management, subagent runner
  infra/       # errors, logger, retry, rate limiter, budget, config
  llm/         # Bedrock provider, prompts
  store/       # artifact store, knowledge store, plan store
  tools/       # all 51 tools, registry, executor
eval/          # eval harness, LLM judge, question bank
test/          # unit and integration tests
traces/        # per-session logs and reports (gitignored)
plans/         # architecture decision docs
MEMO.md        # engineering memo
```

## Evaluation

```bash
pnpm eval                                        # run all 3 cases end-to-end
pnpm eval nuclear-fusion --report ./report.md   # judge an existing report
```

Each case runs smoke tests (word count, topic coverage) then an LLM-based quality judge scoring factual accuracy, completeness, source quality, depth, and coherence. A delegation judge scores planning and subagent usage separately.

Results saved to `eval/results/eval-<timestamp>.json`.
