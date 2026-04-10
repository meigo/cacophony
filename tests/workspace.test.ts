import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { HooksConfig } from '../src/types.js';
import { WorkspaceManager } from '../src/workspace.js';
import { Logger } from '../src/logger.js';
import { tmpGitRepo, tmpDir, cleanup } from './helpers.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function listBranches(cwd: string): string[] {
  return git(cwd, ['branch', '--list', '--format=%(refname:short)'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('WorkspaceManager', () => {
  let dir: string;
  let logger: Logger;
  const defaultHooks: HooksConfig = { timeoutMs: 5000 };

  beforeEach(() => {
    dir = tmpGitRepo();
    logger = new Logger();
  });

  afterEach(() => {
    cleanup(dir);
  });

  describe('ensureWorkspace', () => {
    it('creates a new workspace directory', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const result = await mgr.ensureWorkspace('GH-42');

      expect(result.createdNow).toBe(true);
      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.path).toContain('GH-42');
    });

    it('reuses existing workspace', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const first = await mgr.ensureWorkspace('GH-42');
      const second = await mgr.ensureWorkspace('GH-42');

      expect(first.path).toBe(second.path);
      expect(first.createdNow).toBe(true);
      expect(second.createdNow).toBe(false);
    });

    it('sanitizes identifier — replaces special characters', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const result = await mgr.ensureWorkspace('PROJ/issue#42 (urgent)');

      expect(result.path).toContain('PROJ_issue_42__urgent_');
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it('runs after_create hook on new workspace', async () => {
      const hooks: HooksConfig = {
        afterCreate: 'echo created> .hook-ran',
        timeoutMs: 5000,
      };
      const mgr = new WorkspaceManager(dir, hooks, logger);
      const result = await mgr.ensureWorkspace('GH-1');

      const hookFile = path.join(result.path, '.hook-ran');
      expect(fs.existsSync(hookFile)).toBe(true);
      const content = fs.readFileSync(hookFile, 'utf-8').trim();
      expect(content).toBe('created');
    });

    it('does not run after_create hook on existing workspace', async () => {
      const hooks: HooksConfig = {
        afterCreate: 'echo "created" > .hook-ran',
        timeoutMs: 5000,
      };
      const mgr = new WorkspaceManager(dir, hooks, logger);
      await mgr.ensureWorkspace('GH-1');

      // Delete the hook file
      fs.unlinkSync(path.join(mgr.getWorkspacePath('GH-1'), '.hook-ran'));

      // Second call should not create it again
      await mgr.ensureWorkspace('GH-1');
      expect(fs.existsSync(path.join(mgr.getWorkspacePath('GH-1'), '.hook-ran'))).toBe(false);
    });

    it('cleans up workspace if after_create hook fails', async () => {
      const hooks: HooksConfig = {
        afterCreate: 'exit 1',
        timeoutMs: 5000,
      };
      const mgr = new WorkspaceManager(dir, hooks, logger);

      await expect(mgr.ensureWorkspace('GH-fail')).rejects.toThrow('after_create hook failed');
      expect(fs.existsSync(mgr.getWorkspacePath('GH-fail'))).toBe(false);
    });

    it('prevents path traversal', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      // The sanitizer replaces .. with __ so this becomes safe
      const result = await mgr.ensureWorkspace('..\\..\\etc\\passwd');
      // Should be sanitized and under the worktree root
      const worktreeRoot = path.join(dir, '.cacophony', 'worktrees');
      expect(path.resolve(result.path).startsWith(path.resolve(worktreeRoot))).toBe(true);
    });
  });

  describe('runHook', () => {
    it('returns ok:true for null hook', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const result = await mgr.runHook('beforeRun', dir);
      expect(result.ok).toBe(true);
      expect(result.output).toBe('');
    });

    it('captures hook output', async () => {
      const hooks: HooksConfig = {
        beforeRun: 'echo "hello from hook"',
        timeoutMs: 5000,
      };
      const mgr = new WorkspaceManager(dir, hooks, logger);
      const result = await mgr.runHook('beforeRun', dir);

      expect(result.ok).toBe(true);
      expect(result.output).toContain('hello from hook');
    });

    it('returns ok:false for failing hook', async () => {
      const hooks: HooksConfig = {
        afterRun: 'exit 42',
        timeoutMs: 5000,
      };
      const mgr = new WorkspaceManager(dir, hooks, logger);
      const result = await mgr.runHook('afterRun', dir);

      expect(result.ok).toBe(false);
    });
  });

  describe('removeWorkspace', () => {
    it('removes an existing workspace', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      await mgr.ensureWorkspace('GH-1');
      expect(fs.existsSync(mgr.getWorkspacePath('GH-1'))).toBe(true);

      await mgr.removeWorkspace('GH-1');
      expect(fs.existsSync(mgr.getWorkspacePath('GH-1'))).toBe(false);
    });

    it('does not throw for nonexistent workspace', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      await expect(mgr.removeWorkspace('GH-999')).resolves.not.toThrow();
    });

    it('runs before_remove hook', async () => {
      const hooks: HooksConfig = {
        beforeRemove: 'echo "removing" > /dev/null',
        timeoutMs: 5000,
      };
      const mgr = new WorkspaceManager(dir, hooks, logger);
      await mgr.ensureWorkspace('GH-1');
      await mgr.removeWorkspace('GH-1');

      expect(fs.existsSync(mgr.getWorkspacePath('GH-1'))).toBe(false);
    });
  });

  describe('cleanTerminalWorkspaces', () => {
    it('removes multiple workspaces', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      await mgr.ensureWorkspace('GH-1');
      await mgr.ensureWorkspace('GH-2');
      await mgr.ensureWorkspace('GH-3');

      await mgr.cleanTerminalWorkspaces(['GH-1', 'GH-3']);

      expect(fs.existsSync(mgr.getWorkspacePath('GH-1'))).toBe(false);
      expect(fs.existsSync(mgr.getWorkspacePath('GH-2'))).toBe(true);
      expect(fs.existsSync(mgr.getWorkspacePath('GH-3'))).toBe(false);
    });
  });

  describe('getWorkspacePath', () => {
    it('returns deterministic path for identifier', () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const p1 = mgr.getWorkspacePath('GH-42');
      const p2 = mgr.getWorkspacePath('GH-42');
      expect(p1).toBe(p2);
      expect(p1).toBe(path.join(dir, '.cacophony', 'worktrees', 'GH-42'));
    });
  });

  describe('bootstrap in a non-git directory', () => {
    it('initializes a git repo and creates an initial commit when the directory is not a git repo', async () => {
      // Use a fresh temp directory that is NOT a git repo.
      const plainDir = tmpDir('cacophony-plain-');
      try {
        // Configure a local git user in case the global config isn't set,
        // so the initial commit can be made in CI environments.
        fs.mkdirSync(plainDir, { recursive: true });
        execFileSync('git', ['init', '-b', 'main'], { cwd: plainDir, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: plainDir,
          stdio: 'ignore',
        });
        execFileSync('git', ['config', 'user.name', 'Test'], {
          cwd: plainDir,
          stdio: 'ignore',
        });
        // Blow .git away so it looks like a plain directory to WorkspaceManager.
        fs.rmSync(path.join(plainDir, '.git'), { recursive: true, force: true });

        const mgr = new WorkspaceManager(plainDir, defaultHooks, logger);
        expect(mgr.getProjectRoot()).toBe(plainDir);

        // The repo exists and has HEAD.
        expect(fs.existsSync(path.join(plainDir, '.git'))).toBe(true);
        const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
          cwd: plainDir,
          encoding: 'utf-8',
        }).trim();
        expect(head).toMatch(/^[0-9a-f]+$/);

        // And the base branch was detected.
        expect(mgr.getBaseBranch()).toBeTruthy();
      } finally {
        cleanup(plainDir);
      }
    });
  });

  describe('removeWorkspace — auto-commit before cleanup', () => {
    it('commits dirty agent work before removing the worktree', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('task-a');

      // Simulate the agent writing a file but forgetting to commit.
      fs.writeFileSync(path.join(ws.path, 'agent-output.txt'), 'hello\n');

      await mgr.removeWorkspace('task-a');

      // Worktree dir is gone, but the branch should still exist with the file
      // committed by cacophony's auto-commit.
      expect(fs.existsSync(ws.path)).toBe(false);
      expect(listBranches(dir)).toContain('cacophony/task-a');

      const tree = git(dir, ['ls-tree', '-r', '--name-only', 'cacophony/task-a']);
      expect(tree.split('\n')).toContain('agent-output.txt');
    });

    it('skips the auto-commit when the worktree is clean', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('task-clean');
      const beforeCommits = git(dir, ['rev-list', '--count', 'cacophony/task-clean']);

      await mgr.removeWorkspace('task-clean');

      expect(fs.existsSync(ws.path)).toBe(false);
      // The branch should still exist and have the same number of commits.
      const afterCommits = git(dir, ['rev-list', '--count', 'cacophony/task-clean']);
      expect(afterCommits).toBe(beforeCommits);
    });
  });

  describe('tryMergeIntoBase', () => {
    it('merges the branch into main when project root is clean and on base', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('feature-a');
      fs.writeFileSync(path.join(ws.path, 'feature.txt'), 'work\n');

      // Auto-commit the dirty work, then merge.
      const result = mgr.tryMergeIntoBase('feature-a');
      expect(result.result).toBe('merged');

      // The file should now be on main.
      expect(fs.existsSync(path.join(dir, 'feature.txt'))).toBe(true);
    });

    it('skips the merge when the project root is on a different branch', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('feature-b');
      fs.writeFileSync(path.join(ws.path, 'feature.txt'), 'work\n');

      // Switch the project root onto a feature branch.
      git(dir, ['checkout', '-b', 'wip']);

      const result = mgr.tryMergeIntoBase('feature-b');
      expect(result.result).toBe('skipped');
      expect(result.reason).toContain('wip');
      expect(listBranches(dir)).toContain('cacophony/feature-b');
    });

    it('skips the merge when the project root has uncommitted tracked changes', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('feature-c');
      fs.writeFileSync(path.join(ws.path, 'feature.txt'), 'work\n');

      // Dirty the project root by modifying a tracked file.
      fs.writeFileSync(path.join(dir, 'README.md'), '# changed locally\n');

      const result = mgr.tryMergeIntoBase('feature-c');
      expect(result.result).toBe('skipped');
      expect(result.reason).toMatch(/uncommitted/);
    });

    it('does NOT skip the merge for untracked files at the project root', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('feature-d');
      fs.writeFileSync(path.join(ws.path, 'feature.txt'), 'work\n');

      // Untracked junk like .DS_Store should not block the merge.
      fs.writeFileSync(path.join(dir, '.DS_Store'), 'binary junk');

      const result = mgr.tryMergeIntoBase('feature-d');
      expect(result.result).toBe('merged');
    });

    it('reports skipped when the branch does not exist', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const result = mgr.tryMergeIntoBase('nonexistent-task');
      expect(result.result).toBe('skipped');
      expect(result.reason).toContain('not found');
    });

    it('aborts the merge cleanly on conflict and preserves the branch', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      const ws = await mgr.ensureWorkspace('feature-conflict');

      // Both the worktree branch AND main edit the same line of README.md.
      fs.writeFileSync(path.join(ws.path, 'README.md'), '# conflict from branch\n');

      // Modify main concurrently and commit.
      fs.writeFileSync(path.join(dir, 'README.md'), '# conflict from main\n');
      git(dir, ['add', 'README.md']);
      git(dir, ['commit', '-m', 'main conflict']);

      const result = mgr.tryMergeIntoBase('feature-conflict');
      expect(result.result).toBe('conflict');
      // The project root should be left clean (the merge was aborted).
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf-8',
      });
      expect(status.trim()).toBe('');
      // The branch is preserved for manual resolution.
      expect(listBranches(dir)).toContain('cacophony/feature-conflict');
    });
  });

  describe('deleteBranch', () => {
    it('deletes the cacophony/<id> branch from the project root', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      await mgr.ensureWorkspace('task-x');
      // Remove the worktree first (git refuses to delete a checked-out branch).
      await mgr.removeWorkspace('task-x');
      expect(listBranches(dir)).toContain('cacophony/task-x');

      mgr.deleteBranch('task-x');

      expect(listBranches(dir)).not.toContain('cacophony/task-x');
    });

    it('is a no-op (logs a warning) when the branch is missing', async () => {
      const mgr = new WorkspaceManager(dir, defaultHooks, logger);
      // Should not throw.
      mgr.deleteBranch('never-existed');
      expect(listBranches(dir)).not.toContain('cacophony/never-existed');
    });
  });
});
