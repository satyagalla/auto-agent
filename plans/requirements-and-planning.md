# Deep Research Agent — Requirements & Planning

## Requirements (From Challenge)

### Hard Requirements

| # | Requirement | Specific Criteria | How We'll Know It's Met |
|---|---|---|---|
| 1 | 50+ tools, 4+ namespaces | Model-driven selection (not hand-routed), registry stays coherent at 50 | Tool registry with descriptions; Claude picks tools; no giant if/else chains |
| 2 | Subagent orchestration | Isolated context, scoped tool set, structured return | Separate LLM call with own system prompt, limited tools, typed response |
| 3 | Long-horizon execution | 20+ tool calls, no plan coherence loss, context strategy in code | Agent maintains plan state explicitly; can reference early steps at step 20+ |
| 4 | Production scaffolding | Observability, retries w/ backoff, rate limiting, typed errors, eval harness, unit + integration tests | Each is visible in the code, not stubbed |
| 5 | Composable tool I/O | At least one tool consumes another's structured output | Typed interfaces shared between tool output → tool input |

### Deliverables

| Deliverable | Notes |
|---|---|
| Public GitHub repo | Code + commit history both evaluated |
| MEMO.md at repo root | What you built, what you cut, what more time would fix, one defended design decision |
| 3-5 min video walkthrough | Demo working build, walk through substantive code, surface one moment you and the model diverged |
| Session traces | Claude Code JSONL files from `~/.claude/projects/` |

### Implicit Requirements

- **Commit history quality** — Small, logical commits. Not one giant dump.
- **Architectural coherence** — Code structured for deployment, not a prototype.
- **Engineering taste** — Knowing what to cut. MEMO.md asks "what you cut."
- **The agent actually works** — Video must demo it functioning end-to-end.
- **Thoughtful tradeoffs** — Principled, defended design choices.

---

## Decision Roadmap

Ordered by dependency — each decision builds on the ones above it.

| # | Decision | Status | Document |
|---|----------|--------|----------|
| 1 | Tool Selection Strategy | DECIDED | [01-tool-selection-strategy.md](./01-tool-selection-strategy.md) |
| 2 | Context Management Strategy | DECIDED | [02-context-management-strategy.md](./02-context-management-strategy.md) |
| 3 | Subagent Architecture | DECIDED | [03-subagent-architecture.md](./03-subagent-architecture.md) |
| 4 | Execution Loop Design | DECIDED | [04-execution-loop.md](./04-execution-loop.md) |
| 5 | External Dependencies (APIs, libraries) | DECIDED | [05-external-dependencies.md](./05-external-dependencies.md) |
| 6 | Tool Namespace & Inventory Design | DECIDED | [06-tool-inventory.md](./06-tool-inventory.md) |
| 7 | Production Scaffolding Design | DECIDED | [07-production-scaffolding.md](./07-production-scaffolding.md) |
| 8 | Testing & Evaluation Strategy | DECIDED | [08-testing-and-evaluation.md](./08-testing-and-evaluation.md) |
| 9 | Project Structure & Tech Setup | DECIDED | [09-project-structure.md](./09-project-structure.md) |

---

## Decision Dependencies

```
1. Tool Selection Strategy
   └── 6. Tool Namespace & Inventory (how tools are named/described depends on selection approach)

2. Context Management Strategy
   └── 4. Execution Loop (loop must implement context strategy)
   └── 3. Subagent Architecture (subagents interact with shared context)

3. Subagent Architecture
   └── 4. Execution Loop (loop must handle spawning/collecting subagent results)
   └── 6. Tool Inventory (some tools spawn subagents)

4. Execution Loop Design
   └── 9. Project Structure (loop is the core entry point)

5. External Dependencies
   └── 6. Tool Inventory (tools wrap external APIs)
   └── 7. Production Scaffolding (retries/rate-limits depend on which APIs)

6. Tool Namespace & Inventory
   └── 9. Project Structure (folder layout follows namespaces)

7. Production Scaffolding
   └── 9. Project Structure (scaffolding is cross-cutting infra)

8. Testing & Evaluation
   └── 9. Project Structure (test layout)
   └── 10. Timeline (what gets tested depends on what gets built)

9. Project Structure
   └── 10. Timeline (start building)

10. Timeline & Scope
    └── START CODING
```
