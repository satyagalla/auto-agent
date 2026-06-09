import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';
import { config } from '../infra/config.js';
import { ApiError, ToolExecutionError } from '../infra/errors.js';

export const datasourceTools: AgentToolDefinition[] = [
  {
    name: 'datasource_query_wikidata',
    namespace: 'datasource',
    description: 'Query Wikidata for structured information about entities.',
    inputSchema: z.object({ query: z.string(), entity_type: z.string().optional() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      const sparql = `
SELECT ?entity ?entityLabel ?property ?value WHERE {
  ?entity rdfs:label "${input.query}"@en .
  ?entity ?property ?value .
  FILTER (lang(?value) = "en" || !isLiteral(?value))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 20`;
      const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
      const res = await fetch(url, { headers: { 'User-Agent': 'ResearchAgent/1.0' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new ApiError(`Wikidata error: ${res.status}`, res.status);
      const data = await res.json() as { results: { bindings: { entity: { value: string }; property: { value: string }; value: { value: string } }[] } };
      const results = data.results.bindings.slice(0, 20).map(b => ({
        entity: b.entity?.value,
        property: b.property?.value?.replace('http://www.wikidata.org/prop/direct/', 'P'),
        value: b.value?.value,
      }));
      return { results };
    },
  },
  {
    name: 'datasource_query_world_bank',
    namespace: 'datasource',
    description: 'Query World Bank data for country indicators (GDP, population, etc.).',
    inputSchema: z.object({
      indicator: z.string(),
      country: z.string().optional(),
      yearRange: z.object({ from: z.number(), to: z.number() }).optional(),
    }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      const country = input.country ?? 'all';
      const dateRange = input.yearRange ? `${input.yearRange.from}:${input.yearRange.to}` : '2010:2024';
      const url = `https://api.worldbank.org/v2/country/${country}/indicator/${input.indicator}?date=${dateRange}&format=json&per_page=100`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new ApiError(`World Bank error: ${res.status}`, res.status);
      const json = await res.json() as [{ sourceNote?: string; name?: string }, { country?: { value: string }; date: string; value: number | null }[]];
      if (!Array.isArray(json) || json.length < 2) throw new ToolExecutionError('Unexpected World Bank response');
      const [meta, rows] = json;
      return {
        data: (rows ?? []).filter(r => r.value !== null).map(r => ({
          country: r.country?.value,
          year: parseInt(r.date),
          value: r.value,
        })),
        metadata: { indicator_name: meta?.name, source: meta?.sourceNote?.slice(0, 200) },
      };
    },
  },
  {
    name: 'datasource_query_fred',
    namespace: 'datasource',
    description: 'Query Federal Reserve Economic Data (FRED) for economic time series.',
    inputSchema: z.object({ series_id: z.string(), startDate: z.string().optional(), endDate: z.string().optional() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      if (!config.fred.apiKey) throw new ToolExecutionError('FRED API key not configured. Set FRED_API_KEY in .env');
      const params = new URLSearchParams({
        series_id: input.series_id,
        api_key: config.fred.apiKey,
        file_type: 'json',
      });
      if (input.startDate) params.set('observation_start', input.startDate);
      if (input.endDate) params.set('observation_end', input.endDate);
      const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new ApiError(`FRED error: ${res.status}`, res.status);
      const data = await res.json() as { observations: { date: string; value: string }[] };
      return {
        data: data.observations.map(o => ({ date: o.date, value: o.value === '.' ? null : parseFloat(o.value) })),
        metadata: { series_id: input.series_id },
      };
    },
  },
  {
    name: 'datasource_query_github',
    namespace: 'datasource',
    description: 'Get GitHub repository metadata: stars, forks, issues, language, etc.',
    inputSchema: z.object({ owner: z.string(), repo: z.string() }),
    retryable: true,
    rateLimitKey: 'github',
    async execute(input) {
      const headers: Record<string, string> = { 'User-Agent': 'ResearchAgent/1.0' };
      if (config.github.token) headers.Authorization = `token ${config.github.token}`;
      const res = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new ApiError(`GitHub error: ${res.status}`, res.status);
      const data = await res.json() as {
        stargazers_count: number; forks_count: number; open_issues_count: number;
        language: string; created_at: string; description: string; topics: string[];
      };
      return {
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        language: data.language,
        createdAt: data.created_at,
        description: data.description,
        topics: data.topics,
      };
    },
  },
  {
    name: 'datasource_query_openalex',
    namespace: 'datasource',
    description: 'Search OpenAlex for academic works, authors, or institutions.',
    inputSchema: z.object({
      query: z.string(),
      type: z.enum(['works', 'authors', 'institutions']).optional(),
      sort: z.string().optional(),
    }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      const type = input.type ?? 'works';
      const params = new URLSearchParams({ search: input.query, per_page: '10' });
      if (input.sort) params.set('sort', input.sort);
      const res = await fetch(`https://api.openalex.org/${type}?${params}`, {
        headers: { 'User-Agent': 'ResearchAgent/1.0 (mailto:research@example.com)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new ApiError(`OpenAlex error: ${res.status}`, res.status);
      const data = await res.json() as { results: Record<string, unknown>[]; meta: { count: number } };
      const results = data.results.map(r => ({
        title: r.title ?? r.display_name,
        doi: r.doi,
        year: r.publication_year,
        citations: r.cited_by_count,
        authors: Array.isArray(r.authorships) ? (r.authorships as { author: { display_name: string } }[]).slice(0, 3).map(a => a.author.display_name) : undefined,
      }));
      return { results, totalCount: data.meta?.count };
    },
  },
  {
    name: 'datasource_query_countries',
    namespace: 'datasource',
    description: 'Get country data: population, area, capital, languages, currencies, etc.',
    inputSchema: z.object({ country: z.string() }),
    retryable: true,
    rateLimitKey: 'default',
    async execute(input) {
      const res = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(input.country)}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new ApiError(`RestCountries error: ${res.status}`, res.status);
      const data = await res.json() as Record<string, unknown>[];
      if (!data[0]) throw new ToolExecutionError(`Country not found: ${input.country}`);
      const c = data[0] as {
        name: { common: string }; population: number; area: number;
        capital: string[]; region: string; currencies: Record<string, { name: string }>;
        languages: Record<string, string>; borders: string[];
      };
      return {
        name: c.name?.common,
        population: c.population,
        area: c.area,
        capital: c.capital?.[0],
        region: c.region,
        currencies: Object.values(c.currencies ?? {}).map(cur => cur.name),
        languages: Object.values(c.languages ?? {}),
        borders: c.borders,
      };
    },
  },
];
