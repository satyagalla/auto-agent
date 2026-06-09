import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';

export const planningTools: AgentToolDefinition[] = [
  {
    name: 'planning_create',
    namespace: 'planning',
    description: 'Create a research plan with subtasks. Call this early for complex multi-part questions.',
    inputSchema: z.object({
      question: z.string(),
      subtasks: z.array(z.object({
        description: z.string(),
        priority: z.string().optional(),
      })),
      replaces_plan_id: z.string().optional(),
    }),
    async execute(input, ctx) {
      const plan = ctx.planStore.create(input.question, input.subtasks);
      return { plan_id: plan.id, subtasks: plan.subtasks };
    },
  },
  {
    name: 'planning_update_status',
    namespace: 'planning',
    description: 'Update the status of a subtask (pending, in_progress, done, blocked).',
    inputSchema: z.object({
      subtask_id: z.string(),
      status: z.enum(['pending', 'in_progress', 'done', 'blocked']),
      summary: z.string().optional(),
    }),
    async execute(input, ctx) {
      const plan = ctx.planStore.updateStatus(input.subtask_id, input.status, input.summary);
      return { updated: true, plan_summary: ctx.planStore.getPlanSummary() };
    },
  },
  {
    name: 'planning_add_subtask',
    namespace: 'planning',
    description: 'Add a new subtask to the current research plan.',
    inputSchema: z.object({
      description: z.string(),
      priority: z.string().optional(),
    }),
    async execute(input, ctx) {
      const subtaskId = ctx.planStore.addSubtask(input.description, input.priority);
      return { subtask_id: subtaskId, plan_summary: ctx.planStore.getPlanSummary() };
    },
  },
  {
    name: 'planning_remove_subtask',
    namespace: 'planning',
    description: 'Remove a subtask from the plan with a reason.',
    inputSchema: z.object({ subtask_id: z.string(), reason: z.string() }),
    async execute(input, ctx) {
      ctx.planStore.removeSubtask(input.subtask_id, input.reason);
      return { removed: true, plan_summary: ctx.planStore.getPlanSummary() };
    },
  },
  {
    name: 'planning_get_status',
    namespace: 'planning',
    description: 'Get the current status of the research plan.',
    inputSchema: z.object({}),
    async execute(_, ctx) {
      return ctx.planStore.getStatus();
    },
  },
];
