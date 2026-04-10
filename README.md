# Cacophony

A chaotic mess of agents doing their thing. Provider-agnostic agent orchestrator that polls for work, spins up isolated git worktrees, and runs any coding agent. Persistent state via SQLite. 5 runtime dependencies.

Inspired by [OpenAI's Symphony](https://github.com/openai/symphony) but rebuilt from scratch in TypeScript with a different philosophy: any agent, any tracker, no lock-in.

## What it does

Cacophony is a daemon you run **inside your project's git repo**:

1. Watches for work (local files, GitHub Issues, Linear, or custom)
2. Creates a git worktree per task under `.cacophony/worktrees/` — each on its own branch
3. Runs a coding agent in each worktree (Claude Code, Codex, Aider, or any CLI tool)
4. Manages concurrency, retries, and lifecycle hooks
5. Persists all state to SQLite — survives crashes and restarts
6. Serves a web dashboard for managing tasks and monitoring agents

You manage work. Cacophony manages agents.

## How it differs from OpenAI's Symphony

| | OpenAI Symphony | Cacophony |
|---|---|---|
| **Agents** | Codex only (JSON-RPC protocol) | Any CLI tool |
| **Trackers** | Linear only | Local files + GitHub Issues + Linear + plugins |
| **Isolation** | Separate clones | Git worktrees (shared `.git`) |
| **State** | In-memory (lost on restart) | SQLite (persistent) |
| **Retries** | Lost on crash | Restored from DB |
| **Language** | Elixir | TypeScript |
| **Runtime deps** | Elixir ecosystem | 5 npm packages |
| **GUI** | None | Web dashboard |

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
cacophony init            # generates WORKFLOW.md
cacophony start --port 8080
```

Open `http://localhost:8080` for the dashboard.

Cacophony creates a `.cacophony/` directory inside your project for its state and worktrees — everything is scoped to that one repo.

```
my-project/
├── .cacophony/              # state, auto-gitignored
│   ├── cacophony.db
│   └── worktrees/
│       └── GH-42/           # git worktree on branch cacophony/GH-42
├── .git/
├── src/
└── WORKFLOW.md              # config
```

### Dev mode (no build step)

```bash
npx tsx /path/to/cacophony/src/index.ts start WORKFLOW.md --port 8080
```

## How worktrees work

Each task gets its own git worktree — a separate working directory that shares the main `.git/` with your repo. Worktrees are fast to create (no cloning), disk-efficient (shared objects), and give each agent a fully isolated workspace on its own branch.

When cacophony picks up an issue:

1. Fetches latest from `origin/<base-branch>` (best-effort)
2. Creates a worktree at `.cacophony/worktrees/<id>/` on a new branch `cacophony/<id>`
3. Runs your agent with `cwd` set to that worktree
4. When the agent finishes (success, failure, or cancellation), removes the worktree

The agent can commit, push, open PRs, and merge — it's a real branch in your repo.

## File-based tracker (simplest setup)

No GitHub, no Linear, no API keys. Just markdown files in your project:

```
my-project/
├── tasks/
│   ├── fix-login-bug.md
│   └── add-dark-mode.md
└── WORKFLOW.md
```

Each task file has YAML front matter:

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

The `WORKFLOW.md` file uses YAML front matter for config and a Liquid template body for the agent prompt.

### `tracker`

| Field | Type | Default | Description |
|---|---|---|---|
| `kind` | string | *required* | `"files"`, `"github"`, `"linear"`, or path to custom adapter |
| `dir` | string | `"./tasks"` | Directory for task files. Used with `kind: files`. |
| `repo` | string | | GitHub repo (`"owner/repo"`). Required for `github`. |
| `api_key` | string | | Linear API key. Supports `$ENV_VAR` syntax. Required for `linear`. |
| `project_slug` | string | | Linear project slug. Required for `linear`. |
| `active_labels` | string[] | `["todo", "in-progress"]` | GitHub: labels that mark issues as active |
| `active_states` | string[] | `["todo", "in progress"]` | States that mark issues as active (files + linear) |
| `terminal_labels` | string[] | `["done", "wontfix"]` | GitHub: labels that mark issues as done |
| `terminal_states` | string[] | `["done", "cancelled", ...]` | States that mark issues as done (files + linear) |

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
| `port` | number | | Enable HTTP status server on this port |

## Dependencies between tasks

Tasks can declare blockers so agents run in the right order.

**Files tracker** — use the `blocked_by` front matter field:

```yaml
---
state: todo
blocked_by: [setup-database, create-user-model]
---

# Add login endpoint
```

**GitHub** — add `Blocked by #N` in the issue body:

```
Add login endpoint.

Blocked by #12
Blocked by #15
```

**Linear** — uses Linear's native "Blocked by" relations automatically.

Cacophony skips any task whose blockers aren't in a terminal state.

## The planner pattern

For bigger features, create a single "plan" issue and let an agent decompose it into sub-issues automatically.

1. Create an issue with a `plan` label describing the high-level feature
2. Cacophony's planner prompt runs instead of the coding prompt
3. The agent creates sub-issues using `gh issue create`, with proper `Blocked by` references
4. Sub-issues execute in dependency order by subsequent agent runs

The `cacophony init` wizard generates a `WORKFLOW.md` with both planner and coder prompts, branched on the `plan` label.

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

    async addLabel(issueId, label) {
      // Optional: for auto-labeling running tasks
    },

    async removeLabel(issueId, label) {
      // Optional
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

The body of `WORKFLOW.md` (below the front matter) is a [Liquid](https://liquidjs.com/) template. Available variables:

| Variable | Type | Description |
|---|---|---|
| `issue.id` | string | Tracker-internal ID |
| `issue.identifier` | string | Human-readable key (`GH-42`, `fix-login`) |
| `issue.title` | string | Issue title |
| `issue.description` | string | Issue body/description |
| `issue.priority` | number or null | Priority (lower = higher) |
| `issue.state` | string | Current state/label |
| `issue.url` | string | Link to the issue |
| `issue.labels` | string[] | All labels (lowercase) |
| `attempt` | number or null | Retry attempt number (null on first run) |
| `config` | object | Full WORKFLOW.md config (for referencing `{{config.tracker.repo}}` etc.) |

## How it works

### Poll loop

Every `polling.interval_ms`, cacophony:

1. **Reconciles** running agents against the tracker (kills agents for terminal/inactive tasks)
2. **Fetches** candidate tasks from the tracker
3. **Sorts** by priority (ascending), then creation date (oldest first)
4. **Skips** tasks whose blockers aren't yet resolved
5. **Dispatches** eligible tasks until concurrency limit is reached

### Retry behavior

- **Agent succeeds (exit 0):** Schedule a 1-second continuation check. If the task is still active, dispatch again.
- **Agent fails (non-zero exit):** Exponential backoff: 10s, 20s, 40s, 80s... up to `max_retry_backoff_ms`.
- **Agent times out:** Kill and retry with backoff.
- **3+ failures:** Cacophony adds a `failed` label (GitHub only) so you can triage.
- **All retries are persisted to SQLite.** If cacophony crashes and restarts, pending retries are restored with corrected delays.

### Auto-labeling

For GitHub, cacophony automatically:

- Creates standard labels (`todo`, `in-progress`, `plan`, `failed`) on startup if missing
- Adds `in-progress` when dispatching an agent
- Removes `in-progress` when the agent finishes
- Adds `failed` after 3 retry attempts

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
| `POST` | `/api/v1/tasks` | Create task `{ identifier, priority, content }` |
| `PUT` | `/api/v1/tasks/:id/state` | Update task state `{ state }` |
| `DELETE` | `/api/v1/tasks/:id` | Delete task |
| `POST` | `/api/v1/stop/:id` | Cancel running agent |

## Development

```bash
npm run dev              # Run with tsx (no build step)
npm test                 # Run tests (119 tests)
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
  config.ts             WORKFLOW.md parser, validator, hot-reload watcher
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
    github.ts           GitHub Issues via gh CLI (with Blocked by #N parsing)
    linear.ts           Linear via native fetch + GraphQL
```

### Runtime dependencies

| Package | Purpose |
|---|---|
| `better-sqlite3` | Persistent state (runs, retries, metrics) |
| `yaml` | Parse WORKFLOW.md front matter |
| `liquidjs` | Render prompt templates |
| `chokidar` | Watch WORKFLOW.md for hot-reload |
| `chalk` | Terminal output formatting |

Everything else uses Node.js builtins: `child_process`, `fs`, `path`, `http`, `crypto`.

## License

MIT
