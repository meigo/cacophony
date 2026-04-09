import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { HooksConfig } from './types.js';
import type { Logger } from './logger.js';

function sanitizeIdentifier(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, '_');
}

export class WorkspaceManager {
  private root: string;
  private hooks: HooksConfig;
  private logger: Logger;

  constructor(root: string, hooks: HooksConfig, logger: Logger) {
    this.root = path.resolve(root);
    this.hooks = hooks;
    this.logger = logger;
    fs.mkdirSync(this.root, { recursive: true });
  }

  updateHooks(hooks: HooksConfig): void {
    this.hooks = hooks;
  }

  async ensureWorkspace(issueIdentifier: string): Promise<{ path: string; createdNow: boolean }> {
    const key = sanitizeIdentifier(issueIdentifier);
    const wsPath = path.join(this.root, key);

    // Safety: ensure workspace is under root
    const resolved = path.resolve(wsPath);
    if (!resolved.startsWith(this.root)) {
      throw new Error(`Workspace path escapes root: ${resolved}`);
    }

    const existed = fs.existsSync(wsPath);
    fs.mkdirSync(wsPath, { recursive: true });
    const createdNow = !existed;

    if (createdNow && this.hooks.afterCreate) {
      const result = await this.runHook('afterCreate', wsPath);
      if (!result.ok) {
        // Cleanup failed workspace
        fs.rmSync(wsPath, { recursive: true, force: true });
        throw new Error(`after_create hook failed: ${result.output}`);
      }
    }

    return { path: wsPath, createdNow };
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
      const shell = isWindows ? 'cmd' : 'bash';
      const shellArgs = isWindows ? ['/c', script] : ['-lc', script];

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
    const wsPath = path.join(this.root, key);

    if (!fs.existsSync(wsPath)) return;

    if (this.hooks.beforeRemove) {
      await this.runHook('beforeRemove', wsPath);
    }

    try {
      fs.rmSync(wsPath, { recursive: true, force: true });
      this.logger.info(`Removed workspace for ${issueIdentifier}`);
    } catch (e) {
      this.logger.error(`Failed to remove workspace`, {
        identifier: issueIdentifier,
        error: String(e),
      });
    }
  }

  async cleanTerminalWorkspaces(identifiers: string[]): Promise<void> {
    for (const id of identifiers) {
      await this.removeWorkspace(id);
    }
  }

  getWorkspacePath(issueIdentifier: string): string {
    return path.join(this.root, sanitizeIdentifier(issueIdentifier));
  }
}
