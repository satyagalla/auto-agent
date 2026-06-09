import type { AgentToolDefinition } from './types.js';
import type { ToolDefinition as LLMToolDefinition } from '../llm/provider.js';

function zodToJsonSchema(schema: import('zod').ZodSchema): object {
  // Minimal Zod -> JSON Schema converter for the shapes used in this project
  return zodToJson(schema);
}

function zodToJson(schema: import('zod').ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def: Record<string, unknown> })._def;
  const typeName = def.typeName as string;

  if (typeName === 'ZodObject') {
    const shape = (def.shape as () => Record<string, import('zod').ZodTypeAny>)();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(shape)) {
      const valueDef = (val as { _def: Record<string, unknown> })._def;
      const isOptional = valueDef.typeName === 'ZodOptional';
      properties[key] = zodToJson(isOptional ? (valueDef.innerType as import('zod').ZodTypeAny) : val);
      if (!isOptional) required.push(key);
    }
    const result: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
  }
  if (typeName === 'ZodString') {
    const result: Record<string, unknown> = { type: 'string' };
    if (def.description) result.description = def.description;
    return result;
  }
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodArray') {
    return { type: 'array', items: zodToJson(def.type as import('zod').ZodTypeAny) };
  }
  if (typeName === 'ZodEnum') {
    return { type: 'string', enum: (def.values as string[]) };
  }
  if (typeName === 'ZodOptional') {
    return zodToJson(def.innerType as import('zod').ZodTypeAny);
  }
  if (typeName === 'ZodDefault') {
    return zodToJson(def.innerType as import('zod').ZodTypeAny);
  }
  if (typeName === 'ZodUnion') {
    return { oneOf: (def.options as import('zod').ZodTypeAny[]).map(zodToJson) };
  }
  if (typeName === 'ZodRecord') {
    return { type: 'object', additionalProperties: zodToJson(def.valueType as import('zod').ZodTypeAny) };
  }
  if (typeName === 'ZodAny') return {};
  if (typeName === 'ZodUnknown') return {};
  if (typeName === 'ZodNullable') {
    const inner = zodToJson(def.innerType as import('zod').ZodTypeAny);
    return { ...inner, nullable: true };
  }
  if (typeName === 'ZodLiteral') return { type: typeof def.value, enum: [def.value] };
  return {};
}

export class ToolRegistry {
  private tools = new Map<string, AgentToolDefinition>();

  register(tool: AgentToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getByNamespace(namespace: string): AgentToolDefinition[] {
    return this.getAll().filter(t => t.namespace === namespace);
  }

  toLLMTools(): LLMToolDefinition[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.inputSchema),
    }));
  }
}

export const registry = new ToolRegistry();
