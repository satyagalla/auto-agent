export interface Finding {
  id: string;
  fact: string;
  sourceUrl: string;
  confidence: string;
  subtaskId?: string;
  tags: string[];
  createdAt: string;
  outdated?: boolean;
  outdatedReason?: string;
}

export interface Source {
  id: string;
  url: string;
  title: string;
  type: string;
  reliability?: string;
  addedAt: string;
}

export interface Contradiction {
  id: string;
  findingIdA: string;
  findingIdB: string;
  description: string;
  createdAt: string;
}

export interface KnowledgeSummary {
  findingCount: number;
  sourceCount: number;
  contradictionCount: number;
  activeFindings: number;
  tagBreakdown: Record<string, number>;
}

let fCounter = 0, sCounter = 0, cCounter = 0;

export class KnowledgeStore {
  private findings = new Map<string, Finding>();
  private sources = new Map<string, Source>();
  private contradictions = new Map<string, Contradiction>();

  addFinding(
    fact: string,
    sourceUrl: string,
    confidence: string,
    subtaskId?: string,
    tags?: string[]
  ): string {
    const id = `find_${++fCounter}`;
    this.findings.set(id, {
      id,
      fact,
      sourceUrl,
      confidence,
      subtaskId,
      tags: tags ?? [],
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  addSource(url: string, title: string, type: string, reliability?: string): string {
    const id = `src_${++sCounter}`;
    this.sources.set(id, { id, url, title, type, reliability, addedAt: new Date().toISOString() });
    return id;
  }

  searchFindings(query?: string, tags?: string[], subtaskId?: string): Finding[] {
    let results = Array.from(this.findings.values()).filter(f => !f.outdated);
    if (subtaskId) results = results.filter(f => f.subtaskId === subtaskId);
    if (tags?.length) results = results.filter(f => tags.some(t => f.tags.includes(t)));
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(f => f.fact.toLowerCase().includes(q));
    }
    return results;
  }

  listSources(type?: string): Source[] {
    const all = Array.from(this.sources.values());
    return type ? all.filter(s => s.type === type) : all;
  }

  noteContradiction(findingIdA: string, findingIdB: string, description: string): string {
    const id = `cont_${++cCounter}`;
    this.contradictions.set(id, {
      id,
      findingIdA,
      findingIdB,
      description,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  getContradictions(): Contradiction[] {
    return Array.from(this.contradictions.values());
  }

  getSummary(): KnowledgeSummary {
    const active = Array.from(this.findings.values()).filter(f => !f.outdated);
    const tagBreakdown: Record<string, number> = {};
    for (const f of active) {
      for (const t of f.tags) tagBreakdown[t] = (tagBreakdown[t] ?? 0) + 1;
    }
    return {
      findingCount: this.findings.size,
      sourceCount: this.sources.size,
      contradictionCount: this.contradictions.size,
      activeFindings: active.length,
      tagBreakdown,
    };
  }

  markOutdated(findingId: string, reason: string): void {
    const f = this.findings.get(findingId);
    if (f) {
      f.outdated = true;
      f.outdatedReason = reason;
    }
  }

  getFindings(): Finding[] {
    return Array.from(this.findings.values());
  }
}
