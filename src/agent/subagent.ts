import { BedrockProvider } from '../llm/bedrock.js';
import { buildSubagentPrompt } from '../llm/prompts.js';
import { BudgetTracker } from '../infra/budget.js';
import { registry } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { ArtifactStore } from '../store/artifacts.js';
import { KnowledgeStore } from '../store/knowledge.js';
import { PlanStore } from '../store/plan.js';
import { config } from '../infra/config.js';
import type { LLMMessage, ContentBlock, ToolUseBlock } from '../llm/provider.js';
import type { ToolContext } from '../tools/types.js';
import type { Logger } from 'pino';

export interface SubagentResult {
  findings: { fact: string; source: string; confidence: string }[];
  sources: { url: string; title: string }[];
  gaps: string[];
}

const SUBAGENT_NAMESPACES = {
  research: ['web', 'source', 'extract', 'data', 'datasource', 'knowledge', 'session'],
  verify: ['web', 'verify', 'knowledge', 'session'],
};

export async function spawnSubagent(params: {
  subtopic: string;
  parentQuestion: string;
  visitedUrls?: string[];
  depth?: 'standard' | 'thorough';
  maxSteps?: number;
  mode: 'research' | 'verify';
  logger: Logger;
}): Promise<SubagentResult> {
  const sessionId = `sub_${Date.now()}`;
  const logger = params.logger.child({ subagentId: sessionId, subtopic: params.subtopic.slice(0, 80) });
  const artifactStore = new ArtifactStore(sessionId);
  const knowledgeStore = new KnowledgeStore();
  const planStore = new PlanStore();
  const budget = new BudgetTracker(config.subagent.maxTokens, params.maxSteps ?? config.subagent.maxSteps, 10);

  const toolContext: ToolContext = {
    artifactStore,
    knowledgeStore,
    planStore,
    budgetTracker: budget,
    logger,
    sessionId,
  };

  const allowedNamespaces = new Set(SUBAGENT_NAMESPACES[params.mode]);
  const tools = registry.getAll().filter(t => allowedNamespaces.has(t.namespace));
  const llmTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: registry.toLLMTools().find(lt => lt.name === t.name)?.input_schema ?? {},
  }));

  const provider = new BedrockProvider();
  // Subagent prompt is fully dynamic (subtopic/question/urls change every call) — no caching
  const systemPrompt = { static: buildSubagentPrompt(params.subtopic, params.parentQuestion, params.visitedUrls ?? []), noCachePoints: true };
  const messages: LLMMessage[] = [
    { role: 'user', content: `Research this subtopic: ${params.subtopic}` },
  ];

  let steps = 0;
  let finalText = '';

  logger.info({ mode: params.mode }, 'Subagent started');

  while (!budget.isExhausted && steps < (params.maxSteps ?? config.subagent.maxSteps)) {
    const response = await provider.chat(systemPrompt, messages, llmTools, { maxTokens: config.subagent.maxOutputTokens });
    budget.recordTokens(response.usage.input_tokens, response.usage.output_tokens, response.usage.cache_read_tokens, response.usage.cache_write_tokens);
    budget.recordStep();
    steps++;

    const textBlocks = response.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text');
    const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');

    logger.info(
      {
        step: steps,
        stopReason: response.stop_reason,
        toolCalls: toolUseBlocks.map(b => b.name),
        tokensThisCall: response.usage.input_tokens + response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_tokens,
      },
      'Subagent step'
    );

    if (textBlocks.length > 0) {
      finalText = textBlocks.map(b => b.text).join('\n');
    }

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async block => {
        const tool = registry.get(block.name);
        if (!tool) {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: `Tool not found: ${block.name}`,
            is_error: true,
          };
        }
        const r = await executeTool(tool, block.input, toolContext);
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: r.isError ? (r.error ?? 'Unknown error') : JSON.stringify(r.result),
          is_error: r.isError,
        };
      })
    );

    messages.push({ role: 'user', content: toolResults as ContentBlock[] });
  }

  const result = parseSubagentResult(finalText, knowledgeStore);
  logger.info({ steps, findingsCount: result.findings.length }, 'Subagent completed');
  return result;
}

function parseSubagentResult(text: string, knowledgeStore: KnowledgeStore): SubagentResult {
  // Try to parse JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*"findings"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as SubagentResult;
      if (Array.isArray(parsed.findings)) return parsed;
    } catch { /* fall through */ }
  }

  // Fallback: use what was recorded in the knowledge store
  const findings = knowledgeStore.getFindings().map(f => ({
    fact: f.fact,
    source: f.sourceUrl,
    confidence: f.confidence,
  }));
  const sources = knowledgeStore.listSources().map(s => ({ url: s.url, title: s.title }));

  // Extract gaps from text
  const gapMatch = text.match(/gaps?[:\s]+([^\n]+)/i);
  const gaps = gapMatch ? [gapMatch[1].trim()] : [];

  return { findings, sources, gaps };
}
