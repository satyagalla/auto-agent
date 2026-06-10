import { describe, it, expect } from 'vitest';
import { compactIfNeeded, formatToolResult } from '../../src/agent/context.js';
import type { LLMMessage } from '../../src/llm/provider.js';

function makeMessages(count: number): LLMMessage[] {
  const msgs: LLMMessage[] = [{ role: 'user', content: 'research question' }];
  for (let i = 0; i < count - 1; i++) {
    if (i % 2 === 0) {
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: `assistant turn ${i}` }] });
    } else {
      msgs.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `id_${i}`, content: `result ${i}`, is_error: false }],
      });
    }
  }
  return msgs;
}

describe('compactIfNeeded', () => {
  it('returns unchanged when under 60% threshold', () => {
    const msgs = makeMessages(20);
    const result = compactIfNeeded(msgs, 100_000, 200_000);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(msgs);
  });

  it('returns unchanged when <= 12 messages regardless of token count', () => {
    const msgs = makeMessages(12);
    const result = compactIfNeeded(msgs, 180_000, 200_000);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(msgs);
  });

  it('compacts middle at/above 70% threshold', () => {
    const msgs = makeMessages(25);
    const result = compactIfNeeded(msgs, 150_000, 200_000);
    expect(result.compacted).toBe(true);

    // First message preserved verbatim
    expect(result.messages[0]).toEqual(msgs[0]);

    // Last 10 preserved verbatim
    const last10 = msgs.slice(-10);
    const resultLast10 = result.messages.slice(-10);
    expect(resultLast10).toEqual(last10);

    // Middle tool_result blocks stubbed
    const middle = result.messages.slice(1, result.messages.length - 10);
    for (const msg of middle) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            expect(block.content).toBe('[Prior result — see findings]');
          }
        }
      }
    }
  });

  it('preserves is_error on stubbed tool_result blocks', () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'question' },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
        content: i % 2 === 0
          ? [{ type: 'text' as const, text: 'resp' }]
          : [{ type: 'tool_result' as const, tool_use_id: `id_${i}`, content: 'err', is_error: true }],
      })),
    ];
    const result = compactIfNeeded(msgs, 150_000, 200_000);
    expect(result.compacted).toBe(true);
    const middle = result.messages.slice(1, result.messages.length - 10);
    for (const msg of middle) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            expect(block.is_error).toBe(true);
          }
        }
      }
    }
  });

  it('does not mutate input messages array', () => {
    const msgs = makeMessages(25);
    const original = JSON.stringify(msgs);
    compactIfNeeded(msgs, 150_000, 200_000);
    expect(JSON.stringify(msgs)).toBe(original);
  });
});


describe('formatToolResult', () => {
  it('truncates at 8000 chars', () => {
    const long = 'x'.repeat(9000);
    const result = formatToolResult('id1', long, false);
    expect(result.content.length).toBeLessThanOrEqual(8020);
    expect(result.content).toContain('…[truncated]');
  });

  it('preserves is_error flag', () => {
    const r = formatToolResult('id2', 'error message', true);
    expect(r.is_error).toBe(true);
    expect(r.type).toBe('tool_result');
  });
});
