import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from '../src/types.js';
import { AgentRunner } from '../src/runner.js';
import { Logger } from '../src/logger.js';
import { tmpDir, cleanup } from './helpers.js';

const baseConfig: AgentConfig = {
  command: 'echo "agent output"',
  promptDelivery: 'file',
  timeoutMs: 10_000,
  maxConcurrent: 5,
  maxTurns: 20,
  maxRetryBackoffMs: 300_000,
};

describe('AgentRunner', () => {
  let dir: string;
  let logger: Logger;

  beforeEach(() => {
    dir = tmpDir();
    logger = new Logger();
  });

  afterEach(() => {
    cleanup(dir);
  });

  describe('run — file delivery', () => {
    it('writes prompt file and runs command', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'cat {{prompt_file}}',
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'Hello from test prompt',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from test prompt');
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('cleans up prompt file after run', async () => {
      const runner = new AgentRunner(baseConfig, logger);

      await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(fs.existsSync(path.join(dir, '.cacophony-prompt.md'))).toBe(false);
    });

    it('substitutes template variables in command', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'echo "ws={{workspace}} id={{identifier}} att={{attempt}}"',
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-42',
        attempt: 3,
      });

      expect(result.stdout).toContain(`ws=${dir}`);
      expect(result.stdout).toContain('id=GH-42');
      expect(result.stdout).toContain('att=3');
    });
  });

  describe('run — stdin delivery', () => {
    it('pipes prompt via stdin', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'cat',
        promptDelivery: 'stdin',
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'piped prompt content',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('piped prompt content');
    });
  });

  describe('run — exit codes', () => {
    it('captures non-zero exit code', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'exit 42',
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.exitCode).toBe(42);
    });

    it('captures stderr', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'echo "error msg" >&2 && exit 1',
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error msg');
    });
  });

  describe('run — timeout', () => {
    it('kills process on timeout', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'sleep 60',
        timeoutMs: 500,
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.timedOut).toBe(true);
      expect(result.durationMs).toBeLessThan(5000);
    });
  });

  describe('run — abort signal', () => {
    it('kills process on abort', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'sleep 60',
      };
      const runner = new AgentRunner(config, logger);
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 300);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
        signal: controller.signal,
      });

      expect(result.durationMs).toBeLessThan(5000);
    });
  });

  describe('run — output callback', () => {
    it('calls onOutput for each stdout line', async () => {
      const config: AgentConfig = {
        ...baseConfig,
        command: 'echo "line1" && echo "line2" && echo "line3"',
      };
      const runner = new AgentRunner(config, logger);
      const lines: string[] = [];

      await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
        onOutput: (line) => lines.push(line),
      });

      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.join('\n')).toContain('line1');
    });
  });

  describe('run — environment variables', () => {
    it('passes custom env vars to subprocess', async () => {
      const envCmd =
        process.platform === 'win32' ? 'echo %CACOPHONY_TEST_VAR%' : 'echo $CACOPHONY_TEST_VAR';
      const config: AgentConfig = {
        ...baseConfig,
        command: envCmd,
        env: { CACOPHONY_TEST_VAR: 'hello-from-env' },
      };
      const runner = new AgentRunner(config, logger);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.stdout).toContain('hello-from-env');
    });
  });

  describe('updateConfig', () => {
    it('updates the agent config', async () => {
      const runner = new AgentRunner(baseConfig, logger);
      const newConfig: AgentConfig = { ...baseConfig, command: 'echo "updated"' };
      runner.updateConfig(newConfig);

      const result = await runner.run({
        workspacePath: dir,
        promptContent: 'test',
        issueIdentifier: 'GH-1',
        attempt: 0,
      });

      expect(result.stdout).toContain('updated');
    });
  });
});
