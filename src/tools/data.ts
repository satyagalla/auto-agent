import { z } from 'zod';
import type { AgentToolDefinition } from './types.js';
import { ToolExecutionError } from '../infra/errors.js';

const CPI_BY_YEAR: Record<number, number> = {
  1960: 29.6, 1965: 31.5, 1970: 38.8, 1975: 53.8, 1980: 82.4, 1985: 107.6,
  1990: 130.7, 1995: 152.4, 2000: 172.2, 2001: 177.1, 2002: 179.9, 2003: 184.0,
  2004: 188.9, 2005: 195.3, 2006: 201.6, 2007: 207.3, 2008: 215.3, 2009: 214.5,
  2010: 218.1, 2011: 224.9, 2012: 229.6, 2013: 233.0, 2014: 236.7, 2015: 237.0,
  2016: 240.0, 2017: 245.1, 2018: 251.1, 2019: 255.7, 2020: 258.8, 2021: 270.9,
  2022: 292.7, 2023: 304.7, 2024: 314.2, 2025: 320.0,
};

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(nums: number[], avg: number): number {
  const variance = nums.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) / nums.length;
  return Math.sqrt(variance);
}

export const dataTools: AgentToolDefinition[] = [
  {
    name: 'data_calculate',
    namespace: 'data',
    description: 'Evaluate a mathematical expression. Supports arithmetic, functions like sqrt, log, etc.',
    inputSchema: z.object({ expression: z.string() }),
    async execute(input) {
      try {
        const { evaluate } = await import('mathjs');
        const result = evaluate(input.expression);
        const formatted = typeof result === 'number'
          ? (Number.isInteger(result) ? result.toString() : result.toPrecision(6))
          : String(result);
        return { result, formatted };
      } catch (err) {
        throw new ToolExecutionError(`Math error: ${(err as Error).message}`);
      }
    },
  },
  {
    name: 'data_aggregate',
    namespace: 'data',
    description: 'Compute statistics (sum, average, median, stddev, min, max) over a list of numbers.',
    inputSchema: z.object({
      values: z.array(z.number()),
      operations: z.array(z.string()).optional(),
    }),
    async execute(input) {
      const v = input.values;
      if (v.length === 0) throw new ToolExecutionError('Empty values array');
      const sum = v.reduce((a: number, b: number) => a + b, 0);
      const average = sum / v.length;
      const all = {
        sum,
        average,
        median: median(v),
        stddev: stddev(v, average),
        min: Math.min(...v),
        max: Math.max(...v),
        count: v.length,
      };
      if (input.operations?.length) {
        return {
          results: Object.fromEntries(
            input.operations.filter((op: string) => op in all).map((op: string) => [op, all[op as keyof typeof all]])
          ),
        };
      }
      return { results: all };
    },
  },
  {
    name: 'data_convert_units',
    namespace: 'data',
    description: 'Convert a value from one unit to another (distance, weight, temperature, etc.).',
    inputSchema: z.object({ value: z.number(), from: z.string(), to: z.string() }),
    async execute(input) {
      const { value, from, to } = input;
      const conversions: Record<string, Record<string, (v: number) => number>> = {
        km: { mi: v => v * 0.621371, m: v => v * 1000, ft: v => v * 3280.84 },
        mi: { km: v => v * 1.60934, m: v => v * 1609.34, ft: v => v * 5280 },
        kg: { lb: v => v * 2.20462, g: v => v * 1000, oz: v => v * 35.274 },
        lb: { kg: v => v * 0.453592, g: v => v * 453.592 },
        c: { f: v => v * 9 / 5 + 32, k: v => v + 273.15 },
        f: { c: v => (v - 32) * 5 / 9, k: v => (v - 32) * 5 / 9 + 273.15 },
        k: { c: v => v - 273.15, f: v => (v - 273.15) * 9 / 5 + 32 },
        m: { ft: v => v * 3.28084, km: v => v / 1000, mi: v => v / 1609.34 },
        ft: { m: v => v * 0.3048, km: v => v * 0.0003048 },
        l: { gal: v => v * 0.264172, ml: v => v * 1000 },
        gal: { l: v => v * 3.78541, ml: v => v * 3785.41 },
      };
      const fromLower = from.toLowerCase();
      const toLower = to.toLowerCase();
      const fn = conversions[fromLower]?.[toLower];
      if (!fn) throw new ToolExecutionError(`Unsupported conversion: ${from} to ${to}`);
      const result = fn(value);
      return { result, formatted: `${result.toPrecision(6)} ${to}` };
    },
  },
  {
    name: 'data_inflation_adjust',
    namespace: 'data',
    description: 'Adjust a dollar amount for US inflation between two years using CPI data.',
    inputSchema: z.object({ amount: z.number(), fromYear: z.number(), toYear: z.number() }),
    async execute(input) {
      const { amount, fromYear, toYear } = input;
      const fromCPI = CPI_BY_YEAR[fromYear];
      const toCPI = CPI_BY_YEAR[toYear];
      if (!fromCPI) throw new ToolExecutionError(`No CPI data for year ${fromYear}`);
      if (!toCPI) throw new ToolExecutionError(`No CPI data for year ${toYear}`);
      const adjusted = amount * (toCPI / fromCPI);
      const cumInflation = ((toCPI - fromCPI) / fromCPI) * 100;
      return {
        adjusted,
        cumulativeInflation: cumInflation,
        formatted: `$${adjusted.toFixed(2)} in ${toYear} dollars (${cumInflation.toFixed(1)}% inflation)`,
      };
    },
  },
  {
    name: 'data_build_timeline',
    namespace: 'data',
    description: 'Build a sorted timeline from a list of dated events.',
    inputSchema: z.object({
      events: z.array(z.object({
        date: z.string(),
        label: z.string(),
        value: z.number().optional(),
      })),
    }),
    async execute(input) {
      const parsed = (input.events as { date: string; label: string; value?: number }[]).map(e => ({ ...e, dateObj: new Date(e.date) }));
      parsed.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
      const timeline = parsed.map((e, i) => ({
        date: e.date,
        label: e.label,
        value: e.value,
        daysSincePrevious: i > 0
          ? Math.round((e.dateObj.getTime() - parsed[i - 1].dateObj.getTime()) / 86400000)
          : undefined,
      }));
      const totalSpan = parsed.length >= 2
        ? Math.round((parsed[parsed.length - 1].dateObj.getTime() - parsed[0].dateObj.getTime()) / 86400000)
        : 0;
      return { timeline, totalSpan };
    },
  },
];
