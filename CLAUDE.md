# Deep Research Agent — Development Instructions

## What This Is

An autonomous deep research agent that takes a research question and produces a comprehensive report. Built in TypeScript for a 5-day engineering challenge.

## Architecture Summary

- **Execution loop**: Budget-bounded while loop. Claude (via Bedrock) picks tools each turn. Loop runs until Claude stops calling tools, or budget/steps exhausted.
- **Tools**: 51 tools across 10 namespaces. All registered in a registry. Model picks from full set each turn (no code routing).
- **Context management**: Findings list injected every call. Old tool results can be dropped after agent records findings. Artifacts stored on disk, tools pass pointers.
- **Subagents**: Agent-as-tool pattern. Fresh Claude API call, scoped tool set, structured return.
- **Production scaffolding**: Custom retry with backoff, rate limiting per service, typed error hierarchy, pino structured logging, budget tracking.

## Key Design Decisions

Read `plans/` directory for full context on architectural decisions. Key points:

1. **Tool selection**: All 51 tools sent every API call. Namespaced naming + descriptions guide model. No dynamic filtering.
2. **Context**: Full conversation + findings list in system prompt + drop old tool results after findings recorded.
3. **Subagents**: Fresh API call, scoped to web/source/extract tools only, returns structured { findings, sources, gaps }.
4. **Planning**: Plan is a tool (not a phase). Model creates/updates plan via planning_* tools. System prompt encourages planning first.
5. **Termination**: Model decides (stops calling tools) OR budget forces synthesis OR max steps hit.
6. **Errors**: Transient (network, rate limit) retried invisibly. Permanent surfaced to model as error tool result.

## Tech Stack

- TypeScript, Node.js 20+, ESM modules
- pnpm for packages
- tsx for dev (run TS directly)
- tsc for type checking
- Vitest for tests
- pino for logging
- Zod for schema validation
- cheerio for HTML parsing
- AWS Bedrock SDK for Claude API
- Built-in fetch for HTTP

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev "question"   # Run agent with a research question
pnpm test             # Run unit + integration tests
pnpm eval             # Run evaluation harness
pnpm lint             # Type check
```

## Code Style

- No comments unless explaining a non-obvious WHY
- No over-abstraction — prefer simple direct code
- Typed everything — Zod schemas for tool I/O, TypeScript interfaces for internals
- Each tool file exports tools that self-register with the registry
- Errors are always typed (AgentError subclasses), never generic catch-all

## Commit Style

- Small, logical commits
- Format: "feat: add web tools" / "fix: retry on 429" / "infra: add rate limiter"
- Never commit .env or API keys
