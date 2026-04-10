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

const USAGE = `
${chalk.bold('cacophony')} — Provider-agnostic agent orchestrator

${chalk.bold('Usage:')}
  cacophony init                             Generate a WORKFLOW.md interactively
  cacophony start [workflow.md] [--port N]   Start the daemon
  cacophony status [workflow.md]             Show current state
  cacophony stop <identifier> [workflow.md]  Cancel a running issue
  cacophony help                             Show this help

${chalk.bold('Examples:')}
  cacophony init
  cacophony start WORKFLOW.md
  cacophony start WORKFLOW.md --port 8080
  cacophony status WORKFLOW.md
  cacophony stop GH-42 WORKFLOW.md
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

function resolveWorkflowPath(args: string[]): string {
  // Find first arg that's not a flag
  const wfArg = args.find((a) => !a.startsWith('--'));
  return path.resolve(wfArg ?? 'WORKFLOW.md');
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

const AGENT_PRESETS: Record<string, { command: string; delivery: string }> = {
  'Claude Code': {
    command: 'claude -p {{prompt_file}} --output-format stream-json',
    delivery: 'file',
  },
  Codex: {
    command: 'codex --prompt {{prompt_file}}',
    delivery: 'file',
  },
  Aider: {
    command: 'aider --message-file {{prompt_file}} --yes',
    delivery: 'file',
  },
  'Gemini CLI': {
    command: 'gemini < {{prompt_file}}',
    delivery: 'file',
  },
  Custom: {
    command: '',
    delivery: 'file',
  },
};

async function cmdInit(): Promise<void> {
  const outPath = path.resolve('WORKFLOW.md');

  if (fs.existsSync(outPath)) {
    console.log(chalk.yellow(`\n  WORKFLOW.md already exists at ${outPath}`));
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
  console.log(chalk.dim('  Generate a WORKFLOW.md for your project.\n'));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // --- Tracker ---
  const trackerChoice = await choose(
    rl,
    'Issue tracker:',
    ['Local files (simplest)', 'GitHub Issues', 'Linear'],
    0,
  );

  let trackerBlock: string;

  if (trackerChoice === 'Local files (simplest)') {
    const tasksDir = await ask(rl, 'Tasks directory', './tasks');
    const activeStates = await ask(rl, 'Active states (comma-separated)', 'todo, in-progress');
    const terminalStates = await ask(rl, 'Terminal states (comma-separated)', 'done, cancelled');

    const fmtStates = (s: string) =>
      s
        .split(',')
        .map((l) => `"${l.trim()}"`)
        .join(', ');

    trackerBlock = `tracker:
  kind: files
  dir: "${tasksDir}"
  active_states: [${fmtStates(activeStates)}]
  terminal_states: [${fmtStates(terminalStates)}]`;
  } else if (trackerChoice === 'GitHub Issues') {
    // Try to detect repo from git remote
    let detectedRepo = '';
    try {
      const { execFileSync } = await import('node:child_process');
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (match) detectedRepo = match[1];
    } catch {
      // not a git repo or no remote
    }

    const repo = await ask(rl, 'GitHub repo (owner/repo)', detectedRepo || undefined);
    const activeLabels = await ask(rl, 'Active labels (comma-separated)', 'todo, in-progress');
    const terminalLabels = await ask(rl, 'Terminal labels (comma-separated)', 'done, wontfix');

    const fmtLabels = (s: string) =>
      s
        .split(',')
        .map((l) => `"${l.trim()}"`)
        .join(', ');

    trackerBlock = `tracker:
  kind: github
  repo: "${repo}"
  active_labels: [${fmtLabels(activeLabels)}]
  terminal_labels: [${fmtLabels(terminalLabels)}]`;
  } else {
    const projectSlug = await ask(rl, 'Linear project slug');
    const apiKeyVar = await ask(rl, 'API key env var name', 'LINEAR_API_KEY');

    trackerBlock = `tracker:
  kind: linear
  api_key: "$${apiKeyVar}"
  project_slug: "${projectSlug}"
  active_states: ["Todo", "In Progress"]
  terminal_states: ["Done", "Cancelled", "Closed"]`;
  }

  // --- Agent ---
  const agentNames = Object.keys(AGENT_PRESETS);
  const agentChoice = await choose(rl, 'Coding agent:', agentNames, 0);
  const preset = AGENT_PRESETS[agentChoice];

  let agentCommand = preset.command;
  let agentDelivery = preset.delivery;

  if (agentChoice === 'Custom') {
    agentCommand = await ask(
      rl,
      'Agent command (use {{prompt_file}}, {{workspace}}, {{identifier}})',
    );
    const deliveryChoice = await choose(rl, 'How to pass the prompt:', ['file', 'stdin', 'arg'], 0);
    agentDelivery = deliveryChoice;
  }

  const maxConcurrent = await ask(rl, 'Max concurrent agents', '3');

  rl.close();

  // --- Generate ---
  const workflow = `---
${trackerBlock}

agent:
  command: "${agentCommand}"
  prompt_delivery: ${agentDelivery}
  timeout_ms: 3600000
  max_concurrent: ${maxConcurrent}
  max_turns: 50

polling:
  interval_ms: 30000
---

You are an autonomous coding agent working on issue **{{issue.identifier}}**.

You are running inside a git worktree at the project root. A new branch has already been created for you.

## Task

**{{issue.title}}**

{{issue.description}}

## Instructions

1. Implement the required changes in this worktree
2. Inspect the project stack and run appropriate tests (unit, lint, type check)
3. Fix any failures — do not move on until everything passes
4. Commit and push your branch
5. Open a pull request and merge it: \`gh pr merge --squash --delete-branch\`
6. Close this issue when done

{% if attempt %}
This is retry attempt #{{attempt}}. The worktree may contain previous work — continue from where it left off.
{% endif %}
`;

  fs.writeFileSync(outPath, workflow, 'utf-8');

  console.log(chalk.green(`\n  Created ${outPath}\n`));
  console.log(chalk.dim('  Review and customize the file, then run:\n'));
  console.log(`    ${chalk.bold('cacophony start WORKFLOW.md')}\n`);
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

  // Optional HTTP server
  const port = portStr ? parseInt(portStr, 10) : config.server?.port;
  if (port !== undefined) {
    startHttpServer(orchestrator, port, logger);
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

function startHttpServer(orchestrator: Orchestrator, port: number, logger: Logger): void {
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
        const { identifier, priority, content } = body;
        if (!identifier || !content) {
          json(400, { error: 'identifier and content are required' });
          return;
        }
        filesTracker.createTask(identifier, 'todo', priority ?? null, content);
        logger.info(`Task created via API: ${identifier}`);
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
        if (!filesTracker) {
          json(400, { error: 'Task deletion only supported with files tracker' });
          return;
        }
        const identifier = decodeURIComponent(url.pathname.split('/').pop()!);
        const deleted = filesTracker.deleteTask(identifier);
        json(deleted ? 200 : 404, { deleted, identifier });
        return;
      }

      json(404, { error: 'not found' });
    } catch (e) {
      logger.error('HTTP handler error', { error: String(e) });
      json(500, { error: 'internal error' });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`HTTP server listening on http://127.0.0.1:${port}`);
  });
}

main().catch((e) => {
  console.error(chalk.red(`Fatal: ${e}`));
  process.exit(1);
});
