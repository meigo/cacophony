import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { Orchestrator } from '../src/orchestrator.js';
import { ConfigManager } from '../src/config.js';
import { StateStore } from '../src/state.js';
import { Logger } from '../src/logger.js';
import { tmpGitRepo, cleanup, writeFile } from './helpers.js';

function createWorkflow(dir: string, overrides: { agentCommand?: string } = {}): string {
  const agentCmd = overrides.agentCommand ?? 'echo done';
  const projectRoot = dir.replace(/\\/g, '/');
  return writeFile(
    dir,
    'WORKFLOW.md',
    `---
tracker:
  kind: files
  dir: "./tasks"
  active_states: ["todo", "in-progress"]
  terminal_states: ["done", "closed"]

agent:
  command: "${agentCmd}"
  prompt_delivery: file
  timeout_ms: 5000
  max_concurrent: 3

workspace:
  project_root: ${projectRoot}

polling:
  interval_ms: 60000
---

Work on {{issue.title}}
`,
  );
}

function dbPathFor(projectRoot: string): string {
  return path.join(projectRoot, '.cacophony', 'cacophony.db');
}

describe('Orchestrator', () => {
  let dir: string;
  let logger: Logger;

  beforeEach(() => {
    dir = tmpGitRepo();
    logger = new Logger();
  });

  afterEach(() => {
    cleanup(dir);
  });

  describe('startup recovery', () => {
    it('marks stale runs as failed on startup', async () => {
      const wfPath = createWorkflow(dir);
      const configMgr = new ConfigManager(wfPath, logger);
      configMgr.load();

      const dbPath = dbPathFor(dir);
      // Ensure .cacophony dir exists
      const fs = await import('node:fs');
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });

      const store = new StateStore(dbPath);

      // Simulate stale run from previous process
      const runId = store.createRun('issue-1', 'GH-1', 0, '/ws');
      store.updateRunStatus(runId, 'running');
      expect(store.getActiveRuns()).toHaveLength(1);
      store.close();

      // Reopen store as orchestrator would
      const store2 = new StateStore(dbPath);
      const orchestrator = new Orchestrator(configMgr, store2, logger);

      await orchestrator.start();
      await orchestrator.stop();

      // Reopen to check — stop() closed store2
      const store3 = new StateStore(dbPath);
      const latest = store3.getLatestRun('issue-1');
      expect(latest).toBeDefined();
      expect(latest!.status).toBe('failed');
      expect(latest!.error).toContain('restart');
      store3.close();
    });
  });

  describe('getStatus', () => {
    it('returns empty state before start', async () => {
      const wfPath = createWorkflow(dir);
      const configMgr = new ConfigManager(wfPath, logger);
      configMgr.load();

      const fs = await import('node:fs');
      const dbPath = dbPathFor(dir);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const store = new StateStore(dbPath);

      const orchestrator = new Orchestrator(configMgr, store, logger);
      const status = orchestrator.getStatus();

      expect(status.running).toEqual([]);
      expect(status.retrying).toEqual([]);
      expect(status.claimed).toEqual([]);

      store.close();
    });
  });

  describe('cancelIssue', () => {
    it('returns false for unknown issue', async () => {
      const wfPath = createWorkflow(dir);
      const configMgr = new ConfigManager(wfPath, logger);
      configMgr.load();

      const fs = await import('node:fs');
      const dbPath = dbPathFor(dir);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const store = new StateStore(dbPath);

      const orchestrator = new Orchestrator(configMgr, store, logger);
      expect(orchestrator.cancelIssue('GH-999')).toBe(false);

      store.close();
    });
  });

  describe('lifecycle', () => {
    it('starts and stops cleanly', async () => {
      const wfPath = createWorkflow(dir);
      const configMgr = new ConfigManager(wfPath, logger);
      configMgr.load();

      const fs = await import('node:fs');
      const dbPath = dbPathFor(dir);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const store = new StateStore(dbPath);

      const orchestrator = new Orchestrator(configMgr, store, logger);
      await orchestrator.start();

      const status = orchestrator.getStatus();
      expect(status).toBeDefined();
      expect(status.running).toEqual([]);

      await orchestrator.stop();
    });
  });
});
