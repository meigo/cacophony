#!/usr/bin/env node

import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import chalk from 'chalk';
import { ConfigManager, updateConfigHooks, updateConfigFields } from './config.js';
import { StateStore } from './state.js';
import { Orchestrator } from './orchestrator.js';
import { Logger } from './logger.js';
import type { FilesTracker } from './trackers/files.js';
import { slugifyPrompt, uniqueIdentifier } from './slug.js';
import { runBrief } from './brief.js';
import { lookupSkillPack, installSkillPack, isSkillInstalled } from './skills.js';

const USAGE = `
${chalk.bold('cacophony')} — Autonomous multi-agent coding on autopilot

${chalk.bold('Usage:')}
  cacophony start [--port N|--no-server]   Start the daemon (dashboard on :8080 by default)
  cacophony status                         Show current state
  cacophony stop <identifier>              Cancel a running issue
  cacophony help                           Show this help

${chalk.bold('Examples:')}
  cacophony start
  cacophony start --port 9000
  cacophony start --no-server
  cacophony stop fix-login
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
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

/**
 * Try to reverse-match a command string to a known preset + model.
 * Returns { name: 'Custom', model: '' } if no preset matches.
 */
function detectPreset(command: string): { name: string; model: string } {
  for (const [name, preset] of Object.entries(AGENT_PRESETS)) {
    if (name === 'Custom') continue;
    // Try each model (including no model)
    const candidates = [...(preset.models ?? []), ''];
    for (const model of candidates) {
      if (preset.command(model || undefined) === command) {
        return { name, model };
      }
    }
  }
  return { name: 'Custom', model: '' };
}

// --- Default prompt template (used when generating config from dashboard setup) ---

const DEFAULT_PROMPT_TEMPLATE = `You are an autonomous coding agent working on task **{{issue.identifier}}**.

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

1. **Implement** the required changes in this worktree.
2. **Build / type-check** the project (e.g. \\\`npm run build\\\`, \\\`cargo build\\\`, \\\`go build ./...\\\`). Runtime-only errors like missing imports, post-install hooks, and wiring mistakes only show up here — don't stop at \\\`tsc --noEmit\\\`. If there's no build step, briefly start the app or run a smoke script to catch init-time errors.
3. **Write tests for any new behavior you introduced.** Not just "make existing tests still pass" — add new tests that exercise the lines you just wrote, including at least one realistic edge case (empty input, missing field, boundary value, or an unexpected state). If the project already has a test framework (vitest, jest, pytest, go test, cargo test, etc.), use it. If there are no tests yet and the feature is non-trivial, introduce a minimal test file for the module you touched rather than leaving it uncovered. A test that only asserts \\\`return 42\\\` because you wrote \\\`return 42\\\` is worth nothing — write tests that would fail if the implementation were wrong, not ones that just echo it back.
4. **Run the full test suite** and make sure it passes. Fix any failures, whether in your new tests or pre-existing ones you may have regressed. Do not move on until everything passes.
5. **Commit** your work on this branch. Cacophony will auto-commit anything you forget, but explicit commits give cleaner history.
6. **Exit cleanly** when done. Cacophony will mark the task complete, run its verification hook, and clean up the worktree.

**Defensive coding:** never assume external data (APIs, user input, database results, file contents) has all fields present and non-null. Use nullish coalescing (\\\`??\\\`), optional chaining (\\\`?.\\\`), or explicit guards before accessing properties. If a type says \\\`number\\\` but the data comes from a JSON API, treat it as \\\`number | null\\\` in practice. One missing null check is worse than ten redundant ones.

A task is not done when the code compiles. A task is done when the code compiles, runs with real data without crashing, is covered by tests that actually exercise it, and the full suite is green.

{% if attempt %}
## Retry attempt #{{attempt}}

The previous attempt failed. The worktree contains your previous work — do NOT start from scratch. Read the error below, identify the specific root cause, and make the minimum targeted fix.

{% if last_error %}
**Previous error:**
{{ last_error }}
{% endif %}

{% if last_hook_output %}
**Full build/test output from previous run:**
{{ last_hook_output }}
{% endif %}

Do NOT rewrite files that are already correct. Focus only on the files and lines mentioned in the error. If the error is a type mismatch, fix the type. If it is a missing import, add the import. If it is a wrong API usage, check the docs. Make the smallest change that fixes the specific error.
{% endif %}
`;

function generateConfigFile(agentCommand: string, delivery: string, maxConcurrent: number): string {
  return `---
agent:
  command: "${agentCommand}"
  prompt_delivery: ${delivery}
  timeout_ms: 3600000
  max_concurrent: ${maxConcurrent}
  max_turns: 50

polling:
  interval_ms: 30000
---

${DEFAULT_PROMPT_TEMPLATE}`;
}

// --- Start ---

/**
 * Mutable server state. The HTTP server starts immediately; if no config
 * exists yet the orchestrator/configManager are null and the dashboard
 * shows the setup screen. After the user completes setup via the dashboard,
 * `bootOrchestrator` fills these in and starts the poll loop.
 */
interface ServerState {
  orchestrator: Orchestrator | null;
  configManager: ConfigManager | null;
  logger: Logger;
  configPath: string;
}

async function bootOrchestrator(state: ServerState): Promise<void> {
  const { configPath, logger } = state;
  logger.info(`Loading workflow from ${configPath}`);

  const configManager = new ConfigManager(configPath, logger);
  const wf = configManager.load();
  const config = wf.config;

  const dbPath = resolveDbPath(config.workspace.projectRoot);
  const store = new StateStore(dbPath);
  logger.info(`Database at ${dbPath}`);

  const orchestrator = new Orchestrator(configManager, store, logger);
  state.orchestrator = orchestrator;
  state.configManager = configManager;

  await orchestrator.start();

  // Sentinel file watcher for CLI-based stop
  setInterval(() => {
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

async function cmdStart(args: string[]): Promise<void> {
  const configPath = resolveWorkflowPath(args);
  const portStr = getFlag(args, '--port');
  const logger = new Logger();

  const state: ServerState = {
    orchestrator: null,
    configManager: null,
    logger,
    configPath,
  };

  // If config already exists, boot the orchestrator immediately.
  if (fs.existsSync(configPath)) {
    await bootOrchestrator(state);
  } else {
    logger.info('No config found — starting in setup mode. Open the dashboard to configure.');
  }

  // Graceful shutdown
  const shutdown = async () => {
    if (state.orchestrator) await state.orchestrator.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // HTTP dashboard — defaults to 8080 unless --no-server is passed
  if (!args.includes('--no-server')) {
    const port = portStr
      ? parseInt(portStr, 10)
      : (state.configManager?.getCurrent().config.server?.port ?? 8080);
    startHttpServer(state, port);
  }
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

function startHttpServer(state: ServerState, port: number): void {
  const { logger } = state;
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

      // --- Setup API (available before config exists) ---
      if (req.method === 'GET' && url.pathname === '/api/v1/setup/presets') {
        const presets = Object.entries(AGENT_PRESETS)
          .filter(([name]) => name !== 'Custom')
          .map(([name, p]) => ({
            name,
            models: p.models ?? [],
            delivery: p.delivery,
          }));
        json(200, { presets, needsSetup: !state.orchestrator });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/setup') {
        if (state.orchestrator) {
          json(400, { error: 'Already configured' });
          return;
        }
        const body = JSON.parse(await readBody(req));
        const agentName = typeof body.agent === 'string' ? body.agent : '';
        const model = typeof body.model === 'string' ? body.model : '';
        const maxConcurrent = Math.max(1, Math.min(10, parseInt(body.maxConcurrent, 10) || 3));
        const customCommand = typeof body.customCommand === 'string' ? body.customCommand : '';
        const customDelivery = typeof body.customDelivery === 'string' ? body.customDelivery : 'file';

        let agentCommand: string;
        let delivery: string;

        if (agentName === 'Custom') {
          if (!customCommand.trim()) {
            json(400, { error: 'Custom agent requires a command' });
            return;
          }
          agentCommand = customCommand.trim();
          delivery = customDelivery;
        } else {
          const preset = AGENT_PRESETS[agentName];
          if (!preset) {
            json(400, { error: `Unknown agent: ${agentName}` });
            return;
          }
          agentCommand = preset.command(model || undefined);
          delivery = preset.delivery;
        }

        // Write the config file
        const outPath = path.resolve(state.configPath);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, generateConfigFile(agentCommand, delivery, maxConcurrent), 'utf-8');
        logger.info(`Config created via dashboard setup: ${outPath}`);

        // Boot the orchestrator now that we have a config
        try {
          await bootOrchestrator(state);
          json(201, { created: true });
        } catch (e) {
          // Config was written but orchestrator failed to start — remove
          // the broken config so the user can try again.
          try { fs.unlinkSync(outPath); } catch { /* ignore */ }
          json(500, { error: `Failed to start: ${e}` });
        }
        return;
      }

      // --- Status API ---
      if (req.method === 'GET' && url.pathname === '/api/v1/status') {
        if (!state.orchestrator) {
          json(200, {
            needsSetup: true,
            running: [],
            retrying: [],
            claimed: [],
            trackerKind: '',
            activeStates: [],
            terminalStates: [],
            briefEnabled: false,
            briefMaxRounds: 2,
          });
          return;
        }
        json(200, state.orchestrator.getStatus());
        return;
      }

      // --- All remaining endpoints require an active orchestrator ---
      if (!state.orchestrator || !state.configManager) {
        json(503, { error: 'Not configured yet — complete setup first' });
        return;
      }

      const orchestrator = state.orchestrator;
      const configManager = state.configManager;

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

      // --- Skills API ---
      if (req.method === 'POST' && url.pathname === '/api/v1/skills/install') {
        const body = JSON.parse(await readBody(req));
        const framework = typeof body.framework === 'string' ? body.framework.trim() : '';
        if (!framework) {
          json(400, { error: 'framework is required' });
          return;
        }
        const pack = lookupSkillPack(framework);
        if (!pack) {
          json(404, { error: `no skill pack known for framework "${framework}"` });
          return;
        }
        const projectRoot = path.resolve(configManager.getCurrent().config.workspace.projectRoot);
        const result = installSkillPack(pack, projectRoot, logger);
        json(result.installed ? 201 : 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/config/hooks') {
        const body = JSON.parse(await readBody(req));
        const afterRun = typeof body.after_run === 'string' ? body.after_run.trim() : undefined;
        if (!afterRun) {
          json(400, { error: 'after_run is required' });
          return;
        }
        try {
          const hooks: { after_run: string; after_create?: string } = { after_run: afterRun };
          // Auto-set after_create to bootstrap node_modules if the after_run
          // uses npm/npx tools and no after_create hook is configured yet.
          const currentConfig = configManager.getCurrent().config;
          if (!currentConfig.hooks.afterCreate && /\bnpx?\b/.test(afterRun)) {
            hooks.after_create =
              'if [ -d ../../../node_modules ]; then\n' +
              '  cp -Rc ../../../node_modules . 2>/dev/null || cp -r ../../../node_modules .\n' +
              'else\n' +
              '  npm install --prefer-offline\n' +
              'fi';
          }
          updateConfigHooks(configManager.getFilePath(), hooks);
          configManager.reload();
          json(200, { updated: true, after_run: afterRun, after_create: hooks.after_create });
        } catch (e) {
          json(500, { error: `Failed to update hooks: ${e}` });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/config') {
        const config = configManager.getCurrent().config;
        // Reverse-match the current command to a known preset + model.
        const detected = detectPreset(config.agent.command);
        json(200, {
          agent: {
            command: config.agent.command,
            max_concurrent: config.agent.maxConcurrent,
            // Detected preset info so the UI can pre-select the right card
            preset: detected.name,
            model: detected.model,
          },
          hooks: {
            after_create: config.hooks.afterCreate ?? '',
            before_run: config.hooks.beforeRun ?? '',
            after_run: config.hooks.afterRun ?? '',
            before_remove: config.hooks.beforeRemove ?? '',
          },
          brief: {
            enabled: config.brief.enabled,
            max_rounds: config.brief.maxRounds,
          },
        });
        return;
      }

      if (req.method === 'PUT' && url.pathname === '/api/v1/config') {
        const body = JSON.parse(await readBody(req));
        // If the client sent agent.preset + agent.model, resolve to command string.
        if (body.agent?.preset) {
          const presetName = body.agent.preset;
          const model = body.agent.model || '';
          if (presetName === 'Custom') {
            body.agent.command = body.agent.command || '';
          } else {
            const preset = AGENT_PRESETS[presetName];
            if (preset) {
              body.agent.command = preset.command(model || undefined);
              body.agent.prompt_delivery = preset.delivery;
            }
          }
          delete body.agent.preset;
          delete body.agent.model;
        }
        try {
          updateConfigFields(configManager.getFilePath(), body);
          configManager.reload();
          json(200, { updated: true });
        } catch (e) {
          json(500, { error: `Failed to update config: ${e}` });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/skills/status') {
        const projectRoot = path.resolve(configManager.getCurrent().config.workspace.projectRoot);
        json(200, { installed: isSkillInstalled(projectRoot) });
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

      // --- Preview: serve static files from a worktree's build output ---
      const previewMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
      if (req.method === 'GET' && previewMatch) {
        const identifier = decodeURIComponent(previewMatch[1]);
        const filePath = previewMatch[2] || '/index.html';
        const projectRoot = path.resolve(configManager.getCurrent().config.workspace.projectRoot);
        const worktreeBase = path.join(projectRoot, '.cacophony', 'worktrees');

        // Sanitize the identifier the same way workspace.ts does
        const sanitized = identifier
          .replace(/[^A-Za-z0-9._-]/g, '_')
          .replace(/\.{2,}/g, '_')
          .replace(/^\.+/, '_')
          .replace(/\.+$/, '_');
        const wsPath = path.join(worktreeBase, sanitized);

        // Look for the file in common build output dirs, then worktree root
        const candidates = [
          path.join(wsPath, 'dist', filePath),
          path.join(wsPath, 'build', filePath),
          path.join(wsPath, 'out', filePath),
          path.join(wsPath, filePath),
        ];

        let found: string | null = null;
        for (const c of candidates) {
          const resolved = path.resolve(c);
          // Safety: must be under the worktree
          if (!resolved.startsWith(path.resolve(wsPath))) continue;
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            found = resolved;
            break;
          }
          // Try index.html in directories
          if (filePath.endsWith('/') || !path.extname(filePath)) {
            const idx = path.join(resolved, 'index.html');
            if (fs.existsSync(idx) && fs.statSync(idx).isFile()) {
              found = idx;
              break;
            }
          }
        }

        if (!found) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const ext = path.extname(found).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.mjs': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
          '.webp': 'image/webp',
        };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.writeHead(200);
        res.end(fs.readFileSync(found));
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
