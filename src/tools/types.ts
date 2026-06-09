import { z } from 'zod';
import type { ArtifactStore } from '../store/artifacts.js';
import type { KnowledgeStore } from '../store/knowledge.js';
import type { PlanStore } from '../store/plan.js';
import type { BudgetTracker } from '../infra/budget.js';
import type { Logger } from 'pino';

export interface ToolContext {
  artifactStore: ArtifactStore;
  knowledgeStore: KnowledgeStore;
  planStore: PlanStore;
  budgetTracker: BudgetTracker;
  logger: Logger;
  sessionId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AgentToolDefinition {
  name: string;
  namespace: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
  execute: (input: any, context: ToolContext) => Promise<any>; // Zod validates before execute is called
  retryable?: boolean;
  rateLimitKey?: string;
}
