import { Liquid } from 'liquidjs';
import type {
  Issue,
  RunEntry,
  RetryEntry,
  WorkflowConfig,
  TrackerAdapter,
  RunRecord,
} from './types.js';
import type { ConfigManager } from './config.js';
import type { StateStore } from './state.js';
import { WorkspaceManager } from './workspace.js';
import { AgentRunner } from './runner.js';
import { RetryEngine } from './retry.js';
import { createTracker } from './trackers/interface.js';
import type { Logger } from './logger.js';

const liquid = new Liquid({ strictVariables: false, strictFilters: true });

export class Orchestrator {
  private configManager: ConfigManager;
  private store: StateStore;
  private tracker!: TrackerAdapter;
  private workspace!: WorkspaceManager;
  private runner!: AgentRunner;
  private retryEngine!: RetryEngine;
  private logger: Logger;

  private running: Map<string, RunEntry> = new Map();
  private claimed: Set<string> = new Set();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;

  constructor(configManager: ConfigManager, store: StateStore, logger: Logger) {
    this.configManager = configManager;
    this.store = store;
    this.logger = logger;
  }

  async start(): Promise<void> {
    const wf = this.configManager.getCurrent();
    const config = wf.config;

    // Create components
    this.tracker = await createTracker(config.tracker);
    if (this.tracker.init) {
      await this.tracker.init().catch((e) => {
        this.logger.warn('Tracker init failed', { error: String(e) });
      });
    }
    this.workspace = new WorkspaceManager(
      config.workspace.projectRoot,
      config.hooks,
      this.logger,
      config.workspace.baseBranch,
    );
    this.workspace.pruneStale();
    this.runner = new AgentRunner(config.agent, this.logger);
    this.retryEngine = new RetryEngine(
      this.store,
      (issueId, entry) => this.handleRetry(issueId, entry),
      config.agent.maxRetryBackoffMs,
      this.logger,
    );

    // Startup recovery: mark stale runs as failed
    const staleRuns = this.store.getActiveRuns();
    for (const run of staleRuns) {
      this.store.finishRun(run.id, 'failed', null, 'process restart recovery');
      this.logger.warn(`Marked stale run as failed`, {
        identifier: run.issueIdentifier,
        runId: run.id,
      });
    }

    // Restore retry timers from DB
    this.retryEngine.restoreFromDb();

    // Startup terminal workspace cleanup
    await this.startupCleanup();

    // Config hot-reload
    this.configManager.onChange(async (newWf) => {
      const c = newWf.config;
      this.runner.updateConfig(c.agent);
      this.workspace.updateHooks(c.hooks);
      this.retryEngine.updateMaxBackoff(c.agent.maxRetryBackoffMs);

      // If tracker kind changed, recreate tracker
      if (c.tracker.kind !== this.tracker.kind) {
        try {
          this.tracker = await createTracker(c.tracker);
          this.logger.info('Tracker recreated after config change');
        } catch (e) {
          this.logger.error('Failed to recreate tracker', { error: String(e) });
        }
      }
    });

    this.configManager.startWatching();

    this.logger.info('Cacophony started', {
      tracker: config.tracker.kind,
      maxConcurrent: config.agent.maxConcurrent,
      pollInterval: config.polling.intervalMs,
    });

    // Schedule first tick immediately
    this.scheduleTick(0);
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.logger.info('Shutting down...');

    // Abort all running agents
    for (const [_issueId, entry] of this.running) {
      entry.abortController.abort();
      this.store.finishRun(entry.runId, 'canceled', null, 'shutdown');
      this.logger.info(`Canceled agent for ${entry.issueIdentifier}`);
    }
    this.running.clear();
    this.claimed.clear();

    this.retryEngine.shutdown();
    await this.configManager.stopWatching();
    this.store.close();

    this.logger.info('Cacophony stopped');
  }

  getTracker(): TrackerAdapter | undefined {
    return this.tracker;
  }

  getRecentRuns(limit: number = 20): RunRecord[] {
    return this.store.getRecentRuns(limit);
  }

  getStatus(): {
    running: Array<{
      issueId: string;
      identifier: string;
      title: string;
      url: string | null;
      labels: string[];
      startedAt: string;
      attempt: number;
    }>;
    retrying: RetryEntry[];
    claimed: string[];
    trackerKind: string;
    activeStates: string[];
    terminalStates: string[];
  } {
    const config = this.configManager.getCurrent().config;
    return {
      running: Array.from(this.running.values()).map((r) => ({
        issueId: r.issueId,
        identifier: r.issueIdentifier,
        title: r.issue.title,
        url: r.issue.url,
        labels: r.issue.labels,
        startedAt: r.startedAt.toISOString(),
        attempt: r.attempt,
      })),
      retrying: this.retryEngine?.getActiveRetries() ?? [],
      claimed: Array.from(this.claimed),
      trackerKind: this.tracker?.kind ?? '',
      activeStates: config.tracker.activeStates ?? [],
      terminalStates: config.tracker.terminalStates ?? [],
    };
  }

  cancelIssue(issueIdentifier: string): boolean {
    for (const [issueId, entry] of this.running) {
      if (entry.issueIdentifier === issueIdentifier) {
        entry.abortController.abort();
        this.store.finishRun(entry.runId, 'canceled', null, 'manual cancel');
        this.running.delete(issueId);
        this.claimed.delete(issueId);
        this.retryEngine.cancel(issueId);
        this.logger.info(`Manually canceled ${issueIdentifier}`);
        return true;
      }
    }
    return false;
  }

  // --- Private ---

  private scheduleTick(delayMs: number): void {
    if (this.shuttingDown) return;
    this.pollTimer = setTimeout(() => this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      // 1. Reconcile
      await this.reconcile();

      // 2. Defensive config reload
      this.configManager.reload();
      const config = this.configManager.getCurrent().config;

      // 3. Fetch candidates
      const candidates = await this.tracker.fetchCandidates();

      // 4. Sort: priority asc (null last), createdAt asc, identifier asc
      candidates.sort((a, b) => {
        const pa = a.priority ?? 999;
        const pb = b.priority ?? 999;
        if (pa !== pb) return pa - pb;
        const ta = a.createdAt.getTime();
        const tb = b.createdAt.getTime();
        if (ta !== tb) return ta - tb;
        return a.identifier.localeCompare(b.identifier);
      });

      // 5. Dispatch eligible
      for (const issue of candidates) {
        if (this.shuttingDown) break;
        if (!this.shouldDispatch(issue, config)) continue;

        // Claim before async dispatch to enforce concurrency
        this.claimed.add(issue.id);

        // Cache issue in DB
        this.store.upsertIssue(issue);

        // Dispatch (non-blocking)
        this.dispatch(issue, 0).catch((e) => {
          this.logger.error(`Dispatch failed for ${issue.identifier}`, { error: String(e) });
          this.claimed.delete(issue.id);
        });
      }

      // 6. Update status line
      this.logger.statusLine(
        Array.from(this.running.values()),
        this.retryEngine.getActiveRetries(),
      );
    } catch (e) {
      this.logger.error('Tick error', { error: String(e) });
    }

    // Schedule next tick
    const interval = this.configManager.getCurrent().config.polling.intervalMs;
    this.scheduleTick(interval);
  }

  private shouldDispatch(issue: Issue, config: WorkflowConfig): boolean {
    // Required fields
    if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;

    const state = issue.state.toLowerCase();
    const activeStates = config.tracker.activeStates ?? [];
    const terminalStates = config.tracker.terminalStates ?? [];

    // Must be in active state, not terminal
    if (!activeStates.includes(state)) return false;
    if (terminalStates.includes(state)) return false;

    // Not already running or claimed
    if (this.running.has(issue.id)) return false;
    if (this.claimed.has(issue.id)) return false;

    // Global concurrency (use claimed.size because dispatch is non-blocking)
    if (this.claimed.size >= config.agent.maxConcurrent) return false;

    // Per-state concurrency
    if (config.agent.maxConcurrentByState) {
      const stateLimit = config.agent.maxConcurrentByState[state];
      if (stateLimit !== undefined) {
        const stateCount = Array.from(this.running.values()).filter(
          (r) => r.issue.state.toLowerCase() === state,
        ).length;
        if (stateCount >= stateLimit) return false;
      }
    }

    // Blocker rule: skip if any blocker is non-terminal
    if (issue.blockedBy.length > 0) {
      const hasNonTerminal = issue.blockedBy.some(
        (b) => !terminalStates.includes(b.state.toLowerCase()),
      );
      if (hasNonTerminal) return false;
    }

    return true;
  }

  private async dispatch(issue: Issue, attempt: number): Promise<void> {
    const log = this.logger.child({ issue_id: issue.id, identifier: issue.identifier });

    try {
      // Ensure workspace
      const ws = await this.workspace.ensureWorkspace(issue.identifier);
      log.info(`Workspace ready`, { path: ws.path, new: ws.createdNow });

      // Before-run hook
      const hookResult = await this.workspace.runHook('beforeRun', ws.path);
      if (!hookResult.ok) {
        throw new Error(`before_run hook failed: ${hookResult.output}`);
      }

      // Render prompt
      const wf = this.configManager.getCurrent();
      const tasksDir =
        this.tracker.kind === 'files'
          ? (this.tracker as { getDir?: () => string }).getDir?.()
          : undefined;
      const promptContent = liquid.parseAndRenderSync(wf.promptTemplate, {
        issue: {
          ...issue,
          createdAt: issue.createdAt.toISOString(),
          updatedAt: issue.updatedAt.toISOString(),
        },
        attempt: attempt || null,
        config: wf.config,
        project_root: this.workspace.getProjectRoot(),
        tasks_dir: tasksDir,
      }) as string;

      // Create DB record
      const runId = this.store.createRun(issue.id, issue.identifier, attempt, ws.path);
      this.store.updateRunStatus(runId, 'running');

      // Track in memory
      const abortController = new AbortController();
      const entry: RunEntry = {
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issue,
        startedAt: new Date(),
        attempt,
        runId,
        workspacePath: ws.path,
        abortController,
      };
      this.running.set(issue.id, entry);

      log.info(`Agent dispatched`, { attempt, runId });

      // Run agent (non-blocking — we don't await here in the tick loop)
      const result = await this.runner.run({
        workspacePath: ws.path,
        promptContent,
        issueIdentifier: issue.identifier,
        attempt,
        signal: abortController.signal,
        onOutput: (line) => {
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'assistant' && evt.message?.content) {
              for (const block of evt.message.content) {
                if (block.type === 'tool_use') {
                  log.info(`Tool: ${block.name}`, {
                    input: block.input?.command || block.input?.description || '',
                  });
                } else if (block.type === 'text' && block.text) {
                  log.info(`Agent: ${block.text.slice(0, 200)}`);
                }
              }
            } else if (evt.type === 'user' && evt.tool_use_result?.stderr) {
              log.warn(`Stderr: ${evt.tool_use_result.stderr.slice(0, 200)}`);
            }
          } catch {
            // Not JSON or non-stream output — log as-is if short
            if (line.length < 300) log.debug(line);
          }
        },
      });

      // Agent completed
      this.running.delete(issue.id);
      this.claimed.delete(issue.id);

      // After-run hook (best-effort)
      await this.workspace.runHook('afterRun', ws.path).catch(() => {});

      if (result.timedOut) {
        this.store.finishRun(runId, 'timed_out', result.exitCode, 'Agent timed out');
        log.warn('Agent timed out', { durationMs: result.durationMs });
        this.retryEngine.scheduleFailureRetry(issue.id, issue.identifier, attempt + 1, 'timeout');
      } else if (result.exitCode === 0) {
        this.store.finishRun(runId, 'succeeded', 0);
        log.info('Agent succeeded', { durationMs: result.durationMs });
        if (this.tracker.setIssueState) {
          // Tracker can mark tasks done — do that, clean the worktree, and don't loop.
          // The git branch cacophony/<id> still preserves the agent's commits.
          await this.tracker.setIssueState(issue.id, 'done').catch((e) => {
            log.warn('Failed to mark issue done', { error: String(e) });
          });
          await this.workspace.removeWorkspace(issue.identifier).catch((e) => {
            log.warn('Failed to remove worktree after success', { error: String(e) });
          });
        } else {
          // No way to advance state — fall back to continuation pattern.
          this.retryEngine.scheduleContinuation(issue.id, issue.identifier);
        }
      } else {
        const errMsg = result.stderr.slice(0, 500) || `exit code ${result.exitCode}`;
        this.store.finishRun(runId, 'failed', result.exitCode, errMsg);
        log.warn('Agent failed', { exitCode: result.exitCode, durationMs: result.durationMs });

        this.retryEngine.scheduleFailureRetry(issue.id, issue.identifier, attempt + 1, errMsg);
      }
    } catch (e) {
      this.running.delete(issue.id);
      this.claimed.delete(issue.id);
      log.error('Dispatch error', { error: String(e) });
      throw e;
    }
  }

  private async handleRetry(issueId: string, entry: RetryEntry): Promise<void> {
    if (this.shuttingDown) return;

    const config = this.configManager.getCurrent().config;
    const log = this.logger.child({ issue_id: issueId, identifier: entry.identifier });

    try {
      // Fetch current candidates to see if issue is still eligible
      const candidates = await this.tracker.fetchCandidates();
      const issue = candidates.find((c) => c.id === issueId);

      if (!issue) {
        // Issue no longer in active candidates — release claim and clean workspace
        this.claimed.delete(issueId);
        log.info('Retry: issue no longer active, releasing claim and cleaning workspace');
        await this.workspace.removeWorkspace(entry.identifier);
        return;
      }

      if (!this.shouldDispatch(issue, config)) {
        if (this.claimed.size >= config.agent.maxConcurrent) {
          // No slots — requeue
          this.retryEngine.scheduleFailureRetry(
            issueId,
            entry.identifier,
            entry.attempt,
            'no available slots',
          );
          log.info('Retry: no slots available, requeued');
        } else {
          // Not eligible for other reason — release
          this.claimed.delete(issueId);
          log.info('Retry: issue not eligible, releasing claim');
        }
        return;
      }

      // Re-dispatch
      this.store.upsertIssue(issue);
      await this.dispatch(issue, entry.attempt);
    } catch (e) {
      this.claimed.delete(issueId);
      log.error('Retry handler error', { error: String(e) });
    }
  }

  private async reconcile(): Promise<void> {
    if (this.running.size === 0) return;

    const config = this.configManager.getCurrent().config;
    const terminalStates = config.tracker.terminalStates ?? [];
    const activeStates = config.tracker.activeStates ?? [];

    // Part A: Stall detection (using agent timeout as proxy)
    const now = Date.now();
    for (const [issueId, entry] of this.running) {
      const elapsed = now - entry.startedAt.getTime();
      if (elapsed > config.agent.timeoutMs) {
        this.logger.warn(`Stall detected for ${entry.issueIdentifier}`, { elapsedMs: elapsed });
        entry.abortController.abort();
        this.running.delete(issueId);
        this.store.finishRun(entry.runId, 'timed_out', null, 'stall timeout');
        this.retryEngine.scheduleFailureRetry(
          issueId,
          entry.issueIdentifier,
          entry.attempt + 1,
          'stall timeout',
        );
      }
    }

    // Part B: Tracker state refresh
    const runningIds = Array.from(this.running.keys());
    if (runningIds.length === 0) return;

    try {
      const states = await this.tracker.fetchIssueStatesByIds(runningIds);
      const stateMap = new Map(states.map((s) => [s.id, s]));

      for (const [issueId, entry] of this.running) {
        const current = stateMap.get(issueId);
        if (!current) continue;

        const state = current.state.toLowerCase();

        if (terminalStates.includes(state)) {
          // Terminal — kill and clean workspace
          this.logger.info(`Issue ${entry.issueIdentifier} is now terminal (${state}), stopping`);
          entry.abortController.abort();
          this.running.delete(issueId);
          this.claimed.delete(issueId);
          this.retryEngine.cancel(issueId);
          this.store.finishRun(entry.runId, 'canceled', null, `issue moved to ${state}`);
          await this.workspace.removeWorkspace(entry.issueIdentifier);
        } else if (!activeStates.includes(state)) {
          // Non-active, non-terminal — kill without cleanup
          this.logger.info(
            `Issue ${entry.issueIdentifier} moved to non-active state (${state}), stopping`,
          );
          entry.abortController.abort();
          this.running.delete(issueId);
          this.claimed.delete(issueId);
          this.retryEngine.cancel(issueId);
          this.store.finishRun(entry.runId, 'canceled', null, `issue moved to ${state}`);
        }
        // Still active — keep running
      }
    } catch (e) {
      // State refresh failed — keep workers running, retry next tick
      this.logger.warn('Reconciliation state refresh failed', { error: String(e) });
    }
  }

  private async startupCleanup(): Promise<void> {
    if (!this.tracker.fetchTerminalIssues) return;

    try {
      const terminal = await this.tracker.fetchTerminalIssues();
      const identifiers = terminal.map((i) => i.identifier);
      if (identifiers.length > 0) {
        await this.workspace.cleanTerminalWorkspaces(identifiers);
        this.logger.info(`Cleaned ${identifiers.length} terminal workspaces`);
      }
    } catch (e) {
      this.logger.warn('Startup terminal cleanup failed', { error: String(e) });
    }
  }
}
