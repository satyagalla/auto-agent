import type { LLMMessage, ContentBlock, ToolResultBlock } from '../llm/provider.js';
import { config } from '../infra/config.js';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

export function buildMessages(history: LLMMessage[]): LLMMessage[] {
  if (history.length <= config.context.keepRecentMessages) return history;
  if (history.length <= config.context.maxMessages) return history;

  // Keep first message (the question) + most recent messages
  const recent = history.slice(-config.context.keepRecentMessages);
  const first = history[0];

  // Drop old tool results to save tokens
  const dropped = history.slice(1, history.length - config.context.keepRecentMessages).map(msg => {
    if (msg.role !== 'user') return msg;
    if (typeof msg.content === 'string') return msg;
    const content = msg.content.map(block => {
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result' as const,
          tool_use_id: (block as ToolResultBlock).tool_use_id,
          content: '[Result processed — findings recorded in knowledge store]',
          is_error: (block as ToolResultBlock).is_error ?? false,
        } as ContentBlock;
      }
      return block;
    });
    return { ...msg, content };
  });

  return [first, ...dropped, ...recent];
}

export function formatToolResult(
  toolUseId: string,
  result: unknown,
  isError: boolean
): ContentBlock {
  const content = isError
    ? (typeof result === 'string' ? result : String(result))
    : truncate(JSON.stringify(result), 1000);

  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}
