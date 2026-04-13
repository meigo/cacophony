import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { loadWorkflow, validateConfig, ConfigManager, updateConfigHooks } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { tmpDir, writeFile, cleanup, fixturePath } from './helpers.js';

describe('loadWorkflow', () => {
  it('parses valid workflow with full config', () => {
    const wf = loadWorkflow(fixturePath('valid-workflow.md'));

    expect(wf.config.tracker.kind).toBe('files');
    expect(wf.config.tracker.dir).toContain('tasks');
    expect(wf.config.tracker.activeStates).toEqual(['todo', 'in-progress']);
    expect(wf.config.tracker.terminalStates).toEqual(['done', 'wontfix']);
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

    expect(wf.config.tracker.kind).toBe('files');
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

    expect(wf.config.tracker.kind).toBe('files');
    expect(wf.promptTemplate).toContain('Just a plain prompt');
  });

  it('throws on invalid YAML', () => {
    expect(() => loadWorkflow(fixturePath('invalid-yaml.md'))).toThrow();
  });

  it('throws on missing file', () => {
    expect(() => loadWorkflow('/nonexistent/path/workflow.md')).toThrow();
  });

  it('normalizes state arrays to lowercase', () => {
    const dir = tmpDir();
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: files
  dir: "./tasks"
  active_states: ["TODO", "In-Progress"]
  terminal_states: ["DONE", "WontFix"]
agent:
  command: "echo test"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    expect(wf.config.tracker.activeStates).toEqual(['todo', 'in-progress']);
    expect(wf.config.tracker.terminalStates).toEqual(['done', 'wontfix']);

    cleanup(dir);
  });
});

describe('validateConfig', () => {
  it('returns no errors for valid files config', () => {
    const wf = loadWorkflow(fixturePath('valid-workflow.md'));
    const errors = validateConfig(wf.config);
    expect(errors).toEqual([]);
  });

  it('defaults tracker.kind to files when omitted', () => {
    const wf = loadWorkflow(fixturePath('no-frontmatter.md'));
    expect(wf.config.tracker.kind).toBe('files');
  });

  it('requires agent.command', () => {
    const dir = tmpDir();
    const wfPath = writeFile(
      dir,
      'wf.md',
      `---
tracker:
  kind: files
  dir: "./tasks"
---
Hello`,
    );

    const wf = loadWorkflow(wfPath);
    const errors = validateConfig(wf.config);
    expect(errors).toContain('agent.command is required');

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

    expect(wf.config.tracker.kind).toBe('files');
  });

  it('throws on load of invalid config', () => {
    const wfPath = writeFile(
      dir,
      'bad.md',
      `---
tracker:
  dir: "./tasks"
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
  kind: files
  dir: "./tasks"
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
  kind: files
  dir: "./tasks"
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
  kind: files
  dir: "./tasks"
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
  kind: files
  dir: "./tasks"
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
  kind: files
  dir: "./tasks"
agent:
  command: "echo v2"
---
Hello v2`,
    );

    mgr.reload();
    expect(notified).toBe(true);
  });
});

describe('updateConfigHooks', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    cleanup(dir);
  });

  it('adds after_run hook to a config with no hooks', () => {
    const wfPath = writeFile(
      dir,
      'config.md',
      `---
tracker:
  kind: files
agent:
  command: "echo test"
---
Hello`,
    );

    updateConfigHooks(wfPath, { after_run: 'npm test && npm run build' });

    const content = fs.readFileSync(wfPath, 'utf-8');
    expect(content).toContain('after_run');
    expect(content).toContain('npm test && npm run build');
    // Prompt template body is preserved
    expect(content).toContain('Hello');
    // Existing config is preserved
    expect(content).toContain('echo test');
  });

  it('merges into existing hooks without clobbering other fields', () => {
    const wfPath = writeFile(
      dir,
      'config.md',
      `---
agent:
  command: "echo test"
hooks:
  timeout_ms: 120000
  after_create: "npm install"
---
Prompt body`,
    );

    updateConfigHooks(wfPath, { after_run: 'npm test' });

    const wf = loadWorkflow(wfPath);
    expect(wf.config.hooks.afterCreate).toBe('npm install');
    expect(wf.config.hooks.afterRun).toBe('npm test');
    expect(wf.config.hooks.timeoutMs).toBe(120000);
    expect(wf.promptTemplate).toContain('Prompt body');
  });

  it('overwrites an existing after_run value', () => {
    const wfPath = writeFile(
      dir,
      'config.md',
      `---
agent:
  command: "echo test"
hooks:
  after_run: "old command"
---
Body`,
    );

    updateConfigHooks(wfPath, { after_run: 'new command' });

    const wf = loadWorkflow(wfPath);
    expect(wf.config.hooks.afterRun).toBe('new command');
  });
});
