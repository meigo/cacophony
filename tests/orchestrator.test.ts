import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { Orchestrator } from '../src/orchestrator.js';
import { ConfigManager } from '../src/config.js';
import { StateStore } from '../src/state.js';
import { Logger } from '../src/logger.js';
import { tmpDir, cleanup, writeFile } from './helpers.js';

function createWorkflow(dir: string, overrides: { agentCommand?: string } = {}): string {
  const agentCmd = overrides.agentCommand ?? 'echo done';
  const wsRoot = path.join(dir, 'workspaces').replace(/\\/g, '/');
  return writeFile(
    dir,
    'WORKFLOW.md',
    `---
tracker:
  kind: github
  repo: "test/repo"
  active_labels: ["todo", "in-progress"]
  terminal_labels: ["done", "closed"]

agent:
  command: "${agentCmd}"
  prompt_delivery: file
  timeout_ms: 5000
  max_concurrent: 3

workspace:
  root: ${wsRoot}

polling:
  interval_ms: 60000
---

Work on {{issue.title}}
`,
  );
}

describe('Orchestrator', () => {
  let dir: string;
  let logger: Logger;

  beforeEach(() => {
    dir = tmpDir();
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
      const wsRoot = configMgr.getCurrent().config.workspace.root;
      fs.mkdirSync(wsRoot, { recursive: true });

      const dbPath = path.join(wsRoot, '.cacophony.db');
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
    it('returns empty state before start', () => {
      const wfPath = createWorkflow(dir);
      const configMgr = new ConfigManager(wfPath, logger);
      configMgr.load();
      const wsRoot = configMgr.getCurrent().config.workspace.root;
      fs.mkdirSync(wsRoot, { recursive: true });
      const store = new StateStore(path.join(wsRoot, '.cacophony.db'));

      const orchestrator = new Orchestrator(configMgr, store, logger);
      const status = orchestrator.getStatus();

      expect(status.running).toEqual([]);
      expect(status.retrying).toEqual([]);
      expect(status.claimed).toEqual([]);

      store.close();
    });
  });

  describe('cancelIssue', () => {
    it('returns false for unknown issue', () => {
      const wfPath = createWorkflow(dir);
      const configMgr = new ConfigManager(wfPath, logger);
      configMgr.load();
      const wsRoot = configMgr.getCurrent().config.workspace.root;
      fs.mkdirSync(wsRoot, { recursive: true });
      const store = new StateStore(path.join(wsRoot, '.cacophony.db'));

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
      const wsRoot = configMgr.getCurrent().config.workspace.root;
      fs.mkdirSync(wsRoot, { recursive: true });
      const store = new StateStore(path.join(wsRoot, '.cacophony.db'));

      const orchestrator = new Orchestrator(configMgr, store, logger);
      await orchestrator.start();

      const status = orchestrator.getStatus();
      expect(status).toBeDefined();
      expect(status.running).toEqual([]);

      await orchestrator.stop();
    });
  });
});
