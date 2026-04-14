/**
 * Pure decision helper for `Orchestrator.dispatch`. Given the raw outcome of
 * an agent subprocess + after_run hook plus a handful of environmental facts,
 * classify which branch the effectful code should take. Keeping the decision
 * tree here (no git, no subprocess, no DB) makes it unit-testable.
 */

export interface OutcomeInput {
  timedOut: boolean;
  exitCode: number | null;
  hookOk: boolean;
  hookOutput: string;
  stderr: string;
  worktreeClean: boolean;
  decomposed: boolean;
  attempt: number;
  /** Error strings from the last N failed runs, most recent first. */
  recentErrors: string[];
}

export type RunOutcome =
  | { kind: 'timeout' }
  | { kind: 'no-changes'; message: string; giveUp: boolean }
  | { kind: 'success' }
  | {
      kind: 'failed';
      errMsg: string;
      hookFailed: boolean;
      /**
       * If non-null, we should give up on this task (move to wontfix) rather
       * than retry. The string is a human-readable reason for logs.
       */
      stuckReason: string | null;
    };

/** See `classifyOutcome` — constants exposed for tests. */
export const SAME_ERROR_THRESHOLD = 3;
export const TOTAL_FAILURE_CAP = 5;

const NO_CHANGES_MESSAGE =
  'Agent made zero file changes. The task is NOT already complete — ' +
  're-read the requirements carefully and make the specific changes described. ' +
  'If you believe the work is already done, explain why in a commit message.';

/**
 * Normalize a failure error string so drifting timestamps, durations, and
 * worktree paths don't defeat same-error detection.
 */
export function normalizeError(e: string): string {
  return e
    .replace(/\d{2}:\d{2}:\d{2}/g, 'HH:MM:SS')
    .replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD')
    .replace(/\.cacophony\/worktrees\/[^/\s]+/g, '.cacophony/worktrees/<id>')
    .replace(/\d+ms/g, 'Nms');
}

export function classifyOutcome(input: OutcomeInput): RunOutcome {
  if (input.timedOut) return { kind: 'timeout' };

  if (input.exitCode === 0 && input.hookOk) {
    // Agent exited clean + hook happy. If the worktree is empty it means the
    // agent didn't actually make changes — only treat that as "done" if we
    // explicitly decomposed into subtasks. Otherwise retry once, then give up.
    if (input.worktreeClean && !input.decomposed) {
      return {
        kind: 'no-changes',
        message: NO_CHANGES_MESSAGE,
        giveUp: input.attempt > 0,
      };
    }
    return { kind: 'success' };
  }

  // Failed: non-zero exit OR hook rejected.
  const hookFailed = !input.hookOk;
  const errMsg = hookFailed
    ? `after_run failed: ${input.hookOutput.slice(-500)}`
    : input.stderr.slice(-500) || `exit code ${input.exitCode}`;

  const normalized = input.recentErrors.map(normalizeError);
  const sameErrorLoop =
    normalized.length >= SAME_ERROR_THRESHOLD &&
    normalized.slice(0, SAME_ERROR_THRESHOLD).every((e) => e === normalized[0]);
  const tooManyFailures = input.recentErrors.length >= TOTAL_FAILURE_CAP;

  let stuckReason: string | null = null;
  if (sameErrorLoop) stuckReason = `${SAME_ERROR_THRESHOLD} identical failures`;
  else if (tooManyFailures) stuckReason = `${input.recentErrors.length} total failures (thrashing)`;

  return { kind: 'failed', errMsg, hookFailed, stuckReason };
}
