import { describe, it, expect } from 'vitest';
import { KnowledgeStore } from '../../src/store/knowledge.js';

describe('KnowledgeStore', () => {
  it('adds and retrieves findings', () => {
    const store = new KnowledgeStore();
    const id = store.addFinding('The earth is round', 'https://example.com', 'high', undefined, ['science']);
    expect(id).toBeTruthy();
    const findings = store.searchFindings('earth');
    expect(findings).toHaveLength(1);
    expect(findings[0].fact).toBe('The earth is round');
  });

  it('filters findings by tag', () => {
    const store = new KnowledgeStore();
    store.addFinding('Finding A', 'https://a.com', 'high', undefined, ['tag1']);
    store.addFinding('Finding B', 'https://b.com', 'medium', undefined, ['tag2']);
    const results = store.searchFindings(undefined, ['tag1']);
    expect(results).toHaveLength(1);
    expect(results[0].fact).toBe('Finding A');
  });

  it('marks findings as outdated', () => {
    const store = new KnowledgeStore();
    const id = store.addFinding('Old fact', 'https://x.com', 'low');
    store.markOutdated(id, 'superseded');
    const results = store.searchFindings('Old');
    expect(results).toHaveLength(0);
  });

  it('tracks contradictions', () => {
    const store = new KnowledgeStore();
    const a = store.addFinding('X is true', 'https://a.com', 'high');
    const b = store.addFinding('X is false', 'https://b.com', 'high');
    store.noteContradiction(a, b, 'Direct contradiction');
    expect(store.getContradictions()).toHaveLength(1);
  });

  it('getSummary returns correct counts', () => {
    const store = new KnowledgeStore();
    store.addFinding('F1', 'https://1.com', 'high');
    store.addFinding('F2', 'https://2.com', 'medium');
    store.addSource('https://s.com', 'Source', 'web');
    const summary = store.getSummary();
    expect(summary.findingCount).toBe(2);
    expect(summary.sourceCount).toBe(1);
  });
});
