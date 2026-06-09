import { describe, it, expect, vi } from 'vitest';
import { codeTools } from '../../src/tools/code.js';
import { ArtifactStore } from '../../src/store/artifacts.js';
import type { ToolContext } from '../../src/tools/types.js';

const mockStore = {
  read: vi.fn().mockReturnValue({ content: '{"data": [1, 2, 3]}', metadata: {} }),
} as unknown as ArtifactStore;

const ctx = { artifactStore: mockStore } as unknown as ToolContext;

describe('code_execute_js', () => {
  const tool = codeTools.find(t => t.name === 'code_execute_js')!;

  it('executes JS and captures console output', async () => {
    const result = await tool.execute({ code: 'console.log("hello"); return 42;' }, ctx) as { stdout: string; result: number };
    expect(result.stdout).toBe('hello');
    expect(result.result).toBe(42);
  });

  it('catches errors gracefully', async () => {
    const result = await tool.execute({ code: 'throw new Error("boom");' }, ctx) as { error: string };
    expect(result.error).toContain('boom');
  });
});

describe('code_regex_extract', () => {
  const tool = codeTools.find(t => t.name === 'code_regex_extract')!;

  it('extracts regex matches from artifact', async () => {
    const store = {
      read: vi.fn().mockReturnValue({ content: 'foo 123 bar 456 baz 789' }),
    } as unknown as ArtifactStore;
    const result = await tool.execute(
      { artifact_id: 'art_1', pattern: '\\d+', flags: 'g' },
      { artifactStore: store } as unknown as ToolContext
    ) as { matches: string[]; matchCount: number };
    expect(result.matches).toEqual(['123', '456', '789']);
    expect(result.matchCount).toBe(3);
  });
});

describe('code_json_query', () => {
  const tool = codeTools.find(t => t.name === 'code_json_query')!;

  it('navigates JSON path', async () => {
    const result = await tool.execute({ artifact_id: 'x', path: 'data' }, ctx) as { result: number[] };
    expect(result.result).toEqual([1, 2, 3]);
  });
});
