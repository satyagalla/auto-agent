# Decision 03: Subagent Architecture

## The Challenge Requirement

> "At least one tool spawns a subagent that executes in an isolated context, holds its own scoped tool set, and returns a structured result to the parent. A function call relabelled as a subagent does not satisfy the requirement."

Three things must hold:
1. **Isolated context** — subagent doesn't see parent's conversation
2. **Scoped tool set** — subagent gets a subset of tools, not all 50
3. **Structured result** — returns typed data, not free text

---

## Industry Research: Subagent Architecture Patterns

### Pattern 1: Agent-as-Tool (Claude tool_use)

Parent calls a tool → tool internally runs a full agent loop (new Claude API call) → returns result as tool output.

- Child is invisible to parent. Just looks like a slow tool call.
- Parent provides context via the prompt string — that's the only bridge.
- **Isolation: Complete.** Fresh context, scoped tools, separate API call.
- Used by: Anthropic's Claude Code, custom Claude implementations.

### Pattern 2: Handoff / Relay (OpenAI Agents SDK)

Parent transfers control entirely. New agent takes over the conversation with full history.

- Like passing a baton. Not really parent/child — flat state machine.
- **Isolation: None.** Full conversation history passes along.
- Used by: OpenAI Agents SDK.

### Pattern 3: Group Chat (AutoGen)

Multiple agents share a single conversation thread. Manager decides who speaks next.

- All agents see all messages from all other agents.
- **Isolation: None.** Everyone sees everything.
- Used by: Microsoft AutoGen.

### Pattern 4: Subgraph / Mapped State (LangGraph)

Parent graph contains child graph as a node. State explicitly mapped in and out.

- Define which fields child reads and which it writes back.
- **Isolation: Strong.** Child has own internal state. Only mapped fields cross boundary.
- Used by: LangGraph/LangChain.
- Most "engineered" approach — requires state schemas and mappings.

### Pattern 5: Fan-Out Workers (GPT-Researcher)

Orchestrator creates N independent tasks, fires in parallel, collects results.

- Workers are identical (same template, different input). No communication between them.
- **Isolation: Complete.** Workers don't know each other exist.
- Used by: GPT-Researcher, STORM.

### Comparison Against Challenge Requirements

| Architecture | Isolated context? | Scoped tool set? | Structured return? | Complexity |
|---|---|---|---|---|
| Agent-as-Tool | Yes | Yes | Yes | Low |
| Handoff | No (shared history) | Yes | Partially | Low |
| Group Chat | No (shared thread) | Yes | No | Medium |
| Subgraph | Yes | Yes | Yes | High |
| Fan-Out Workers | Yes | Yes | Yes | Medium |

---

## Decision: Agent-as-Tool Pattern

### Why This Pattern

1. **Satisfies all three requirements** — isolation, scoped tools, structured return.
2. **Simplest to implement** — it's just a tool whose implementation makes a new Claude API call.
3. **Proven in production** — Claude Code uses this exact pattern.
4. **Natural fit** — from the parent's perspective, delegating research is just calling a tool.
5. **Fan-out is the upgrade path** — same pattern, just concurrent. Can add later.

### How It Works

```
Parent's perspective:
  → calls tool "research_delegate" with { subtopic, parent_question, visited_urls }
  ← gets back { findings, sources, gaps }
  (looks like any other tool call)

Inside the tool:
  → constructs a focused prompt from the input
  → new Claude API call with own system prompt and scoped tools
  → child runs its own tool loop (search, fetch, extract)
  → child produces structured output
  → returned as parent's tool result
```

The prompt is the ONLY context bridge. Isolation is the default — separate API call means separate everything.

---

## Sub-Decisions

### 3.1: When Does the Parent Spawn a Subagent?

**Decision: Model decides.**

A `research_delegate` tool exists in the registry. The model calls it when it judges a subtask needs focused depth. System prompt encourages delegation for complex subtopics.

Why not alternatives:
- Every subtask delegated → parent won't hit 20+ calls (challenge risk)
- Code-based threshold → arbitrary, violates model-driven spirit

### 3.2: What Does the Subagent Receive?

**Decision: Minimal context.**

The subagent receives:
- The specific sub-question to research
- The parent's original research question (for framing)
- List of URLs already visited (to avoid re-fetching)

Why not alternatives:
- Full parent history → token waste, context pollution (OpenAI/AutoGen moving away from this)
- Just the sub-question → risks duplicating work parent already did

Why pass visited URLs specifically: In our design, both parent and child do web research on the same broad topic. Without dedup info, the child might re-visit pages the parent already read. This is specific to our domain — systems where parent and child do different types of work (like Claude Code) don't need this.

### 3.3: What Does the Subagent Return?

**Decision: Structured data only.**

```typescript
interface SubagentResult {
  findings: Array<{
    fact: string;
    source: string;
    confidence: "high" | "medium" | "low";
  }>;
  sources: Array<{
    url: string;
    title: string;
  }>;
  gaps: string[];  // things it couldn't find or answer
}
```

Why not alternatives:
- Free text → hard to merge programmatically into parent's findings
- Both structured + narrative → unnecessary complexity. Parent does synthesis.

### 3.4: Execution Model

**Decision: No special handling. Parallel if Claude asks.**

The delegation tool is just a tool. The execution loop already handles parallel tool calls (Decision 04). If Claude returns one `research_delegate` call, one subagent runs. If Claude returns three `research_delegate` calls in one response, all three run in parallel.

No special-casing. The same parallel execution infrastructure handles everything uniformly.

Why this changed from the original "sequential" decision:
- We allow parallel tool calls in the execution loop (Decision 04)
- Subagent delegation IS a tool call
- Forcing it sequential would mean adding special-case code — more complexity, not less
- After planning, it's natural for Claude to delegate multiple subtopics at once

Cost control for parallel subagents:
- Each subagent has its own max_turns (15 tool calls)
- Parent's budget tracker accounts for subagent token usage
- Rate limiting at infrastructure layer throttles external API calls regardless of source

### 3.5: Scoped Tool Set

**Decision: Fixed "researcher" tool set.**

Subagent gets:
- `web_search` — find sources
- `web_fetch` — read pages
- `web_extract` — pull structured data from pages

Subagent does NOT get:
- Planning tools (not its job to plan)
- Synthesis tools (not its job to synthesize)
- Findings/knowledge tools (it returns findings; parent records them)
- Delegation tools (no recursion)

Why: The subagent's job is narrow — find facts on a specific subtopic and report them back. It doesn't need to plan, synthesize, or delegate further.

### 3.6: Recursion

**Decision: No.** One level only. Parent → Subagent. Subagent cannot delegate further.

Why: Complexity explosion. Hard to track budget. Hard to debug. Unbounded recursion risk. Not needed for our scope (20-50 step sessions).

### 3.7: Child Token Budget and Limits

- **Max tool calls:** 15 per subagent run (prevent runaway loops)
- **Max tokens per response:** Set reasonable limit on child API calls
- **Failure handling:** If child hits max_turns without completing, return partial results. Parent handles gracefully.

---

## Failure Modes to Design Against

| Failure | Mitigation |
|---|---|
| Model never delegates (does everything itself) | System prompt explicitly encourages delegation for complex subtopics |
| Model delegates too eagerly (everything) | System prompt says "delegate only when subtask requires multiple searches" |
| Child runs forever | max_turns = 15 on child loop |
| Child returns empty/useless results | Parent checks result quality, can re-attempt or skip |
| Child re-visits parent's URLs | Visited URLs passed as input to child |

---

## Integration with Context Management (Decision 02)

When a subagent returns results:
1. Parent receives the structured `SubagentResult` as a tool result
2. Parent reads the findings and adds relevant ones to its own findings list (via `findings_add` tool)
3. Parent updates plan status (subtask marked done)
4. The subagent's internal conversation is never seen by the parent — only the structured return

This means subagent results integrate through the same mechanism as any other tool result. No special handling needed.
