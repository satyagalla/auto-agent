export type SubtaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface Subtask {
  id: string;
  description: string;
  status: SubtaskStatus;
  priority?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  question: string;
  subtasks: Subtask[];
  createdAt: string;
}

export interface PlanStatus {
  plan: Plan | null;
  completed: Subtask[];
  remaining: Subtask[];
  blocked: Subtask[];
  progress_pct: number;
}

let planCounter = 0;
let subtaskCounter = 0;

export class PlanStore {
  private plan: Plan | null = null;
  private removedSubtasks: Map<string, string> = new Map();

  create(question: string, subtasks: { description: string; priority?: string }[]): Plan {
    const planId = `plan_${++planCounter}`;
    this.plan = {
      id: planId,
      question,
      subtasks: subtasks.map(s => ({
        id: `task_${++subtaskCounter}`,
        description: s.description,
        status: 'pending' as SubtaskStatus,
        priority: s.priority,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      createdAt: new Date().toISOString(),
    };
    return this.plan;
  }

  updateStatus(subtaskId: string, status: string, summary?: string): Plan {
    if (!this.plan) throw new Error('No plan exists');
    const subtask = this.plan.subtasks.find(s => s.id === subtaskId);
    if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);
    subtask.status = status as SubtaskStatus;
    if (summary) subtask.summary = summary;
    subtask.updatedAt = new Date().toISOString();
    return this.plan;
  }

  addSubtask(description: string, priority?: string): string {
    if (!this.plan) throw new Error('No plan exists');
    const id = `task_${++subtaskCounter}`;
    this.plan.subtasks.push({
      id,
      description,
      status: 'pending',
      priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  }

  removeSubtask(subtaskId: string, reason: string): void {
    if (!this.plan) throw new Error('No plan exists');
    const idx = this.plan.subtasks.findIndex(s => s.id === subtaskId);
    if (idx === -1) throw new Error(`Subtask not found: ${subtaskId}`);
    this.plan.subtasks.splice(idx, 1);
    this.removedSubtasks.set(subtaskId, reason);
  }

  getStatus(): PlanStatus {
    if (!this.plan) {
      return { plan: null, completed: [], remaining: [], blocked: [], progress_pct: 0 };
    }
    const completed = this.plan.subtasks.filter(s => s.status === 'done');
    const remaining = this.plan.subtasks.filter(s => s.status === 'pending' || s.status === 'in_progress');
    const blocked = this.plan.subtasks.filter(s => s.status === 'blocked');
    const total = this.plan.subtasks.length;
    const progress_pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    return { plan: this.plan, completed, remaining, blocked, progress_pct };
  }

  getPlanSummary(): string {
    if (!this.plan) return 'No plan created yet.';
    const status = this.getStatus();
    const lines = [`Plan: ${this.plan.question}`, `Progress: ${status.progress_pct}%`];
    for (const s of this.plan.subtasks) {
      lines.push(`  [${s.status}] ${s.id}: ${s.description}`);
    }
    return lines.join('\n');
  }
}
