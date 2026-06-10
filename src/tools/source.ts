import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { AgentToolDefinition } from './types.js';
import { ToolExecutionError, ApiError } from '../infra/errors.js';

export const sourceTools: AgentToolDefinition[] = [
  {
    name: 'source_fetch_pdf',
    namespace: 'source',
    description: 'Fetch a PDF from a URL and extract its text content.',
    inputSchema: z.object({ url: z.string() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input, ctx) {
      const MAX_PDF_BYTES = 10 * 1024 * 1024;
      const res = await fetch(input.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
      const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
      if (contentLength > MAX_PDF_BYTES) throw new ToolExecutionError(`PDF too large: ${Math.round(contentLength / 1024 / 1024)}MB (limit 10MB)`);

      if (!res.body) throw new ToolExecutionError('PDF response has no body');
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        if (totalBytes > MAX_PDF_BYTES) {
          reader.cancel();
          throw new ToolExecutionError(`PDF too large: >${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB (limit 10MB)`);
        }
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      let text = '';
      let pageCount = 0;
      try {
        const pdfParse = await import('pdf-parse');
        const parsed = await pdfParse.default(buffer);
        text = parsed.text;
        pageCount = parsed.numpages;
      } catch {
        text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ');
        pageCount = 0;
      }
      const artifactId = ctx.artifactStore.write(text, {
        source_url: input.url,
        type: 'pdf',
      });
      return {
        artifact_id: artifactId,
        pageCount,
        excerpt: text.slice(0, 300),
      };
    },
  },
  {
    name: 'source_fetch_arxiv',
    namespace: 'source',
    description: 'Fetch an arXiv paper by ID, extract abstract and full text.',
    inputSchema: z.object({ arxiv_id: z.string() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input, ctx) {
      const res = await fetch(`https://export.arxiv.org/api/query?id_list=${input.arxiv_id}`);
      if (!res.ok) throw new ApiError(`arXiv API error: ${res.status}`, res.status);
      const xml = await res.text();
      const titleMatch = xml.match(/<title>([^<]+)<\/title>/);
      const abstractMatch = xml.match(/<summary>([^<]+)<\/summary>/s);
      const authorMatches = [...xml.matchAll(/<name>([^<]+)<\/name>/g)];
      const yearMatch = xml.match(/<published>(\d{4})/);
      const pdfLinkMatch = xml.match(/href="([^"]+\/pdf\/[^"]+)"/);

      const title = titleMatch?.[1]?.trim() ?? input.arxiv_id;
      const abstract = abstractMatch?.[1]?.trim() ?? '';
      const authors = authorMatches.map(m => m[1]);
      const year = yearMatch?.[1] ? parseInt(yearMatch[1]) : undefined;

      let fullText = `${title}\n\n${abstract}`;
      if (pdfLinkMatch) {
        try {
          const pdfRes = await fetch(pdfLinkMatch[1], { signal: AbortSignal.timeout(30000) });
          if (pdfRes.ok) {
            const buf = Buffer.from(await pdfRes.arrayBuffer());
            const pdfParse = await import('pdf-parse');
            const parsed = await pdfParse.default(buf);
            fullText = parsed.text;
          }
        } catch { /* use abstract only */ }
      }

      const artifactId = ctx.artifactStore.write(fullText, {
        title,
        source_url: `https://arxiv.org/abs/${input.arxiv_id}`,
        type: 'arxiv',
      });

      return { artifact_id: artifactId, title, authors, abstract, year };
    },
  },
  {
    name: 'source_fetch_wikipedia',
    namespace: 'source',
    description: 'Fetch a Wikipedia article by topic.',
    inputSchema: z.object({ topic: z.string() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input, ctx) {
      const encoded = encodeURIComponent(input.topic.replace(/ /g, '_'));
      const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
      if (!summaryRes.ok) throw new ApiError(`Wikipedia error: ${summaryRes.status}`, summaryRes.status);
      const summary = await summaryRes.json() as { title: string; extract: string };

      const htmlRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encoded}`);
      let sections: string[] = [];
      let fullText = summary.extract;
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const $ = cheerio.load(html);
        $('section').each((_, el) => {
          const heading = $(el).find('h2, h3').first().text().trim();
          const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 500);
          if (heading) sections.push(heading);
          fullText += '\n\n' + text;
        });
      }

      const artifactId = ctx.artifactStore.write(fullText, {
        title: summary.title,
        source_url: `https://en.wikipedia.org/wiki/${encoded}`,
        type: 'wikipedia',
      });

      return { artifact_id: artifactId, title: summary.title, summary: summary.extract, sections };
    },
  },
  {
    name: 'source_fetch_youtube_transcript',
    namespace: 'source',
    description: 'Attempt to fetch a YouTube video transcript.',
    inputSchema: z.object({ videoId: z.string() }),
    async execute(input, ctx) {
      try {
        const url = `https://www.youtube.com/watch?v=${input.videoId}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error('Could not fetch YouTube page');
        const html = await res.text();
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const title = titleMatch?.[1]?.replace(' - YouTube', '') ?? input.videoId;
        // Try to extract captions URL
        const captionMatch = html.match(/"captionTracks":\[{"baseUrl":"([^"]+)"/);
        if (!captionMatch) throw new ToolExecutionError('No transcript available for this video');
        const captionUrl = captionMatch[1].replace(/\\u0026/g, '&');
        const captionRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
        const captionXml = await captionRes.text();
        const textParts = [...captionXml.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
        const transcript = textParts.join(' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        const artifactId = ctx.artifactStore.write(transcript, {
          title,
          source_url: url,
          type: 'youtube',
        });
        return { artifact_id: artifactId, title, excerpt: transcript.slice(0, 300) };
      } catch (err) {
        if (err instanceof ToolExecutionError) throw err;
        throw new ToolExecutionError(`YouTube transcript unavailable: ${(err as Error).message}`);
      }
    },
  },
  {
    name: 'source_parse_csv',
    namespace: 'source',
    description: 'Fetch a CSV file from a URL and parse it.',
    inputSchema: z.object({ url: z.string() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input, ctx) {
      const res = await fetch(input.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
      const text = await res.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length === 0) throw new ToolExecutionError('CSV is empty');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const sample = lines.slice(1, 11).map(line =>
        line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      );
      const artifactId = ctx.artifactStore.write(text, {
        source_url: input.url,
        type: 'csv',
      });
      return { artifact_id: artifactId, headers, rowCount: lines.length - 1, sample };
    },
  },
];
