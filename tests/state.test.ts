import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { StateStore } from '../src/state.js';
import { tmpDir, cleanup, makeIssue } from './helpers.js';

describe('StateStore', () => {
  let dir: string;
  let store: StateStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new StateStore(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    cleanup(dir);
  });

  describe('runs', () => {
    it('creates a run and returns its id', () => {
      const id = store.createRun('issue-1', 'GH-1', 0, '/path/to/ws');
      expect(id).toBeGreaterThan(0);
    });

    it('creates multiple runs with incrementing ids', () => {
      const id1 = store.createRun('issue-1', 'GH-1', 0, '/ws/1');
      const id2 = store.createRun('issue-2', 'GH-2', 0, '/ws/2');
      expect(id2).toBeGreaterThan(id1);
    });

    it('updates run status', () => {
      const id = store.createRun('issue-1', 'GH-1', 0, '/ws');
      store.updateRunStatus(id, 'running');

      const runs = store.getActiveRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('running');
    });

    it('finishes a run with exit code and duration', () => {
      const id = store.createRun('issue-1', 'GH-1', 0, '/ws');
      store.updateRunStatus(id, 'running');
      store.finishRun(id, 'succeeded', 0);

      const active = store.getActiveRuns();
      expect(active).toHaveLength(0);

      const latest = store.getLatestRun('issue-1');
      expect(latest).toBeDefined();
      expect(latest!.status).toBe('succeeded');
      expect(latest!.exitCode).toBe(0);
      expect(latest!.finishedAt).not.toBeNull();
      expect(latest!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('finishes a run with error', () => {
      const id = store.createRun('issue-1', 'GH-1', 0, '/ws');
      store.finishRun(id, 'failed', 1, 'something broke');

      const latest = store.getLatestRun('issue-1');
      expect(latest!.status).toBe('failed');
      expect(latest!.error).toBe('something broke');
      expect(latest!.exitCode).toBe(1);
    });

    it('getActiveRuns returns only active statuses', () => {
      const id1 = store.createRun('issue-1', 'GH-1', 0, '/ws/1');
      const id2 = store.createRun('issue-2', 'GH-2', 0, '/ws/2');
      const id3 = store.createRun('issue-3', 'GH-3', 0, '/ws/3');

      store.updateRunStatus(id1, 'running');
      store.finishRun(id2, 'succeeded', 0);
      store.updateRunStatus(id3, 'launching_agent');

      const active = store.getActiveRuns();
      expect(active).toHaveLength(2);
      const ids = active.map((r) => r.issueId);
      expect(ids).toContain('issue-1');
      expect(ids).toContain('issue-3');
    });

    it('getRunsForIssue returns runs in descending order', () => {
      store.createRun('issue-1', 'GH-1', 0, '/ws');
      store.createRun('issue-1', 'GH-1', 1, '/ws');
      store.createRun('issue-1', 'GH-1', 2, '/ws');

      const runs = store.getRunsForIssue('issue-1');
      expect(runs).toHaveLength(3);
      expect(runs[0].attempt).toBe(2);
      expect(runs[1].attempt).toBe(1);
      expect(runs[2].attempt).toBe(0);
    });

    it('getLatestRun returns undefined for unknown issue', () => {
      expect(store.getLatestRun('nonexistent')).toBeUndefined();
    });
  });

  describe('issues', () => {
    it('upserts and retrieves an issue', () => {
      const issue = makeIssue({ id: 'abc', identifier: 'GH-42', title: 'Fix bug' });
      store.upsertIssue(issue);

      const retrieved = store.getIssue('abc');
      expect(retrieved).toBeDefined();
      expect(retrieved!.identifier).toBe('GH-42');
      expect(retrieved!.title).toBe('Fix bug');
      expect(retrieved!.createdAt).toBeInstanceOf(Date);
    });

    it('updates existing issue on upsert', () => {
      const issue = makeIssue({ id: 'abc', title: 'v1' });
      store.upsertIssue(issue);

      const updated = makeIssue({ id: 'abc', title: 'v2', state: 'in-progress' });
      store.upsertIssue(updated);

      const retrieved = store.getIssue('abc');
      expect(retrieved!.title).toBe('v2');
      expect(retrieved!.state).toBe('in-progress');
    });

    it('returns undefined for unknown issue', () => {
      expect(store.getIssue('nonexistent')).toBeUndefined();
    });
  });

  describe('retries', () => {
    it('upserts and retrieves a retry', () => {
      store.upsertRetry({
        issueId: 'issue-1',
        identifier: 'GH-1',
        attempt: 1,
        dueAtMs: 1000,
        error: 'timeout',
      });

      const retry = store.getRetry('issue-1');
      expect(retry).toBeDefined();
      expect(retry!.identifier).toBe('GH-1');
      expect(retry!.attempt).toBe(1);
      expect(retry!.error).toBe('timeout');
    });

    it('updates existing retry on upsert', () => {
      store.upsertRetry({
        issueId: 'issue-1',
        identifier: 'GH-1',
        attempt: 1,
        dueAtMs: 1000,
        error: 'first',
      });
      store.upsertRetry({
        issueId: 'issue-1',
        identifier: 'GH-1',
        attempt: 2,
        dueAtMs: 2000,
        error: 'second',
      });

      const retry = store.getRetry('issue-1');
      expect(retry!.attempt).toBe(2);
      expect(retry!.error).toBe('second');
    });

    it('getDueRetries returns only past-due entries', () => {
      store.upsertRetry({
        issueId: 'a',
        identifier: 'GH-A',
        attempt: 1,
        dueAtMs: 100,
        error: null,
      });
      store.upsertRetry({
        issueId: 'b',
        identifier: 'GH-B',
        attempt: 1,
        dueAtMs: 500,
        error: null,
      });
      store.upsertRetry({
        issueId: 'c',
        identifier: 'GH-C',
        attempt: 1,
        dueAtMs: 9999,
        error: null,
      });

      const due = store.getDueRetries(500);
      expect(due).toHaveLength(2);
      const ids = due.map((r) => r.issueId);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });

    it('removeRetry deletes the entry', () => {
      store.upsertRetry({
        issueId: 'a',
        identifier: 'GH-A',
        attempt: 1,
        dueAtMs: 100,
        error: null,
      });
      store.removeRetry('a');
      expect(store.getRetry('a')).toBeUndefined();
    });

    it('getAllRetries returns all entries', () => {
      store.upsertRetry({
        issueId: 'a',
        identifier: 'GH-A',
        attempt: 1,
        dueAtMs: 100,
        error: null,
      });
      store.upsertRetry({
        issueId: 'b',
        identifier: 'GH-B',
        attempt: 2,
        dueAtMs: 200,
        error: null,
      });

      const all = store.getAllRetries();
      expect(all).toHaveLength(2);
    });
  });

  describe('metrics', () => {
    it('sets and gets a metric', () => {
      store.setMetric('totalRuns', 42);
      expect(store.getMetric<number>('totalRuns')).toBe(42);
    });

    it('overwrites existing metric', () => {
      store.setMetric('count', 1);
      store.setMetric('count', 2);
      expect(store.getMetric<number>('count')).toBe(2);
    });

    it('stores complex objects', () => {
      const data = { runs: 10, succeeded: 8, failed: 2 };
      store.setMetric('totals', data);
      expect(store.getMetric('totals')).toEqual(data);
    });

    it('returns undefined for unknown metric', () => {
      expect(store.getMetric('nonexistent')).toBeUndefined();
    });
  });

  describe('persistence', () => {
    it('data survives close and reopen', () => {
      const dbPath = path.join(dir, 'persist.db');
      const store1 = new StateStore(dbPath);
      store1.createRun('issue-1', 'GH-1', 0, '/ws');
      store1.upsertRetry({
        issueId: 'issue-1',
        identifier: 'GH-1',
        attempt: 1,
        dueAtMs: 9999,
        error: null,
      });
      store1.setMetric('version', 1);
      store1.close();

      const store2 = new StateStore(dbPath);
      expect(store2.getActiveRuns()).toHaveLength(1);
      expect(store2.getAllRetries()).toHaveLength(1);
      expect(store2.getMetric('version')).toBe(1);
      store2.close();
    });
  });
});
