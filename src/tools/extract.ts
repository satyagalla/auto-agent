import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';
import { ToolExecutionError } from '../infra/errors.js';

export const extractTools: AgentToolDefinition[] = [
  {
    name: 'extract_entities',
    namespace: 'extract',
    description: 'Extract named entities (people, places, organizations) from an artifact.',
    inputSchema: z.object({ artifact_id: z.string() }),
    async execute(input, ctx) {
      const { content } = ctx.artifactStore.read(input.artifact_id);
      const nlp = (await import('compromise')).default;
      const doc = nlp(content.slice(0, 50000));
      const toFreq = (terms: string[]): { normal: string; count: number }[] => {
        const counts: Record<string, number> = {};
        for (const t of terms) counts[t] = (counts[t] ?? 0) + 1;
        return Object.entries(counts).map(([normal, count]) => ({ normal, count })).sort((a, b) => b.count - a.count);
      };
      const people = toFreq(doc.people().out('array') as string[]);
      const places = toFreq(doc.places().out('array') as string[]);
      const organizations = toFreq(doc.organizations().out('array') as string[]);

      const entities = [
        ...people.slice(0, 15).map(e => ({ name: e.normal, type: 'person', frequency: e.count, context: '' })),
        ...places.slice(0, 10).map(e => ({ name: e.normal, type: 'place', frequency: e.count, context: '' })),
        ...organizations.slice(0, 15).map(e => ({ name: e.normal, type: 'organization', frequency: e.count, context: '' })),
      ];

      // Add context sentence for top entities
      for (const entity of entities.slice(0, 10)) {
        const idx = content.indexOf(entity.name);
        if (idx >= 0) {
          const start = Math.max(0, idx - 80);
          const end = Math.min(content.length, idx + 80);
          entity.context = content.slice(start, end).replace(/\s+/g, ' ').trim();
        }
      }

      return { entities };
    },
  },
  {
    name: 'extract_statistics',
    namespace: 'extract',
    description: 'Extract numerical statistics and data points from an artifact.',
    inputSchema: z.object({ artifact_id: z.string() }),
    async execute(input, ctx) {
      const { content } = ctx.artifactStore.read(input.artifact_id);
      const stats: { value: string; unit?: string; metric: string; context: string }[] = [];

      const patterns = [
        { regex: /\$\s*(\d[\d,.]*)\s*(billion|million|trillion|thousand)/gi, unit: 'USD' },
        { regex: /(\d[\d,.]*)\s*%/g, unit: '%' },
        { regex: /(\d[\d,.]*)\s*(km|miles?|kg|lbs?|GW|MW|kWh|TWh)/gi, unit: undefined },
        { regex: /(\d{1,3}(?:,\d{3})+)/g, unit: undefined },
      ];

      const sentences = content.match(/[^.!?]+[.!?]/g) ?? [];
      for (const sentence of sentences.slice(0, 200)) {
        for (const pattern of patterns) {
          pattern.regex.lastIndex = 0;
          let match;
          while ((match = pattern.regex.exec(sentence)) !== null) {
            if (stats.length >= 50) break;
            stats.push({
              value: match[1],
              unit: match[2] ?? pattern.unit,
              metric: 'numeric',
              context: sentence.trim().slice(0, 150),
            });
          }
        }
      }

      return { statistics: stats.slice(0, 30) };
    },
  },
  {
    name: 'extract_references',
    namespace: 'extract',
    description: 'Extract references, citations, and URLs from an artifact.',
    inputSchema: z.object({ artifact_id: z.string() }),
    async execute(input, ctx) {
      const { content } = ctx.artifactStore.read(input.artifact_id);
      const references: { title?: string; url?: string; doi?: string; year?: number }[] = [];

      const doiMatches = content.matchAll(/10\.\d{4,}\/[^\s"'>]+/g);
      for (const m of doiMatches) {
        references.push({ doi: m[0] });
      }

      const urlMatches = content.matchAll(/https?:\/\/[^\s"'<>)]+/g);
      for (const m of urlMatches) {
        references.push({ url: m[0] });
      }

      const yearMatches = content.matchAll(/\((\d{4})\)/g);
      const years = [...yearMatches].map(m => parseInt(m[1])).filter(y => y >= 1900 && y <= 2030);

      return { references: references.slice(0, 40), years: [...new Set(years)].slice(0, 20) };
    },
  },
  {
    name: 'extract_section',
    namespace: 'extract',
    description: 'Extract a specific section from an artifact by heading name or keyword.',
    inputSchema: z.object({ artifact_id: z.string(), section: z.string() }),
    async execute(input, ctx) {
      const { content } = ctx.artifactStore.read(input.artifact_id);
      const sectionLower = input.section.toLowerCase();
      const lines = content.split('\n');

      let startLine = -1;
      let endLine = lines.length;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(sectionLower) && (lines[i].startsWith('#') || lines[i].length < 100)) {
          startLine = i;
          break;
        }
      }

      if (startLine === -1) {
        // Fallback: find paragraph containing keyword
        const idx = content.toLowerCase().indexOf(sectionLower);
        if (idx === -1) throw new ToolExecutionError(`Section "${input.section}" not found`);
        const start = Math.max(0, content.lastIndexOf('\n\n', idx));
        const end = Math.min(content.length, content.indexOf('\n\n', idx + sectionLower.length) + 500);
        const sectionContent = content.slice(start, end).trim();
        return { content: sectionContent, startOffset: start, wordCount: sectionContent.split(/\s+/).length };
      }

      // Find next heading at same or higher level
      for (let i = startLine + 1; i < lines.length; i++) {
        if (lines[i].match(/^#{1,3}\s/) && i > startLine + 2) {
          endLine = i;
          break;
        }
      }

      const sectionContent = lines.slice(startLine, endLine).join('\n').trim();
      return {
        content: sectionContent,
        startOffset: lines.slice(0, startLine).join('\n').length,
        wordCount: sectionContent.split(/\s+/).filter(Boolean).length,
      };
    },
  },
];
