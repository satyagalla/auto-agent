import { BedrockProvider } from '../src/llm/bedrock.js';
import type { SystemPrompt } from '../src/llm/provider.js';
import { z } from 'zod';

export const SUBAGENT_DIMENSIONS = [
  'delegation_decision',
  'coverage_contribution',
  'efficiency',
  'finding_integration',
] as const;

export type SubagentDimension = (typeof SUBAGENT_DIMENSIONS)[number];

export const SubagentDimensionScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  justification: z.string(),
});

export const SubagentJudgmentSchema = z.object({
  delegation_decision: SubagentDimensionScoreSchema,
  coverage_contribution: SubagentDimensionScoreSchema,
  efficiency: SubagentDimensionScoreSchema,
  finding_integration: SubagentDimensionScoreSchema,
  overall_assessment: z.string(),
});

export type SubagentJudgment = z.infer<typeof SubagentJudgmentSchema>;

const JUDGE_SYSTEM: SystemPrompt = {
  static: `You are an expert evaluator of research agent orchestration strategy. You assess whether an autonomous research agent made good delegation decisions — using subagents for independent subtopics vs handling them directly.

Score each dimension independently. Be critical — a 3 is "adequate", a 5 is "exceptional". Do not grade inflate.

## Scoring Rubric

### Delegation Decision (1-5)
Given the question's complexity and the plan's subtasks, was the agent's choice to delegate (or not) correct?
- 1: Complex multi-faceted question with 4+ independent subtasks, zero delegation — brute-forced sequentially
- 2: Should have delegated most subtasks but handled all directly, or delegated trivial subtasks that didn't need it
- 3: Reasonable choice — either the question was simple enough to not need delegation, or some delegation was used
- 4: Good judgment — delegated the right subtopics (independent, deep) while keeping interdependent ones direct
- 5: Optimal — delegated exactly the subtopics that benefit from parallel independent research, kept coordination tasks direct

### Coverage Contribution (1-5)
Did the overall research strategy (with or without delegation) achieve broad coverage?
- 1: Major subtopics completely missing from the report
- 2: Several angles unexplored; report is shallow in areas that needed depth
- 3: Adequate coverage but gaps visible; a subagent could have filled them
- 4: Good coverage across all planned subtopics with reasonable depth
- 5: Excellent — all subtopics explored thoroughly, multiple perspectives per topic

### Efficiency (1-5)
Was the research completed in a reasonable number of steps and tokens relative to output quality?
- 1: Extreme waste — 30+ steps for a question answerable in 10, or many repeated/failed tool calls
- 2: Inefficient — sequential handling of clearly parallelizable subtopics, significant token waste
- 3: Adequate — completed the task but took more steps than necessary
- 4: Efficient — good use of parallel tool calls, minimal wasted steps
- 5: Optimal — minimal steps for the coverage achieved, smart tool selection, no redundancy

### Finding Integration (1-5)
Were research findings recorded incrementally and woven into the final synthesis?
- 1: Findings batch-dumped at the end or not recorded at all; final report disconnected from research
- 2: Many findings recorded late; some research results lost before recording
- 3: Most findings recorded but some gaps between research and recording
- 4: Findings recorded steadily throughout; report draws on recorded knowledge
- 5: Every significant fact recorded immediately after discovery; report comprehensively cites findings

## Output Format

Respond with ONLY a JSON object matching this structure (no markdown, no wrapping):
{
  "delegation_decision": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "coverage_contribution": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "efficiency": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "finding_integration": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "overall_assessment": "<1-2 sentence summary of orchestration strengths and weaknesses>"
}`,
  noCachePoints: true,
};

export interface SubagentJudgeInput {
  question: string;
  plan: { subtasks: { description: string; status: string }[] } | null;
  report: string;
  delegationCount: number;
  steps: number;
  tokens: number;
  toolCalls: number;
}

function buildSubagentJudgePrompt(input: SubagentJudgeInput): string {
  const planSection = input.plan
    ? `## Research Plan (${input.plan.subtasks.length} subtasks)\n${input.plan.subtasks.map((t, i) => `${i + 1}. [${t.status}] ${t.description}`).join('\n')}`
    : '## Research Plan\nNo plan was created.';

  const delegationSection = input.delegationCount > 0
    ? `## Delegation\n${input.delegationCount} subtopic(s) were delegated to subagents.`
    : `## Delegation\nNo subagents were used. All research was done sequentially by the parent agent.`;

  const metricsSection = `## Session Metrics\n- Steps taken: ${input.steps}\n- Total tokens: ${input.tokens.toLocaleString()}\n- Tool calls: ${input.toolCalls}`;

  return `## Research Question\n${input.question}\n\n${planSection}\n\n${delegationSection}\n\n${metricsSection}\n\n## Final Report\n${input.report}\n\nEvaluate this agent's orchestration strategy. Score each dimension 1-5 with justification.`;
}

export async function judgeSubagentStrategy(input: SubagentJudgeInput): Promise<SubagentJudgment> {
  const provider = new BedrockProvider();
  const prompt = buildSubagentJudgePrompt(input);

  const response = await provider.chat(
    JUDGE_SYSTEM,
    [{ role: 'user', content: prompt }],
    [],
    { maxTokens: 2048, model: 'us.anthropic.claude-sonnet-4-6' }
  );

  const textBlocks = response.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[];
  const raw = textBlocks.map(b => b.text).join('');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Subagent judge did not return valid JSON. Raw output: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return SubagentJudgmentSchema.parse(parsed);
}

export function computeSubagentWeightedScore(judgment: SubagentJudgment): number {
  const weights: Record<SubagentDimension, number> = {
    delegation_decision: 0.35,
    coverage_contribution: 0.25,
    efficiency: 0.20,
    finding_integration: 0.20,
  };

  let total = 0;
  for (const dim of SUBAGENT_DIMENSIONS) {
    total += judgment[dim].score * weights[dim];
  }
  return Math.round(total * 100) / 100;
}
