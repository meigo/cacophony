import type { RetryEntry } from './types.js';
import type { StateStore } from './state.js';
import type { Logger } from './logger.js';

export class RetryEngine {
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private store: StateStore;
  private onRetryDue: (issueId: string, entry: RetryEntry) => void;
  private maxBackoffMs: number;
  private logger: Logger;

  constructor(
    store: StateStore,
    onRetryDue: (issueId: string, entry: RetryEntry) => void,
    maxBackoffMs: number,
    logger: Logger,
  ) {
    this.store = store;
    this.onRetryDue = onRetryDue;
    this.maxBackoffMs = maxBackoffMs;
    this.logger = logger;
  }

  updateMaxBackoff(ms: number): void {
    this.maxBackoffMs = ms;
  }

  scheduleContinuation(issueId: string, identifier: string): void {
    this.cancel(issueId);

    const delay = 1_000;
    const dueAtMs = Date.now() + delay;
    const entry: RetryEntry = { issueId, identifier, attempt: 1, dueAtMs, error: null };

    this.store.upsertRetry(entry);
    this.armTimer(issueId, entry, delay);
    this.logger.debug(`Continuation retry scheduled in ${delay}ms`, { identifier });
  }

  scheduleFailureRetry(issueId: string, identifier: string, attempt: number, error: string): void {
    this.cancel(issueId);

    const delay = Math.min(10_000 * Math.pow(2, attempt - 1), this.maxBackoffMs);
    const dueAtMs = Date.now() + delay;
    const entry: RetryEntry = { issueId, identifier, attempt, dueAtMs, error };

    this.store.upsertRetry(entry);
    this.armTimer(issueId, entry, delay);
    this.logger.info(`Failure retry #${attempt} scheduled in ${delay}ms`, { identifier, error });
  }

  cancel(issueId: string): void {
    const existing = this.timers.get(issueId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(issueId);
    }
    this.store.removeRetry(issueId);
  }

  restoreFromDb(): void {
    const entries = this.store.getAllRetries();
    const now = Date.now();

    for (const entry of entries) {
      const remaining = Math.max(0, entry.dueAtMs - now);
      this.armTimer(entry.issueId, entry, remaining);
      this.logger.debug(`Restored retry timer`, {
        identifier: entry.identifier,
        remainingMs: remaining,
      });
    }

    if (entries.length > 0) {
      this.logger.info(`Restored ${entries.length} retry timers from database`);
    }
  }

  getActiveRetries(): RetryEntry[] {
    return this.store.getAllRetries();
  }

  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private armTimer(issueId: string, entry: RetryEntry, delayMs: number): void {
    const handle = setTimeout(() => {
      this.timers.delete(issueId);
      this.store.removeRetry(issueId);
      this.onRetryDue(issueId, entry);
    }, delayMs);

    this.timers.set(issueId, handle);
  }
}
