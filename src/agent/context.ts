import type { LLMMessage, ContentBlock, ToolResultBlock } from '../llm/provider.js';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

export function compactIfNeeded(
  messages: LLMMessage[],
  lastInputTokens: number,
  windowLimit: number
): { messages: LLMMessage[]; compacted: boolean } {
  if (messages.length <= 12) return { messages, compacted: false };
  if (lastInputTokens < windowLimit * 0.60) return { messages, compacted: false };

  const first = messages[0];
  const recent = messages.slice(-10);
  const middle = messages.slice(1, messages.length - 10);

  const compactedMiddle = middle.map(msg => {
    if (msg.role !== 'user') return msg;
    if (typeof msg.content === 'string') return msg;
    const content = msg.content.map(block => {
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result' as const,
          tool_use_id: (block as ToolResultBlock).tool_use_id,
          content: '[Prior result — see findings]',
          is_error: (block as ToolResultBlock).is_error ?? false,
        } as ContentBlock;
      }
      return block;
    });
    return { ...msg, content };
  });

  return { messages: [first, ...compactedMiddle, ...recent], compacted: true };
}


export function formatToolResult(
  toolUseId: string,
  result: unknown,
  isError: boolean
): ContentBlock {
  const content = truncate(
    isError ? (typeof result === 'string' ? result : String(result)) : JSON.stringify(result),
    8000
  );

  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}
