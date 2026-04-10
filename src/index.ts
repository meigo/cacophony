#!/usr/bin/env node

import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import readline from 'node:readline';
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import { StateStore } from './state.js';
import { Orchestrator } from './orchestrator.js';
import { Logger } from './logger.js';
import type { FilesTracker } from './trackers/files.js';
import { slugifyPrompt, uniqueIdentifier } from './slug.js';
import { runBrief } from './brief.js';

const USAGE = `
${chalk.bold('cacophony')} — Provider-agnostic agent orchestrator

${chalk.bold('Usage:')}
  cacophony init                                       Generate .cacophony/config.md interactively
  cacophony start [workflow.md] [--port N|--no-server] Start the daemon (dashboard on :8080 by default)
  cacophony status [workflow.md]                       Show current state
  cacophony stop <identifier> [workflow.md]            Cancel a running issue
  cacophony help                                       Show this help

${chalk.bold('Examples:')}
  cacophony init
  cacophony start
  cacophony start --port 9000
  cacophony start --no-server
  cacophony stop fix-login
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'start':
      await cmdStart(args.slice(1));
      break;
    case 'status':
      await cmdStatus(args.slice(1));
      break;
    case 'stop':
      await cmdStop(args.slice(1));
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

const DEFAULT_CONFIG_PATH = '.cacophony/config.md';
const LEGACY_CONFIG_PATH = 'WORKFLOW.md';

function resolveWorkflowPath(args: string[]): string {
  // Explicit path argument always wins
  const wfArg = args.find((a) => !a.startsWith('--'));
  if (wfArg) return path.resolve(wfArg);

  // Default: prefer .cacophony/config.md, fall back to WORKFLOW.md for legacy projects
  const newPath = path.resolve(DEFAULT_CONFIG_PATH);
  if (fs.existsSync(newPath)) return newPath;

  const legacyPath = path.resolve(LEGACY_CONFIG_PATH);
  if (fs.existsSync(legacyPath)) {
    console.error(
      chalk.yellow(
        `  ⚠  Found legacy ${LEGACY_CONFIG_PATH} at the project root. ` +
          `Move it to ${DEFAULT_CONFIG_PATH} when convenient.`,
      ),
    );
    return legacyPath;
  }

  return newPath;
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function resolveDbPath(projectRoot: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  const cacoDir = path.join(resolvedRoot, '.cacophony');
  fs.mkdirSync(cacoDir, { recursive: true });
  return path.join(cacoDir, 'cacophony.db');
}

// --- Init ---

function ask(rl: readline.Interface, question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? chalk.dim(` (${fallback})`) : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || fallback || '');
    });
  });
}

function choose(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultIdx = 0,
): Promise<string> {
  return new Promise((resolve) => {
    console.log(`\n  ${chalk.bold(question)}`);
    for (let i = 0; i < options.length; i++) {
      const marker = i === defaultIdx ? chalk.green('> ') : '  ';
      console.log(`  ${marker}${i + 1}. ${options[i]}`);
    }
    rl.question(`  Choice ${chalk.dim(`(${defaultIdx + 1})`)}: `, (answer) => {
      const idx = answer.trim() ? parseInt(answer.trim(), 10) - 1 : defaultIdx;
      resolve(options[Math.max(0, Math.min(idx, options.length - 1))]);
    });
  });
}

interface AgentPreset {
  command: (model?: string) => string;
  delivery: string;
  /** First entry is the default; the init wizard presents these as a picker. */
  models?: string[];
}

const AGENT_PRESETS: Record<string, AgentPreset> = {
  'Claude Code': {
    command: (model) =>
      `claude -p {{prompt_file}} --output-format stream-json --verbose --dangerously-skip-permissions${model ? ` --model ${model}` : ''}`,
    delivery: 'file',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  },
  Codex: {
    command: (model) => `codex --prompt {{prompt_file}}${model ? ` --model ${model}` : ''}`,
    delivery: 'file',
    models: ['gpt-5', 'gpt-5-mini', 'o4-mini'],
  },
  Aider: {
    command: () => 'aider --message-file {{prompt_file}} --yes',
    delivery: 'file',
  },
  'Gemini CLI': {
    command: () => 'gemini < {{prompt_file}}',
    delivery: 'file',
  },
  'Qwen Code': {
    command: (model) => `qwen --yolo${model ? ` --model ${model}` : ''} < {{prompt_file}}`,
    delivery: 'file',
    models: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-coder'],
  },
  Custom: {
    command: () => '',
    delivery: 'file',
  },
};

const CUSTOM_MODEL_LABEL = 'Custom…';

async function cmdInit(): Promise<void> {
  const outPath = path.resolve(DEFAULT_CONFIG_PATH);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (fs.existsSync(outPath)) {
    console.log(chalk.yellow(`\n  ${DEFAULT_CONFIG_PATH} already exists at ${outPath}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const overwrite = await ask(rl, 'Overwrite?', 'n');
    if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
      console.log(chalk.dim('  Aborted.\n'));
      rl.close();
      return;
    }
    rl.close();
  }

  console.log(chalk.bold('\n  Cacophony Init\n'));
  console.log(chalk.dim(`  Generate ${DEFAULT_CONFIG_PATH} for your project.\n`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // --- Agent ---
  const agentNames = Object.keys(AGENT_PRESETS);
  const agentChoice = await choose(rl, 'Coding agent:', agentNames, 0);
  const preset = AGENT_PRESETS[agentChoice];

  let agentCommand = preset.command();
  let agentDelivery = preset.delivery;

  if (agentChoice === 'Custom') {
    agentCommand = await ask(
      rl,
      'Agent command (use {{prompt_file}}, {{workspace}}, {{identifier}})',
    );
    const deliveryChoice = await choose(rl, 'How to pass the prompt:', ['file', 'stdin', 'arg'], 0);
    agentDelivery = deliveryChoice;
  } else if (preset.models?.length) {
    const options = [...preset.models, CUSTOM_MODEL_LABEL];
    const picked = await choose(rl, 'Model:', options, 0);
    const model = picked === CUSTOM_MODEL_LABEL ? await ask(rl, 'Model name') : picked;
    agentCommand = preset.command(model);
  }

  const maxConcurrent = await ask(rl, 'Max concurrent agents', '3');

  rl.close();

  // --- Generate ---
  const workflow = `---
agent:
  command: "${agentCommand}"
  prompt_delivery: ${agentDelivery}
  timeout_ms: 3600000
  max_concurrent: ${maxConcurrent}
  max_turns: 50

polling:
  interval_ms: 30000
---

You are an autonomous coding agent working on task **{{issue.identifier}}**.

You are running inside a git worktree at the project root. A new branch has already been created for you.

## Task

**{{issue.title}}**

{{issue.description}}

## Decide first: do it, or split it

Before writing any code, judge whether this task is small enough to finish in a single agent run.

- **If it is small** (one focused change, one feature, a single component), proceed to the instructions below and do the work.
- **If it spans multiple distinct workstreams** (e.g. project scaffolding + multiple pages + styling + integration), split it into smaller tasks and exit immediately. Do not write any code yourself in that case — your only job is planning.

To split the task, write 2–6 markdown files into {{tasks_dir}}/. Each file represents one subtask and must be self-contained: the agent that picks it up will not have access to this prompt or to the other subtasks.

Each subtask file must have YAML front matter with at least:

- state: todo
- parent: {{issue.identifier}}   (so the dashboard can group children under this task)
- priority: 1-4   (optional)

…followed by a short markdown body that fully describes the subtask. The filename should be a short slug ending in .md (letters, digits, hyphens only). If subtask B depends on subtask A, add blocked_by: [A-slug] to B's front matter and cacophony will run them in order.

After writing the files, exit cleanly. Cacophony will pick up the subtasks on the next poll.

## Instructions (only if you decided to do the task yourself)

1. Implement the required changes in this worktree
2. Inspect the project stack and run appropriate tests (unit, lint, type check) where they exist
3. Fix any failures — do not move on until everything passes
4. Commit your work on this branch (cacophony will auto-commit anything you forget, but explicit commits give better history)
5. Exit cleanly when done — cacophony will mark the task complete and clean up the worktree

{% if attempt %}
This is retry attempt #{{attempt}}. The worktree may contain previous work — continue from where it left off.
{% endif %}
`;

  fs.writeFileSync(outPath, workflow, 'utf-8');

  console.log(chalk.green(`\n  Created ${outPath}\n`));
  console.log(chalk.dim('  Review and customize the file, then run:\n'));
  console.log(`    ${chalk.bold('cacophony start')}\n`);
}

// --- Start ---

async function cmdStart(args: string[]): Promise<void> {
  const workflowPath = resolveWorkflowPath(args);
  const portStr = getFlag(args, '--port');

  const logger = new Logger();

  logger.info(`Loading workflow from ${workflowPath}`);

  const configManager = new ConfigManager(workflowPath, logger);
  const wf = configManager.load();
  const config = wf.config;

  const dbPath = resolveDbPath(config.workspace.projectRoot);
  const store = new StateStore(dbPath);

  logger.info(`Database at ${dbPath}`);

  const orchestrator = new Orchestrator(configManager, store, logger);

  // Graceful shutdown
  const shutdown = async () => {
    await orchestrator.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // HTTP dashboard — defaults to 8080 unless --no-server is passed
  if (!args.includes('--no-server')) {
    const port = portStr ? parseInt(portStr, 10) : (config.server?.port ?? 8080);
    startHttpServer(orchestrator, configManager, port, logger);
  }

  await orchestrator.start();

  // Keep process alive
  setInterval(() => {
    // Check for stop sentinel files
    const sentinelDir = path.join(path.resolve(config.workspace.projectRoot), '.cacophony');
    try {
      const files = fs.readdirSync(sentinelDir);
      for (const f of files) {
        if (f.startsWith('stop-')) {
          const identifier = f.replace('stop-', '');
          if (orchestrator.cancelIssue(identifier)) {
            logger.info(`Canceled ${identifier} via sentinel file`);
          }
          fs.unlinkSync(path.join(sentinelDir, f));
        }
      }
    } catch {
      // ignore
    }
  }, 5_000);
}

async function cmdStatus(args: string[]): Promise<void> {
  const workflowPath = resolveWorkflowPath(args);
  const logger = new Logger();

  try {
    const configManager = new ConfigManager(workflowPath, logger);
    const wf = configManager.load();
    const dbPath = resolveDbPath(wf.config.workspace.projectRoot);

    if (!fs.existsSync(dbPath)) {
      console.log(chalk.yellow('No database found. Is cacophony running?'));
      return;
    }

    const store = new StateStore(dbPath);

    const activeRuns = store.getActiveRuns();
    const retries = store.getAllRetries();

    console.log(chalk.bold('\n  Cacophony Status\n'));

    if (activeRuns.length === 0 && retries.length === 0) {
      console.log(chalk.dim('  No active runs or retries.\n'));
    }

    if (activeRuns.length > 0) {
      console.log(chalk.bold('  Active Runs:'));
      for (const run of activeRuns) {
        console.log(
          `    ${chalk.green('●')} ${chalk.bold(run.issueIdentifier)} — ${run.status} (attempt ${run.attempt}, started ${run.startedAt})`,
        );
      }
      console.log();
    }

    if (retries.length > 0) {
      console.log(chalk.bold('  Pending Retries:'));
      for (const r of retries) {
        const dueIn = Math.max(0, r.dueAtMs - Date.now());
        console.log(
          `    ${chalk.yellow('◌')} ${chalk.bold(r.identifier)} — retry #${r.attempt} (due in ${Math.round(dueIn / 1000)}s)`,
        );
      }
      console.log();
    }

    // Recent completed runs
    const metrics = store.getMetric<{ totalRuns: number; totalSucceeded: number }>('totals');
    if (metrics) {
      console.log(chalk.bold('  Totals:'));
      console.log(`    Runs: ${metrics.totalRuns}  Succeeded: ${metrics.totalSucceeded}`);
      console.log();
    }

    store.close();
  } catch (e) {
    console.error(chalk.red(`Error: ${e}`));
    process.exit(1);
  }
}

async function cmdStop(args: string[]): Promise<void> {
  const identifier = args[0];
  if (!identifier || identifier.startsWith('--')) {
    console.error(chalk.red('Usage: cacophony stop <identifier> [workflow.md]'));
    process.exit(1);
  }

  const workflowPath = resolveWorkflowPath(args.slice(1));
  const logger = new Logger();

  try {
    const configManager = new ConfigManager(workflowPath, logger);
    const wf = configManager.load();
    const projectRoot = path.resolve(wf.config.workspace.projectRoot);
    const sentinelDir = path.join(projectRoot, '.cacophony');
    const sentinelPath = path.join(sentinelDir, `stop-${identifier}`);
    fs.mkdirSync(sentinelDir, { recursive: true });
    fs.writeFileSync(sentinelPath, '', 'utf-8');

    console.log(chalk.green(`Stop signal sent for ${identifier}`));
    console.log(chalk.dim(`  Sentinel written to ${sentinelPath}`));
    console.log(chalk.dim(`  The daemon will pick this up within 5 seconds.`));
  } catch (e) {
    console.error(chalk.red(`Error: ${e}`));
    process.exit(1);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}

function getFilesTracker(orchestrator: Orchestrator): FilesTracker | null {
  const tracker = orchestrator.getTracker();
  if (tracker?.kind === 'files') {
    return tracker as FilesTracker;
  }
  return null;
}

function startHttpServer(
  orchestrator: Orchestrator,
  configManager: ConfigManager,
  port: number,
  logger: Logger,
): void {
  // Lazy import dashboard
  let dashboardHtmlFn: (() => string) | null = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    const json = (status: number, data: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(status);
      res.end(JSON.stringify(data, null, 2));
    };

    try {
      // --- Dashboard ---
      if (req.method === 'GET' && url.pathname === '/') {
        if (!dashboardHtmlFn) {
          const mod = await import('./dashboard.js');
          dashboardHtmlFn = mod.dashboardHtml;
        }
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(dashboardHtmlFn());
        return;
      }

      // --- Status API ---
      if (req.method === 'GET' && url.pathname === '/api/v1/status') {
        json(200, orchestrator.getStatus());
        return;
      }

      // --- Runs API ---
      if (req.method === 'GET' && url.pathname === '/api/v1/runs') {
        const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
        json(200, orchestrator.getRecentRuns(Math.min(limit, 100)));
        return;
      }

      // --- Stop API ---
      if (req.method === 'POST' && url.pathname.startsWith('/api/v1/stop/')) {
        const identifier = decodeURIComponent(url.pathname.split('/').pop()!);
        const canceled = orchestrator.cancelIssue(identifier);
        json(canceled ? 200 : 404, { canceled, identifier });
        return;
      }

      // --- Brief API (intake interview) ---
      if (req.method === 'POST' && url.pathname === '/api/v1/brief') {
        const body = JSON.parse(await readBody(req));
        const transcript = Array.isArray(body.transcript) ? body.transcript : [];
        if (transcript.length === 0) {
          json(400, { error: 'transcript is required and must be non-empty' });
          return;
        }
        // Validate transcript shape
        for (const m of transcript) {
          if (
            !m ||
            typeof m !== 'object' ||
            (m.role !== 'user' && m.role !== 'assistant') ||
            typeof m.content !== 'string'
          ) {
            json(400, {
              error: 'each transcript message must be { role: user|assistant, content: string }',
            });
            return;
          }
        }
        const wf = configManager.getCurrent();
        if (!wf.config.brief.enabled) {
          json(400, { error: 'brief is disabled in config' });
          return;
        }
        // Round = number of prior assistant turns + 1
        const round = transcript.filter((m: { role: string }) => m.role === 'assistant').length + 1;
        const maxRounds = wf.config.brief.maxRounds;
        const result = await runBrief({
          transcript,
          round,
          maxRounds,
          agent: wf.config.agent,
          projectRoot: path.resolve(wf.config.workspace.projectRoot),
          timeoutMs: wf.config.brief.timeoutMs,
          logger,
        });
        json(200, { ...result, round, maxRounds });
        return;
      }

      // --- Tasks API (files tracker only) ---
      const filesTracker = getFilesTracker(orchestrator);

      if (req.method === 'GET' && url.pathname === '/api/v1/tasks') {
        if (!filesTracker) {
          json(200, []); // Non-files trackers: no local task management
          return;
        }
        const tasks = filesTracker.getAllTasks();
        json(200, tasks);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/tasks') {
        if (!filesTracker) {
          json(400, { error: 'Task creation only supported with files tracker' });
          return;
        }
        const body = JSON.parse(await readBody(req));
        const { prompt, priority } = body;
        if (typeof prompt !== 'string' || prompt.trim() === '') {
          json(400, { error: 'prompt is required' });
          return;
        }
        const identifier = uniqueIdentifier(filesTracker, slugifyPrompt(prompt));
        filesTracker.createTask(identifier, 'todo', priority ?? null, prompt.trim());
        logger.info(`Task created via API: ${identifier}`);
        // Nudge the orchestrator to dispatch immediately rather than waiting
        // for the next poll cycle.
        orchestrator.pollNow();
        json(201, { created: true, identifier });
        return;
      }

      if (req.method === 'PUT' && url.pathname.match(/^\/api\/v1\/tasks\/[^/]+\/state$/)) {
        if (!filesTracker) {
          json(400, { error: 'State update only supported with files tracker' });
          return;
        }
        const parts = url.pathname.split('/');
        const identifier = decodeURIComponent(parts[parts.length - 2]);
        const body = JSON.parse(await readBody(req));
        const updated = filesTracker.updateTaskState(identifier, body.state);
        json(updated ? 200 : 404, { updated, identifier });
        return;
      }

      if (req.method === 'DELETE' && url.pathname.match(/^\/api\/v1\/tasks\/[^/]+$/)) {
        const identifier = decodeURIComponent(url.pathname.split('/').pop()!);
        // Best-effort "remove all trace of this task": the .md file, all run
        // history, the issues cache row, any pending retry, and the in-memory
        // retry timer.
        const fileDeleted = filesTracker ? filesTracker.deleteTask(identifier) : false;
        const purged = orchestrator.purgeByIdentifier(identifier);
        const anything = fileDeleted || purged.runs > 0 || purged.issues > 0 || purged.retries > 0;
        json(anything ? 200 : 404, { fileDeleted, ...purged, identifier });
        return;
      }

      json(404, { error: 'not found' });
    } catch (e) {
      logger.error('HTTP handler error', { error: String(e) });
      json(500, { error: 'internal error' });
    }
  });

  const MAX_PORT_ATTEMPTS = 20;
  let attempt = 0;
  let currentPort = port;

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      attempt++;
      const nextPort = currentPort + 1;
      logger.warn(`Port ${currentPort} in use, trying ${nextPort}`);
      currentPort = nextPort;
      server.listen(currentPort, '127.0.0.1');
    } else {
      logger.error(`HTTP server failed to bind`, { error: String(err) });
    }
  });

  server.listen(currentPort, '127.0.0.1', () => {
    logger.info(`HTTP server listening on http://127.0.0.1:${currentPort}`);
  });
}

main().catch((e) => {
  console.error(chalk.red(`Fatal: ${e}`));
  process.exit(1);
});
