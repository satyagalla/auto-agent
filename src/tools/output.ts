import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentToolDefinition } from './types.js';

function formatCitation(source: { url: string; title: string; type: string }, style: string, index: number): string {
  const title = source.title || source.url;
  const year = new Date().getFullYear();
  if (style === 'mla') return `"${title}." Web. ${year}. <${source.url}>.`;
  if (style === 'chicago') return `${index}. "${title}." Accessed ${year}. ${source.url}.`;
  // APA default
  return `(${year}). ${title}. Retrieved from ${source.url}`;
}

export const outputTools: AgentToolDefinition[] = [
  {
    name: 'output_write_report',
    namespace: 'output',
    description: 'Write the final research report to a markdown file.',
    inputSchema: z.object({
      filename: z.string(),
      content: z.string(),
      title: z.string(),
    }),
    async execute(input) {
      const dir = join(process.cwd(), 'output');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const filename = input.filename.endsWith('.md') ? input.filename : `${input.filename}.md`;
      const fullContent = `# ${input.title}\n\n${input.content}`;
      const path = join(dir, filename);
      writeFileSync(path, fullContent, 'utf-8');
      const wordCount = fullContent.split(/\s+/).filter(Boolean).length;
      return { path, wordCount };
    },
  },
  {
    name: 'output_export_findings_json',
    namespace: 'output',
    description: 'Export all findings and sources as a JSON file.',
    inputSchema: z.object({ filename: z.string().optional() }),
    async execute(input, ctx) {
      const dir = join(process.cwd(), 'output');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const findings = ctx.knowledgeStore.getFindings();
      const sources = ctx.knowledgeStore.listSources();
      const data = { findings, sources, exportedAt: new Date().toISOString() };
      const filename = `${input.filename ?? 'findings'}.json`;
      const path = join(dir, filename);
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
      return { path, finding_count: findings.length, source_count: sources.length };
    },
  },
  {
    name: 'output_create_bibliography',
    namespace: 'output',
    description: 'Generate a formatted bibliography from all recorded sources.',
    inputSchema: z.object({ style: z.enum(['apa', 'mla', 'chicago']).optional() }),
    async execute(input, ctx) {
      const sources = ctx.knowledgeStore.listSources();
      const style = input.style ?? 'apa';
      const bibliography = sources.map((s, i) => formatCitation(s, style, i + 1)).join('\n\n');
      return { bibliography, source_count: sources.length };
    },
  },
];
