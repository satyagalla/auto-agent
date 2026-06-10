import { BedrockProvider } from '../llm/bedrock.js';
import { buildBeastModePrompt, STATIC_SYSTEM } from '../llm/prompts.js';
import { BudgetTracker } from '../infra/budget.js';
import { ArtifactStore } from '../store/artifacts.js';
import { KnowledgeStore } from '../store/knowledge.js';
import { PlanStore } from '../store/plan.js';
import { createSessionLogger } from '../infra/logger.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { registry } from '../tools/registry.js';
import { registerAllTools } from '../tools/register-all.js';
import { executeTool } from '../tools/executor.js';
import { compactIfNeeded, formatToolResult } from './context.js';
import { config } from '../infra/config.js';
import type { LLMMessage, ContentBlock, ToolUseBlock } from '../llm/provider.js';
import type { ToolContext } from '../tools/types.js';

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveReport(sessionId: string, question: string, report: string): string {
  const dir = join(process.cwd(), 'traces', sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'report.md');
  writeFileSync(path, `# Research Report\n\n**Question:** ${question}\n\n---\n\n${report}`, 'utf-8');
  return path;
}

interface RecentCall {
  name: string;
  input: string;
  count: number;
}

export async function runAgent(question: string): Promise<string> {
  registerAllTools();

  const sessionId = generateSessionId();
  const logger = createSessionLogger(sessionId, { sessionId });
  const artifactStore = new ArtifactStore(sessionId);
  const knowledgeStore = new KnowledgeStore();
  const planStore = new PlanStore();
  const budget = new BudgetTracker(config.tokenBudget, config.maxSteps, config.budgetReservePercent);

  const toolContext: ToolContext = {
    artifactStore,
    knowledgeStore,
    planStore,
    budgetTracker: budget,
    logger,
    sessionId,
  };

  const provider = new BedrockProvider();
  let messages: LLMMessage[] = [
    { role: 'user', content: question },
  ];

  logger.info({ sessionId, question: question.slice(0, 100) }, 'Research session started');

  // Stuck detection: track last 10 tool calls
  const recentCalls: RecentCall[] = [];

  function checkStuck(calls: { name: string; input: string }[]): boolean {
    for (const call of calls) {
      const key = `${call.name}:${call.input}`;
      const existing = recentCalls.find(r => `${r.name}:${r.input}` === key);
      if (existing) {
        existing.count++;
        if (existing.count >= 3) return true;
      } else {
        recentCalls.push({ name: call.name, input: call.input, count: 1 });
        if (recentCalls.length > 10) recentCalls.shift();
      }
    }
    return false;
  }

  let lastInputTokens = 0;

  while (!budget.isExhausted) {
    const budgetStatus = budget.getStatus();

    if (budget.shouldSynthesize) {
      logger.warn({ step: budgetStatus.stepsTaken }, 'Budget reserve reached — entering beast mode');
      const beastPrompt = buildBeastModePrompt(question, knowledgeStore.getFindings());
      const beastMessages: LLMMessage[] = [{ role: 'user', content: beastPrompt }];
      const response = await provider.chat({ static: STATIC_SYSTEM }, beastMessages, [], { maxTokens: 8192 });
      budget.recordTokens(response.usage.input_tokens, response.usage.output_tokens, response.usage.cache_read_tokens, response.usage.cache_write_tokens);
      const textBlocks = response.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[];
      const report = textBlocks.map(b => b.text).join('\n');
      logger.info({ path: saveReport(sessionId, question, report) }, 'Report saved');
      return report;
    }

    const compactResult = compactIfNeeded(messages, lastInputTokens, config.contextWindow);
    if (compactResult.compacted) {
      messages = compactResult.messages;
      logger.warn({ step: budgetStatus.stepsTaken, lastInputTokens }, 'Context compacted: middle tool results stubbed');
    }

    const llmTools = registry.toLLMTools();
    const response = await provider.chat({ static: STATIC_SYSTEM }, messages, llmTools, { maxTokens: 4096 });
    lastInputTokens = response.usage.input_tokens;
    budget.recordTokens(response.usage.input_tokens, response.usage.output_tokens, response.usage.cache_read_tokens, response.usage.cache_write_tokens);
    budget.recordStep();

    const step = budgetStatus.stepsTaken + 1;
    const textBlocks = response.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[];
    const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');

    logger.info(
      {
        step,
        stopReason: response.stop_reason,
        toolCalls: toolUseBlocks.map(b => b.name),
        tokensThisCall: response.usage.input_tokens + response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_tokens,
        cacheWriteTokens: response.usage.cache_write_tokens,
        tokensTotal: budget.tokensSpent,
        contextTokens: lastInputTokens,
      },
      'Agent step'
    );

    // Natural termination
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      const finalText = textBlocks.map(b => b.text).join('\n');
      if (finalText.trim()) {
        logger.info({ step, path: saveReport(sessionId, question, finalText) }, 'Agent completed research naturally');
        return finalText;
      }
      if (messages.length > 2) break;
    }

    if (toolUseBlocks.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async block => {
        const tool = registry.get(block.name);
        if (!tool) {
          logger.warn({ toolName: block.name }, 'Unknown tool called');
          return formatToolResult(block.id, `Tool not found: ${block.name}`, true);
        }
        const result = await executeTool(tool, block.input, toolContext);
        return formatToolResult(block.id, result.isError ? result.error : result.result, result.isError);
      })
    );

    messages.push({ role: 'user', content: toolResults as ContentBlock[] });

    // Stuck detection: inject guidance AFTER tool_results so tool_use/tool_result adjacency is preserved.
    // Uses assistant→user alternation: the guidance becomes the next assistant turn, prompting a new user turn.
    const stuck = checkStuck(toolUseBlocks.map(b => ({ name: b.name, input: JSON.stringify(b.input).slice(0, 100) })));
    if (stuck) {
      logger.warn({ step }, 'Stuck detection triggered');
      messages.push({ role: 'assistant', content: [{ type: 'text', text: '[Guidance] You have repeated the same action multiple times without new results. Try a different approach, different search queries, or move to a different subtask.' }] });
      messages.push({ role: 'user', content: 'Understood — changing approach.' });
    }
  }

  // Force synthesis if we exited due to budget — findings are in beastPrompt, skip dynamic system block
  logger.warn({ steps: budget.stepsTaken }, 'Budget exhausted — forcing synthesis');
  const beastPrompt = buildBeastModePrompt(question, knowledgeStore.getFindings());
  const finalMessages: LLMMessage[] = [
    { role: 'user', content: beastPrompt },
  ];
  const finalResponse = await provider.chat(
    { static: STATIC_SYSTEM },
    finalMessages,
    [],
    { maxTokens: 8192 }
  );
  budget.recordTokens(finalResponse.usage.input_tokens, finalResponse.usage.output_tokens, finalResponse.usage.cache_read_tokens, finalResponse.usage.cache_write_tokens);
  const finalText = finalResponse.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n');
  const result = finalText || 'Research session ended without producing a report.';
  logger.info({ path: saveReport(sessionId, question, result) }, 'Report saved');
  return result;
}
