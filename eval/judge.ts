import { BedrockProvider } from '../src/llm/bedrock.js';
import type { SystemPrompt } from '../src/llm/provider.js';
import { z } from 'zod';

export const DIMENSIONS = [
  'factual_accuracy',
  'completeness',
  'source_quality',
  'depth_of_analysis',
  'coherence_and_synthesis',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const DimensionScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  justification: z.string(),
});

export const JudgmentSchema = z.object({
  factual_accuracy: DimensionScoreSchema,
  completeness: DimensionScoreSchema,
  source_quality: DimensionScoreSchema,
  depth_of_analysis: DimensionScoreSchema,
  coherence_and_synthesis: DimensionScoreSchema,
  overall_assessment: z.string(),
});

export type Judgment = z.infer<typeof JudgmentSchema>;

const JUDGE_SYSTEM: SystemPrompt = {
  static: `You are an expert evaluator of research reports. You assess reports produced by an autonomous research agent on a 1-5 scale across multiple quality dimensions.

Score each dimension independently. Be critical — a 3 is "adequate", a 5 is "exceptional". Do not grade inflate.

## Scoring Rubric

### Factual Accuracy (1-5)
Can the claims in this report be verified? Are numbers, dates, names, and attributions correct?
- 1: Multiple clearly false statements or fabricated data
- 2: Several inaccuracies or unsupported claims presented as fact
- 3: Mostly accurate with minor errors that don't undermine the main conclusions
- 4: Accurate throughout with only trivial imprecisions
- 5: Every verifiable claim is correct; nuanced where certainty is limited

### Completeness (1-5)
Does the report address all aspects and subtopics of the research question?
- 1: Answers a different question or covers only a tiny fragment
- 2: Major subtopics missing; answers less than half the question
- 3: Covers the main points but misses notable subtopics or perspectives
- 4: Thorough coverage with only minor gaps
- 5: Comprehensive — all reasonable subtopics addressed, multiple perspectives included

### Source Quality (1-5)
Are claims grounded in identifiable sources? Are sources authoritative and diverse?
- 1: No sources cited; claims appear fabricated or entirely unsupported
- 2: Few sources, mostly low-quality or unverifiable; heavy reliance on one source
- 3: Some credible sources cited but gaps in attribution; moderate diversity
- 4: Well-sourced from authoritative references; good diversity across source types
- 5: Excellent sourcing — authoritative, diverse, recent, with clear attribution throughout

### Depth of Analysis (1-5)
Does the report go beyond surface-level? Are there specific data points, examples, nuanced discussion?
- 1: Entirely generic; could be generated without any research
- 2: Mostly surface-level with occasional specific detail
- 3: Mix of general and specific; adequate for an overview
- 4: Consistently specific with data, examples, and nuanced discussion
- 5: Expert-level depth — quantitative evidence, edge cases explored, limitations acknowledged

### Coherence & Synthesis (1-5)
Is the report well-organized? Does it connect information across sources and draw conclusions?
- 1: Disorganized dump of unconnected facts
- 2: Loosely organized but reads as separate summaries stitched together
- 3: Logical structure; some connections drawn between sources
- 4: Well-organized with clear narrative; synthesizes across sources effectively
- 5: Masterful synthesis — identifies patterns, resolves contradictions, builds to well-supported conclusions

## Output Format

Respond with ONLY a JSON object matching this structure (no markdown, no wrapping):
{
  "factual_accuracy": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "completeness": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "source_quality": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "depth_of_analysis": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "coherence_and_synthesis": { "score": <1-5>, "justification": "<2-3 sentences>" },
  "overall_assessment": "<1-2 sentence summary of the report's strengths and weaknesses>"
}`,
  noCachePoints: true,
};

function buildJudgePrompt(question: string, report: string): string {
  return `## Research Question
${question}

## Report to Evaluate
${report}

Evaluate this report against the research question. Score each dimension 1-5 with justification.`;
}

export async function judgeReport(question: string, report: string): Promise<Judgment> {
  const provider = new BedrockProvider();
  const prompt = buildJudgePrompt(question, report);

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
    throw new Error(`Judge did not return valid JSON. Raw output: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return JudgmentSchema.parse(parsed);
}

export function computeWeightedScore(judgment: Judgment): number {
  const weights: Record<Dimension, number> = {
    factual_accuracy: 0.30,
    completeness: 0.20,
    source_quality: 0.20,
    depth_of_analysis: 0.15,
    coherence_and_synthesis: 0.15,
  };

  let total = 0;
  for (const dim of DIMENSIONS) {
    total += judgment[dim].score * weights[dim];
  }
  return Math.round(total * 100) / 100;
}
