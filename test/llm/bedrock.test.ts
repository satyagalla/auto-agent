import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AWS SDK before importing bedrock
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  const ConverseCommand = vi.fn((input: unknown) => ({ input }));
  const BedrockRuntimeClient = vi.fn(() => ({
    send: vi.fn().mockResolvedValue({
      output: { message: { content: [{ text: 'response' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
    }),
  }));
  return { BedrockRuntimeClient, ConverseCommand };
});

import { BedrockProvider } from '../../src/llm/bedrock.js';
import type { LLMMessage } from '../../src/llm/provider.js';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

describe('BedrockProvider cachePoint injection', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BedrockProvider();
  });

  it('does not inject cachePoint when fewer than 3 messages', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] },
    ];
    await provider.chat({ static: 'sys', dynamic: 'dyn' }, messages, []);
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const msg of cmd.messages) {
      if (Array.isArray(msg.content)) {
        expect(msg.content.every((b: unknown) => !('cachePoint' in (b as object)))).toBe(true);
      }
    }
  });

  it('injects cachePoint into second-to-last user message with 3+ messages', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: 'result', is_error: false }] },
      { role: 'assistant', content: [{ type: 'text', text: 'more thinking' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id2', content: 'result2', is_error: false }] },
    ];
    await provider.chat({ static: 'sys', dynamic: 'dyn' }, messages, []);
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const bedrockMessages = cmd.messages;

    // Second-to-last user message is at index 2 (messages[2], skipping last message[4])
    const targetMsg = bedrockMessages[2];
    const hasCachePoint = (targetMsg.content as unknown[]).some(
      (b: unknown) => b !== null && typeof b === 'object' && 'cachePoint' in (b as object)
    );
    expect(hasCachePoint).toBe(true);

    // Last message should NOT have a cachePoint
    const lastMsg = bedrockMessages[bedrockMessages.length - 1];
    const lastHasCachePoint = (lastMsg.content as unknown[]).some(
      (b: unknown) => b !== null && typeof b === 'object' && 'cachePoint' in (b as object)
    );
    expect(lastHasCachePoint).toBe(false);
  });

  it('does not mutate input messages array', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: 'result', is_error: false }] },
    ];
    const original = JSON.stringify(messages);
    await provider.chat({ static: 'sys', dynamic: 'dyn' }, messages, []);
    expect(JSON.stringify(messages)).toBe(original);
  });

  it('does not inject cachePoint when noCachePoints is true', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: 'result', is_error: false }] },
      { role: 'assistant', content: [{ type: 'text', text: 'more' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id2', content: 'result2', is_error: false }] },
    ];
    await provider.chat({ static: 'sys', noCachePoints: true }, messages, []);
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const msg of cmd.messages) {
      if (Array.isArray(msg.content)) {
        const hasCachePoint = (msg.content as unknown[]).some(
          (b: unknown) => b !== null && typeof b === 'object' && 'cachePoint' in (b as object)
        );
        expect(hasCachePoint).toBe(false);
      }
    }
  });

  it('caches static-only system prompt (no dynamic field)', async () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'q' }];
    await provider.chat({ static: 'static content' }, messages, []);
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemBlocks = cmd.system as unknown[];
    // Should have text block + cachePoint block (trailing)
    expect(systemBlocks.length).toBe(2);
    expect((systemBlocks[0] as { text: string }).text).toBe('static content');
    expect(systemBlocks[1]).toHaveProperty('cachePoint');
  });

  it('caches static section with cachePoint between static and dynamic', async () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'q' }];
    await provider.chat({ static: 'static', dynamic: 'dynamic' }, messages, []);
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemBlocks = cmd.system as unknown[];
    expect(systemBlocks.length).toBe(3);
    expect((systemBlocks[0] as { text: string }).text).toBe('static');
    expect(systemBlocks[1]).toHaveProperty('cachePoint');
    expect((systemBlocks[2] as { text: string }).text).toBe('dynamic');
  });

  it('does not cache system when noCachePoints is true', async () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'q' }];
    await provider.chat({ static: 'static', noCachePoints: true }, messages, []);
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemBlocks = cmd.system as unknown[];
    expect(systemBlocks.length).toBe(1);
    expect(systemBlocks[0]).not.toHaveProperty('cachePoint');
  });

  it('uses options.model when provided', async () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'q' }];
    await provider.chat({ static: 'sys' }, messages, [], { model: 'custom-model' });
    const cmd = (ConverseCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cmd.modelId).toBe('custom-model');
  });
});
