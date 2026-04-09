import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { RetryEngine } from '../src/retry.js';
import { StateStore } from '../src/state.js';
import { Logger } from '../src/logger.js';
import type { RetryEntry } from '../src/types.js';
import { tmpDir, cleanup } from './helpers.js';

describe('RetryEngine', () => {
  let dir: string;
  let store: StateStore;
  let logger: Logger;
  let retryCallbacks: Array<{ issueId: string; entry: RetryEntry }>;
  let engine: RetryEngine;

  beforeEach(() => {
    dir = tmpDir();
    store = new StateStore(path.join(dir, 'test.db'));
    logger = new Logger();
    retryCallbacks = [];

    engine = new RetryEngine(
      store,
      (issueId, entry) => retryCallbacks.push({ issueId, entry }),
      300_000,
      logger,
    );
  });

  afterEach(() => {
    engine.shutdown();
    store.close();
    cleanup(dir);
  });

  describe('scheduleContinuation', () => {
    it('persists retry to database', () => {
      engine.scheduleContinuation('issue-1', 'GH-1');

      const retry = store.getRetry('issue-1');
      expect(retry).toBeDefined();
      expect(retry!.attempt).toBe(1);
      expect(retry!.error).toBeNull();
      expect(retry!.dueAtMs).toBeGreaterThan(Date.now() - 100);
    });

    it('fires callback after ~1 second', async () => {
      vi.useFakeTimers();

      engine.scheduleContinuation('issue-1', 'GH-1');

      expect(retryCallbacks).toHaveLength(0);
      vi.advanceTimersByTime(1000);
      expect(retryCallbacks).toHaveLength(1);
      expect(retryCallbacks[0].issueId).toBe('issue-1');

      vi.useRealTimers();
    });

    it('cancels previous timer for same issue', () => {
      vi.useFakeTimers();

      engine.scheduleContinuation('issue-1', 'GH-1');
      engine.scheduleContinuation('issue-1', 'GH-1');

      vi.advanceTimersByTime(1500);
      // Should only fire once, not twice
      expect(retryCallbacks).toHaveLength(1);

      vi.useRealTimers();
    });

    it('removes retry from DB when timer fires', () => {
      vi.useFakeTimers();

      engine.scheduleContinuation('issue-1', 'GH-1');
      expect(store.getRetry('issue-1')).toBeDefined();

      vi.advanceTimersByTime(1000);
      expect(store.getRetry('issue-1')).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe('scheduleFailureRetry', () => {
    it('uses exponential backoff', () => {
      const now = Date.now();

      engine.scheduleFailureRetry('a', 'GH-A', 1, 'err');
      const r1 = store.getRetry('a');
      // attempt 1: min(10000 * 2^0, 300000) = 10000
      expect(r1!.dueAtMs).toBeGreaterThanOrEqual(now + 9_000);
      expect(r1!.dueAtMs).toBeLessThanOrEqual(now + 11_000);

      engine.scheduleFailureRetry('b', 'GH-B', 2, 'err');
      const r2 = store.getRetry('b');
      // attempt 2: min(10000 * 2^1, 300000) = 20000
      expect(r2!.dueAtMs).toBeGreaterThanOrEqual(now + 19_000);
      expect(r2!.dueAtMs).toBeLessThanOrEqual(now + 21_000);

      engine.scheduleFailureRetry('c', 'GH-C', 3, 'err');
      const r3 = store.getRetry('c');
      // attempt 3: min(10000 * 2^2, 300000) = 40000
      expect(r3!.dueAtMs).toBeGreaterThanOrEqual(now + 39_000);
      expect(r3!.dueAtMs).toBeLessThanOrEqual(now + 41_000);
    });

    it('caps at maxRetryBackoffMs', () => {
      const now = Date.now();
      // With max 300_000 and attempt 20: 10000 * 2^19 = huge, but capped
      engine.scheduleFailureRetry('a', 'GH-A', 20, 'err');
      const retry = store.getRetry('a');
      expect(retry!.dueAtMs).toBeLessThanOrEqual(now + 301_000);
    });

    it('persists error message', () => {
      engine.scheduleFailureRetry('a', 'GH-A', 1, 'something broke');
      const retry = store.getRetry('a');
      expect(retry!.error).toBe('something broke');
    });
  });

  describe('cancel', () => {
    it('removes timer and DB entry', () => {
      engine.scheduleContinuation('issue-1', 'GH-1');
      expect(store.getRetry('issue-1')).toBeDefined();

      engine.cancel('issue-1');
      expect(store.getRetry('issue-1')).toBeUndefined();
    });

    it('prevents callback from firing', () => {
      vi.useFakeTimers();

      engine.scheduleContinuation('issue-1', 'GH-1');
      engine.cancel('issue-1');

      vi.advanceTimersByTime(2000);
      expect(retryCallbacks).toHaveLength(0);

      vi.useRealTimers();
    });

    it('is safe to cancel nonexistent issue', () => {
      expect(() => engine.cancel('nonexistent')).not.toThrow();
    });
  });

  describe('restoreFromDb', () => {
    it('restores timers from database after restart', () => {
      vi.useFakeTimers();

      // Simulate: previous process scheduled a retry
      const futureMs = Date.now() + 5000;
      store.upsertRetry({
        issueId: 'issue-1',
        identifier: 'GH-1',
        attempt: 2,
        dueAtMs: futureMs,
        error: 'previous error',
      });

      // Create a new engine (simulating restart)
      const engine2 = new RetryEngine(
        store,
        (issueId, entry) => retryCallbacks.push({ issueId, entry }),
        300_000,
        logger,
      );
      engine2.restoreFromDb();

      expect(retryCallbacks).toHaveLength(0);

      // Advance past the due time
      vi.advanceTimersByTime(6000);
      expect(retryCallbacks).toHaveLength(1);
      expect(retryCallbacks[0].entry.attempt).toBe(2);

      engine2.shutdown();
      vi.useRealTimers();
    });

    it('fires immediately for past-due retries', () => {
      vi.useFakeTimers();

      // Retry was due 10 seconds ago
      store.upsertRetry({
        issueId: 'issue-1',
        identifier: 'GH-1',
        attempt: 1,
        dueAtMs: Date.now() - 10_000,
        error: null,
      });

      const engine2 = new RetryEngine(
        store,
        (issueId, entry) => retryCallbacks.push({ issueId, entry }),
        300_000,
        logger,
      );
      engine2.restoreFromDb();

      // Should fire immediately (setTimeout(fn, 0))
      vi.advanceTimersByTime(0);
      expect(retryCallbacks).toHaveLength(1);

      engine2.shutdown();
      vi.useRealTimers();
    });
  });

  describe('getActiveRetries', () => {
    it('returns all scheduled retries', () => {
      engine.scheduleContinuation('a', 'GH-A');
      engine.scheduleFailureRetry('b', 'GH-B', 1, 'err');

      const active = engine.getActiveRetries();
      expect(active).toHaveLength(2);
    });
  });

  describe('shutdown', () => {
    it('clears all timers', () => {
      vi.useFakeTimers();

      engine.scheduleContinuation('a', 'GH-A');
      engine.scheduleContinuation('b', 'GH-B');
      engine.shutdown();

      vi.advanceTimersByTime(5000);
      expect(retryCallbacks).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe('updateMaxBackoff', () => {
    it('affects subsequent retries', () => {
      const now = Date.now();
      engine.updateMaxBackoff(15_000);

      // attempt 5: min(10000 * 2^4, 15000) = min(160000, 15000) = 15000
      engine.scheduleFailureRetry('a', 'GH-A', 5, 'err');
      const retry = store.getRetry('a');
      expect(retry!.dueAtMs).toBeLessThanOrEqual(now + 16_000);
    });
  });
});
