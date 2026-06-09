# Decision 09: Project Structure & Tech Setup

## Overview

The project is structured as a deployable TypeScript application, not a notebook or script. Clear separation between agent logic, tools, infrastructure, and state management.

Key tradeoff: 51 tools across 10 namespaces, but consolidated into fewer files (one file per namespace, not one file per tool). This keeps the architecture rich while staying buildable in 5 days.

---

## Folder Structure

```
deep-research-agent/
├── src/
│   ├── index.ts                 # Entry point — CLI interface
│   ├── agent/
│   │   ├── loop.ts              # Execution loop (budget-bounded while loop)
│   │   ├── context.ts           # Context assembly (findings injection, message building)
│   │   └── subagent.ts          # Subagent spawning logic
│   ├── tools/
│   │   ├── registry.ts          # Tool registry (register, lookup, list all)
│   │   ├── executor.ts          # Common tool invocation wrapper (validation, error wrapping, logging)
│   │   ├── types.ts             # Tool interface, input/output base types
│   │   ├── web.ts               # web_* tools (4 tools)
│   │   ├── source.ts            # source_* tools (5 tools)
│   │   ├── extract.ts           # extract_* tools (4 tools)
│   │   ├── data.ts              # data_* tools (5 tools)
│   │   ├── code.ts              # code_* tools (3 tools)
│   │   ├── datasource.ts        # datasource_* tools (6 tools)
│   │   ├── verify.ts            # verify_* tools (4 tools)
│   │   ├── planning.ts          # planning_* tools (5 tools)
│   │   ├── knowledge.ts         # knowledge_* tools (7 tools)
│   │   ├── session.ts           # session_* tools (3 tools)
│   │   ├── output.ts            # output_* tools (3 tools)
│   │   └── agent-tools.ts       # agent_* tools (2 tools)
│   ├── infra/
│   │   ├── retry.ts             # withRetry async wrapper
│   │   ├── rate-limiter.ts      # RateLimiter class (token bucket)
│   │   ├── budget.ts            # Token/step budget tracking
│   │   ├── errors.ts            # Error class hierarchy
│   │   ├── logger.ts            # pino structured logging setup
│   │   └── config.ts            # Configuration loading (.env + defaults)
│   ├── llm/
│   │   ├── provider.ts          # LLMProvider interface (model-agnostic)
│   │   ├── bedrock.ts           # AWS Bedrock Claude implementation
│   │   └── prompts.ts           # System prompt templates, context injection
│   └── store/
│       ├── artifacts.ts         # Artifact store (write, read, list)
│       ├── knowledge.ts         # Knowledge state (findings, sources, contradictions)
│       └── plan.ts              # Plan state (subtasks, statuses)
├── test/
│   ├── rate-limiter.test.ts
│   ├── retry.test.ts
│   ├── errors.test.ts
│   ├── artifact-store.test.ts
│   ├── plan-state.test.ts
│   ├── knowledge-store.test.ts
│   ├── observability.test.ts
│   ├── research-flow.integration.test.ts
│   ├── artifact-lifecycle.integration.test.ts
│   ├── subagent-spawn.integration.test.ts
│   ├── budget-termination.integration.test.ts
│   ├── stuck-detection.integration.test.ts
│   └── fixtures/                # Mock API responses (JSON files)
├── eval/
│   ├── runner.ts                # Eval harness runner
│   ├── cases.ts                 # Eval case definitions
│   └── results/                 # Stored eval run results (JSON)
├── traces/                      # Session trace logs (JSONL per session)
├── output/                      # Generated research reports
├── .env.example                 # Template for API keys (committed)
├── .env                         # Actual API keys (gitignored)
├── .github/workflows/test.yml   # CI workflow
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── MEMO.md                      # Challenge deliverable
└── README.md                    # How to run, configure, test
```

---

## Design Decisions

### Why one file per namespace (not one file per tool)

- 51 tools × 1 file each = 55+ files in tools/. Too many for 5 days.
- Tools within a namespace share imports, patterns, and structure.
- One file per namespace (e.g., `web.ts` exports 4 tools) → 15 files total.
- Each file is ~100-300 lines. Readable, navigable, buildable.
- The logical grouping (10 namespaces) is preserved. The file count is practical.

### Why `tools/executor.ts` (NEW)

Common wrapper for every tool invocation:
- Validates input against Zod schema
- Wraps errors into typed AgentError subtypes
- Logs execution (tool name, input, output, latency)
- Handles retry for tools that hit external APIs
- Single place to add cross-cutting concerns

Without this, every tool would duplicate validation + error handling + logging.

### Why `infra/budget.ts` (NEW)

Tracks:
- Tokens spent (input + output, per call and cumulative)
- Steps taken
- Budget remaining (tokens and steps)
- Triggers beast mode when budget exhausted

The execution loop checks budget before each iteration. Tools like `session_check_budget` read from this module.

### Why `llm/prompts.ts` (NEW)

Stores:
- System prompt template (agent identity, guidelines)
- Dynamic prompt construction (inject findings list, plan state, tool hints)
- Subagent system prompt template
- Beast mode synthesis prompt

Separating prompts from loop logic keeps the agent code clean and prompts easily editable.

### Why `src/store/` stays as 3 files (not merged)

Each store has genuinely different responsibilities:
- `artifacts.ts` — filesystem I/O (write/read content to disk)
- `knowledge.ts` — in-memory state (findings, sources, contradictions, search)
- `plan.ts` — in-memory state (subtasks, statuses, progress calculation)

They don't share interfaces or logic. Merging adds no value.

### Why tests are flat (not unit/ and integration/ folders)

- Only 12 test files total. Folders add navigation overhead for no benefit.
- File naming convention distinguishes: `*.test.ts` (unit), `*.integration.test.ts` (integration)
- Vitest can filter by pattern: `vitest run --grep integration`

### Why agent/ stays as 3 files (not merged)

- `loop.ts` (~150-200 lines): the while loop, termination logic, step tracking
- `context.ts` (~100-150 lines): message assembly, findings injection, compaction
- `subagent.ts` (~100-150 lines): spawn logic, scoped tool selection, result parsing

Each is a distinct concern. Merging creates a 400+ line file that's harder to navigate.

---

## Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | Strong typing for tool schemas, good ecosystem |
| Runtime | Node.js 20+ | Built-in fetch, ESM support |
| Dev runner | tsx | Runs TypeScript directly, no build step for dev |
| Type checking | tsc | Compile-time type verification |
| Package manager | pnpm | Fast, strict, lockfile |
| Testing | Vitest | Fast, native TS, Jest-compatible |
| Logging | pino | Structured JSON, minimal, fast |
| Validation | Zod | Schema definition + runtime validation + type inference |
| HTTP | Built-in fetch | Standard, no dependency needed |
| HTML parsing | cheerio | jQuery-like, lightweight |
| Math | mathjs | Safe expression evaluation for data_calculate |
| NLP | compromise | Lightweight entity extraction |
| PDF | pdf-parse | PDF text extraction |

Note: Removed `isolated-vm` (too heavy for 5 days). Code execution tool uses Node's `vm` module with timeout constraints instead.

---

## Dependency Rules

```
index.ts → agent/
agent/ → tools/registry, llm/, store/, infra/
tools/* → store/, infra/, llm/ (for subagent tools only)
tools/* → NEVER import other tool files directly
store/ → infra/ (logger, errors only)
infra/ → nothing (leaf modules)
llm/ → infra/ (retry, rate-limiter, errors, config)
```

Tools compose through the agent loop (tool A runs, model reads result, calls tool B). Tools never call each other directly.

---

## Scripts (package.json)

```json
{
  "name": "deep-research-agent",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "eval": "tsx eval/runner.ts",
    "eval:case": "tsx eval/runner.ts --case",
    "lint": "tsc --noEmit"
  }
}
```

### How to Run

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Fill in API keys

# Run the agent
pnpm dev "What are the current approaches to nuclear fusion?"

# Run tests
pnpm test

# Run evaluation
pnpm eval
```

---

## tsconfig.json

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
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## .gitignore

```
node_modules/
dist/
.env
traces/
output/
eval/results/
*.log
```

---

## File Count (Estimated)

| Directory | Files | Purpose |
|---|---|---|
| src/agent/ | 3 | Core loop logic |
| src/tools/ | 15 | Tool implementations (one per namespace + registry + executor + types) |
| src/infra/ | 6 | Production scaffolding |
| src/llm/ | 3 | LLM abstraction + prompts |
| src/store/ | 3 | State management |
| test/ | 12 | Unit + integration tests |
| eval/ | 2-3 | Eval harness |
| Config/root | 7-8 | package.json, tsconfig, CI, etc. |
| **Total** | **~50-55 files** | |

Down from ~85-90 in the original structure. Same architecture, half the files.
