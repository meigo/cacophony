import Database from 'better-sqlite3';
import type { RunRecord, RunStatus, Issue, RetryEntry } from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id        TEXT NOT NULL,
  issue_identifier TEXT NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 0,
  workspace_path  TEXT NOT NULL,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  status          TEXT NOT NULL DEFAULT 'preparing_workspace',
  error           TEXT,
  exit_code       INTEGER,
  duration_ms     INTEGER
);

CREATE TABLE IF NOT EXISTS issues (
  id              TEXT PRIMARY KEY,
  identifier      TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  state           TEXT NOT NULL,
  priority        INTEGER,
  url             TEXT,
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  data_json       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retries (
  issue_id        TEXT PRIMARY KEY,
  identifier      TEXT NOT NULL,
  attempt         INTEGER NOT NULL,
  due_at_ms       INTEGER NOT NULL,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS metrics (
  key             TEXT PRIMARY KEY,
  value_json      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_issue_id ON runs(issue_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_retries_due ON retries(due_at_ms);
`;

export class StateStore {
  private db: Database.Database;

  // Prepared statements
  private stmtCreateRun: Database.Statement;
  private stmtUpdateRunStatus: Database.Statement;
  private stmtFinishRun: Database.Statement;
  private stmtGetActiveRuns: Database.Statement;
  private stmtGetRunsForIssue: Database.Statement;
  private stmtGetLatestRun: Database.Statement;

  private stmtUpsertIssue: Database.Statement;
  private stmtGetIssue: Database.Statement;

  private stmtUpsertRetry: Database.Statement;
  private stmtGetRetry: Database.Statement;
  private stmtGetDueRetries: Database.Statement;
  private stmtRemoveRetry: Database.Statement;
  private stmtGetAllRetries: Database.Statement;

  private stmtSetMetric: Database.Statement;
  private stmtGetMetric: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);

    // Runs
    this.stmtCreateRun = this.db.prepare(`
      INSERT INTO runs (issue_id, issue_identifier, attempt, workspace_path, status)
      VALUES (?, ?, ?, ?, 'preparing_workspace')
    `);
    this.stmtUpdateRunStatus = this.db.prepare(`
      UPDATE runs SET status = ?, error = ? WHERE id = ?
    `);
    this.stmtFinishRun = this.db.prepare(`
      UPDATE runs SET status = ?, exit_code = ?, error = ?,
        finished_at = datetime('now'),
        duration_ms = CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
      WHERE id = ?
    `);
    const runColumns = `id, issue_id AS issueId, issue_identifier AS issueIdentifier, attempt,
             workspace_path AS workspacePath, started_at AS startedAt, finished_at AS finishedAt,
             status, error, exit_code AS exitCode, duration_ms AS durationMs`;
    this.stmtGetActiveRuns = this.db.prepare(`
      SELECT ${runColumns} FROM runs WHERE status IN ('preparing_workspace', 'building_prompt', 'launching_agent', 'running')
    `);
    this.stmtGetRunsForIssue = this.db.prepare(`
      SELECT ${runColumns} FROM runs WHERE issue_id = ? ORDER BY id DESC
    `);
    this.stmtGetLatestRun = this.db.prepare(`
      SELECT ${runColumns} FROM runs WHERE issue_id = ? ORDER BY id DESC LIMIT 1
    `);

    // Issues
    this.stmtUpsertIssue = this.db.prepare(`
      INSERT INTO issues (id, identifier, title, state, priority, url, last_seen_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(id) DO UPDATE SET
        identifier = excluded.identifier,
        title = excluded.title,
        state = excluded.state,
        priority = excluded.priority,
        url = excluded.url,
        last_seen_at = excluded.last_seen_at,
        data_json = excluded.data_json
    `);
    this.stmtGetIssue = this.db.prepare(`SELECT * FROM issues WHERE id = ?`);

    // Retries
    this.stmtUpsertRetry = this.db.prepare(`
      INSERT INTO retries (issue_id, identifier, attempt, due_at_ms, error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        identifier = excluded.identifier,
        attempt = excluded.attempt,
        due_at_ms = excluded.due_at_ms,
        error = excluded.error,
        created_at = datetime('now')
    `);
    this.stmtGetRetry = this.db.prepare(`
      SELECT issue_id AS issueId, identifier, attempt, due_at_ms AS dueAtMs, error
      FROM retries WHERE issue_id = ?
    `);
    this.stmtGetDueRetries = this.db.prepare(`
      SELECT issue_id AS issueId, identifier, attempt, due_at_ms AS dueAtMs, error
      FROM retries WHERE due_at_ms <= ?
    `);
    this.stmtRemoveRetry = this.db.prepare(`DELETE FROM retries WHERE issue_id = ?`);
    this.stmtGetAllRetries = this.db.prepare(`
      SELECT issue_id AS issueId, identifier, attempt, due_at_ms AS dueAtMs, error
      FROM retries
    `);

    // Metrics
    this.stmtSetMetric = this.db.prepare(`
      INSERT INTO metrics (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `);
    this.stmtGetMetric = this.db.prepare(`SELECT value_json FROM metrics WHERE key = ?`);
  }

  // --- Runs ---

  createRun(
    issueId: string,
    issueIdentifier: string,
    attempt: number,
    workspacePath: string,
  ): number {
    const result = this.stmtCreateRun.run(issueId, issueIdentifier, attempt, workspacePath);
    return Number(result.lastInsertRowid);
  }

  updateRunStatus(runId: number, status: RunStatus, error?: string): void {
    this.stmtUpdateRunStatus.run(status, error ?? null, runId);
  }

  finishRun(runId: number, status: RunStatus, exitCode?: number | null, error?: string): void {
    this.stmtFinishRun.run(status, exitCode ?? null, error ?? null, runId);
  }

  getActiveRuns(): RunRecord[] {
    return this.stmtGetActiveRuns.all() as RunRecord[];
  }

  getRunsForIssue(issueId: string): RunRecord[] {
    return this.stmtGetRunsForIssue.all(issueId) as RunRecord[];
  }

  getLatestRun(issueId: string): RunRecord | undefined {
    return this.stmtGetLatestRun.get(issueId) as RunRecord | undefined;
  }

  // --- Issues ---

  upsertIssue(issue: Issue): void {
    this.stmtUpsertIssue.run(
      issue.id,
      issue.identifier,
      issue.title,
      issue.state,
      issue.priority,
      issue.url,
      JSON.stringify(issue),
    );
  }

  getIssue(id: string): Issue | undefined {
    const row = this.stmtGetIssue.get(id) as { data_json: string } | undefined;
    if (!row) return undefined;
    const parsed = JSON.parse(row.data_json);
    parsed.createdAt = new Date(parsed.createdAt);
    parsed.updatedAt = new Date(parsed.updatedAt);
    return parsed as Issue;
  }

  // --- Retries ---

  upsertRetry(entry: Omit<RetryEntry, 'timerHandle'>): void {
    this.stmtUpsertRetry.run(
      entry.issueId,
      entry.identifier,
      entry.attempt,
      entry.dueAtMs,
      entry.error,
    );
  }

  getRetry(issueId: string): RetryEntry | undefined {
    return this.stmtGetRetry.get(issueId) as RetryEntry | undefined;
  }

  getDueRetries(nowMs: number): RetryEntry[] {
    return this.stmtGetDueRetries.all(nowMs) as RetryEntry[];
  }

  removeRetry(issueId: string): void {
    this.stmtRemoveRetry.run(issueId);
  }

  getAllRetries(): RetryEntry[] {
    return this.stmtGetAllRetries.all() as RetryEntry[];
  }

  // --- Metrics ---

  setMetric(key: string, value: unknown): void {
    this.stmtSetMetric.run(key, JSON.stringify(value));
  }

  getMetric<T>(key: string): T | undefined {
    const row = this.stmtGetMetric.get(key) as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}
