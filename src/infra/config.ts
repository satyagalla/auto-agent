import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load .env manually (no dotenv dependency in some envs)
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  aws: {
    region: optional('AWS_REGION', 'us-east-1'),
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY ?? '',
  },
  fred: {
    apiKey: process.env.FRED_API_KEY ?? '',
  },
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
  },
  model: 'us.anthropic.claude-sonnet-4-5-20251001-v1:0',
  maxSteps: 50,
  tokenBudget: 200_000,
  budgetReservePercent: 15,
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30_000,
  },
  rateLimits: {
    tavily: { maxRequests: 20, windowMs: 60_000 },
    jina: { maxRequests: 20, windowMs: 60_000 },
    github: { maxRequests: 60, windowMs: 3_600_000 },
    default: { maxRequests: 10, windowMs: 60_000 },
  },
  context: {
    maxMessages: 40,
    keepRecentMessages: 8,
  },
  subagent: {
    maxSteps: 15,
    maxTokens: 50_000,
  },
};
