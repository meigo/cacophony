import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FilesTracker } from '../src/trackers/files.js';
import type { TrackerConfig } from '../src/types.js';
import { tmpDir, cleanup } from './helpers.js';

function writeTask(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

describe('FilesTracker', () => {
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

  function makeTracker(overrides: Partial<TrackerConfig> = {}): FilesTracker {
    return new FilesTracker({
      kind: 'files',
      dir: tasksDir,
      activeStates: ['todo', 'in-progress'],
      terminalStates: ['done', 'cancelled', 'wontfix'],
      ...overrides,
    });
  }

  describe('fetchCandidates', () => {
    it('returns issues from markdown files with active state', async () => {
      writeTask(
        tasksDir,
        'fix-login.md',
        `---
state: todo
priority: 1
---

# Fix login bug

Users are unable to log in after session timeout.`,
      );
      writeTask(
        tasksDir,
        'add-dark-mode.md',
        `---
state: todo
priority: 3
---

# Add dark mode

Implement a dark theme toggle.`,
      );

      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();

      expect(candidates).toHaveLength(2);
      expect(candidates[0].identifier).toBe('fix-login');
      expect(candidates[0].title).toBe('Fix login bug');
      expect(candidates[0].state).toBe('todo');
      expect(candidates[0].priority).toBe(1);
      expect(candidates[0].description).toContain('session timeout');
    });

    it('sorts by priority ascending, null last', async () => {
      writeTask(tasksDir, 'low.md', '---\nstate: todo\npriority: 3\n---\n# Low');
      writeTask(tasksDir, 'high.md', '---\nstate: todo\npriority: 1\n---\n# High');
      writeTask(tasksDir, 'none.md', '---\nstate: todo\n---\n# No priority');

      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();

      expect(candidates[0].identifier).toBe('high');
      expect(candidates[1].identifier).toBe('low');
      expect(candidates[2].identifier).toBe('none');
    });

    it('excludes terminal-state tasks', async () => {
      writeTask(tasksDir, 'active.md', '---\nstate: todo\n---\n# Active');
      writeTask(tasksDir, 'finished.md', '---\nstate: done\n---\n# Done');
      writeTask(tasksDir, 'cancelled.md', '---\nstate: cancelled\n---\n# Cancelled');

      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();

      expect(candidates).toHaveLength(1);
      expect(candidates[0].identifier).toBe('active');
    });

    it('excludes non-active states', async () => {
      writeTask(tasksDir, 'review.md', '---\nstate: review\n---\n# In review');

      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();

      expect(candidates).toHaveLength(0);
    });

    it('defaults to todo state when no front matter', async () => {
      writeTask(tasksDir, 'bare.md', '# Just a title\n\nSome description');

      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();

      expect(candidates).toHaveLength(1);
      expect(candidates[0].state).toBe('todo');
      expect(candidates[0].title).toBe('Just a title');
    });

    it('ignores non-md files', async () => {
      writeTask(tasksDir, 'task.md', '---\nstate: todo\n---\n# Task');
      writeTask(tasksDir, 'notes.txt', 'not a task');
      writeTask(tasksDir, 'data.json', '{}');

      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();

      expect(candidates).toHaveLength(1);
    });

    it('returns empty array for empty directory', async () => {
      const tracker = makeTracker();
      const candidates = await tracker.fetchCandidates();
      expect(candidates).toEqual([]);
    });
  });

  describe('fetchIssueStatesByIds', () => {
    it('returns current state for existing tasks', async () => {
      writeTask(tasksDir, 'task-1.md', '---\nstate: in-progress\n---\n# Task 1');
      writeTask(tasksDir, 'task-2.md', '---\nstate: done\n---\n# Task 2');

      const tracker = makeTracker();
      const states = await tracker.fetchIssueStatesByIds(['task-1', 'task-2']);

      expect(states).toHaveLength(2);
      expect(states.find((s) => s.id === 'task-1')!.state).toBe('in-progress');
      expect(states.find((s) => s.id === 'task-2')!.state).toBe('done');
    });

    it('returns deleted state for missing files', async () => {
      const tracker = makeTracker();
      const states = await tracker.fetchIssueStatesByIds(['nonexistent']);

      expect(states).toHaveLength(1);
      expect(states[0].state).toBe('deleted');
    });
  });

  describe('fetchTerminalIssues', () => {
    it('returns only terminal-state tasks', async () => {
      writeTask(tasksDir, 'active.md', '---\nstate: todo\n---\n# Active');
      writeTask(tasksDir, 'done.md', '---\nstate: done\n---\n# Done');
      writeTask(tasksDir, 'wontfix.md', '---\nstate: wontfix\n---\n# Wontfix');

      const tracker = makeTracker();
      const terminal = await tracker.fetchTerminalIssues();

      expect(terminal).toHaveLength(2);
      const ids = terminal.map((t) => t.identifier);
      expect(ids).toContain('done');
      expect(ids).toContain('wontfix');
    });
  });

  describe('createTask', () => {
    it('creates a new task file with front matter', () => {
      const tracker = makeTracker();
      tracker.createTask('new-task', 'todo', 2, '# New Task\n\nDo something.');

      const filePath = path.join(tasksDir, 'new-task.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('state: todo');
      expect(content).toContain('priority: 2');
      expect(content).toContain('# New Task');
    });

    it('creates task without priority', () => {
      const tracker = makeTracker();
      tracker.createTask('no-pri', 'todo', null, '# No Priority');

      const content = fs.readFileSync(path.join(tasksDir, 'no-pri.md'), 'utf-8');
      expect(content).toContain('state: todo');
      expect(content).not.toContain('priority');
    });

    it('created task is fetchable', async () => {
      const tracker = makeTracker();
      tracker.createTask('fetchable', 'todo', 1, '# Fetchable task');

      const candidates = await tracker.fetchCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].identifier).toBe('fetchable');
      expect(candidates[0].title).toBe('Fetchable task');
    });
  });

  describe('updateTaskState', () => {
    it('updates the state in front matter', () => {
      writeTask(tasksDir, 'task.md', '---\nstate: todo\npriority: 1\n---\n# Task');

      const tracker = makeTracker();
      const updated = tracker.updateTaskState('task', 'done');
      expect(updated).toBe(true);

      const task = tracker.getTask('task');
      expect(task!.state).toBe('done');
    });

    it('returns false for nonexistent task', () => {
      const tracker = makeTracker();
      expect(tracker.updateTaskState('nonexistent', 'done')).toBe(false);
    });

    it('moves task from candidates to terminal', async () => {
      writeTask(tasksDir, 'task.md', '---\nstate: todo\n---\n# Task');

      const tracker = makeTracker();
      expect((await tracker.fetchCandidates()).length).toBe(1);

      tracker.updateTaskState('task', 'done');

      expect((await tracker.fetchCandidates()).length).toBe(0);
      expect((await tracker.fetchTerminalIssues()).length).toBe(1);
    });
  });

  describe('deleteTask', () => {
    it('removes the task file', () => {
      writeTask(tasksDir, 'doomed.md', '---\nstate: todo\n---\n# Doomed');

      const tracker = makeTracker();
      const deleted = tracker.deleteTask('doomed');
      expect(deleted).toBe(true);
      expect(fs.existsSync(path.join(tasksDir, 'doomed.md'))).toBe(false);
    });

    it('returns false for nonexistent task', () => {
      const tracker = makeTracker();
      expect(tracker.deleteTask('nope')).toBe(false);
    });
  });

  describe('getTask', () => {
    it('returns parsed task', () => {
      writeTask(
        tasksDir,
        'my-task.md',
        '---\nstate: in-progress\npriority: 2\nlabels:\n  - bug\n  - urgent\n---\n# My Task\n\nDetails here.',
      );

      const tracker = makeTracker();
      const task = tracker.getTask('my-task');

      expect(task).not.toBeNull();
      expect(task!.identifier).toBe('my-task');
      expect(task!.state).toBe('in-progress');
      expect(task!.priority).toBe(2);
      expect(task!.labels).toEqual(['bug', 'urgent']);
      expect(task!.title).toBe('My Task');
    });

    it('returns null for nonexistent task', () => {
      const tracker = makeTracker();
      expect(tracker.getTask('nope')).toBeNull();
    });
  });

  describe('getAllTasks', () => {
    it('returns all tasks regardless of state', async () => {
      writeTask(tasksDir, 'a.md', '---\nstate: todo\n---\n# A');
      writeTask(tasksDir, 'b.md', '---\nstate: done\n---\n# B');
      writeTask(tasksDir, 'c.md', '---\nstate: in-progress\n---\n# C');

      const tracker = makeTracker();
      const all = tracker.getAllTasks();

      expect(all).toHaveLength(3);
    });
  });

  describe('constructor', () => {
    it('creates tasks dir if it does not exist', () => {
      const newDir = path.join(dir, 'new-tasks');
      expect(fs.existsSync(newDir)).toBe(false);

      new FilesTracker({ kind: 'files', dir: newDir });

      expect(fs.existsSync(newDir)).toBe(true);
    });
  });
});
