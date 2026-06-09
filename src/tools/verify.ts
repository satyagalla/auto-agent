import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';
import { config } from '../infra/config.js';
import { ApiError } from '../infra/errors.js';

async function tavilySearch(query: string, apiKey: string) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  });
  if (!res.ok) throw new ApiError(`Tavily error: ${res.status}`, res.status);
  return res.json() as Promise<{ results: { url: string; content: string }[] }>;
}

function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return intersection / Math.max(setA.size, 1);
}

export const verifyTools: AgentToolDefinition[] = [
  {
    name: 'verify_cross_reference',
    namespace: 'verify',
    description: 'Search for corroboration of a claim across multiple web sources.',
    inputSchema: z.object({
      claim: z.string(),
      exclude_sources: z.array(z.string()).optional(),
    }),
    retryable: true,
    rateLimitKey: 'tavily',
    async execute(input) {
      if (!config.tavily.apiKey) return { corroborations: [], count: 0, error: 'TAVILY_API_KEY not configured' };
      const data = await tavilySearch(input.claim, config.tavily.apiKey);
      const excluded = new Set(input.exclude_sources ?? []);
      const corroborations = data.results
        .filter(r => !excluded.has(r.url))
        .filter(r => tokenOverlap(input.claim, r.content) > 0.2)
        .map(r => ({ source_url: r.url, excerpt: r.content.slice(0, 200) }));
      return { corroborations, count: corroborations.length };
    },
  },
  {
    name: 'verify_wayback_lookup',
    namespace: 'verify',
    description: 'Check if a URL is archived in the Wayback Machine.',
    inputSchema: z.object({ url: z.string(), date: z.string().optional() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      const params = new URLSearchParams({ url: input.url });
      if (input.date) params.set('timestamp', input.date.replace(/-/g, ''));
      const res = await fetch(`https://archive.org/wayback/available?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { available: false };
      const data = await res.json() as { archived_snapshots?: { closest?: { url: string; timestamp: string; available: boolean } } };
      const snapshot = data.archived_snapshots?.closest;
      return {
        available: snapshot?.available ?? false,
        closest_snapshot: snapshot?.available
          ? { url: snapshot.url, timestamp: snapshot.timestamp }
          : undefined,
      };
    },
  },
  {
    name: 'verify_check_retraction',
    namespace: 'verify',
    description: 'Check if an academic paper has been retracted using CrossRef.',
    inputSchema: z.object({ title: z.string().optional(), doi: z.string().optional() }),
    async execute(input) {
      if (!input.title && !input.doi) return { retracted: false, source: 'no identifier provided' };
      try {
        let url: string;
        if (input.doi) {
          url = `https://api.crossref.org/works/${encodeURIComponent(input.doi)}`;
        } else {
          url = `https://api.crossref.org/works?query.title=${encodeURIComponent(input.title!)}&rows=1`;
        }
        const res = await fetch(url, {
          headers: { 'User-Agent': 'ResearchAgent/1.0 (mailto:research@example.com)' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { retracted: false, source: 'crossref (unavailable)' };
        const data = await res.json() as { message?: { 'update-to'?: unknown[]; relation?: Record<string, unknown> } };
        const msg = data.message;
        const retracted = !!(msg?.['update-to']?.length || msg?.relation?.['is-retraction-of']);
        return { retracted, source: 'crossref' };
      } catch {
        return { retracted: false, source: 'crossref (error)' };
      }
    },
  },
  {
    name: 'verify_domain_info',
    namespace: 'verify',
    description: 'Classify a domain: government, academic, news, commercial, etc.',
    inputSchema: z.object({ domain: z.string() }),
    async execute(input) {
      const domain = input.domain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      const tld = domain.split('.').slice(-1)[0];
      const secondLevel = domain.split('.').slice(-2).join('.');
      const govTlds = new Set(['gov', 'mil', 'gc.ca', 'gov.uk', 'gouv.fr', 'bund.de']);
      const eduTlds = new Set(['edu', 'ac.uk', 'edu.au', 'ac.nz', 'ac.jp']);
      const newsDomains = ['nytimes.com', 'bbc.com', 'reuters.com', 'apnews.com', 'theguardian.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com', 'nature.com', 'science.org', 'sciencemag.org'];

      const is_government = govTlds.has(tld) || govTlds.has(secondLevel);
      const is_academic = eduTlds.has(tld) || eduTlds.has(secondLevel) || domain.includes('.ac.');
      const is_news = newsDomains.some(d => domain.includes(d));

      return {
        domain,
        tld,
        tld_type: is_government ? 'government' : is_academic ? 'academic' : is_news ? 'news' : 'commercial',
        is_government,
        is_academic,
        is_news,
      };
    },
  },
];
