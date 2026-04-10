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

function findGitRoot(startDir: string): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf-8',
    });
    return out.trim();
  } catch {
    throw new Error(
      `Not inside a git repository. Run cacophony from your project's root directory.`,
    );
  }
}

function detectBaseBranch(projectRoot: string): string {
  // Try origin/HEAD first, fall back to main, then master
  try {
    const out = execFileSync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd: projectRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
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
    return 'main';
  }
}

export class WorkspaceManager {
  private projectRoot: string;
  private worktreeRoot: string;
  private baseBranch: string;
  private hooks: HooksConfig;
  private logger: Logger;

  constructor(projectRoot: string, hooks: HooksConfig, logger: Logger, baseBranch?: string) {
    this.projectRoot = findGitRoot(projectRoot);
    this.worktreeRoot = path.join(this.projectRoot, '.cacophony', 'worktrees');
    this.baseBranch = baseBranch || detectBaseBranch(this.projectRoot);
    this.hooks = hooks;
    this.logger = logger;
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
        await this.removeWorktree(wsPath, branchName);
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
    const branchName = `cacophony/${key}`;

    if (!fs.existsSync(wsPath)) return;

    if (this.hooks.beforeRemove) {
      await this.runHook('beforeRemove', wsPath);
    }

    await this.removeWorktree(wsPath, branchName);
  }

  private async removeWorktree(wsPath: string, branchName: string): Promise<void> {
    // Remove the git worktree
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

    // Delete the branch (only if not checked out)
    try {
      execFileSync('git', ['branch', '-D', branchName], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });
    } catch {
      // Branch may have been pushed/merged and deleted — that's fine
    }
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
