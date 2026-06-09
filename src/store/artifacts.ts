import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ArtifactNotFoundError } from '../infra/errors.js';

export interface ArtifactMetadata {
  id: string;
  title?: string;
  source_url?: string;
  type?: string;
  wordCount: number;
  createdAt: string;
}

let counter = 0;

function generateId(): string {
  return `art_${Date.now()}_${++counter}`;
}

export class ArtifactStore {
  private metadata = new Map<string, ArtifactMetadata>();
  private dir: string;

  constructor(sessionId: string) {
    this.dir = join(process.cwd(), 'traces', sessionId, 'artifacts');
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  write(content: string, meta: { title?: string; source_url?: string; type?: string }): string {
    const id = generateId();
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const filePath = join(this.dir, `${id}.txt`);
    writeFileSync(filePath, content, 'utf-8');
    const metadata: ArtifactMetadata = {
      id,
      title: meta.title,
      source_url: meta.source_url,
      type: meta.type ?? 'text',
      wordCount,
      createdAt: new Date().toISOString(),
    };
    this.metadata.set(id, metadata);
    return id;
  }

  read(artifactId: string): { content: string; metadata: ArtifactMetadata } {
    const metadata = this.metadata.get(artifactId);
    if (!metadata) throw new ArtifactNotFoundError(artifactId);
    const filePath = join(this.dir, `${artifactId}.txt`);
    const content = readFileSync(filePath, 'utf-8');
    return { content, metadata };
  }

  readSection(artifactId: string, offset = 0, limit?: number): string {
    const { content } = this.read(artifactId);
    const words = content.split(/\s+/).filter(Boolean);
    const slice = limit ? words.slice(offset, offset + limit) : words.slice(offset);
    return slice.join(' ');
  }

  list(type?: string): ArtifactMetadata[] {
    const all = Array.from(this.metadata.values());
    return type ? all.filter(m => m.type === type) : all;
  }

  getMetadata(artifactId: string): ArtifactMetadata {
    const metadata = this.metadata.get(artifactId);
    if (!metadata) throw new ArtifactNotFoundError(artifactId);
    return metadata;
  }
}
