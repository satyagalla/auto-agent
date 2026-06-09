import { BedrockProvider } from '../llm/bedrock.js';
import { buildSystemPrompt, buildBeastModePrompt, formatFindingsList } from '../llm/prompts.js';
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
import { buildMessages, formatToolResult } from './context.js';
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
  const messages: LLMMessage[] = [
    { role: 'user', content: question },
  ];

  logger.info({ sessionId, question: question.slice(0, 100) }, 'Research session started');

  // Stuck detection: track last 10 tool calls
  const recentCalls: RecentCall[] = [];
  let stuckHint: string | undefined;

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

  while (!budget.isExhausted) {
    const budgetStatus = budget.getStatus();
    const systemPrompt = buildSystemPrompt({
      planSummary: planStore.getPlanSummary(),
      findingsList: formatFindingsList(knowledgeStore.getFindings()),
      budgetStatus: `Steps: ${budgetStatus.stepsTaken}/${config.maxSteps} | Tokens: ${budgetStatus.tokensSpent}/${config.tokenBudget} (${budgetStatus.budgetPctUsed}% used)`,
      toolHint: stuckHint,
    });
    stuckHint = undefined;

    const trimmedMessages = buildMessages(messages);
    const llmTools = budget.shouldSynthesize ? [] : registry.toLLMTools();

    if (budget.shouldSynthesize) {
      // Beast mode: force synthesis
      logger.warn({ step: budgetStatus.stepsTaken }, 'Budget reserve reached — entering beast mode');
      const beastPrompt = buildBeastModePrompt(knowledgeStore.getFindings());
      const beastMessages: LLMMessage[] = [
        ...trimmedMessages,
        { role: 'user', content: beastPrompt },
      ];
      const response = await provider.chat(systemPrompt, beastMessages, [], { maxTokens: 8192 });
      budget.recordTokens(response.usage.input_tokens, response.usage.output_tokens);
      const textBlocks = response.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[];
      const report = textBlocks.map(b => b.text).join('\n');
      logger.info({ path: saveReport(sessionId, question, report) }, 'Report saved');
      return report;
    }

    const response = await provider.chat(systemPrompt, trimmedMessages, llmTools, { maxTokens: 4096 });
    budget.recordTokens(response.usage.input_tokens, response.usage.output_tokens);
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
        tokensTotal: budget.tokensSpent,
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
      // If no text, continue loop (model might have just not produced output yet)
      if (messages.length > 2) break;
    }

    if (toolUseBlocks.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    // Stuck detection
    const stuck = checkStuck(toolUseBlocks.map(b => ({ name: b.name, input: JSON.stringify(b.input).slice(0, 100) })));
    if (stuck) {
      stuckHint = "You've attempted a similar action multiple times without new results. Try a different approach, different search queries, or move to a different subtask.";
      logger.warn({ step }, 'Stuck detection triggered');
    }

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
  }

  // Force synthesis if we exited due to budget
  logger.warn({ steps: budget.stepsTaken }, 'Budget exhausted — forcing synthesis');
  const beastPrompt = buildBeastModePrompt(knowledgeStore.getFindings());
  const finalMessages: LLMMessage[] = [
    { role: 'user', content: question },
    { role: 'user', content: beastPrompt },
  ];
  const finalResponse = await provider.chat(
    buildSystemPrompt({
      planSummary: planStore.getPlanSummary(),
      findingsList: formatFindingsList(knowledgeStore.getFindings()),
      budgetStatus: 'BUDGET EXHAUSTED',
    }),
    finalMessages,
    [],
    { maxTokens: 8192 }
  );
  const finalText = finalResponse.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n');
  const result = finalText || 'Research session ended without producing a report.';
  logger.info({ path: saveReport(sessionId, question, result) }, 'Report saved');
  return result;
}
