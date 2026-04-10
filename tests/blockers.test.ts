import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FilesTracker } from '../src/trackers/files.js';
import { isStillBlocked } from '../src/orchestrator.js';
import { tmpDir, cleanup, makeIssue } from './helpers.js';

const TERMINAL = ['done', 'cancelled', 'wontfix'];

describe('FilesTracker blocker resolution', () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(() => {
    dir = tmpDir();
    tasksDir = path.join(dir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
  });

  afterEach(() => {
    cleanup(dir);
  });

  function tracker(): FilesTracker {
    return new FilesTracker({ kind: 'files', dir: tasksDir });
  }

  function writeTask(name: string, body: string): void {
    fs.writeFileSync(path.join(tasksDir, name), body, 'utf-8');
  }

  it('reports an existing blocker with its current state', async () => {
    writeTask('parent.md', `---\nstate: in-progress\n---\n\n# Parent\n`);
    writeTask('child.md', `---\nstate: todo\nblocked_by: [parent]\n---\n\n# Child\n`);

    const issues = await tracker().fetchCandidates();
    const child = issues.find((i) => i.identifier === 'child');
    expect(child).toBeDefined();
    expect(child!.blockedBy).toHaveLength(1);
    expect(child!.blockedBy[0].identifier).toBe('parent');
    expect(child!.blockedBy[0].state).toBe('in-progress');
  });

  it('reports a missing blocker as state "deleted"', async () => {
    writeTask('child.md', `---\nstate: todo\nblocked_by: [vanished-parent]\n---\n\n# Child\n`);

    const issues = await tracker().fetchCandidates();
    const child = issues.find((i) => i.identifier === 'child');
    expect(child).toBeDefined();
    expect(child!.blockedBy).toHaveLength(1);
    expect(child!.blockedBy[0].state).toBe('deleted');
  });

  it('skips self-references in blocked_by', async () => {
    writeTask('self.md', `---\nstate: todo\nblocked_by: [self, real-blocker]\n---\n\n# Self\n`);
    writeTask('real-blocker.md', `---\nstate: todo\n---\n\n# blocker\n`);

    const issues = await tracker().fetchCandidates();
    const self = issues.find((i) => i.identifier === 'self');
    expect(self!.blockedBy.map((b) => b.identifier)).toEqual(['real-blocker']);
  });
});

describe('isStillBlocked', () => {
  it('returns false when blockedBy is empty', () => {
    expect(isStillBlocked(makeIssue({ blockedBy: [] }), TERMINAL)).toBe(false);
  });

  it('returns true when any blocker is in an active state', () => {
    const issue = makeIssue({
      blockedBy: [{ id: 'a', identifier: 'a', state: 'in-progress' }],
    });
    expect(isStillBlocked(issue, TERMINAL)).toBe(true);
  });

  it('returns false when every blocker is in a terminal state', () => {
    const issue = makeIssue({
      blockedBy: [
        { id: 'a', identifier: 'a', state: 'done' },
        { id: 'b', identifier: 'b', state: 'cancelled' },
      ],
    });
    expect(isStillBlocked(issue, TERMINAL)).toBe(false);
  });

  it('treats a deleted blocker as resolved (regression: auto-deleted task files)', () => {
    const issue = makeIssue({
      blockedBy: [{ id: 'gone', identifier: 'gone', state: 'deleted' }],
    });
    expect(isStillBlocked(issue, TERMINAL)).toBe(false);
  });

  it('returns true if at least one blocker is still pending, even when others are deleted', () => {
    const issue = makeIssue({
      blockedBy: [
        { id: 'gone', identifier: 'gone', state: 'deleted' },
        { id: 'pending', identifier: 'pending', state: 'todo' },
      ],
    });
    expect(isStillBlocked(issue, TERMINAL)).toBe(true);
  });

  it('is case-insensitive on state strings', () => {
    const issue = makeIssue({
      blockedBy: [{ id: 'a', identifier: 'a', state: 'DONE' }],
    });
    expect(isStillBlocked(issue, TERMINAL)).toBe(false);
  });
});
