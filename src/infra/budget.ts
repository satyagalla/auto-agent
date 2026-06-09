export interface BudgetStatus {
  tokensSpent: number;
  tokensRemaining: number;
  stepsRemaining: number;
  stepsTaken: number;
  budgetPctUsed: number;
  shouldSynthesize: boolean;
  isExhausted: boolean;
}

export class BudgetTracker {
  private _tokensSpent = 0;
  private _stepsTaken = 0;
  private reserveTokens: number;

  constructor(
    private tokenBudget: number,
    private maxSteps: number,
    reservePercent: number
  ) {
    this.reserveTokens = Math.floor(tokenBudget * (reservePercent / 100));
  }

  // Bedrock reports inputTokens EXCLUSIVE of cache tokens (cache fields are additive).
  // Cache reads cost 0.1x, writes cost 1.25x — but input already counts cacheWrite at 1x,
  // so only add the 0.25x surcharge for writes.
  recordTokens(input: number, output: number, cacheRead = 0, cacheWrite = 0): void {
    this._tokensSpent += output + input + (cacheRead * 0.1) + (cacheWrite * 0.25);
  }

  recordStep(): void {
    this._stepsTaken++;
  }

  get tokensSpent(): number { return this._tokensSpent; }
  get tokensRemaining(): number { return Math.max(0, this.tokenBudget - this._tokensSpent); }
  get stepsRemaining(): number { return Math.max(0, this.maxSteps - this._stepsTaken); }
  get stepsTaken(): number { return this._stepsTaken; }

  get isExhausted(): boolean {
    return this._tokensSpent >= this.tokenBudget || this._stepsTaken >= this.maxSteps;
  }

  get shouldSynthesize(): boolean {
    return this.tokensRemaining <= this.reserveTokens;
  }

  getStatus(): BudgetStatus {
    return {
      tokensSpent: this._tokensSpent,
      tokensRemaining: this.tokensRemaining,
      stepsRemaining: this.stepsRemaining,
      stepsTaken: this._stepsTaken,
      budgetPctUsed: Math.round((this._tokensSpent / this.tokenBudget) * 100),
      shouldSynthesize: this.shouldSynthesize,
      isExhausted: this.isExhausted,
    };
  }
}
