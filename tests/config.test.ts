import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { loadWorkflow, validateConfig, ConfigManager } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { tmpDir, writeFile, cleanup, fixturePath } from './helpers.js';

describe('loadWorkflow', () => {
  it('parses valid workflow with full config', () => {
    const wf = loadWorkflow(fixturePath('valid-workflow.md'));

    expect(wf.config.tracker.kind).toBe('github');
    expect(wf.config.tracker.repo).toBe('test-org/test-repo');
    expect(wf.config.tracker.activeLabels).toEqual(['todo', 'in-progress']);
    expect(wf.config.tracker.terminalLabels).toEqual(['done', 'wontfix']);
    expect(wf.config.agent.command).toBe('echo {{prompt_file}}');
    expect(wf.config.agent.promptDelivery).toBe('file');
    expect(wf.config.agent.timeoutMs).toBe(5000);
    expect(wf.config.agent.maxConcurrent).toBe(3);
    expect(wf.config.agent.maxTurns).toBe(5);
    expect(wf.config.workspace.projectRoot).toBe('./test-project');
    expect(wf.config.hooks.afterCreate).toBe('echo workspace created');
    expect(wf.config.hooks.beforeRun).toBe('echo before run');
    expect(wf.config.polling.intervalMs).toBe(1000);
    expect(wf.promptTemplate).toContain('{{issue.title}}');
    expect(wf.promptTemplate).toContain('{{issue.description}}');
  });

  it('parses minimal workflow with defaults', () => {
    const wf = loadWorkflow(fixturePath('minimal-workflow.md'));

    expect(wf.config.tracker.kind).toBe('github');
    expect(wf.config.agent.timeoutMs).toBe(3_600_000);
    expect(wf.config.agent.maxConcurrent).toBe(5);
    expect(wf.config.agent.maxTurns).toBe(20);
    expect(wf.config.agent.maxRetryBackoffMs).toBe(300_000);
    expect(wf.config.polling.intervalMs).toBe(30_000);
    expect(wf.config.hooks.timeoutMs).toBe(60_000);
    expect(wf.config.hooks.afterCreate).toBeUndefined();
  });

  it('handles files with no front matter', () => {
    const wf = loadWorkflow(fixturePath('no-frontmatter.md'));

    expect(wf.config.tracker.kind).toBe('');
    expect(wf.promptTemplate).toContain('Just a plain prompt');
  });

  it('throws on invalid YAML', () => {
    expect(() => loadWorkflow(fixturePath('invalid-yaml.md'))).toThrow();
  });

  it('throws on missing file', () => {
    expect(() => loadWorkflow('/nonexistent/path/workflow.md')).toThrow();
  });

  it('resolves $VAR environment variables', () => {
    const dir = tmpDir();
    process.env.TEST_CACOPHONY_KEY = 'secret-key-123';

    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: linear
  api_key: "$TEST_CACOPHONY_KEY"
  project_slug: "test"
agent:
  command: "echo test"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    expect(wf.config.tracker.apiKey).toBe('secret-key-123');

    delete process.env.TEST_CACOPHONY_KEY;
    cleanup(dir);
  });

  it('normalizes state/label arrays to lowercase', () => {
    const dir = tmpDir();
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: github
  repo: "org/repo"
  active_labels: ["TODO", "In-Progress"]
  terminal_labels: ["DONE", "WontFix"]
agent:
  command: "echo test"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    expect(wf.config.tracker.activeLabels).toEqual(['todo', 'in-progress']);
    expect(wf.config.tracker.terminalLabels).toEqual(['done', 'wontfix']);

    cleanup(dir);
  });
});

describe('validateConfig', () => {
  it('returns no errors for valid github config', () => {
    const wf = loadWorkflow(fixturePath('valid-workflow.md'));
    const errors = validateConfig(wf.config);
    expect(errors).toEqual([]);
  });

  it('requires tracker.kind', () => {
    const wf = loadWorkflow(fixturePath('no-frontmatter.md'));
    const errors = validateConfig(wf.config);
    expect(errors).toContain('tracker.kind is required');
  });

  it('requires tracker.repo for github', () => {
    const dir = tmpDir();
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: github
agent:
  command: "echo test"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    const errors = validateConfig(wf.config);
    expect(errors).toContain('tracker.repo is required for GitHub tracker');

    cleanup(dir);
  });

  it('requires agent.command', () => {
    const dir = tmpDir();
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: github
  repo: "org/repo"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    const errors = validateConfig(wf.config);
    expect(errors).toContain('agent.command is required');

    cleanup(dir);
  });

  it('requires linear api_key and project_slug', () => {
    const dir = tmpDir();
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: linear
agent:
  command: "echo test"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    const errors = validateConfig(wf.config);
    expect(errors).toContain('tracker.api_key is required for Linear tracker');
    expect(errors).toContain('tracker.project_slug is required for Linear tracker');

    cleanup(dir);
  });
});

describe('ConfigManager', () => {
  let dir: string;
  let logger: Logger;

  beforeEach(() => {
    dir = tmpDir();
    logger = new Logger();
  });

  afterEach(() => {
    cleanup(dir);
  });

  it('loads and validates on construction', () => {
    const wfPath = fixturePath('valid-workflow.md');
    const mgr = new ConfigManager(wfPath, logger);
    const wf = mgr.load();

    expect(wf.config.tracker.kind).toBe('github');
  });

  it('throws on load of invalid config', () => {
    const wfPath = writeFile(
      dir,
      'bad.md',
      `---
agent:
  command: "echo"
---
Hello`,
    );

    const mgr = new ConfigManager(wfPath, logger);
    expect(() => mgr.load()).toThrow('Invalid workflow config');
  });

  it('getCurrent throws before load', () => {
    const wfPath = fixturePath('valid-workflow.md');
    const mgr = new ConfigManager(wfPath, logger);
    expect(() => mgr.getCurrent()).toThrow('Config not loaded');
  });

  it('reloads successfully on valid change', () => {
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: github
  repo: "org/repo"
agent:
  command: "echo v1"
---
Hello v1`,
    );

    const mgr = new ConfigManager(wfPath, logger);
    mgr.load();

    expect(mgr.getCurrent().config.agent.command).toBe('echo v1');

    // Modify file
    fs.writeFileSync(
      wfPath,
      `---
tracker:
  kind: github
  repo: "org/repo"
agent:
  command: "echo v2"
---
Hello v2`,
    );

    const ok = mgr.reload();
    expect(ok).toBe(true);
    expect(mgr.getCurrent().config.agent.command).toBe('echo v2');
  });

  it('keeps last good config on invalid reload', () => {
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: github
  repo: "org/repo"
agent:
  command: "echo v1"
---
Hello`,
    );

    const mgr = new ConfigManager(wfPath, logger);
    mgr.load();

    // Break the file
    fs.writeFileSync(wfPath, '---\n  [invalid yaml\n---\nHello');

    const ok = mgr.reload();
    expect(ok).toBe(false);
    expect(mgr.getCurrent().config.agent.command).toBe('echo v1');
  });

  it('notifies listeners on successful reload', () => {
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: github
  repo: "org/repo"
agent:
  command: "echo v1"
---
Hello`,
    );

    const mgr = new ConfigManager(wfPath, logger);
    mgr.load();

    let notified = false;
    mgr.onChange(() => {
      notified = true;
    });

    fs.writeFileSync(
      wfPath,
      `---
tracker:
  kind: github
  repo: "org/repo"
agent:
  command: "echo v2"
---
Hello v2`,
    );

    mgr.reload();
    expect(notified).toBe(true);
  });
});
