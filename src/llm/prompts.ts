import type { Finding } from '../store/knowledge.js';
import type { SystemPrompt } from './provider.js';

const STATIC_SYSTEM = `You are a deep research agent. Your job is to research questions thoroughly and produce comprehensive reports.

## How to Work

1. For complex multi-faceted questions, begin by calling planning_create to create a research plan with subtasks.
2. Work through subtasks systematically. Update subtask status with planning_update_status as you progress.
3. Use web_search to find relevant sources, then web_fetch to read them in detail.
4. Record important findings with knowledge_add_finding, citing source URLs.
5. Delegate complex subtopics to agent_delegate_research for parallel depth.
6. When you have sufficient findings across all planned subtasks, produce your final synthesis report directly as a text response (do not call any tools).
7. Your final response should be a well-structured markdown report with citations.

## Tool Namespaces
- web_* : Web search and fetching
- source_* : Specialized source types (PDFs, arXiv, Wikipedia, YouTube, CSV)
- extract_* : Extract structured info from artifacts
- data_* : Calculations, aggregation, conversions
- code_* : Execute JS, regex, JSON queries
- datasource_* : External data APIs (World Bank, FRED, GitHub, etc.)
- verify_* : Cross-reference claims, check retractions, verify domains
- planning_* : Create and manage research plans
- knowledge_* : Store and retrieve findings
- session_* : Budget tracking, artifact management
- output_* : Write reports and exports
- agent_* : Delegate to subagents`;

export function buildSystemPrompt(params: {
  planSummary: string;
  findingsList: string;
  budgetStatus: string;
  toolHint?: string;
}): SystemPrompt {
  const dynamic = `## Current Plan
${params.planSummary}

## Accumulated Findings
${params.findingsList || 'No findings recorded yet.'}

## Budget Status
${params.budgetStatus}${params.toolHint ? `\n\n## Guidance\n${params.toolHint}` : ''}`;

  return { static: STATIC_SYSTEM, dynamic };
}

export function buildSubagentPrompt(subtopic: string, parentQuestion: string, visitedUrls: string[]): string {
  const visited = visitedUrls.length > 0
    ? `\nAlready visited URLs (do not revisit):\n${visitedUrls.map(u => `- ${u}`).join('\n')}`
    : '';
  return `You are a research subagent. Research the following subtopic thoroughly.

Parent Question: ${parentQuestion}
Subtopic: ${subtopic}
${visited}

Search for relevant information, fetch key sources, and extract important facts. Return a structured summary of your findings.

At the end, respond with a JSON object in this exact format:
{
  "findings": [{ "fact": "...", "source": "url", "confidence": "high|medium|low" }],
  "sources": [{ "url": "...", "title": "..." }],
  "gaps": ["list of unanswered questions or gaps in the research"]
}`;
}

export function buildBeastModePrompt(findings: Finding[]): string {
  const findingsList = findings
    .slice(0, 80)
    .map((f, i) => `${i + 1}. ${f.fact} (Source: ${f.sourceUrl}, Confidence: ${f.confidence})`)
    .join('\n');

  return `You have reached your research budget. Based on the findings gathered so far, produce your final comprehensive research report now. Do not make any more tool calls.

## Findings Gathered
${findingsList}

Write a thorough, well-structured markdown report synthesizing all these findings. Include citations, key insights, and conclusions.`;
}

export function formatFindingsList(findings: Finding[]): string {
  if (findings.length === 0) return 'No findings recorded yet.';
  return findings
    .filter(f => !f.outdated)
    .slice(-50)
    .map((f, i) => `${i + 1}. [${f.confidence}] ${f.fact} (${f.sourceUrl})`)
    .join('\n');
}
