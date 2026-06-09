# Decision 04: Execution Loop Design

## The Problem

The execution loop is the core of the agent — the code that runs repeatedly until the task is done. It must integrate all prior decisions (tool selection, context management, subagents) into a single coherent flow.

Key questions: how does it start, how does it end, what happens each iteration, and what guardrails prevent failure?

---

## Key Prior Decision: Plan as a Tool

Planning is not a separate phase — it's a tool the agent can call at any time. This means the loop is a single unified loop from start to finish. Planning, researching, delegating, synthesizing all happen within the same loop, driven by the model.

System prompt guides Claude to plan first for complex questions, but doesn't force it.

---

## The Loop Design

### Structure: Budget-Bounded While Loop

```
SETUP:
  - System prompt (identity, tool hints, guidelines)
  - All 50 tools registered (including planning, findings, delegation)
  - Budget tracker initialized (token budget + max steps)
  - Conversation starts with user's research question

LOOP:
  while (stop_reason === "tool_use" && within budget && within max steps):
    1. Build context for Claude:
       - System prompt with tool-selection hints
       - Findings list (injected, always visible)
       - Conversation messages (with old results dropped per Decision 02)
       - All 50 tool definitions
    2. Send to Claude API
    3. Claude responds with one or more tool calls, or final text
    4. For each tool call (parallel execution):
       - If transient error → retry with backoff (invisible to Claude)
       - If permanent error → return error as tool result
       - If success → return result
       - (Subagent tools run like any other tool — no special handling)
    5. Add Claude's response + all tool results to conversation
    6. Track: tokens spent, step count
    7. Duplicate action check → if same tool+input 3x, inject guidance message

  if (exited due to budget/steps, not Claude's choice):
    → One final call: "Synthesize your findings into a report now."

OUTPUT:
  Claude's final text response = the research report
```

### Why Budget-Bounded (Not Simple While Loop)

A simple `while (stop_reason === "tool_use")` loop has no guarantees:
- Claude might never stop (rabbit hole research)
- Costs could spiral without bound
- No forced termination for runaway sessions

Budget-bounding adds ~10 lines of code and solves all three. The model still drives all research decisions — the infrastructure just adds a safety net.

---

## Sub-Decisions

### 4.1: Loop Structure

**Decision: Single budget-bounded while loop.**

No phases. No state machine. One loop handles everything. Claude calls planning tools, research tools, delegation tools, and eventually stops and synthesizes. The loop just runs whatever Claude asks for.

Why not alternatives:
- Phased (plan → gather → synthesize) → rigid, research is non-linear, fights model autonomy
- Simple while loop (no bounds) → no cost/termination guarantees

### 4.2: How the Loop Starts

**Decision: User question goes directly into the loop.**

Claude's first action is whatever it judges appropriate:
- Complex question → calls `planning_create` first
- Simple question → might search directly

System prompt guides: "For multi-faceted research questions, begin by creating a research plan."

No forced first step. No separate planning phase. One loop, start to finish.

### 4.3: How the Loop Ends

**Decision: Combined termination (three paths).**

| Path | Trigger | What Happens |
|---|---|---|
| Model decides | Claude stops calling tools, produces text | Natural exit. Claude judges it has enough. |
| Budget exhaustion | Token budget exceeded | One final "synthesize now" call (beast mode). |
| Max steps | Hard cap (e.g., 50 tool call turns) | Same forced synthesis. Safety valve. |

The plan helps Claude judge completeness — when all planned subtasks are done, that's a natural signal. But it's Claude's judgment, not code enforcing it.

Budget split: reserve ~15% of token budget for the final synthesis call (Jina pattern). This ensures the agent can always produce output even if budget runs out mid-research.

### 4.4: Parallel Tool Calls

**Decision: Allow. No special-casing.**

Claude can return multiple tool calls in one response. All execute in parallel. This includes:
- Multiple `web_search` calls (search different queries simultaneously)
- Multiple `research_delegate` calls (delegate multiple subtopics at once)
- Mix of any tools

No tool is special-cased for sequential execution. If Claude calls it, it runs. If Claude calls three things at once, all three run in parallel.

Why: Subagent delegation tools are just tools. Forcing them sequential would be adding complexity (special-case code) for no benefit. The infrastructure handles parallelism uniformly.

Cost control for parallel subagents: each subagent has its own max_turns (15), parent's budget tracker accounts for subagent token usage, and rate limiting throttles external calls regardless of who makes them.

### 4.5: Error Handling

**Decision: Retry transient silently, surface permanent to Claude.**

| Error Type | Examples | Handling |
|---|---|---|
| Transient | Network timeout, rate limit (429), server error (500) | Retry with exponential backoff. Claude never sees it. |
| Permanent | 404 not found, access denied, invalid input | Return as error tool result. Claude adapts. |

Claude naturally handles surfaced errors well — it reads the error and tries a different approach. Retrying transient errors silently avoids wasting Claude's turns on infrastructure problems.

### 4.6: Stuck Detection

**Decision: Duplicate action tracking.**

Track last N tool calls. If same tool + same/similar input repeats 3 times:
- Inject a message: "You've attempted this action multiple times without new results. Try a different approach or move to a different subtask."

This catches the most common agent failure mode (repetitive searches) without the complexity of Jina's per-turn schema manipulation.

Why not adaptive action disabling (Jina): requires building dynamic tool schemas per turn, which adds significant complexity. Duplicate detection is 90% of the value for 10% of the effort.

### 4.7: Self-Reflection

**Decision: No forced reflection. Planning tools serve this purpose.**

With plan-as-tool, the act of updating the plan IS reflection:
- `planning_update_status` → forces Claude to assess "is this subtask done?"
- `planning_replan` → forces Claude to evaluate "should I change my approach?"
- `findings_add` → forces Claude to extract what it learned

No separate reflection mechanism needed. If Claude drifts off-track, stuck detection catches it. If Claude is on-track, plan updates naturally demonstrate progress.

---

## How Prior Decisions Integrate

```
┌─────────────────────────────────────────────────────────────┐
│                    EACH LOOP ITERATION                        │
│                                                              │
│  Context Assembly (Decisions 01 + 02):                       │
│    - System prompt + tool-selection hints (Decision 01)      │
│    - Findings list injected (Decision 02)                    │
│    - Recent messages, old results dropped (Decision 02)      │
│    - All 50 tools with namespaced names (Decision 01)        │
│                                                              │
│  Tool Execution:                                             │
│    - Normal tools → run, return result                       │
│    - Planning tools → update plan state in findings          │
│    - Findings tools → update findings list                   │
│    - Delegation tool → spawns subagent (Decision 03)         │
│      - Fresh Claude API call, scoped tools, structured return│
│      - Runs like any other tool (parallel if Claude asks)    │
│                                                              │
│  Guardrails:                                                 │
│    - Token budget check                                      │
│    - Step count check                                        │
│    - Duplicate action detection                              │
│    - Transient error retry (invisible to Claude)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## What Makes This "Plan-Coherent" (Challenge Requirement)

1. Claude creates a plan early (prompted to do so for complex questions).
2. The plan exists as a tool result in conversation — Claude sees it every turn.
3. As Claude works, it calls `planning_update_status` — plan is a living tracker.
4. Findings list accumulates — Claude sees what it knows at every step.
5. At step 20+, Claude reads its plan + findings to know where it is and what's left.

Coherence comes from: plan visible in context + findings always present + model using planning tools to track progress. Not enforced by code structure, but enabled by tools and demonstrated through their use.

---

## Observability (Connects to Decision 07)

Each iteration logs:
- Step number
- Tool(s) called + inputs
- Tool results (or error)
- Tokens consumed (this call + cumulative)
- Time elapsed
- Current plan state

This creates a full trace of the agent's execution, inspectable after the fact.

---

## Beast Mode (Forced Synthesis)

When budget or steps force termination:

```
System: "You have reached your research budget. Using the findings you've gathered so far,
produce your final synthesis report now. Do not make any more tool calls."
```

This guarantees the agent ALWAYS produces output, even if cut short. The report may be less comprehensive, but it's never empty.
