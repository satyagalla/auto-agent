import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';

export const agentTools: AgentToolDefinition[] = [
  {
    name: 'agent_delegate_research',
    namespace: 'agent',
    description: 'Spawn a subagent to research a specific subtopic in depth. Returns structured findings.',
    inputSchema: z.object({
      subtopic: z.string(),
      parent_question: z.string(),
      visited_urls: z.array(z.string()).optional(),
      depth: z.enum(['standard', 'thorough']).optional(),
      max_steps: z.number().optional(),
    }),
    async execute(input, ctx) {
      const { spawnSubagent } = await import('../agent/subagent.js');
      ctx.logger.info({ subtopic: input.subtopic }, 'Spawning research subagent');
      return spawnSubagent({
        subtopic: input.subtopic,
        parentQuestion: input.parent_question,
        visitedUrls: input.visited_urls,
        depth: input.depth,
        maxSteps: input.max_steps,
        mode: 'research',
        logger: ctx.logger,
      });
    },
  },
  {
    name: 'agent_verify_claim',
    namespace: 'agent',
    description: 'Spawn a subagent to verify or refute a specific claim.',
    inputSchema: z.object({ claim: z.string(), context: z.string().optional() }),
    async execute(input, ctx) {
      const { spawnSubagent } = await import('../agent/subagent.js');
      ctx.logger.info({ claim: input.claim.slice(0, 80) }, 'Spawning verification subagent');
      const result = await spawnSubagent({
        subtopic: `Verify this claim: "${input.claim}"${input.context ? `. Context: ${input.context}` : ''}`,
        parentQuestion: input.claim,
        mode: 'verify',
        maxSteps: 8,
        logger: ctx.logger,
      });

      const evidenceFor = result.findings.filter(f => f.confidence === 'high' || f.confidence === 'medium');
      const evidenceAgainst = result.findings.filter(f => f.confidence === 'low');
      const verified = evidenceFor.length > evidenceAgainst.length;
      const confidence = evidenceFor.length >= 2 ? 'high' : evidenceFor.length === 1 ? 'medium' : 'low';

      return { verified, evidence_for: evidenceFor, evidence_against: evidenceAgainst, confidence };
    },
  },
];
