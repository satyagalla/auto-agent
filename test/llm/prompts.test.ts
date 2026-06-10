import { describe, it, expect } from 'vitest';
import { buildBeastModePrompt } from '../../src/llm/prompts.js';
import type { Finding } from '../../src/store/knowledge.js';

function makeFinding(fact: string): Finding {
  return { id: fact, fact, sourceUrl: 'http://example.com', confidence: 'high', timestamp: Date.now(), outdated: false };
}

describe('buildBeastModePrompt', () => {
  it('includes question and findings', () => {
    const findings = [makeFinding('fact A'), makeFinding('fact B')];
    const result = buildBeastModePrompt('What is X?', findings);
    expect(result).toContain('What is X?');
    expect(result).toContain('fact A');
    expect(result).toContain('fact B');
  });

  it('caps at 80 findings', () => {
    const findings = Array.from({ length: 100 }, (_, i) => makeFinding(`fact ${i}`));
    const result = buildBeastModePrompt('Q', findings);
    expect(result).toContain('fact 79');
    expect(result).not.toContain('fact 80');
  });
});
