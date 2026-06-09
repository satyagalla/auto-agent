# Decision 08: Testing & Evaluation Strategy

## The Challenge Requirement

> "an evaluation harness, and a test suite covering both unit and integration paths"

## Design Philosophy

Testing on a 5-day deadline means maximizing bug-detection per hour spent. The strategy:
- **Infrastructure unit tests** catch bugs that cascade everywhere (high leverage)
- **Integration tests** catch composition bugs that unit tests miss (critical paths)
- **Eval harness** proves end-to-end functionality for demo (evidence)

What we DON'T do: test every individual tool (51 × 2 = 102 tests). Tools are simple wrappers — trust the implementation, catch bugs via integration tests.

**Total time budget: ~8 hours across Days 4-5.**

---

## 8.1: Unit Tests (~2 hours, 19 tests)

### What We Test

Infrastructure that's reused across all 51 tools. Bugs here cascade everywhere.

**Rate Limiter (3 tests):**
- Acquires immediately when under limit
- Blocks/delays when at limit
- Resets after time window passes

**Retry Logic (3 tests):**
- Retries on transient error (NetworkError, 429)
- Does NOT retry on permanent error (ValidationError, 404)
- Exponential backoff timing is correct

**Error Classification (2 tests):**
- Error hierarchy instantiates correctly (types, codes)
- `recoverable` flag set correctly per error type

**Artifact Store (3 tests):**
- Write artifact → read returns same content
- List returns all stored artifacts with metadata
- Get missing artifact → throws ArtifactNotFoundError

**Plan State (4 tests):**
- Create plan → subtasks exist with correct statuses
- Update status → status changes, summary stored
- Add subtask → appears in plan
- Get status → returns correct progress percentage

**Knowledge Store (3 tests):**
- Add finding → retrievable by ID
- Search findings by keyword → returns matches
- Note contradiction → stored and retrievable

**Observability (1 test):**
- Tool execution emits structured JSON log with trace ID, step number, latency

### Framework & Approach

- **Vitest** — fast, native TypeScript
- **No external API calls** — all mocked
- **Each test is self-contained** — no shared state between tests

---

## 8.2: Integration Tests (~3 hours, 5 tests)

### What We Test

Critical paths where components wire together. Mocked HTTP (no real API calls in CI).

**Test 1: Standard Research Flow**
```
web_search → web_fetch → knowledge_add_finding → planning_update_status
```
Proves: tool composition works, findings persist, plan updates reflect progress.

**Test 2: Artifact Lifecycle**
```
web_fetch → stores artifact → session_get_artifact_content retrieves it → extract_section extracts from it
```
Proves: artifact pointer system works end-to-end. Content survives storage and retrieval.

**Test 3: Subagent Execution**
```
agent_delegate_research → subagent runs with scoped tools → returns structured { findings, sources, gaps }
```
Proves: subagent isolation (fresh context, limited tools), structured return, parent consumes result.

**Test 4: Budget Termination (Beast Mode)**
```
Set low token budget → run agent loop → budget exhausts → synthesis forced → report produced
```
Proves: budget tracking works, forced termination triggers, agent always produces output.

**Test 5: Stuck Detection**
```
Agent calls same tool with same input 3 times → guidance message injected → agent changes approach
```
Proves: duplicate action tracking works, guardrail fires correctly.

### Approach

- Mock HTTP with test fixtures (pre-recorded API responses)
- Real execution of tool logic, state management, artifact store
- Tests run in <30 seconds (no real network calls)

---

## 8.3: Evaluation Harness (~2-3 hours, manual runs)

### Design

The eval harness runs the agent on real research questions with real APIs and measures output quality.

```typescript
interface EvalCase {
  question: string;
  minSources: number;          // minimum sources consulted
  minFindings: number;         // minimum findings recorded
  knownFacts?: string[];       // facts that MUST appear in report
  maxSteps?: number;           // budget constraint for this case
}

interface EvalResult {
  case: EvalCase;
  passed: boolean;
  report_produced: boolean;
  sources_consulted: number;
  findings_recorded: number;
  facts_found: string[];       // which known facts appeared
  steps_used: number;
  tokens_spent: number;
  duration_ms: number;
}
```

### Eval Cases

**Case 1: Simple Factual**
```typescript
{
  question: "When was CERN founded, what is its primary mission, and where is it located?",
  minSources: 2,
  minFindings: 3,
  knownFacts: ["1954", "Geneva", "particle physics"],
  maxSteps: 15
}
```
Tests: basic search → read → extract cycle. Should be fast.

**Case 2: Multi-Faceted Research**
```typescript
{
  question: "What are the current approaches to nuclear fusion energy and what is their funding status?",
  minSources: 5,
  minFindings: 8,
  knownFacts: ["ITER", "tokamak"],
  maxSteps: 35
}
```
Tests: plan creation, multiple sources, subagent delegation potential, structured findings.

**Case 3: Data-Driven**
```typescript
{
  question: "Compare GDP growth rates of the United States and China from 2020 to 2024",
  minSources: 3,
  minFindings: 5,
  knownFacts: [],  // numbers vary by source
  maxSteps: 25
}
```
Tests: datasource tools, computation, data handling.

### Metrics (Pass/Fail)

| Metric | Pass Condition |
|---|---|
| Report produced | Agent outputs a final report (not empty) |
| Sources >= threshold | Consulted at least N sources |
| Findings >= threshold | Recorded at least N findings |
| Known facts present | Report contains expected facts (keyword match) |
| Completed within budget | Didn't exceed max steps |

### Running the Eval

```bash
npm run eval           # runs all cases against real APIs
npm run eval -- --case 1  # run single case
```

Results stored in `evals/{timestamp}.json` — evidence for demo video.

---

## 8.4: CI Workflow

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test          # unit + integration (mocked, fast)
      # Eval harness NOT in CI (requires real APIs, costs money)
```

---

## 8.5: What We DON'T Test (and Why)

| Skipped | Reason |
|---|---|
| Individual tool implementations (51 tools) | Caught by integration tests. Simple wrappers don't need isolated testing. |
| Report prose quality | Subjective. Can't automate meaningfully. |
| Full end-to-end in CI | Expensive, slow, flaky. Manual eval covers this. |
| Every composition chain | Test one chain proves the pattern. If tools compose once, they compose everywhere. |
| Edge cases in every tool | Time constraint. Focus on critical path bugs. |

---

## Summary

| Layer | Count | Time | Runs In |
|---|---|---|---|
| Unit tests | 19 tests, 7 files | ~2 hours | CI (fast, mocked) |
| Integration tests | 5 tests, 5 files | ~3 hours | CI (mocked HTTP) |
| Eval harness | 2-3 cases | ~2-3 hours | Manual (real APIs) |
| CI workflow | 1 file | ~15 min | GitHub Actions |
| **Total** | **24 tests + 3 eval cases** | **~8 hours** | |

### What This Produces for Demo

- `npm test` output: 24 tests passing
- `evals/` folder: scored results from real research runs
- GitHub Actions: green badge showing tests pass
- Video can show: "here's the test suite, here's a real eval run, here's the output"
