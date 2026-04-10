# Cacophony

A chaotic mess of agents doing their thing. Provider-agnostic agent orchestrator that polls for work, spins up isolated git worktrees, and runs any coding agent. Persistent state via SQLite. 5 runtime dependencies.

## What it does

Cacophony is a daemon you run **inside your project's git repo**:

1. Watches a local `tasks/` directory of markdown files for work (or a custom adapter)
2. Creates a git worktree per task under `.cacophony/worktrees/` — each on its own branch
3. Runs a coding agent in each worktree (Claude Code, Codex, Aider, or any CLI tool)
4. Manages concurrency, retries, and lifecycle hooks
5. Persists all state to SQLite — survives crashes and restarts
6. Serves a web dashboard for managing tasks and monitoring agents

You manage work. Cacophony manages agents.

## Install

```bash
npm install
npm run build
```

Requires Node.js 18+ and Git.

## Quick start

Run from inside any git repository:

```bash
cd my-project
cacophony init            # generates .cacophony/config.md
cacophony start           # dashboard on http://localhost:8080
```

Pass `--port N` to use a different port, or `--no-server` to run headless.

Cacophony creates a `.cacophony/` directory inside your project for its state and worktrees — everything is scoped to that one repo.

```
my-project/
├── .cacophony/              # state, auto-gitignored
│   ├── config.md            # workflow + agent config (front matter + prompt)
│   ├── cacophony.db
│   ├── tasks/               # markdown task files
│   └── worktrees/
│       └── fix-login/       # git worktree on branch cacophony/fix-login
├── .git/
└── src/
```

Cacophony's design rule: **finished code lives at the project root; everything in-progress, scratch, or local-only lives under `.cacophony/`**.

### Dev mode (no build step)

```bash
npx tsx /path/to/cacophony/src/index.ts start --port 8080
```

## How worktrees work

Each task gets its own git worktree — a separate working directory that shares the main `.git/` with your repo. Worktrees are fast to create (no cloning), disk-efficient (shared objects), and give each agent a fully isolated workspace on its own branch.

When cacophony picks up an issue:

1. Fetches latest from `origin/<base-branch>` (best-effort)
2. Creates a worktree at `.cacophony/worktrees/<id>/` on a new branch `cacophony/<id>`
3. Runs your agent with `cwd` set to that worktree
4. When the agent finishes (success, failure, or cancellation), removes the worktree

The agent can commit, push, open PRs, and merge — it's a real branch in your repo.

## File-based tracker

Just markdown files inside `.cacophony/tasks/` — no API keys, no remote services:

```
my-project/
└── .cacophony/
    ├── config.md
    └── tasks/
        ├── fix-login-bug.md
        └── add-dark-mode.md
```

Tasks are most easily created and edited from the web dashboard, but you can hand-edit the markdown files directly. Each file has YAML front matter:

```yaml
---
state: todo
priority: 1
blocked_by: [setup-auth]
---

# Fix login bug

Users can't log in after session timeout.
```

Drop a file in `tasks/` and cacophony picks it up. Or manage everything from the web dashboard — create, edit, reorder, delete.

## Configuration reference

The `.cacophony/config.md` file uses YAML front matter for config and a Liquid template body for the agent prompt. (Legacy `WORKFLOW.md` at the project root is still loaded as a fallback with a deprecation hint.)

### `tracker` (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `kind` | string | `"files"` | `"files"` or path to a custom adapter |
| `dir` | string | `".cacophony/tasks"` | Directory for task files (used by the files tracker) |
| `active_states` | string[] | `["todo", "in-progress"]` | States that mark issues as active |
| `terminal_states` | string[] | `["done", "cancelled", "wontfix"]` | States that mark issues as done |

### `agent`

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | string | *required* | Shell command to run. Supports Liquid: `{{prompt_file}}`, `{{workspace}}`, `{{identifier}}`, `{{attempt}}` |
| `prompt_delivery` | string | `"file"` | How the prompt reaches the agent: `"file"`, `"stdin"`, or `"arg"` |
| `timeout_ms` | number | `3600000` | Kill agent after this many ms (1 hour default) |
| `max_concurrent` | number | `5` | Max agents running simultaneously |
| `max_turns` | number | `20` | Max retry turns per issue |
| `max_retry_backoff_ms` | number | `300000` | Max backoff delay for failed retries (5 min) |
| `max_concurrent_by_state` | object | `{}` | Per-state concurrency limits, e.g. `{ "todo": 2 }` |
| `env` | object | `{}` | Extra environment variables for agent subprocess |

### `workspace` (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `project_root` | string | `.` | Git repo root. Worktrees live in `<project_root>/.cacophony/worktrees/`. |
| `base_branch` | string | auto-detect | Branch to base new worktrees on. Auto-detects `origin/HEAD`, then `main`, then `master`. |

### `hooks` (optional)

Shell scripts that run at worktree lifecycle points. All execute with the worktree as `cwd`. Bash required (uses Git Bash on Windows).

| Field | Description |
|---|---|
| `after_create` | Runs once after a worktree is first created. Failure aborts creation. |
| `before_run` | Runs before each agent attempt. Failure aborts the attempt. |
| `after_run` | Runs after each agent attempt. Failure is logged and ignored. |
| `before_remove` | Runs before worktree deletion. Failure is logged and ignored. |
| `timeout_ms` | Timeout for all hooks (default: 60000) |

Typical use: install deps, run a script to symlink shared caches, etc.

```yaml
hooks:
  after_create: |
    npm install --prefer-offline
```

### `polling`

| Field | Type | Default | Description |
|---|---|---|---|
| `interval_ms` | number | `30000` | How often to poll the tracker (30s default) |

### `server` (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `port` | number | `8080` | Dashboard / HTTP API port. Override with `--port N` or disable with `--no-server`. |

## Dependencies between tasks

Tasks can declare blockers so agents run in the right order. Use the `blocked_by` front matter field:

```yaml
---
state: todo
blocked_by: [setup-database, create-user-model]
---

# Add login endpoint
```

Cacophony skips any task whose blockers aren't in a terminal state.

## Agent examples

Cacophony runs any CLI tool:

**Claude Code:**
```yaml
agent:
  command: "claude -p {{prompt_file}} --output-format stream-json --verbose --dangerously-skip-permissions"
  prompt_delivery: file
```

**Codex:**
```yaml
agent:
  command: "codex --prompt {{prompt_file}}"
  prompt_delivery: file
```

**Aider:**
```yaml
agent:
  command: "aider --message-file {{prompt_file}} --yes"
  prompt_delivery: file
```

**Custom script:**
```yaml
agent:
  command: "python ./scripts/agent.py --task {{prompt_file}} --workspace {{workspace}}"
  prompt_delivery: file
```

## Custom tracker plugins

Create a JS/TS file that exports a factory function:

```typescript
// my-tracker.js
export default function createTracker(config) {
  return {
    kind: 'my-tracker',

    async fetchCandidates() {
      // Return Issue[] -- active issues to work on
    },

    async fetchIssueStatesByIds(ids) {
      // Return { id, identifier, state }[] for given issue IDs
    },

    async fetchTerminalIssues() {
      // Optional: return Issue[] in terminal states (for cleanup)
    },

    async setIssueState(issueId, state) {
      // Optional: cacophony calls this to mark a task done after a successful run.
      // If omitted, cacophony falls back to scheduling a continuation retry.
    },
  };
}
```

Reference it in your workflow:

```yaml
tracker:
  kind: "./my-tracker.js"
```

## Prompt template

The body of `.cacophony/config.md` (below the front matter) is a [Liquid](https://liquidjs.com/) template. Available variables:

| Variable | Type | Description |
|---|---|---|
| `issue.id` | string | Tracker-internal ID |
| `issue.identifier` | string | Human-readable key (e.g. `fix-login`) |
| `issue.title` | string | Issue title |
| `issue.description` | string | Issue body/description |
| `issue.priority` | number or null | Priority (lower = higher) |
| `issue.state` | string | Current state |
| `issue.url` | string or null | Link to the issue, if any |
| `issue.labels` | string[] | All labels (lowercase) |
| `attempt` | number or null | Retry attempt number (null on first run) |
| `config` | object | Full config from `.cacophony/config.md` |
| `tasks_dir` | string | Absolute path to `.cacophony/tasks/` (used by agents that self-decompose) |
| `project_root` | string | Absolute path to the project root |

## How it works

### Poll loop

Every `polling.interval_ms`, cacophony:

1. **Reconciles** running agents against the tracker (kills agents for terminal/inactive tasks)
2. **Fetches** candidate tasks from the tracker
3. **Sorts** by priority (ascending), then creation date (oldest first)
4. **Skips** tasks whose blockers aren't yet resolved
5. **Dispatches** eligible tasks until concurrency limit is reached

### Retry behavior

- **Agent succeeds (exit 0):** Cacophony marks the task as `done` via the tracker's `setIssueState` method. (For custom trackers without `setIssueState`, falls back to a 1-second continuation retry.)
- **Agent fails (non-zero exit):** Exponential backoff: 10s, 20s, 40s, 80s... up to `max_retry_backoff_ms`.
- **Agent times out:** Kill and retry with backoff.
- **All retries are persisted to SQLite.** If cacophony crashes and restarts, pending retries are restored with corrected delays.

### Worktree safety

- Identifiers are sanitized to valid git branch names (`[A-Za-z0-9._-]`, no leading dots, no `..`)
- Worktree paths are verified to be under `.cacophony/worktrees/` (no path traversal)
- Stale worktrees are pruned on startup via `git worktree prune`
- Failed worktree creation cleans up with `git worktree remove --force`
- Each task works on its own branch `cacophony/<identifier>`

## Web dashboard

The dashboard is a single-file Alpine.js app served from the daemon. Features:

- **Running agents** — live view with elapsed time and one-click stop
- **Stats** — running / retrying / succeeded / failed counters
- **Task list** — filterable (active / done / all) with search
- **Priority badges** — color-coded P1–P4
- **Blocker indicator** — shows which tasks are waiting on dependencies
- **Task detail modal** — description, blockers, run history, error traces
- **Keyboard shortcuts** — `/` to focus search, `Esc` to close modals
- **Task creation** — inline form (files tracker only)

**API endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard HTML |
| `GET` | `/api/v1/status` | Orchestrator state (running, retrying, claimed, trackerKind) |
| `GET` | `/api/v1/runs?limit=N` | Recent run history |
| `GET` | `/api/v1/tasks` | All tasks (files tracker only) |
| `POST` | `/api/v1/tasks` | Create task `{ prompt, priority }` (identifier is auto-generated from the prompt) |
| `PUT` | `/api/v1/tasks/:id/state` | Update task state `{ state }` |
| `DELETE` | `/api/v1/tasks/:id` | Delete task |
| `POST` | `/api/v1/stop/:id` | Cancel running agent |

## Development

```bash
npm run dev              # Run with tsx (no build step)
npm test                 # Run tests
npm run test:watch       # TDD watch mode
npm run test:coverage    # Coverage report
npm run lint             # ESLint
npm run format           # Prettier
npm run check            # Full pipeline: lint + format + test + build
```

## Architecture

```
src/
  index.ts              CLI entry point (init/start/status/stop)
  orchestrator.ts       Poll loop, dispatch, reconciliation, blocker enforcement
  config.ts             Config file parser, validator, hot-reload watcher
  state.ts              SQLite store (runs, retries, issues, metrics)
  workspace.ts          Git worktree lifecycle, hooks, safety checks
  runner.ts             Agent subprocess management
  retry.ts              Exponential backoff, persistence, timer restoration
  logger.ts             Structured JSON logging, terminal status
  dashboard.ts          Inline Alpine.js web dashboard
  types.ts              Shared type definitions
  trackers/
    interface.ts        TrackerAdapter interface, factory
    files.ts            Local markdown files (with blocked_by support)
```

### Runtime dependencies

| Package | Purpose |
|---|---|
| `better-sqlite3` | Persistent state (runs, retries, metrics) |
| `yaml` | Parse config front matter |
| `liquidjs` | Render prompt templates |
| `chokidar` | Watch the config file for hot-reload |
| `chalk` | Terminal output formatting |

Everything else uses Node.js builtins: `child_process`, `fs`, `path`, `http`, `crypto`.

## License

MIT
