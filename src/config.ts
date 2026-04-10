import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  WorkflowDefinition,
  WorkflowConfig,
  TrackerConfig,
  AgentConfig,
  WorkspaceConfig,
  HooksConfig,
  PollingConfig,
} from './types.js';
import type { Logger } from './logger.js';

const DEFAULTS = {
  polling: { intervalMs: 30_000 },
  agent: {
    command: '',
    promptDelivery: 'file' as const,
    timeoutMs: 3_600_000,
    maxConcurrent: 5,
    maxTurns: 20,
    maxRetryBackoffMs: 300_000,
  },
  workspace: { projectRoot: '.' },
  hooks: { timeoutMs: 60_000 },
  tracker: {
    activeStates: ['todo', 'in-progress'],
    terminalStates: ['done', 'cancelled', 'wontfix'],
  },
};

function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function lowercase(arr: string[] | undefined): string[] | undefined {
  return arr?.map((s) => s.toLowerCase());
}

export function loadWorkflow(filePath: string): WorkflowDefinition {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let frontMatter: Record<string, unknown> = {};
  let promptTemplate: string;

  if (raw.startsWith('---')) {
    const endIdx = raw.indexOf('---', 3);
    if (endIdx === -1) {
      throw new Error('config file: unclosed YAML front matter');
    }
    const yamlStr = raw.slice(3, endIdx);
    promptTemplate = raw.slice(endIdx + 3).trim();
    const parsed = parseYaml(yamlStr);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('config file: front matter must be a YAML map');
    }
    frontMatter = parsed as Record<string, unknown>;
  } else {
    promptTemplate = raw.trim();
  }

  const config = buildConfig(frontMatter);
  return { config, promptTemplate };
}

function buildConfig(fm: Record<string, unknown>): WorkflowConfig {
  const t = (fm.tracker ?? {}) as Record<string, unknown>;
  const a = (fm.agent ?? {}) as Record<string, unknown>;
  const w = (fm.workspace ?? {}) as Record<string, unknown>;
  const h = (fm.hooks ?? {}) as Record<string, unknown>;
  const p = (fm.polling ?? {}) as Record<string, unknown>;
  const s = (fm.server ?? undefined) as { port?: number } | undefined;

  const tracker: TrackerConfig = {
    kind: String(t.kind ?? 'files'),
    dir: t.dir != null ? expandPath(String(t.dir)) : undefined,
    activeStates:
      lowercase(t.active_states as string[] | undefined) ?? DEFAULTS.tracker.activeStates,
    terminalStates:
      lowercase(t.terminal_states as string[] | undefined) ?? DEFAULTS.tracker.terminalStates,
  };

  const agent: AgentConfig = {
    command: String(a.command ?? DEFAULTS.agent.command),
    promptDelivery:
      (a.prompt_delivery as AgentConfig['promptDelivery']) ?? DEFAULTS.agent.promptDelivery,
    timeoutMs: Number(a.timeout_ms ?? DEFAULTS.agent.timeoutMs),
    maxConcurrent: Number(a.max_concurrent ?? DEFAULTS.agent.maxConcurrent),
    maxTurns: Number(a.max_turns ?? DEFAULTS.agent.maxTurns),
    maxRetryBackoffMs: Number(a.max_retry_backoff_ms ?? DEFAULTS.agent.maxRetryBackoffMs),
    maxConcurrentByState: a.max_concurrent_by_state as Record<string, number> | undefined,
    env: a.env as Record<string, string> | undefined,
  };

  const workspace: WorkspaceConfig = {
    projectRoot: expandPath(String(w.project_root ?? DEFAULTS.workspace.projectRoot)),
    baseBranch: w.base_branch != null ? String(w.base_branch) : undefined,
  };

  const hooks: HooksConfig = {
    afterCreate: h.after_create != null ? String(h.after_create) : undefined,
    beforeRun: h.before_run != null ? String(h.before_run) : undefined,
    afterRun: h.after_run != null ? String(h.after_run) : undefined,
    beforeRemove: h.before_remove != null ? String(h.before_remove) : undefined,
    timeoutMs: Number(h.timeout_ms ?? DEFAULTS.hooks.timeoutMs),
  };

  const polling: PollingConfig = {
    intervalMs: Number(p.interval_ms ?? DEFAULTS.polling.intervalMs),
  };

  return { tracker, agent, workspace, hooks, polling, server: s };
}

export function validateConfig(config: WorkflowConfig): string[] {
  const errors: string[] = [];

  if (!config.agent.command) {
    errors.push('agent.command is required');
  }

  if (config.agent.maxConcurrent < 1) {
    errors.push('agent.max_concurrent must be >= 1');
  }

  if (config.agent.timeoutMs < 1000) {
    errors.push('agent.timeout_ms must be >= 1000');
  }

  return errors;
}

export class ConfigManager {
  private current: WorkflowDefinition | null = null;
  private filePath: string;
  private watcher: FSWatcher | null = null;
  private listeners: Set<(wf: WorkflowDefinition) => void> = new Set();
  private logger: Logger;

  constructor(filePath: string, logger: Logger) {
    this.filePath = path.resolve(filePath);
    this.logger = logger;
  }

  load(): WorkflowDefinition {
    const wf = loadWorkflow(this.filePath);
    const errors = validateConfig(wf.config);
    if (errors.length > 0) {
      throw new Error(`Invalid workflow config:\n  ${errors.join('\n  ')}`);
    }
    this.current = wf;
    return wf;
  }

  getCurrent(): WorkflowDefinition {
    if (!this.current) throw new Error('Config not loaded. Call load() first.');
    return this.current;
  }

  onChange(cb: (wf: WorkflowDefinition) => void): void {
    this.listeners.add(cb);
  }

  startWatching(): void {
    this.watcher = chokidar.watch(this.filePath, { persistent: false });
    this.watcher.on('change', () => {
      this.logger.info('Config changed, reloading...');
      this.reload();
    });
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  reload(): boolean {
    try {
      const wf = loadWorkflow(this.filePath);
      const errors = validateConfig(wf.config);
      if (errors.length > 0) {
        this.logger.error('Invalid config after reload, keeping previous', { errors });
        return false;
      }

      // Only notify if config actually changed
      const oldJson = JSON.stringify(this.current?.config);
      const newJson = JSON.stringify(wf.config);
      if (oldJson === newJson) return true;

      this.current = wf;
      for (const cb of this.listeners) {
        try {
          cb(wf);
        } catch (e) {
          this.logger.error('Config change listener error', { error: String(e) });
        }
      }
      this.logger.info('Config reloaded successfully');
      return true;
    } catch (e) {
      this.logger.error('Failed to reload config, keeping previous', { error: String(e) });
      return false;
    }
  }
}
