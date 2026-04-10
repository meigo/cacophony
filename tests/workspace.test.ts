import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { HooksConfig } from '../src/types.js';
import { WorkspaceManager } from '../src/workspace.js';
import { Logger } from '../src/logger.js';
import { tmpGitRepo, cleanup } from './helpers.js';

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
});
