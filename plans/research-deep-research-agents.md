# Industry Research: Deep Research Agents

## How the Industry Builds Deep Research Agents

### 1. OpenAI Deep Research

**Model:** Fine-tuned o3 reasoning model, trained via RL on browsing/reasoning tasks.

**How it works:**
1. User submits a query (can include files)
2. Model creates a research plan (visible as chain-of-thought)
3. Executes multi-step web browsing — opening pages, reading, analyzing images/tables/PDFs
4. Dynamically adapts research plan as it uncovers new information
5. Synthesizes into comprehensive report with inline citations

**Timing:** Up to 30 minutes per query. Latency traded for depth.

**Output:** Comprehensive reports with tables, analysis, charts, citations. Customizable format.

**Key insight:** Uses full interactive browser (Operator) — JS rendering, CAPTCHAs, dynamic pages. This is their moat.

---

### 2. Google Gemini Deep Research

**Model:** Gemini 1.5 Pro with 1M token context, in an agentic system.

**How it works:**
1. User enters question
2. System creates multi-step research plan
3. **Human-in-the-loop gate:** User reviews/revises plan before execution
4. Browses web iteratively — "searching, finding interesting pieces, starting new search based on what it learned"
5. Repeats multiple times, refining
6. Generates comprehensive report

**Timing:** "A few minutes."

**Output:** Report with source links, exportable to Google Docs. Supports follow-up questions.

**Key differentiator:** Human approval of plan before execution begins.

---

### 3. Perplexity Deep Research

- Performs dozens of queries (vs. 5-10 for regular Pro Search)
- Creates visible research plan
- Iteratively searches, reads, synthesizes
- Takes 3-5 minutes
- Structured report with inline citations

---

### 4. Open-Source Implementations

#### GPT-Researcher (Tavily)

**Architecture: Planner-Execution-Publisher**

1. Planner agent generates research questions
2. Crawler agents gather info per question (parallelized)
3. Summarizer condenses each resource
4. Filter & aggregate into final report

**Deep Research mode:** Tree-like exploration with configurable depth/breadth. Recursive with concurrent processing.

**Multi-agent system:** Chief Editor, Researcher, Editor, Reviewer, Publisher (via LangGraph).

**Metrics:** 20+ sources, 2000+ words, ~5 minutes, ~$0.40/run.

---

#### Stanford STORM

**Architecture: 4-module pipeline**

1. Knowledge Curation — collects via perspective-guided questioning
2. Outline Generation — organizes hierarchically
3. Article Generation — populates outline with cited content
4. Article Polishing — refines

**Core innovation:** Perspective-Guided Question Asking. Discovers diverse perspectives by surveying existing articles. Simulates conversations between writer and expert grounded in sources.

**Cost optimization:** Cheap models (GPT-3.5) for conversation/questions, expensive (GPT-4o) for generation/polishing.

---

#### Jina node-DeepResearch

**Architecture: Token-budget-bounded iterative loop**

```
while (tokenUsage < tokenBudget && badAttempts <= maxBadAttempts) {
  currentQuestion = gaps.shift() || originalQuestion
  // LLM decides next action: search, visit, reflect, answer
}
```

**Key mechanisms:**
- Gap questions as FIFO queue (not recursive DFS)
- Adaptive action disabling — if action yields nothing new, disable it
- Beast Mode — when budget exhausted, force final answer
- Answer evaluation — separate prompt evaluates definitiveness

**Step counts:** Simple factual: 2-3, Moderate: 11-13, Complex/open-ended: 42+

---

#### Hugging Face Open Deep Research (smolagents)

**Key choice:** CodeAgent — expresses actions in Python code, not JSON tool calls.

- 30% fewer steps than JSON-based agents
- Variables persist across steps
- GAIA: 55.15% (vs OpenAI's 67.36%)

---

## Two Dominant Architectures

### A. Multi-Agent Fan-Out

Decompose → assign parallel agents → merge results.

Used by: GPT-Researcher, STORM, LangChain supervisor.

```
Query → Decompose into sub-questions
         ├── Agent 1: researches subtopic A
         ├── Agent 2: researches subtopic B
         └── Agent 3: researches subtopic C
              → Merge → Synthesize → Report
```

### B. Single-Agent Iterative Loop

One agent with tools running in a budget-bounded loop.

Used by: Jina, OpenAI, Gemini.

```
Query → while (budget remaining && not done) {
           decide action → execute → observe → evaluate
         } → Report
```

---

## Universal Components (Present in All Implementations)

1. Query decomposition/rewriting
2. Web search + page reading
3. Summarization/compression (context management)
4. Answer/report evaluation (separate from generation)
5. Budget/termination logic
6. Iterative refinement (search based on what was found)
7. Source tracking and citation

---

## What Deep Research Is NOT (vs Simple RAG)

| Simple RAG | Deep Research |
|------------|--------------|
| Single query → retrieve → generate | Multi-step: plan → search → read → reason → refine → repeat |
| Fixed retrieval (one shot) | Adaptive retrieval (new searches based on findings) |
| ~200ms latency | Minutes acceptable |
| Static knowledge base | Live web browsing |
| No gap detection | Finds what's missing, generates sub-questions |
| 3-5 sources | 15-100+ sources |
| No self-evaluation | Evaluates own answer quality, retries if insufficient |

The fundamental difference: **Deep research is agentic** — it decides what to do next based on what it learned, not a fixed pipeline.

---

## Known Limitations & Failure Modes

1. **Context window overflow** — agents accumulate beyond 128K-400K tokens
2. **Hallucination in synthesis** — false connections between real sources
3. **Source bias propagation** — biases in sources transfer to report
4. **JS-heavy sites** — text-only fetching gets blocked/empty
5. **Repetitive search loops** — without adaptive disabling, agents spin
6. **Budget forcing is hard** — DFS approaches can't easily terminate on budget
7. **Contradiction handling is weak** — most use "majority wins" heuristic
8. **Query decomposition failures** — wrong initial framing poisons everything downstream
9. **Non-determinism** — same query, different reports each run
10. **Shallow on niche topics** — degrades when sources are sparse

---

## Key Architectural Takeaways

1. **Token budget > step count** — bounds by cost, handles variable complexity naturally
2. **FIFO gap queue > recursive DFS** — shared context, tractable budget-forcing
3. **Separate generation from evaluation** — distinct prompt assesses quality
4. **Adaptive action disabling** — prevent infinite loops
5. **Multi-model for cost** — cheap for summarization, expensive for synthesis
6. **Query rewriting is critical** — invest heavily here
7. **Embedding dedup in memory** — no vector DB needed at session scale
8. **Beast mode fallback** — forced answer when budget exhausted
9. **Stream progress** — users accept delays if they see thinking
10. **The browser is the moat** — JS-capable browsing explains most of OpenAI's lead
