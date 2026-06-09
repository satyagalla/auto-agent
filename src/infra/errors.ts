export class AgentError extends Error {
  code: string;
  recoverable: boolean;
  context?: Record<string, unknown>;

  constructor(message: string, code: string, recoverable: boolean, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

export class NetworkError extends AgentError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', true, context);
  }
}

export class RateLimitError extends AgentError {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number, context?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT_ERROR', true, context);
    this.retryAfterMs = retryAfterMs;
  }
}

export class ApiError extends AgentError {
  status: number;
  constructor(message: string, status: number, context?: Record<string, unknown>) {
    const recoverable = status >= 500;
    super(message, 'API_ERROR', recoverable, context);
    this.status = status;
  }
}

export class ToolExecutionError extends AgentError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'TOOL_EXECUTION_ERROR', false, context);
  }
}

export class ValidationError extends AgentError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', false, context);
  }
}

export class BudgetExhaustedError extends AgentError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BUDGET_EXHAUSTED', false, context);
  }
}

export class ArtifactNotFoundError extends AgentError {
  constructor(artifactId: string) {
    super(`Artifact not found: ${artifactId}`, 'ARTIFACT_NOT_FOUND', false, { artifactId });
  }
}
