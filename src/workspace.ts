import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import type { HooksConfig } from './types.js';
import type { Logger } from './logger.js';

function sanitizeIdentifier(identifier: string): string {
  // Replace invalid chars, then replace leading dots (git branch names can't start with .)
  // and collapse sequences of dots (.. is invalid in git refs).
  return identifier
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\.+$/, '_');
}

function findGitRoot(startDir: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf-8',
    });
    return out.trim();
  } catch {
    return null;
  }
}

function ensureGitRepo(startDir: string, logger: Logger): string {
  const existing = findGitRoot(startDir);
  if (existing) return existing;

  // Not a git repo — initialize one at startDir. Default to main as the
  // initial branch since that's what cacophony's auto-merge assumes.
  try {
    execFileSync('git', ['init', '-b', 'main'], {
      cwd: startDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Older gits don't support -b; fall back and rename after.
    try {
      execFileSync('git', ['init'], { cwd: startDir, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(
        `Not inside a git repository and cacophony could not initialize one at ${startDir}: ${e}`,
      );
    }
    // Rename the unborn default branch to main. `git branch -M main` works on
    // an unborn HEAD because it just rewrites HEAD's ref target.
    try {
      execFileSync('git', ['branch', '-M', 'main'], {
        cwd: startDir,
        stdio: 'ignore',
      });
    } catch {
      // Already on main, or an even older git — harmless.
    }
  }
  logger.info('Initialized new git repository', { path: startDir });

  const root = findGitRoot(startDir);
  if (!root) {
    throw new Error(`git init appeared to succeed but the repository is not detectable.`);
  }
  return root;
}

function ensureInitialCommit(projectRoot: string, logger: Logger): void {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return;
  } catch {
    // No commits — bootstrap one
  }

  try {
    execFileSync('git', ['commit', '--allow-empty', '-m', 'cacophony: initial commit'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logger.info('Created initial empty commit (repo had no history)');
  } catch (e) {
    throw new Error(
      `The git repository has no commits and cacophony could not create an initial one. ` +
        `Check that git user.name and user.email are configured, then retry. (${e})`,
    );
  }
}

function detectBaseBranch(projectRoot: string): string {
  // Try origin/HEAD first
  try {
    const out = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().replace(/^origin\//, '');
  } catch {
    // Try main, then master
    for (const branch of ['main', 'master']) {
      try {
        execFileSync('git', ['rev-parse', '--verify', branch], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        return branch;
      } catch {
        // Try next
      }
    }
    // Fall back to whatever branch HEAD currently points at
    try {
      const out = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.trim();
    } catch {
      throw new Error(
        'Could not determine the base branch. Set workspace.base_branch in .cacophony/config.md.',
      );
    }
  }
}

export class WorkspaceManager {
  private projectRoot: string;
  private worktreeRoot: string;
  private baseBranch: string;
  private hooks: HooksConfig;
  private logger: Logger;

  constructor(projectRoot: string, hooks: HooksConfig, logger: Logger, baseBranch?: string) {
    // Initialize a git repo at projectRoot if one doesn't already exist,
    // then bootstrap an initial commit if there's no history yet.
    this.projectRoot = ensureGitRepo(projectRoot, logger);
    this.worktreeRoot = path.join(this.projectRoot, '.cacophony', 'worktrees');
    this.logger = logger;
    ensureInitialCommit(this.projectRoot, logger);
    this.baseBranch = baseBranch || detectBaseBranch(this.projectRoot);
    this.hooks = hooks;
    fs.mkdirSync(this.worktreeRoot, { recursive: true });

    // Auto-gitignore the .cacophony directory
    const cacoDir = path.join(this.projectRoot, '.cacophony');
    const gitignorePath = path.join(cacoDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '*\n', 'utf-8');
    }
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getBaseBranch(): string {
    return this.baseBranch;
  }

  updateHooks(hooks: HooksConfig): void {
    this.hooks = hooks;
  }

  /**
   * Create a worktree for an issue, or return an existing one.
   * The worktree is based on the latest base branch and checked out on
   * a new branch named after the issue identifier.
   */
  async ensureWorkspace(issueIdentifier: string): Promise<{ path: string; createdNow: boolean }> {
    const key = sanitizeIdentifier(issueIdentifier);
    const wsPath = path.join(this.worktreeRoot, key);
    const branchName = `cacophony/${key}`;

    // Safety: ensure worktree is under worktreeRoot
    const resolved = path.resolve(wsPath);
    if (!resolved.startsWith(this.worktreeRoot)) {
      throw new Error(`Workspace path escapes worktree root: ${resolved}`);
    }

    if (fs.existsSync(wsPath)) {
      return { path: wsPath, createdNow: false };
    }

    // Fetch latest from origin (best-effort; no-op if no remote)
    try {
      execFileSync('git', ['fetch', 'origin', this.baseBranch], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
    } catch {
      // No remote or fetch failed — continue with local branch
    }

    // Determine base ref: prefer origin/<base> if it exists, else local <base>
    let baseRef = this.baseBranch;
    try {
      execFileSync('git', ['rev-parse', '--verify', `origin/${this.baseBranch}`], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
      baseRef = `origin/${this.baseBranch}`;
    } catch {
      // Fall back to local
    }

    // Remove any stale branch with this name (from a previous failed run)
    try {
      execFileSync('git', ['branch', '-D', branchName], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
    } catch {
      // Branch doesn't exist, that's fine
    }

    // Create the worktree
    try {
      execFileSync('git', ['worktree', 'add', '-b', branchName, wsPath, baseRef], {
        cwd: this.projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      throw new Error(`Failed to create worktree for ${issueIdentifier}: ${e}`);
    }

    this.logger.info(`Created worktree`, {
      identifier: issueIdentifier,
      path: wsPath,
      branch: branchName,
      baseRef,
    });

    // Run after_create hook if configured
    if (this.hooks.afterCreate) {
      const result = await this.runHook('afterCreate', wsPath);
      if (!result.ok) {
        // Cleanup failed worktree
        await this.removeWorktree(wsPath);
        throw new Error(`after_create hook failed: ${result.output}`);
      }
    }

    return { path: wsPath, createdNow: true };
  }

  async runHook(
    hookName: 'afterCreate' | 'beforeRun' | 'afterRun' | 'beforeRemove',
    workspacePath: string,
  ): Promise<{ ok: boolean; output: string }> {
    const script = this.hooks[hookName];
    if (!script) return { ok: true, output: '' };

    this.logger.debug(`Running hook: ${hookName}`, { workspace: workspacePath });

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      let shell: string;
      let shellArgs: string[];
      if (isWindows) {
        const gitDir = process.env.GIT_INSTALL_ROOT || 'C:\\Program Files\\Git';
        shell = path.join(gitDir, 'bin', 'bash.exe');
        shellArgs = ['-c', script];
      } else {
        shell = 'bash';
        shellArgs = ['-c', script];
      }

      const child = spawn(shell, shellArgs, {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.hooks.timeoutMs,
      });

      let output = '';
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.on('error', (err) => {
        this.logger.error(`Hook ${hookName} error`, { error: err.message });
        resolve({ ok: false, output: err.message });
      });

      child.on('close', (code) => {
        const truncated =
          output.length > 10_240 ? output.slice(0, 10_240) + '...(truncated)' : output;
        if (code !== 0) {
          this.logger.warn(`Hook ${hookName} exited with code ${code}`, { output: truncated });
        }
        resolve({ ok: code === 0, output: truncated });
      });
    });
  }

  async removeWorkspace(issueIdentifier: string): Promise<void> {
    const key = sanitizeIdentifier(issueIdentifier);
    const wsPath = path.join(this.worktreeRoot, key);

    if (!fs.existsSync(wsPath)) return;

    if (this.hooks.beforeRemove) {
      await this.runHook('beforeRemove', wsPath);
    }

    await this.removeWorktree(wsPath);
  }

  /**
   * Delete the cacophony/<id> branch. Safe to call only after the worktree
   * has been removed (git refuses while a branch is checked out in any
   * worktree). Used after a successful auto-merge.
   */
  deleteBranch(issueIdentifier: string): void {
    const key = sanitizeIdentifier(issueIdentifier);
    const branchName = `cacophony/${key}`;
    try {
      execFileSync('git', ['branch', '-D', branchName], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
      this.logger.info('Deleted merged branch', { branch: branchName });
    } catch (e) {
      this.logger.warn('Failed to delete merged branch', {
        branch: branchName,
        error: String(e),
      });
    }
  }

  /**
   * Try to merge the task's branch into the configured base branch in the
   * project root. Returns 'merged' on success, 'conflict' on merge conflict
   * (the merge is aborted), or 'skipped' if the project root isn't ready
   * (dirty tree or checked out on a different branch). The branch and
   * worktree are left intact in the conflict and skipped cases so the user
   * can resolve manually.
   */
  tryMergeIntoBase(issueIdentifier: string): {
    result: 'merged' | 'conflict' | 'skipped';
    reason?: string;
  } {
    const key = sanitizeIdentifier(issueIdentifier);
    const branchName = `cacophony/${key}`;
    const wsPath = path.join(this.worktreeRoot, key);

    // Make sure any forgotten work is committed before merging
    this.commitDirtyWorktree(wsPath);

    // Verify the branch actually exists
    try {
      execFileSync('git', ['rev-parse', '--verify', branchName], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
    } catch {
      return { result: 'skipped', reason: `branch ${branchName} not found` };
    }

    // Project root must be on the base branch
    let currentBranch: string;
    try {
      currentBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return { result: 'skipped', reason: 'project root has detached HEAD' };
    }
    if (currentBranch !== this.baseBranch) {
      return {
        result: 'skipped',
        reason: `project root is on ${currentBranch}, not ${this.baseBranch}`,
      };
    }

    // Project root must be clean (modified tracked files block a merge;
    // untracked files like .DS_Store do not).
    let dirty: string;
    try {
      dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      });
    } catch (e) {
      return { result: 'skipped', reason: `git status failed: ${e}` };
    }
    if (dirty.trim() !== '') {
      return { result: 'skipped', reason: 'project root has uncommitted tracked changes' };
    }

    // Do the merge. The branch isn't deleted here because the worktree still
    // has it checked out — git refuses. Caller should delete the branch after
    // removing the worktree (see deleteBranch).
    try {
      execFileSync(
        'git',
        ['merge', '--no-ff', '-m', `cacophony: merge ${branchName}`, branchName],
        { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.logger.info('Auto-merged into base branch', {
        branch: branchName,
        base: this.baseBranch,
      });
      return { result: 'merged' };
    } catch (e) {
      // Conflict — abort the merge so the project root is left clean
      try {
        execFileSync('git', ['merge', '--abort'], {
          cwd: this.projectRoot,
          stdio: 'ignore',
        });
      } catch {
        // ignore
      }
      this.logger.warn('Auto-merge failed (conflict)', {
        branch: branchName,
        error: String(e),
      });
      return { result: 'conflict', reason: String(e) };
    }
  }

  /**
   * If the worktree has uncommitted changes, stage and commit them on the
   * cacophony/<id> branch. Returns 'clean' if nothing to commit, 'committed'
   * on success, 'failed' if the commit could not be made (in which case the
   * caller MUST NOT delete the worktree — work would be lost).
   */
  private commitDirtyWorktree(wsPath: string): 'clean' | 'committed' | 'failed' {
    if (!fs.existsSync(wsPath)) return 'clean';
    let dirty: string;
    try {
      dirty = execFileSync('git', ['status', '--porcelain'], {
        cwd: wsPath,
        encoding: 'utf-8',
      });
    } catch (e) {
      this.logger.warn('git status failed in worktree', {
        path: wsPath,
        error: String(e),
      });
      return 'failed';
    }
    if (dirty.trim() === '') return 'clean';
    try {
      execFileSync('git', ['add', '-A'], { cwd: wsPath, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'cacophony: auto-commit before worktree cleanup'], {
        cwd: wsPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.logger.info('Auto-committed uncommitted agent work', { path: wsPath });
      return 'committed';
    } catch (e) {
      this.logger.error('Failed to auto-commit dirty worktree — leaving worktree in place', {
        path: wsPath,
        error: String(e),
      });
      return 'failed';
    }
  }

  private async removeWorktree(wsPath: string): Promise<void> {
    // Preserve any work the agent forgot to commit. The cacophony/<id> branch
    // is the durable record of the run; the worktree dir is just scratch space.
    // If the auto-commit fails, do NOT delete the worktree — the user can
    // inspect and resolve manually. Losing work silently is worse than a
    // lingering worktree.
    if (this.commitDirtyWorktree(wsPath) === 'failed') {
      return;
    }

    try {
      execFileSync('git', ['worktree', 'remove', '--force', wsPath], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
      this.logger.info(`Removed worktree`, { path: wsPath });
    } catch {
      // Fallback: remove dir manually
      try {
        fs.rmSync(wsPath, { recursive: true, force: true });
        execFileSync('git', ['worktree', 'prune'], { cwd: this.projectRoot, stdio: 'ignore' });
      } catch (e) {
        this.logger.error(`Failed to remove worktree`, { path: wsPath, error: String(e) });
      }
    }

    // The branch is intentionally left in place — it preserves the agent's work
    // and lets the user inspect, merge, or delete it manually.
  }

  async cleanTerminalWorkspaces(identifiers: string[]): Promise<void> {
    for (const id of identifiers) {
      await this.removeWorkspace(id);
    }
  }

  getWorkspacePath(issueIdentifier: string): string {
    return path.join(this.worktreeRoot, sanitizeIdentifier(issueIdentifier));
  }

  /**
   * Returns true if the worktree has no modified, added, or untracked files.
   * Used for no-changes detection: if the agent exited 0 but didn't touch
   * any files, it probably misunderstood the task.
   */
  isWorktreeClean(wsPath: string): boolean {
    if (!fs.existsSync(wsPath)) return true;
    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: wsPath,
        encoding: 'utf-8',
      });
      return status.trim() === '';
    } catch {
      return true;
    }
  }

  /**
   * Prune any stale worktree references (e.g., from a crash).
   */
  pruneStale(): void {
    try {
      execFileSync('git', ['worktree', 'prune'], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
    } catch {
      // Non-fatal
    }
  }
}
