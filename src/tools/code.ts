import { z } from 'zod';
import * as vm from 'vm';
import type { AgentToolDefinition } from './types.js';
import { ToolExecutionError } from '../infra/errors.js';

export const codeTools: AgentToolDefinition[] = [
  {
    name: 'code_execute_js',
    namespace: 'code',
    description: 'Execute JavaScript code in a sandbox. Console output is captured. Artifact content can be accessed via artifacts object.',
    inputSchema: z.object({
      code: z.string(),
      artifact_ids: z.array(z.string()).optional(),
    }),
    async execute(input, ctx) {
      const logs: string[] = [];
      const artifacts: Record<string, string> = {};

      if (input.artifact_ids) {
        for (const id of input.artifact_ids) {
          const { content } = ctx.artifactStore.read(id);
          artifacts[id] = content;
        }
      }

      const sandbox = {
        console: { log: (...args: unknown[]) => logs.push(args.map(String).join(' ')) },
        Math,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        artifacts,
        result: undefined as unknown,
      };

      vm.createContext(sandbox);

      try {
        const wrapped = `result = (function() { ${input.code} })();`;
        const script = new vm.Script(wrapped);
        script.runInContext(sandbox, { timeout: 5000 });
      } catch (err) {
        return { stdout: logs.join('\n'), error: (err as Error).message };
      }

      return {
        stdout: logs.join('\n'),
        result: sandbox.result !== undefined ? sandbox.result : undefined,
      };
    },
  },
  {
    name: 'code_regex_extract',
    namespace: 'code',
    description: 'Apply a regular expression to an artifact and return all matches.',
    inputSchema: z.object({
      artifact_id: z.string(),
      pattern: z.string(),
      flags: z.string().optional(),
    }),
    async execute(input, ctx) {
      const { content } = ctx.artifactStore.read(input.artifact_id);
      let regex: RegExp;
      try {
        regex = new RegExp(input.pattern, input.flags ?? 'g');
      } catch {
        throw new ToolExecutionError(`Invalid regex: ${input.pattern}`);
      }
      const matches: string[] = [];
      const groups: Record<string, string>[] = [];
      for (const match of content.matchAll(regex)) {
        matches.push(match[0]);
        if (match.groups) groups.push(match.groups);
        if (matches.length >= 100) break;
      }
      return { matches, groups, matchCount: matches.length };
    },
  },
  {
    name: 'code_json_query',
    namespace: 'code',
    description: 'Query JSON content in an artifact using dot-notation path (e.g., "data.results[0].name").',
    inputSchema: z.object({ artifact_id: z.string(), path: z.string() }),
    async execute(input, ctx) {
      const { content } = ctx.artifactStore.read(input.artifact_id);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new ToolExecutionError('Artifact content is not valid JSON');
      }
      const parts = (input.path as string).split('.').flatMap((p: string) => {
        const arrMatch = p.match(/^(.+?)\[(\d+)\]$/);
        return arrMatch ? [arrMatch[1], parseInt(arrMatch[2])] : [p];
      });
      let current: unknown = parsed;
      for (const part of parts) {
        if (current === null || current === undefined) break;
        current = (current as Record<string | number, unknown>)[part as string | number];
      }
      return { result: current };
    },
  },
];
