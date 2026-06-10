import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type Message,
  type ContentBlock as BedrockContentBlock,
  type Tool,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../infra/config.js';
import { withRetry } from '../infra/retry.js';
import { rateLimiters } from '../infra/rate-limiter.js';
import { NetworkError, RateLimitError, ApiError } from '../infra/errors.js';
import type { LLMProvider, LLMMessage, LLMResponse, ToolDefinition, ContentBlock, SystemPrompt } from './provider.js';

export class BedrockProvider implements LLMProvider {
  private client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region: config.aws.region,
      ...(config.aws.accessKeyId && config.aws.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.aws.accessKeyId,
              secretAccessKey: config.aws.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async chat(
    system: SystemPrompt,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options?: { maxTokens?: number; model?: string }
  ): Promise<LLMResponse> {
    await rateLimiters.default.acquire();

    return withRetry(async () => {
      const bedrockMessages = messages.map(m => this.toBedrockMessage(m));

      // Inject cachePoint into second-to-last user message to cache conversation prefix.
      // Skip if conversation is too short (no prior user turn to cache), or caching is disabled.
      if (!system.noCachePoints && bedrockMessages.length >= 3) {
        // Walk backwards from end, skipping the last message, find first user message.
        let targetIdx = -1;
        for (let i = bedrockMessages.length - 2; i >= 0; i--) {
          if (bedrockMessages[i].role === 'user') {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx !== -1) {
          const target = bedrockMessages[targetIdx];
          bedrockMessages[targetIdx] = {
            ...target,
            content: [...(target.content ?? []), { cachePoint: { type: 'default' as const } }] as BedrockContentBlock[],
          };
        }
      }

      const bedrockTools: Tool[] = tools.map(t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.input_schema } as ToolInputSchema,
        },
      }));

      // Cache the system prompt and tools. When there is a dynamic section, the cachePoint sits
      // between static and dynamic so only the stable prefix is cached. When the prompt is fully
      // static (no dynamic), the cachePoint trails the static block — valid because nothing follows
      // it in the system array and the static content itself is the cacheable unit.
      // noCachePoints disables all caching for callers that don't want cache write charges.
      const useCache = !system.noCachePoints;
      const systemBlocks = useCache
        ? system.dynamic
          ? [{ text: system.static }, { cachePoint: { type: 'default' as const } }, { text: system.dynamic }]
          : [{ text: system.static }, { cachePoint: { type: 'default' as const } }]
        : [{ text: system.static + (system.dynamic ? '\n\n' + system.dynamic : '') }];

      const command = new ConverseCommand({
        modelId: options?.model ?? config.model,
        system: systemBlocks as ConverseCommandInput['system'],
        messages: bedrockMessages,
        toolConfig: tools.length > 0
          ? {
              tools: bedrockTools,
              ...(useCache ? { cachePoint: { type: 'default' as const } } : {}),
            } as ConverseCommandInput['toolConfig']
          : undefined,
        inferenceConfig: {
          maxTokens: options?.maxTokens ?? 4096,
        },
      });

      let response;
      try {
        response = await this.client.send(command);
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
        if (error.name === 'ThrottlingException' || error.name === 'ServiceQuotaExceededException') {
          throw new RateLimitError(error.message ?? 'Rate limited by Bedrock');
        }
        if (error.$metadata?.httpStatusCode) {
          const status = error.$metadata.httpStatusCode;
          if (status >= 500) throw new NetworkError(error.message ?? 'Bedrock server error');
          throw new ApiError(error.message ?? 'Bedrock API error', status);
        }
        throw new NetworkError(error.message ?? 'Bedrock network error');
      }

      const outputMsg = response.output?.message;
      if (!outputMsg) throw new Error('Empty response from Bedrock');

      const content: ContentBlock[] = (outputMsg.content ?? []).map(block => {
        if ('text' in block && block.text !== undefined) {
          return { type: 'text' as const, text: block.text };
        }
        if ('toolUse' in block && block.toolUse) {
          return {
            type: 'tool_use' as const,
            id: block.toolUse.toolUseId ?? '',
            name: block.toolUse.name ?? '',
            input: (block.toolUse.input as Record<string, unknown>) ?? {},
          };
        }
        return { type: 'text' as const, text: '' };
      });

      const stopReason = response.stopReason ?? 'end_turn';
      const normalizedStop =
        stopReason === 'tool_use'
          ? 'tool_use'
          : stopReason === 'max_tokens'
          ? 'max_tokens'
          : 'end_turn';

      return {
        content,
        stop_reason: normalizedStop,
        usage: {
          input_tokens: response.usage?.inputTokens ?? 0,
          output_tokens: response.usage?.outputTokens ?? 0,
          cache_read_tokens: response.usage?.cacheReadInputTokens ?? 0,
          cache_write_tokens: response.usage?.cacheWriteInputTokens ?? 0,
        },
      };
    });
  }

  private toBedrockMessage(msg: LLMMessage): Message {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: [{ text: msg.content }] };
    }

    const content = msg.content.map(block => {
      if (block.type === 'text') {
        return { text: block.text };
      }
      if (block.type === 'tool_use') {
        return {
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.input,
          },
        };
      }
      if (block.type === 'tool_result') {
        return {
          toolResult: {
            toolUseId: block.tool_use_id,
            content: [{ text: block.content }],
            status: block.is_error ? ('error' as const) : ('success' as const),
          },
        };
      }
      return { text: '' };
    }) as BedrockContentBlock[];

    return { role: msg.role, content };
  }
}
