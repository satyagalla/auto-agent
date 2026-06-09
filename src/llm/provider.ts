export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[] | string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

export interface SystemPrompt {
  static: string;
  dynamic?: string;
  noCachePoints?: boolean;
}

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
}

export interface LLMProvider {
  chat(
    system: SystemPrompt,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options?: { maxTokens?: number }
  ): Promise<LLMResponse>;
}
