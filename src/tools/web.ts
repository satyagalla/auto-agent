import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { AgentToolDefinition } from './types.js';
import { config } from '../infra/config.js';
import { ToolExecutionError, ApiError } from '../infra/errors.js';

async function tavilySearch(query: string, maxResults: number, type: string, daysBack?: number) {
  if (!config.tavily.apiKey) throw new ToolExecutionError('TAVILY_API_KEY not configured');
  const body: Record<string, unknown> = {
    api_key: config.tavily.apiKey,
    query,
    max_results: maxResults,
    search_depth: type === 'academic' ? 'advanced' : 'basic',
  };
  if (daysBack) body.days = daysBack;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`Tavily error: ${res.statusText}`, res.status);
  return res.json() as Promise<{ results: { title: string; url: string; content: string; published_date?: string }[] }>;
}

async function extractPageText(url: string): Promise<{ text: string; title: string; byline?: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ResearchAgent/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const buffer = await res.arrayBuffer();
  const charsetRaw = res.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charsetRaw).decode(buffer);
  } catch {
    html = new TextDecoder('utf-8').decode(buffer);
  }
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside, .ads, .advertisement, .cookie-notice').remove();
  const title = $('title').text().trim() || $('h1').first().text().trim();
  // Restrict to inline/small elements to avoid matching large container divs.
  // Normalize whitespace and discard anything that looks like a layout dump (>120 chars).
  const bylineRaw = $('a[rel="author"], [class="author"], [class="byline"], span[class*="author"], span[class*="byline"], p[class*="author"], p[class*="byline"]')
    .first().text().replace(/\s+/g, ' ').trim();
  const byline = bylineRaw && bylineRaw.length <= 120 ? bylineRaw : undefined;
  const article = $('article, main, [role="main"], .content, .post-content, .entry-content').first();
  const text = (article.length ? article : $('body')).text().replace(/\s+/g, ' ').trim();
  return { text, title, byline };
}

async function jinaFetch(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'User-Agent': 'ResearchAgent/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new ApiError(`Jina error: ${res.status}`, res.status);
  return res.text();
}

export const webTools: AgentToolDefinition[] = [
  {
    name: 'web_search',
    namespace: 'web',
    description: 'Search the web for information. Use type="academic" for scholarly sources, type="news" for recent news.',
    inputSchema: z.object({
      query: z.string(),
      maxResults: z.number().optional(),
      type: z.enum(['general', 'academic', 'news']).optional(),
      recency: z.object({ daysBack: z.number() }).optional(),
    }),
    retryable: true,
    rateLimitKey: 'tavily',
    async execute(input, ctx) {
      const data = await tavilySearch(
        input.query,
        input.maxResults ?? 5,
        input.type ?? 'general',
        input.recency?.daysBack
      );
      return {
        results: data.results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content?.slice(0, 400),
          publishedDate: r.published_date,
        })),
      };
    },
  },
  {
    name: 'web_fetch',
    namespace: 'web',
    description: 'Fetch and extract the main text content from a web page. Returns an artifact_id for later reference.',
    inputSchema: z.object({ url: z.string() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input, ctx) {
      let text: string;
      let title = '';
      let byline: string | undefined;

      try {
        const result = await extractPageText(input.url);
        text = result.text;
        title = result.title;
        byline = result.byline;
        if (!text || text.length < 100) throw new Error('Content too short, fallback to Jina');
      } catch {
        const jinaLimiter = (await import('../infra/rate-limiter.js')).rateLimiters.jina;
        await jinaLimiter.acquire();
        text = await jinaFetch(input.url);
        title = input.url;
      }

      const artifactId = ctx.artifactStore.write(text, {
        title,
        source_url: input.url,
        type: 'webpage',
      });

      return {
        artifact_id: artifactId,
        title,
        byline,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        excerpt: text.slice(0, 200),
      };
    },
  },
  {
    name: 'web_fetch_batch',
    namespace: 'web',
    description: 'Fetch multiple web pages in parallel.',
    inputSchema: z.object({ urls: z.array(z.string()) }),
    async execute(input, ctx) {
      const results = await Promise.allSettled(
        (input.urls as string[]).map(async (url: string) => {
          const webFetchTool = (await import('./web.js')).webTools.find(t => t.name === 'web_fetch')!;
          const r = await webFetchTool.execute({ url }, ctx);
          return { url, ...(r as Record<string, unknown>) };
        })
      );
      return {
        results: results.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : { url: input.urls[i], error: (r.reason as Error).message }
        ),
      };
    },
  },
  {
    name: 'web_get_links',
    namespace: 'web',
    description: 'Get all links from a web page. Optional filter to return only matching links.',
    inputSchema: z.object({ url: z.string(), filter: z.string().optional() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      const res = await fetch(input.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
      const html = await res.text();
      const $ = cheerio.load(html);
      const links: { text: string; url: string; context: string }[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const text = $(el).text().trim();
        const context = $(el).parent().text().replace(/\s+/g, ' ').trim().slice(0, 100);
        if (!href || href.startsWith('#')) return;
        const fullUrl = href.startsWith('http') ? href : new URL(href, input.url).toString();
        if (input.filter && !fullUrl.includes(input.filter) && !text.includes(input.filter)) return;
        links.push({ text: text.slice(0, 80), url: fullUrl, context });
      });
      return { links: links.slice(0, 50) };
    },
  },
];
