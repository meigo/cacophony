// === Issue Domain ===

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

export interface TrackerAdapter {
  kind: string;
  init?(): Promise<void>;
  fetchCandidates(): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Pick<Issue, 'id' | 'identifier' | 'state'>[]>;
  fetchTerminalIssues?(): Promise<Issue[]>;
  setIssueState?(issueId: string, state: string): Promise<void>;
  deleteIssue?(issueId: string): Promise<void>;
  /** Absolute path where new tasks can be written (used for self-decomposition prompts). */
  getTasksDir?(): string;
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

export interface RunRecord {
  id: number;
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  workspacePath: string;
  prompt: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  error: string | null;
  exitCode: number | null;
  durationMs: number | null;
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
