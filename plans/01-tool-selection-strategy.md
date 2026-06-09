# Decision 01: Tool Selection Strategy

## The Problem

The agent needs 50+ tools across 4+ namespaces. The model (Claude) must choose which tool to call — no hand-routing in code. At 50 tools, the model must not get confused or pick wrong tools.

Challenge requirement: "Tool selection is driven by the model rather than routed by hand, and the registry has to remain coherent at fifty tools."

---

## Options Evaluated

### 1. Flat (All at Once)

Send all 50 tool definitions in every API call. Model picks from full set.

- Pros: Simplest. Truly model-driven. No logic in code.
- Cons: ~15k tokens per call for tool defs. Model might confuse similar tools. No engineering thought demonstrated.

### 2. Two-Tier Lazy Discovery

Model calls a meta-tool (`discover_tools`) to find available tools, then calls the real one.

- Pros: Minimal context per call. Model explores on demand.
- Cons: Extra round-trip per tool use (latency + cost). Agent might skip discovery and hallucinate tool names.
- Best for: 200+ tools.

### 3. Prefix Namespacing + Structural Selection

All tools sent every call. Names are structured (`web_search`, `analysis_summarize`). Descriptions explicitly say when to use.

- Pros: Simple. Truly model-driven. Namespaces help Claude reason. Proven to work at 50-80 tools.
- Cons: Still 15k tokens. Relies on description quality.

### 4. Dynamic Tool Pruning (Phase-Based)

Based on current plan phase, only surface relevant tools (~12-15 per call).

- Pros: Lower context cost. Fewer, more relevant options.
- Cons: Who decides the phase? If code decides → hand-routing (violates requirement). If model decides → extra step. What if the model needs a tool from another phase?
- Risk: Research is non-linear. Agent might need any tool at any time.

### 5. Hierarchical (Namespace Meta-Tools)

Model calls `select_namespace("web")` → next call only sees web tools.

- Pros: Focused context.
- Cons: Extra calls. Model must remember to switch. Awkward for cross-namespace needs.
- Not worth it at 50 tools.

### 6. Semantic Retrieval

Embed tool descriptions. Retrieve top-K most relevant tools per step using embeddings.

- Pros: Scales to thousands. Always relevant subset.
- Cons: Needs embedding infra. Overkill for 50. Adds latency. Black-box (hard to debug why a tool wasn't surfaced).

---

## Decision: Namespace Prefixing + Plan-Aware Hints

A hybrid of option 3 (structural naming) with dynamic contextual hints.

### Implementation

1. **All 50 tools available every call** — truly model-driven, satisfies challenge requirement.
2. **Names use `{namespace}_{verb}_{noun}` convention** — gives model structural cues.
3. **Descriptions include decision criteria** — not "searches the web" but "Use when you need to find information on a topic. Returns titles, URLs, and snippets. Use web_fetch to get full page content from a specific URL."
4. **System prompt includes a dynamic hint** about current plan state:

```
"Current phase: gathering information on subtopic 2 of 4.
 Most relevant namespaces: web, knowledge.
 All tools remain available — use any namespace if needed."
```

### Why This Over the Alternatives

| Alternative | Why Not |
|-------------|---------|
| Flat/naive | No engineering thought. Doesn't demonstrate depth. |
| Two-tier discovery | Extra latency for 50 tools isn't justified. Designed for 200+. |
| Phase-based pruning | Research is non-linear. Hiding tools makes the agent brittle. Also risks violating "model-driven" requirement. |
| Semantic retrieval | Overkill infra. Black-box selection is hard to debug and explain. |

### What Makes It "Not Just Flat"

1. Naming convention is deliberate — model gets structural cues from prefixes.
2. Descriptions include explicit "use when..." criteria — model knows when each tool is appropriate.
3. Plan-aware hints — system prompt tells the model what phase it's in and what's likely relevant.
4. Description quality is testable — eval harness can measure "did model pick the right tool."

### Defendable Argument (for MEMO.md)

"I chose not to dynamically prune tools because the research domain is non-linear. An agent analyzing sources may need to search again at any moment. Hiding tools based on assumed phases would make the agent brittle. Instead, I keep all tools available and use contextual hints to guide selection without restricting it. This preserves model autonomy (satisfying the challenge's 'model-driven' requirement) while providing orientation through naming conventions and dynamic system-prompt hints."
