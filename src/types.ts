// === Issue Domain ===

/**
 * Canonical issue-state values cacophony itself writes (e.g. via
 * `setIssueState`) or compares against. Trackers may surface other strings;
 * those pass through untouched. All stored/compared values are lowercase.
 *
 * - 'deleted' is a synthetic sentinel returned when a tracker no longer
 *   knows about an issue (e.g. the task file was deleted). It is never
 *   persisted — only reported by `fetchIssueStatesByIds`.
 */
export const ISSUE_STATES = {
  TODO: 'todo',
  IN_PROGRESS: 'in-progress',
  DONE: 'done',
  WONTFIX: 'wontfix',
  CANCELLED: 'cancelled',
  DELETED: 'deleted',
} as const;

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: BlockerRef[];
  parent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlockerRef {
  id: string;
  identifier: string;
  state: string;
}

// === Tracker Plugin Interface ===

/**
 * The minimum contract every tracker implements: discover active tasks,
 * refresh their states, and (optionally) advance/delete them. Anything more
 * specific — task file CRUD, local tasks directory, etc. — belongs on
 * `LocalTaskStore`, a capability interface that only some trackers (today
 * just FilesTracker) also implement. Callers that need file-level features
 * should use `isLocalTaskStore(tracker)` to narrow.
 */
export interface TrackerAdapter {
  kind: string;
  init?(): Promise<void>;
  fetchCandidates(): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Pick<Issue, 'id' | 'identifier' | 'state'>[]>;
  fetchTerminalIssues?(): Promise<Issue[]>;
  setIssueState?(issueId: string, state: string): Promise<void>;
  deleteIssue?(issueId: string): Promise<void>;
}

/**
 * Capability for trackers that own a local task store (task files on disk).
 * Not every tracker has this — remote trackers like Linear or GitHub fetch
 * tasks from an API and can't offer local CRUD or a tasks directory.
 */
export interface LocalTaskStore {
  getAllTasks(): Issue[];
  getTask(identifier: string): Issue | null;
  createTask(
    identifier: string,
    state: string,
    priority: number | null,
    content: string,
    parent?: string | null,
  ): void;
  updateTaskState(identifier: string, newState: string): boolean;
  deleteTask(identifier: string): boolean;
  /** Absolute path where new tasks can be written (used for self-decomposition prompts). */
  getTasksDir(): string;
}

export function isLocalTaskStore(t: unknown): t is LocalTaskStore {
  return (
    !!t &&
    typeof t === 'object' &&
    typeof (t as LocalTaskStore).createTask === 'function' &&
    typeof (t as LocalTaskStore).getTasksDir === 'function'
  );
}

// === Workflow / Config ===

export interface WorkflowDefinition {
  config: WorkflowConfig;
  promptTemplate: string;
}

export interface WorkflowConfig {
  tracker: TrackerConfig;
  agent: AgentConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  polling: PollingConfig;
  brief: BriefConfig;
  server?: { port?: number };
}

export interface BriefConfig {
  enabled: boolean;
  maxRounds: number;
  timeoutMs: number;
}

export interface TrackerConfig {
  kind: string;
  dir?: string;
  activeStates?: string[];
  terminalStates?: string[];
}

export interface AgentConfig {
  command: string;
  promptDelivery: 'file' | 'stdin' | 'arg';
  timeoutMs: number;
  maxConcurrent: number;
  maxTurns: number;
  maxRetryBackoffMs: number;
  maxConcurrentByState?: Record<string, number>;
  env?: Record<string, string>;
}

export interface WorkspaceConfig {
  projectRoot: string; // defaults to the git repo root
  baseBranch?: string; // defaults to auto-detected (origin/HEAD or main)
}

export interface HooksConfig {
  afterCreate?: string;
  beforeRun?: string;
  afterRun?: string;
  beforeRemove?: string;
  timeoutMs: number;
}

export interface PollingConfig {
  intervalMs: number;
}

// === Run State ===

export type RunStatus =
  | 'preparing_workspace'
  | 'building_prompt'
  | 'launching_agent'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'canceled';

export type MergeStatus = 'merged' | 'skipped' | 'conflict';

export interface RunRecord {
  id: number;
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  workspacePath: string;
  prompt: string | null;
  parent: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  error: string | null;
  hookOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
  mergeStatus: MergeStatus | null;
  mergeReason: string | null;
}

// === Runtime Entries ===

export interface RunEntry {
  issueId: string;
  issueIdentifier: string;
  issue: Issue;
  startedAt: Date;
  attempt: number;
  runId: number;
  workspacePath: string;
  abortController: AbortController;
}

export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  error: string | null;
}

// === Agent Runner ===

export interface AgentResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}
