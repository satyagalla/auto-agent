import { describe, it, expect } from 'vitest';
import { BudgetTracker } from '../../src/infra/budget.js';

describe('BudgetTracker', () => {
  it('starts with zero spend', () => {
    const b = new BudgetTracker(100_000, 50, 15);
    expect(b.tokensSpent).toBe(0);
    expect(b.tokensRemaining).toBe(100_000);
    expect(b.isExhausted).toBe(false);
  });

  it('tracks token usage', () => {
    const b = new BudgetTracker(100_000, 50, 15);
    b.recordTokens(1000, 500);
    expect(b.tokensSpent).toBe(1500);
    expect(b.tokensRemaining).toBe(98_500);
  });

  it('isExhausted when token budget exceeded', () => {
    const b = new BudgetTracker(1000, 50, 15);
    b.recordTokens(500, 600);
    expect(b.isExhausted).toBe(true);
  });

  it('isExhausted when max steps reached', () => {
    const b = new BudgetTracker(100_000, 3, 15);
    b.recordStep();
    b.recordStep();
    b.recordStep();
    expect(b.isExhausted).toBe(true);
  });

  it('shouldSynthesize when only reserve remains', () => {
    const b = new BudgetTracker(100_000, 50, 15);
    b.recordTokens(85_000, 1000); // 86000 spent, 14000 remaining < 15000 reserve
    expect(b.shouldSynthesize).toBe(true);
  });

  it('getStatus returns correct shape', () => {
    const b = new BudgetTracker(100_000, 50, 15);
    b.recordTokens(10_000, 5_000);
    b.recordStep();
    const s = b.getStatus();
    expect(s.tokensSpent).toBe(15_000);
    expect(s.stepsRemaining).toBe(49);
    expect(s.budgetPctUsed).toBe(15);
  });
});
