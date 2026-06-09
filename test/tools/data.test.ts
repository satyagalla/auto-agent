import { describe, it, expect } from 'vitest';
import { dataTools } from '../../src/tools/data.js';

function getTool(name: string) {
  const tool = dataTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

const mockCtx = {} as Parameters<typeof dataTools[0]['execute']>[1];

describe('data_calculate', () => {
  it('evaluates arithmetic', async () => {
    const tool = getTool('data_calculate');
    const result = await tool.execute({ expression: '2 + 2 * 3' }, mockCtx) as { result: number };
    expect(result.result).toBe(8);
  });

  it('evaluates sqrt', async () => {
    const tool = getTool('data_calculate');
    const result = await tool.execute({ expression: 'sqrt(16)' }, mockCtx) as { result: number };
    expect(result.result).toBe(4);
  });
});

describe('data_aggregate', () => {
  it('computes all stats', async () => {
    const tool = getTool('data_aggregate');
    const result = await tool.execute({ values: [1, 2, 3, 4, 5] }, mockCtx) as { results: Record<string, number> };
    expect(result.results.sum).toBe(15);
    expect(result.results.average).toBe(3);
    expect(result.results.min).toBe(1);
    expect(result.results.max).toBe(5);
    expect(result.results.count).toBe(5);
  });
});

describe('data_convert_units', () => {
  it('converts km to miles', async () => {
    const tool = getTool('data_convert_units');
    const result = await tool.execute({ value: 100, from: 'km', to: 'mi' }, mockCtx) as { result: number };
    expect(result.result).toBeCloseTo(62.137, 2);
  });

  it('converts celsius to fahrenheit', async () => {
    const tool = getTool('data_convert_units');
    const result = await tool.execute({ value: 100, from: 'c', to: 'f' }, mockCtx) as { result: number };
    expect(result.result).toBe(212);
  });
});

describe('data_inflation_adjust', () => {
  it('adjusts 2000 dollars to 2020 equivalent', async () => {
    const tool = getTool('data_inflation_adjust');
    const result = await tool.execute({ amount: 100, fromYear: 2000, toYear: 2020 }, mockCtx) as { adjusted: number };
    expect(result.adjusted).toBeGreaterThan(100); // inflation, should be higher
  });
});
