import { describe, it, expect } from 'vitest';
import {
  classifyOutcome,
  normalizeError,
  SAME_ERROR_THRESHOLD,
  TOTAL_FAILURE_CAP,
  type OutcomeInput,
} from '../src/outcome.js';

const base: OutcomeInput = {
  timedOut: false,
  exitCode: 0,
  hookOk: true,
  hookOutput: '',
  stderr: '',
  worktreeClean: false,
  decomposed: false,
  attempt: 0,
  recentErrors: [],
};

describe('classifyOutcome', () => {
  it('returns timeout when timedOut is true, regardless of other fields', () => {
    const out = classifyOutcome({ ...base, timedOut: true, exitCode: null, hookOk: false });
    expect(out).toEqual({ kind: 'timeout' });
  });

  it('returns success when exit=0, hook ok, worktree dirty', () => {
    const out = classifyOutcome({ ...base, worktreeClean: false });
    expect(out.kind).toBe('success');
  });

  it('returns success when exit=0, hook ok, worktree clean but decomposed', () => {
    const out = classifyOutcome({ ...base, worktreeClean: true, decomposed: true });
    expect(out.kind).toBe('success');
  });

  it('returns no-changes with retry on first empty run', () => {
    const out = classifyOutcome({ ...base, worktreeClean: true, decomposed: false, attempt: 0 });
    expect(out).toMatchObject({ kind: 'no-changes', giveUp: false });
  });

  it('returns no-changes with give-up on second empty run', () => {
    const out = classifyOutcome({ ...base, worktreeClean: true, decomposed: false, attempt: 1 });
    expect(out).toMatchObject({ kind: 'no-changes', giveUp: true });
  });

  it('returns failed with hookFailed=true when exit=0 but hook rejected', () => {
    const out = classifyOutcome({
      ...base,
      exitCode: 0,
      hookOk: false,
      hookOutput: 'build failed: error in foo.ts',
    });
    expect(out).toMatchObject({ kind: 'failed', hookFailed: true });
    if (out.kind === 'failed') {
      expect(out.errMsg).toContain('after_run failed');
      expect(out.errMsg).toContain('build failed');
    }
  });

  it('returns failed with hookFailed=false when exit≠0', () => {
    const out = classifyOutcome({
      ...base,
      exitCode: 1,
      hookOk: true,
      stderr: 'agent crashed',
    });
    expect(out).toMatchObject({ kind: 'failed', hookFailed: false });
    if (out.kind === 'failed') {
      expect(out.errMsg).toContain('agent crashed');
    }
  });

  it('falls back to exit-code message when stderr is empty', () => {
    const out = classifyOutcome({ ...base, exitCode: 42, hookOk: true, stderr: '' });
    if (out.kind === 'failed') {
      expect(out.errMsg).toContain('exit code 42');
    }
  });

  it('truncates long hook output in errMsg to last 500 chars', () => {
    const huge = 'x'.repeat(5000) + 'THE_REAL_ERROR';
    const out = classifyOutcome({ ...base, exitCode: 0, hookOk: false, hookOutput: huge });
    if (out.kind === 'failed') {
      expect(out.errMsg.length).toBeLessThan(600);
      expect(out.errMsg).toContain('THE_REAL_ERROR');
    }
  });

  it('marks stuck when last N errors are identical (after normalization)', () => {
    const errs = Array.from({ length: SAME_ERROR_THRESHOLD }, (_, i) =>
      `error at 12:3${i}:00 in .cacophony/worktrees/foo-${i}`,
    );
    const out = classifyOutcome({ ...base, exitCode: 1, recentErrors: errs });
    expect(out).toMatchObject({ kind: 'failed' });
    if (out.kind === 'failed') {
      expect(out.stuckReason).toContain('identical failures');
    }
  });

  it('marks stuck when total failure cap is reached even with different errors', () => {
    const errs = Array.from({ length: TOTAL_FAILURE_CAP }, (_, i) => `unique error ${i}`);
    const out = classifyOutcome({ ...base, exitCode: 1, recentErrors: errs });
    if (out.kind === 'failed') {
      expect(out.stuckReason).toContain('thrashing');
    }
  });

  it('does not mark stuck when errors differ and count is below cap', () => {
    const errs = ['err a', 'err b'];
    const out = classifyOutcome({ ...base, exitCode: 1, recentErrors: errs });
    if (out.kind === 'failed') {
      expect(out.stuckReason).toBeNull();
    }
  });
});

describe('normalizeError', () => {
  it('normalizes timestamps, dates, worktree paths, and durations', () => {
    const a = 'failed at 12:34:56 on 2026-04-14 in .cacophony/worktrees/task-one (1234ms)';
    const b = 'failed at 00:01:02 on 2026-04-15 in .cacophony/worktrees/task-two (9999ms)';
    expect(normalizeError(a)).toBe(normalizeError(b));
  });
});
