import { describe, it, expect } from 'vitest';
import { PlanStore } from '../../src/store/plan.js';

describe('PlanStore', () => {
  it('creates a plan with subtasks', () => {
    const store = new PlanStore();
    const plan = store.create('What is AI?', [
      { description: 'History of AI' },
      { description: 'Current state' },
    ]);
    expect(plan.subtasks).toHaveLength(2);
    expect(plan.subtasks[0].status).toBe('pending');
  });

  it('updates subtask status', () => {
    const store = new PlanStore();
    const plan = store.create('Q', [{ description: 'Task 1' }]);
    const id = plan.subtasks[0].id;
    store.updateStatus(id, 'done', 'Completed research');
    const status = store.getStatus();
    expect(status.completed).toHaveLength(1);
    expect(status.progress_pct).toBe(100);
  });

  it('adds and removes subtasks', () => {
    const store = new PlanStore();
    store.create('Q', [{ description: 'Original' }]);
    const newId = store.addSubtask('New task');
    expect(newId).toBeTruthy();
    store.removeSubtask(newId, 'not needed');
    const status = store.getStatus();
    expect(status.plan?.subtasks).toHaveLength(1);
  });

  it('getPlanSummary includes progress', () => {
    const store = new PlanStore();
    const plan = store.create('My question', [{ description: 'Task A' }, { description: 'Task B' }]);
    store.updateStatus(plan.subtasks[0].id, 'done');
    const summary = store.getPlanSummary();
    expect(summary).toContain('50%');
    expect(summary).toContain('My question');
  });
});
