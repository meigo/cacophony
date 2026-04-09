# Cacophony

A chaotic mess of agents doing their thing. Provider-agnostic agent orchestrator that polls for work, spins up isolated workspaces, and runs any coding agent. Persistent state via SQLite. 5 runtime dependencies.

Inspired by [OpenAI's Symphony](https://github.com/openai/symphony) but rebuilt from scratch in TypeScript with a different philosophy: any agent, any tracker, no lock-in.

## What it does

Cacophony is a daemon that:

1. Watches for work (local files, GitHub Issues, Linear, or custom)
2. Creates an isolated workspace directory per task
3. Runs a coding agent in each workspace (Claude Code, Codex, Aider, or any CLI tool)
4. Manages concurrency, retries, and lifecycle hooks
5. Persists all state to SQLite -- survives crashes and restarts
6. Serves a web dashboard for managing tasks and monitoring agents

You manage work. Cacophony manages agents.

## How it differs from OpenAI's Symphony

| | OpenAI Symphony | Cacophony |
|---|---|---|
| **Agents** | Codex only (JSON-RPC protocol) | Any CLI tool |
| **Trackers** | Linear only | Local files + GitHub Issues + Linear + plugins |
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

Requires Node.js 18+.

## Quick start

### 1. Generate a WORKFLOW.md

```bash
cacophony init
```

This walks you through an interactive setup: picks your tracker (local files/GitHub/Linear), coding agent (Claude Code/Codex/Aider/custom), and workspace settings. Writes a ready-to-use `WORKFLOW.md`.

### 2. Start the daemon

```bash
cacophony start WORKFLOW.md --port 8080
```

Open `http://localhost:8080` to see the dashboard. Create tasks, watch agents work, manage state.

### 3. Dev mode (no build step)

```bash
npx tsx src/index.ts init
npx tsx src/index.ts start WORKFLOW.md --port 8080
```

## File-based tracker (simplest setup)

No GitHub, no Linear, no API keys. Just markdown files:

```
tasks/
  fix-login-bug.md
  add-dark-mode.md
```

Each file has YAML front matter:

```yaml
---
state: todo
priority: 1
---

# Fix login bug

Users can't log in after session timeout.
```

Drop a file in the `tasks/` folder and Cacophony picks it up. Change `state: todo` to `state: done` and the agent stops. Or manage everything from the web dashboard.

WORKFLOW.md for file-based tracking:

```yaml
---
tracker:
  kind: files
  dir: "./tasks"
  active_states: ["todo", "in-progress"]
  terminal_states: ["done", "cancelled"]

agent:
  command: "claude -p {{prompt_file}} --output-format stream-json"
  prompt_delivery: file
  timeout_ms: 3600000
  max_concurrent: 3

workspace:
  root: ./workspaces

polling:
  interval_ms: 30000
---

You are working on: **{{issue.title}}**

{{issue.description}}
```

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

### `workspace`

| Field | Type | Default | Description |
|---|---|---|---|
| `root` | string | `<tmpdir>/cacophony_workspaces` | Root directory for per-issue workspaces. Supports `~`. |

### `hooks`

Shell scripts that run at workspace lifecycle points. All execute with the workspace as `cwd`.

| Field | Type | Default | Description |
|---|---|---|---|
| `after_create` | string | | Runs once when a workspace directory is first created. Failure aborts creation. |
| `before_run` | string | | Runs before each agent attempt. Failure aborts the attempt. |
| `after_run` | string | | Runs after each agent attempt. Failure is logged and ignored. |
| `before_remove` | string | | Runs before workspace deletion. Failure is logged and ignored. |
| `timeout_ms` | number | `60000` | Timeout for all hooks (1 min default) |

### `polling`

| Field | Type | Default | Description |
|---|---|---|---|
| `interval_ms` | number | `30000` | How often to poll the tracker (30s default) |

### `server` (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `port` | number | | Enable HTTP status server on this port |

## Agent examples

Cacophony runs any CLI tool:

**Claude Code:**
```yaml
agent:
  command: "claude -p {{prompt_file}} --output-format stream-json"
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

**Pipe via stdin:**
```yaml
agent:
  command: "my-agent --json"
  prompt_delivery: stdin
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

## How it works

### Poll loop

Every `polling.interval_ms`, Cacophony:

1. **Reconciles** running agents against the tracker (kills agents for terminal/inactive tasks)
2. **Fetches** candidate tasks from the tracker
3. **Sorts** by priority (ascending), then creation date (oldest first)
4. **Dispatches** eligible tasks until concurrency limit is reached

### Retry behavior

- **Agent succeeds (exit 0):** Schedule a 1-second continuation check. If the task is still active, dispatch again.
- **Agent fails (non-zero exit):** Exponential backoff: 10s, 20s, 40s, 80s... up to `max_retry_backoff_ms`.
- **Agent times out:** Kill and retry with backoff.
- **All retries are persisted to SQLite.** If Cacophony crashes and restarts, pending retries are restored with corrected delays.

### Workspace safety

- Identifiers are sanitized to `[A-Za-z0-9._-]` only
- Workspace paths are verified to be under the configured root (no path traversal)
- Agents run with `cwd` set to the workspace directory
- Each task gets its own isolated directory

## Web dashboard

Start with `--port` to enable:

```bash
cacophony start WORKFLOW.md --port 8080
```

The dashboard shows running agents, retry queue, and all tasks. With the file-based tracker you can create, update, and delete tasks directly from the browser.

**API endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard HTML |
| `GET` | `/api/v1/status` | Orchestrator state (running, retrying, claimed) |
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
  orchestrator.ts       Poll loop, dispatch, reconciliation
  config.ts             WORKFLOW.md parser, validator, hot-reload watcher
  state.ts              SQLite store (runs, retries, issues, metrics)
  workspace.ts          Directory lifecycle, hooks, safety checks
  runner.ts             Agent subprocess management
  retry.ts              Exponential backoff, persistence, timer restoration
  logger.ts             Structured JSON logging, terminal status
  dashboard.ts          Inline HTML/CSS/JS web dashboard
  types.ts              Shared type definitions
  trackers/
    interface.ts        TrackerAdapter interface, factory
    files.ts            Local markdown files
    github.ts           GitHub Issues via gh CLI
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
