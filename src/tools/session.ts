import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';

export const sessionTools: AgentToolDefinition[] = [
  {
    name: 'session_check_budget',
    namespace: 'session',
    description: 'Check remaining token and step budget for this research session.',
    inputSchema: z.object({}),
    async execute(_, ctx) {
      const status = ctx.budgetTracker.getStatus();
      return {
        tokens_spent: status.tokensSpent,
        tokens_remaining: status.tokensRemaining,
        steps_taken: status.stepsTaken,
        steps_remaining: status.stepsRemaining,
        budget_pct_used: status.budgetPctUsed,
      };
    },
  },
  {
    name: 'session_list_artifacts',
    namespace: 'session',
    description: 'List all artifacts collected in this session.',
    inputSchema: z.object({ type: z.string().optional() }),
    async execute(input, ctx) {
      const artifacts = ctx.artifactStore.list(input.type);
      return { artifacts };
    },
  },
  {
    name: 'session_get_artifact_content',
    namespace: 'session',
    description: 'Get the content of a stored artifact, with optional pagination.',
    inputSchema: z.object({
      artifact_id: z.string(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    }),
    async execute(input, ctx) {
      const content = ctx.artifactStore.readSection(input.artifact_id, input.offset, input.limit);
      const metadata = ctx.artifactStore.getMetadata(input.artifact_id);
      const truncated = input.limit !== undefined && metadata.wordCount > (input.offset ?? 0) + input.limit;
      return { content, wordCount: metadata.wordCount, truncated };
    },
  },
];
