# Decision 02: Context Management Strategy

## The Problem

The agent makes 20+ API calls to Claude. Each call sends the **entire conversation so far** as input. Claude reads it all, decides what to do next.

**Problem 1: Cost.** You pay for all input tokens every call. Each call includes all prior messages. By call 20, input might be 60k+ tokens. Quadratic growth.

**Problem 2: Size.** Tool results are the bulky part. Web page extractions are 2-10k tokens each. After 20 tool calls, results alone could be 60-100k tokens.

**Problem 3: Challenge requirement.** "Context-management strategy expressed in the code itself rather than left implicit." Keeping everything isn't a strategy — it's the absence of one.

---

## Research: Summarized vs Raw Content in Research Agents

Before choosing a context strategy, we needed to answer: should tools pre-summarize content to save context space?

### The Tradeoff

**Pre-summarized tool output:**
- Saves context tokens (summary is 200 tokens vs 3k for full text)
- But: the summarizer doesn't know what the research question needs
- Loses specifics: numbers, qualifications, direct quotes, unexpected details
- A generic summarizer skips the one sentence that matters for THIS question

**Raw/extracted tool output:**
- Research model (Claude doing the reasoning) sees full content
- Applies its understanding of the question to judge relevance
- Preserves nuance, exact figures, ability to quote
- Cost: context fills up fast

### The Key Insight: Extract, Don't Summarize

The distinction isn't summarize vs raw. It's **extract vs summarize**.

- **Extraction** = remove noise (HTML, navigation, boilerplate), keep the actual content intact
- **Summarization** = reduce actual content to fewer words — destroys research fidelity

| Content Type | Approach | Why |
|---|---|---|
| Search result snippets | Already concise | Just pointers to sources |
| Full web page (article) | Extract (not summarize) | Remove HTML/nav, keep article body |
| Data-heavy pages | Extract | Numbers/tables can't be summarized without loss |
| Academic papers | Extract relevant sections | Too long in full, but abstract alone loses methodology |
| Lists/rankings | Extract | Structure matters |

### When Summarization IS Appropriate

1. After the research model has already read the content — it summarizes its own finding for future reference
2. For sources already visited — the agent already extracted what mattered
3. As a last resort when hitting context limits

### The Realization: Agent Self-Notes Solve Context Growth

```
1. Agent calls web_fetch → gets full extracted text (3k tokens)
2. Agent reads it, decides what matters for THIS question
3. Agent records finding: "key fact, source URL, confidence"
4. ... more steps happen ...
5. That 3k tool result is OLD. Agent already extracted what it needed.
6. SAFE to drop the old result — the finding is preserved in notes.
```

The agent's self-recorded findings ARE the compression. A researcher reads a paper, takes notes, moves on. The notes survive. The full paper can be put away.

---

## Design Constraints That Shape the Strategy

These constraints flow from the architecture and feed back into tool design:

| Constraint | Implication for Context | Implication for Tools |
|---|---|---|
| Context window is finite | Can't keep everything forever | Tools return extracted text, not raw HTML |
| Agent processes content once then moves on | Old full-text results become dead weight | Fetch once, read once, note what matters |
| API calls cost per input token per call | Large results multiply cost across all subsequent calls | Return minimum complete content |
| Rate limits on external APIs | Can't fire many fetches in parallel | Rate limiting at infra layer |
| Model chooses from 50+ tools | Tool contracts must be clear | Schemas and descriptions are first-class |

---

## Options Evaluated

### 1. Full Conversation, No Management

Keep everything. Hope 200k context is enough.

- Might work for 20-30 calls with concise results
- Violates "expressed in code" requirement
- Cost grows quadratically
- **Verdict: Not a strategy. Rejected.**

### 2. Full Conversation + Pre-Summarized Tool Output

Tools return summaries instead of full content to stay small.

- Cheap and fits in context
- Destroys research quality (summarizer doesn't know what matters)
- **Verdict: Rejected. Sacrifices the core mission (deep research) for an engineering convenience.**

### 3. Scratchpad/Blackboard as Primary Memory

Separate structured object holds all state. Conversation is secondary.

- Over-engineered for 20-50 step sessions
- Adds complexity (agent must manage two systems)
- The scratchpad IS just a note-taking tool — doesn't need to be a separate architecture
- **Verdict: Over-engineered. The concept is right but the implementation should be simpler.**

### 4. Hierarchical Memory (MemGPT-style)

Three-tier system with paging between layers.

- Designed for 100+ step sessions or multi-session persistence
- We have no multi-session requirement
- Adds massive complexity for no benefit at our scale
- **Verdict: Rejected. Wrong scale.**

### 5. RAG-Based Retrieval

Vector DB stores everything. Retrieve relevant context per step.

- Needs embedding infrastructure
- Black-box retrieval (hard to debug)
- Overkill for sessions of 20-50 steps
- **Verdict: Rejected. Infra overhead not justified.**

### 6. Full Conversation + Extract (not summarize) + Agent Self-Notes + Drop Old Results

- Tools return extracted content (noise-free, not summarized)
- Agent reads content and records its own findings
- Old tool results dropped after agent has processed them
- Findings list persists (always visible in system prompt)
- Safety valve: compress if conversation still exceeds threshold

- **Verdict: Adopted. Simple, preserves research quality, expressed in code.**

---

## Final Decision

### The Strategy (Three Mechanisms)

**Mechanism 1: Tools return extracted content**
- Web fetch strips HTML/nav/ads, returns article body
- Not summarized — the research model reads and judges
- This keeps results at 1-5k tokens instead of 20-50k (raw HTML) while preserving fidelity

**Mechanism 2: Agent records its own findings**
- A `findings_add` tool lets the agent note what it learned
- The findings list is injected into the system prompt every call
- This is the agent's "notebook" — compact, always visible, question-relevant
- The agent, having read the source with full context of the research question, produces better summaries than any preprocessing step could

**Mechanism 3: Old tool results are droppable**
- Once the agent has processed a tool result and noted its findings, the full result is no longer needed
- A background process can drop (or heavily compress) tool results older than N steps
- Key information survives in the findings list
- Safety valve: if conversation still exceeds ~100k tokens, compress aggressively

### How It Satisfies the Challenge

- **"Expressed in code"**: Extraction logic, findings tool, drop mechanism, token counting — all concrete modules
- **20+ calls without coherence loss**: Findings list is always present. Agent can reference step 1's findings at step 25.
- **Subagent coordination**: Subagents return structured findings → merged into parent's findings list

### What Lives Where

```
System Prompt (every call):
  - Agent identity and instructions
  - Tool selection hints (from Decision 01)
  - Findings list (agent's notebook — grows during session)
  - Current plan status (compact — subtask list with statuses)

Conversation Messages:
  - Full recent exchanges (last 6-8 tool calls + results)
  - Dropped/compressed older exchanges (findings already captured)
```

### Coupling with Tool Design

This decision means tools must be designed with these constraints:
- `web_fetch` → returns extracted text, NOT raw HTML, NOT a summary
- `findings_add` → agent records what it learned (input: fact, source, confidence)
- Every tool's output schema defines what "concise but complete" means for that tool
- No tool should return more than ~5k tokens in normal operation

---

## Open Items (Resolved in Later Decisions)

- Exact tool schemas → Decision 06 (Tool Inventory)
- How subagent findings merge → Decision 03 (Subagent Architecture)
- Token thresholds for compaction → determined during implementation/testing
