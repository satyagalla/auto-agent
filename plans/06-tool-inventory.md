# Decision 06: Tool Namespace & Inventory Design

## The Challenge Requirement

> "50+ tools across 4+ namespaces. Tool selection is driven by the model rather than routed by hand, and the registry has to remain coherent at fifty tools."

Plus from our other decisions:
- Tools must compose (output of A → input of B) — Requirement #5
- Tools return extracted content, not summaries — Decision 02
- Large content stored as artifacts (pointers, not raw text) — Decision 02
- Subagent tools are just tools, no special-casing — Decision 03/04

---

## Design Principles

1. **Every tool does real work:** External API call, deterministic computation, state management, or file I/O. Zero LLM wrapper tools.
2. **Artifact system:** Large content lives on disk. Tools pass `artifact_id` pointers. Model sees metadata + excerpt, not full content.
3. **Naming convention:** `{namespace}_{verb}_{noun}` — clear, predictable, scannable.
4. **Descriptions include "use when..."** — model knows when each tool is appropriate.
5. **Schemas are honest:** Different tools have genuinely different input/output shapes.

---

## Architecture: The Artifact System

Tools that fetch content don't return raw text into conversation. They store it and return a pointer:

```
web_fetch(url) → stores full content on disk
             → returns { artifact_id: "art_01", title, wordCount, excerpt }

Model sees: small metadata object (50 tokens)
Not: full page content (3000 tokens)

Later: extract_section({ artifact_id: "art_01", section: "methodology" })
       → reads from disk, returns just that section
```

This prevents context window pollution and enables tools to operate on stored content without re-fetching.

---

## Final Tool Inventory: 50 tools across 10 namespaces

### `web` — Discovery & Retrieval (4 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 1 | `web_search` | Search the web for a query. Use when you need to find sources on a topic. Supports general, academic, and recent/news filtering. | `{ query, maxResults?, type?: "general"\|"academic"\|"news", recency?: { daysBack } }` | `{ results: [{ title, url, snippet, publishedDate?, authors?, year? }] }` | Tavily API |
| 2 | `web_fetch` | Fetch and extract readable text from a URL. Content stored as artifact. Use when you have a specific page to read. | `{ url }` | `{ artifact_id, title, byline?, wordCount, excerpt }` | fetch + Cheerio, fallback Jina Reader |
| 3 | `web_fetch_batch` | Fetch multiple URLs in parallel. Use when you have several independent pages to read. | `{ urls: string[] }` | `{ results: [{ url, artifact_id?, title?, error? }] }` | Parallel fetch with rate limiting |
| 4 | `web_get_links` | Extract all links from a page. Use to find related sources, references, or navigate a site. | `{ url, filter? }` | `{ links: [{ text, url, context }] }` | fetch + Cheerio link extraction |

### `source` — Multi-Format Ingestion (5 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 5 | `source_fetch_pdf` | Download and extract text from a PDF. Use for research papers, reports, whitepapers. Content stored as artifact. | `{ url }` | `{ artifact_id, title?, pageCount, excerpt }` | HTTP + pdf-parse |
| 6 | `source_fetch_arxiv` | Fetch a paper from arXiv by ID. Returns metadata and full text. Use for academic research. | `{ arxiv_id }` | `{ artifact_id, title, authors[], abstract, year }` | arXiv Atom API |
| 7 | `source_fetch_wikipedia` | Get structured Wikipedia content. Returns sections, summary, and references. | `{ topic }` | `{ artifact_id, title, summary, sections[], references[] }` | Wikipedia REST API |
| 8 | `source_fetch_youtube_transcript` | Get the transcript of a YouTube video. Use when a video is a relevant source. | `{ videoId }` | `{ artifact_id, title, duration, excerpt }` | youtube-transcript library |
| 9 | `source_parse_csv` | Parse CSV from a URL into structured data. Use when you find tabular data. | `{ url }` | `{ artifact_id, headers[], rowCount, sample[] }` | HTTP + CSV parser |

### `extract` — Deterministic Data Extraction (4 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 10 | `extract_entities` | Extract named entities (people, organizations, places) from stored content using NLP parsing. Deterministic, not LLM-based. | `{ artifact_id }` | `{ entities: [{ name, type, frequency, context }] }` | compromise.js NLP |
| 11 | `extract_statistics` | Pull numerical data, percentages, and metrics from stored content using pattern matching. | `{ artifact_id }` | `{ statistics: [{ value, unit?, metric, context }] }` | Regex + number parsing |
| 12 | `extract_references` | Pull citations and bibliography entries from stored content. Finds DOIs, URLs, citation patterns. | `{ artifact_id }` | `{ references: [{ title?, authors?, url?, year?, doi? }] }` | Regex for DOI/URL/citation formats |
| 13 | `extract_section` | Extract a specific section from stored content by heading or keyword. Use when you need part of a large document. | `{ artifact_id, section }` | `{ content, startOffset, wordCount }` | Heading detection + text slicing |

### `data` — Computation (5 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 14 | `data_calculate` | Evaluate a mathematical expression. Use for arithmetic, percentages, compound calculations. | `{ expression }` | `{ result, formatted }` | mathjs safe evaluator |
| 15 | `data_aggregate` | Compute statistics over a list of numbers: sum, average, median, standard deviation, min, max. | `{ values[], operations? }` | `{ results: { sum, average, median, stddev, min, max, count } }` | Pure math |
| 16 | `data_convert_units` | Convert between units (currency, distance, weight, temperature). Use when comparing values in different units. | `{ value, from, to }` | `{ result, formatted }` | convert-units + exchange rate API |
| 17 | `data_inflation_adjust` | Adjust a dollar amount for inflation between two years using CPI data. Use for comparing historical figures. | `{ amount, fromYear, toYear }` | `{ adjusted, cumulativeInflation, formatted }` | Bundled BLS CPI table |
| 18 | `data_build_timeline` | Sort events chronologically and compute durations between them. Use to construct a chronology from findings. | `{ events: [{ date, label, value? }] }` | `{ timeline: [{ date, label, daysSincePrevious? }], totalSpan }` | Date parsing + sort |

### `code` — Sandbox Execution (3 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 19 | `code_execute_js` | Execute JavaScript in a sandboxed environment. Use for complex transformations, parsing, or calculations too involved for data tools. Can access stored artifacts. | `{ code, artifact_ids? }` | `{ stdout, result?, error? }` | isolated-vm sandbox |
| 20 | `code_regex_extract` | Apply a regex pattern to stored content. Use when you know the exact pattern to match. Simpler than writing full JS. | `{ artifact_id, pattern, flags? }` | `{ matches[], groups?, matchCount }` | RegExp on artifact |
| 21 | `code_json_query` | Query structured JSON data using a JSONPath expression. Use to drill into complex structured API responses. | `{ artifact_id, path }` | `{ result }` | jsonpath-plus |

### `datasource` — Structured Data APIs (6 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 22 | `datasource_query_wikidata` | Query Wikidata for structured facts about entities. Use when you need verified factual data like founding dates, populations, relationships. | `{ query, entity_type? }` | `{ results: [{ entity, property, value, qualifiers? }] }` | Wikidata SPARQL |
| 23 | `datasource_query_world_bank` | Query World Bank indicators by country and year. Use for economic/development data: GDP, population, literacy, etc. | `{ indicator, country?, yearRange? }` | `{ data: [{ country, year, value }], metadata: { indicator_name, source } }` | World Bank API v2 |
| 24 | `datasource_query_fred` | Query Federal Reserve Economic Data. Use for US economic indicators: interest rates, unemployment, CPI. | `{ series_id, startDate?, endDate? }` | `{ data: [{ date, value }], metadata: { title, units, frequency } }` | FRED API |
| 25 | `datasource_query_github` | Get repository statistics: stars, forks, contributors, activity, languages. Use for tech/open-source research. | `{ owner, repo }` | `{ stars, forks, openIssues, language, contributors?, weeklyCommits?, createdAt }` | GitHub REST API |
| 26 | `datasource_query_openalex` | Query OpenAlex for academic metadata: papers, authors, citations. Use for bibliometric research or finding influential papers. | `{ query, type?: "works"\|"authors"\|"institutions", sort? }` | `{ results: [{ title?, author?, citations?, year?, doi? }], totalCount }` | OpenAlex API |
| 27 | `datasource_query_countries` | Get country facts: population, area, currencies, languages, region, borders. Use for geopolitical or demographic research. | `{ country }` | `{ name, population, area, capital, region, currencies, languages, borders }` | REST Countries API |

### `verify` — Fact-Checking & Validation (4 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 28 | `verify_cross_reference` | Search for corroborating evidence for a claim. Checks if claim keywords appear in independent sources. Use for quick validation before recording high-confidence findings. | `{ claim, exclude_sources? }` | `{ corroborations: [{ source_url, excerpt }], count }` | Tavily search + token overlap matching |
| 29 | `verify_wayback_lookup` | Check Internet Archive for historical page versions. Use to verify past content or find deleted pages. | `{ url, date? }` | `{ available, closest_snapshot?: { url, timestamp }, archived_count? }` | Wayback Machine API |
| 30 | `verify_check_retraction` | Check if an academic paper has been retracted or corrected. Use before citing research. | `{ title?, doi? }` | `{ retracted, correction?, source }` | CrossRef API / Retraction Watch |
| 31 | `verify_domain_info` | Get factual information about a domain: TLD type, registration date, country. Use to assess source type (government, academic, commercial). | `{ domain }` | `{ tld_type, registered_date?, country?, is_government, is_academic }` | WHOIS + TLD classification |

### `planning` — Research Plan Management (5 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 32 | `planning_create` | Create a research plan by decomposing the question into subtasks. Use at the start of complex research. Can replace an existing plan. | `{ question, subtasks: [{ description, priority? }], replaces_plan_id? }` | `{ plan_id, subtasks: [{ id, description, status, priority }] }` | In-memory state |
| 33 | `planning_update_status` | Mark a subtask as done, in-progress, or blocked. Include summary when marking done. | `{ subtask_id, status: "done"\|"in_progress"\|"blocked", summary? }` | `{ updated, plan_summary }` | In-memory state |
| 34 | `planning_add_subtask` | Add a new subtask discovered during research. Use when you find an important angle not in the original plan. | `{ description, priority? }` | `{ subtask_id, plan_summary }` | In-memory state |
| 35 | `planning_remove_subtask` | Remove a subtask that turned out irrelevant. Records reason for audit trail. | `{ subtask_id, reason }` | `{ removed, plan_summary }` | In-memory state + log |
| 36 | `planning_get_status` | Get current plan status and progress. Use to orient yourself on what's done and what remains. | `{}` | `{ plan, completed, remaining, blocked, progress_pct }` | In-memory state read |

### `knowledge` — Findings & Source Management (7 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 37 | `knowledge_add_finding` | Record a research finding. Use after reading a source and identifying a key fact relevant to your question. | `{ fact, source_url, confidence: "high"\|"medium"\|"low", subtask_id?, tags? }` | `{ finding_id }` | In-memory array |
| 38 | `knowledge_add_source` | Register a source in the source registry. Use to track all sources consulted for the bibliography. | `{ url, title, type: "article"\|"paper"\|"data"\|"video"\|"other", reliability? }` | `{ source_id }` | In-memory array |
| 39 | `knowledge_search_findings` | Search accumulated findings by keyword or tag. Use to check what you already know before researching further. | `{ query?, tags?, subtask_id?, confidence? }` | `{ findings: [{ id, fact, source_url, confidence, tags }] }` | In-memory filter + keyword match |
| 40 | `knowledge_list_sources` | List all registered sources, optionally filtered by type or reliability. | `{ type?, reliability? }` | `{ sources: [{ id, url, title, type, reliability }] }` | In-memory filter |
| 41 | `knowledge_note_contradiction` | Record a contradiction between two findings from different sources. Use when sources disagree. | `{ finding_id_a, finding_id_b, description }` | `{ contradiction_id }` | In-memory array |
| 42 | `knowledge_get_contradictions` | Get all recorded contradictions. Use before synthesis to address conflicting information. | `{}` | `{ contradictions: [{ id, finding_a, finding_b, description }] }` | In-memory read |
| 43 | `knowledge_get_summary` | Get summary of knowledge state: totals, coverage per subtask, confidence distribution. | `{}` | `{ total_findings, total_sources, contradictions_count, coverage: { [subtask_id]: number } }` | In-memory aggregation |

### `session` — Session Management (3 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 44 | `session_check_budget` | Check remaining token budget and step count. Use to decide whether to go deeper or start synthesizing. | `{}` | `{ tokens_spent, tokens_remaining, steps_taken, steps_remaining, budget_pct_used }` | Internal counters |
| 45 | `session_list_artifacts` | List all stored artifacts with metadata. Use to see what content you have available without re-fetching. | `{ type? }` | `{ artifacts: [{ id, title, type, wordCount, source_url }] }` | Artifact store listing |
| 46 | `session_get_artifact_content` | Read content from a stored artifact. Use to re-read a previously fetched source without fetching from the web again. | `{ artifact_id, offset?, limit? }` | `{ content, wordCount, truncated }` | Artifact store read |

### `output` — Report Generation & Export (3 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 47 | `output_write_report` | Write the final research report to a markdown file. Use when synthesis is complete. | `{ filename, content, title }` | `{ path, wordCount }` | File system write |
| 48 | `output_export_findings_json` | Export all findings and sources as structured JSON for machine-readable output. | `{ filename? }` | `{ path, finding_count, source_count }` | JSON serialize + file write |
| 49 | `output_create_bibliography` | Generate a formatted bibliography from all registered sources. | `{ style?: "apa"\|"mla"\|"chicago" }` | `{ bibliography, source_count }` | Deterministic citation formatting |

### `agent` — Subagent Delegation (2 tools)

| # | Name | Description | Input | Output | Implementation |
|---|---|---|---|---|---|
| 50 | `agent_delegate_research` | Delegate a subtopic to a focused research subagent. Use when a subtask needs deep investigation that would clutter your context. Subagent searches independently, returns structured findings. Set depth to "thorough" for complex subtopics. | `{ subtopic, parent_question, visited_urls?, depth?: "standard"\|"thorough", max_steps? }` | `{ findings: [{ fact, source, confidence }], sources: [{ url, title }], gaps[] }` | Fresh Claude API call, scoped tools |
| 51 | `agent_verify_claim` | Spawn a subagent to independently verify a specific claim by searching for evidence. Use for important claims that need thorough independent confirmation beyond quick cross-referencing. | `{ claim, context? }` | `{ verified, evidence_for[], evidence_against[], confidence }` | Fresh Claude API call, scoped tools |

---

## Summary

**51 tools across 10 namespaces.**

| Namespace | Count | Work Type |
|---|---|---|
| `web` | 4 | External API calls (search, fetch) |
| `source` | 5 | External APIs (PDF, arXiv, Wikipedia, YouTube, CSV) |
| `extract` | 4 | Deterministic NLP/regex parsing |
| `data` | 5 | Deterministic computation |
| `code` | 3 | Sandboxed execution |
| `datasource` | 6 | Structured data APIs |
| `verify` | 4 | External validation APIs |
| `planning` | 5 | In-memory state management |
| `knowledge` | 7 | In-memory state management |
| `session` | 3 | Internal system reads |
| `output` | 3 | File I/O |
| `agent` | 2 | Subagent spawning |
| **Total** | **51** | |

---

## Composition Chains (Requirement #5)

### Chain 1: Standard Research Flow
```
web_search → web_fetch → knowledge_add_finding → planning_update_status
```

### Chain 2: Academic Deep Dive
```
web_search({type:"academic"}) → source_fetch_arxiv → extract_references → verify_check_retraction → knowledge_add_finding
```

### Chain 3: Data-Driven Analysis
```
datasource_query_world_bank → data_aggregate → data_convert_units → data_calculate → knowledge_add_finding
```

### Chain 4: Verification Pipeline
```
knowledge_search_findings → verify_cross_reference → verify_domain_info → knowledge_note_contradiction
```

### Chain 5: Artifact Re-examination
```
session_list_artifacts → session_get_artifact_content → extract_section → code_regex_extract → knowledge_add_finding
```

### Chain 6: Delegation & Synthesis
```
planning_get_status → agent_delegate_research → knowledge_add_finding (bulk) → session_check_budget → output_write_report
```

### Chain 7: Structured Data Research
```
datasource_query_wikidata → data_build_timeline → data_calculate → knowledge_add_finding
```

---

## Naming Conflicts Addressed

| Original Conflict | Resolution |
|---|---|
| `web_search` vs `web_search_news` vs `web_search_academic` | Merged into one `web_search` with `type` parameter |
| `data_aggregate` vs `data_aggregate_timeline` | Renamed to `data_build_timeline` |
| `agent_deep_dive` vs `agent_delegate_research` | Merged into one with `depth` parameter |
| `datasource_*` naming inconsistency | Standardized all to `datasource_query_*` |
| `verify_cross_reference` vs `agent_verify_claim` | Descriptions clarify: cross_reference is quick token-overlap check, agent_verify is thorough independent subagent investigation |

---

## Reviewed Design Decisions

### Why separate search types aren't separate tools
The model expresses intent through parameters (`type: "academic"`, `recency: { daysBack: 7 }`). One tool with clear parameter docs is better than three tools with overlapping descriptions.

### Why `extract_entities` stays despite model being "better at NER"
The model does NER better in-context. But `extract_entities` runs on **stored artifacts** without spending context tokens. When the agent has a 50-page PDF stored and wants to quickly find all organizations mentioned, running compromise.js saves ~5000 tokens vs. re-reading the document.

### Why `verify_cross_reference` is not an LLM wrapper
Implementation: run `web_search(claim)` → for each result, compute token overlap between claim and result snippet → return results above threshold. The matching is deterministic string/token comparison, not LLM judgment.

### Why `code_regex_extract` and `code_json_query` stay despite being subsets of `code_execute_js`
They're convenience tools with simpler interfaces that reduce model error. Writing `{ pattern: "\\d+%" }` is less error-prone than writing `{ code: "const content = artifacts['art_01']; return content.match(/\\d+%/g)" }`. The model makes fewer mistakes with constrained interfaces.

---

## Token Budget Estimate

51 tool definitions at ~250-350 tokens each = ~13-18k tokens per API call for tool definitions. Within acceptable bounds for 200k context window (~8%).

---

## Implementation Priority

**Phase 1 (minimum viable agent — ~15 tools):**
web_search, web_fetch, planning_create, planning_update_status, planning_get_status, knowledge_add_finding, knowledge_add_source, knowledge_search_findings, knowledge_get_summary, session_check_budget, session_get_artifact_content, output_write_report, agent_delegate_research

**Phase 2 (depth — adds ~20 tools):**
source_*, extract_*, data_*, code_execute_js, web_get_links, web_fetch_batch

**Phase 3 (completeness — remaining ~16 tools):**
datasource_*, verify_*, output_*, remaining session/knowledge/code tools
