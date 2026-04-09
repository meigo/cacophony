import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { Liquid } from 'liquidjs';
import type { AgentConfig, AgentResult } from './types.js';
import type { Logger } from './logger.js';

const liquid = new Liquid({ strictVariables: false, strictFilters: true });

export class AgentRunner {
  private config: AgentConfig;
  private logger: Logger;

  constructor(config: AgentConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  updateConfig(config: AgentConfig): void {
    this.config = config;
  }

  async run(opts: {
    workspacePath: string;
    promptContent: string;
    issueIdentifier: string;
    attempt: number;
    onOutput?: (line: string) => void;
    signal?: AbortSignal;
  }): Promise<AgentResult> {
    const { workspacePath, promptContent, issueIdentifier, attempt, onOutput, signal } = opts;
    const startTime = Date.now();

    // Write prompt to temp file in workspace
    const promptFile = path.join(workspacePath, '.cacophony-prompt.md');
    fs.writeFileSync(promptFile, promptContent, 'utf-8');

    // Render command template
    const renderedCommand = liquid.parseAndRenderSync(this.config.command, {
      prompt_file: promptFile,
      workspace: workspacePath,
      identifier: issueIdentifier,
      attempt,
    });

    this.logger.info(`Launching agent`, {
      identifier: issueIdentifier,
      command: renderedCommand,
      delivery: this.config.promptDelivery,
    });

    return new Promise<AgentResult>((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd' : 'bash';
      const shellArgs = isWindows ? ['/c', renderedCommand] : ['-lc', renderedCommand];

      const child = spawn(shell, shellArgs, {
        cwd: workspacePath,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let finished = false;

      const finish = (exitCode: number | null) => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({
          exitCode,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startTime,
        });
      };

      // Pipe prompt via stdin if configured
      if (this.config.promptDelivery === 'stdin') {
        child.stdin.write(promptContent);
        child.stdin.end();
      } else {
        child.stdin.end();
      }

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        if (onOutput) {
          for (const line of text.split('\n').filter(Boolean)) {
            onOutput(line);
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        this.logger.error('Agent process error', { error: err.message });
        finish(null);
      });

      child.on('close', (code) => {
        finish(code);
      });

      // Timeout handling
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.logger.warn(`Agent timed out after ${this.config.timeoutMs}ms`, {
          identifier: issueIdentifier,
        });
        killProcess(child.pid);
      }, this.config.timeoutMs);

      // Abort signal handling
      const onAbort = () => {
        this.logger.info('Agent aborted by signal', { identifier: issueIdentifier });
        killProcess(child.pid);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        signal?.removeEventListener('abort', onAbort);
        // Clean up prompt file
        try {
          fs.unlinkSync(promptFile);
        } catch {
          // ignore
        }
      };
    });
  }
}

function killProcess(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
      // Give 5s grace, then SIGKILL
      setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already dead
        }
      }, 5000);
    }
  } catch {
    // process already exited
  }
}
