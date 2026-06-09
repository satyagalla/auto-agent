import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new ToolRegistry();
    reg.register({
      name: 'test_tool',
      namespace: 'test',
      description: 'A test tool',
      inputSchema: z.object({ input: z.string() }),
      async execute() { return { ok: true }; },
    });
    const tool = reg.get('test_tool');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('test_tool');
  });

  it('lists tools by namespace', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'a_foo', namespace: 'a', description: '', inputSchema: z.object({}), async execute() { return {}; } });
    reg.register({ name: 'b_bar', namespace: 'b', description: '', inputSchema: z.object({}), async execute() { return {}; } });
    reg.register({ name: 'a_baz', namespace: 'a', description: '', inputSchema: z.object({}), async execute() { return {}; } });
    expect(reg.getByNamespace('a')).toHaveLength(2);
    expect(reg.getByNamespace('b')).toHaveLength(1);
  });

  it('toLLMTools produces correct format', () => {
    const reg = new ToolRegistry();
    reg.register({
      name: 'my_tool',
      namespace: 'ns',
      description: 'Does stuff',
      inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
      async execute() { return {}; },
    });
    const llmTools = reg.toLLMTools();
    expect(llmTools).toHaveLength(1);
    expect(llmTools[0].name).toBe('my_tool');
    expect(llmTools[0].description).toBe('Does stuff');
    const schema = llmTools[0].input_schema as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('query');
    expect(schema.required).toContain('query');
    expect(schema.required).not.toContain('limit');
  });
});
