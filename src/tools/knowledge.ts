import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';

const tagsField = z.preprocess(
  v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : undefined),
  z.array(z.string())
).optional();

export const knowledgeTools: AgentToolDefinition[] = [
  {
    name: 'knowledge_add_finding',
    namespace: 'knowledge',
    description: 'Record a factual finding with its source URL and confidence level.',
    inputSchema: z.object({
      fact: z.string(),
      source_url: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      subtask_id: z.string().optional(),
      tags: tagsField,
    }),
    async execute(input, ctx) {
      const id = ctx.knowledgeStore.addFinding(input.fact, input.source_url, input.confidence, input.subtask_id, input.tags);
      return { finding_id: id };
    },
  },
  {
    name: 'knowledge_add_source',
    namespace: 'knowledge',
    description: 'Record a source (web page, paper, report) for citation purposes.',
    inputSchema: z.object({
      url: z.string(),
      title: z.string(),
      type: z.string(),
      reliability: z.string().optional(),
    }),
    async execute(input, ctx) {
      const id = ctx.knowledgeStore.addSource(input.url, input.title, input.type, input.reliability);
      return { source_id: id };
    },
  },
  {
    name: 'knowledge_search_findings',
    namespace: 'knowledge',
    description: 'Search recorded findings by keyword, tags, or subtask.',
    inputSchema: z.object({
      query: z.string().optional(),
      tags: tagsField,
      subtask_id: z.string().optional(),
    }),
    async execute(input, ctx) {
      const findings = ctx.knowledgeStore.searchFindings(input.query, input.tags, input.subtask_id);
      return { findings };
    },
  },
  {
    name: 'knowledge_list_sources',
    namespace: 'knowledge',
    description: 'List all recorded sources, optionally filtered by type.',
    inputSchema: z.object({ type: z.string().optional() }),
    async execute(input, ctx) {
      const sources = ctx.knowledgeStore.listSources(input.type);
      return { sources };
    },
  },
  {
    name: 'knowledge_note_contradiction',
    namespace: 'knowledge',
    description: 'Flag a contradiction between two findings.',
    inputSchema: z.object({
      finding_id_a: z.string(),
      finding_id_b: z.string(),
      description: z.string(),
    }),
    async execute(input, ctx) {
      const id = ctx.knowledgeStore.noteContradiction(input.finding_id_a, input.finding_id_b, input.description);
      return { contradiction_id: id };
    },
  },
  {
    name: 'knowledge_get_contradictions',
    namespace: 'knowledge',
    description: 'Get all noted contradictions in the research.',
    inputSchema: z.object({}),
    async execute(_, ctx) {
      return { contradictions: ctx.knowledgeStore.getContradictions() };
    },
  },
  {
    name: 'knowledge_get_summary',
    namespace: 'knowledge',
    description: 'Get a summary of all accumulated knowledge: finding count, source count, tags.',
    inputSchema: z.object({}),
    async execute(_, ctx) {
      return ctx.knowledgeStore.getSummary();
    },
  },
];
