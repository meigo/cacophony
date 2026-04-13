# Future enhancements

Collected during development sessions. Not committed to — a parking lot for ideas that are worth doing but not urgent.

## Workspace & performance

### Native dependency-dir cloning in workspace.ts
After creating a worktree, automatically clone known dependency directories (node_modules, .venv, vendor) from the project root via copy-on-write. Eliminates the need for per-project `after_create` hooks for dep bootstrap. Currently this is a documented hook pattern; native support would make it zero-config.

### pnpm as recommended package manager
pnpm's content-addressable store with hardlinks makes `pnpm install` in a new worktree 2-5 seconds regardless of project size. Worth recommending in the README for Node-heavy users.

## Review stage

### Post-verification LLM review
An optional `review` stage that runs after `after_run` passes but before auto-merge. A separate agent call reviews the diff and either approves or rejects. Two modes: `gate` (blocks merge on reject) and `advisory` (just surfaces notes). Deferred because the `after_run` gate + improved retry context covers 90% of the value. Build when there's a concrete pain point showing agents shipping code that passes tests but has subtle quality issues.

Design notes: the reviewer needs fresh context (separate from the coding agent) to avoid rubber-stamping. The diff should be fed via `git diff base..HEAD`. The review prompt should be adversarial ("look for what's wrong, not what's right"). Whether the agent can opt out of review was discussed — conclusion: never let the agent under review skip the review. Only the orchestrator or a deterministic heuristic (diff size under N lines) should decide.

## Dashboard & UI

### Live dev-server preview (Level 2)
Start the project's dev server (`npm run dev` on a random port) inside the worktree and proxy through cacophony's HTTP server. Provides live HMR preview as the agent writes code — the Lovable-like experience. Requires: process management (port allocation, stdout parsing for "ready", health checking, zombie cleanup), WebSocket forwarding for HMR. Significantly more complex than the static preview but dramatically more useful for SvelteKit/Next.js/Vite projects where the dev server is the only way to see the output.

### Inline dashboard preview (Level 3)
An `<iframe>` in the task detail modal or a split-pane layout showing the preview alongside run history and task details. Trivial once Level 1 or 2 exists — just embed the preview URL. The split-pane layout would make cacophony feel like a lightweight IDE: task list on the left, live preview on the right.

### Settings panel
A read-only "Settings" panel in the dashboard showing current config values (agent command, model, max concurrent, brief enabled, hooks, etc.). Evolve to editable fields for high-impact settings. Keep the config file as source of truth — UI writes back to YAML and triggers hot-reload. Challenge: YAML round-tripping loses comments.

### Live agent output streaming
SSE endpoint at `/api/v1/runs/:id/stream` that streams tool calls and text blocks from the running agent to the dashboard in real-time. Currently the only way to see live agent output is the daemon's terminal log. Significant implementation work (event bus, backpressure, reconnect handling). Defer until the stored build log + retry context prove insufficient.

### Duplicate task button
For historical (done) entries, a "Duplicate" button that creates a new task with the same prompt as the original. Requires preserving the original prompt in the runs table (already done via `runs.prompt`). Would let users re-run a task with minor tweaks without retyping.

### Retry now button
For failed tasks, a "Retry now" button that forces immediate dispatch instead of waiting for the backoff timer. Currently users have to wait for the retry engine's exponential backoff.

## Agent execution

### Containerized agent runs
Run the agent subprocess inside a Docker container with only the worktree directory mounted and no host network. Eliminates the security concern of agents accessing the full filesystem. The `agent.command` config could accept a `docker run` wrapper. Challenge: many agent CLIs need network access for API calls, and Docker adds startup latency.

### Runtime smoke testing in after_run
For web projects, the `after_run` hook could start the dev server briefly, hit a URL, and check for HTTP 200 + no console errors. Catches runtime initialization errors that static builds miss (the Prisma `.prisma/client/default` error, the Defold `tint` property error). Fiddly to implement reliably but high value for web projects.

### Checkpoint / resumability
If cacophony crashes mid-agent-run, the current behavior is to mark the run as failed and start over on restart. With checkpointing, the agent's progress (commits, tool call history) could be preserved and the next attempt could resume from the last checkpoint rather than restarting. Requires agent cooperation (the agent would need to support resumption). Inspired by OpenExec's stage-based checkpointing.

## Skill ecosystem

### Fetchable skill registry
Replace the hardcoded `SKILL_REGISTRY` in `src/skills.ts` with a fetchable JSON file (hosted on GitHub or a CDN). New skill packs can be added without releasing a new cacophony version. Only worth doing when there are 5+ community skill packs.

### Skill auto-detection from project files
For existing projects (not new ones), detect the framework from signature files (`game.project` → Defold, `package.json` with `next` → Next.js, etc.) at daemon startup and suggest skill installation via the dashboard. Currently only the brief flow detects frameworks; file-based detection would catch projects where the brief isn't used.

## Configuration

### Post-merge deploy hook
A `post_merge` hook that runs in the main checkout after auto-merge succeeds. Used for deployment: `netlify deploy --dir=dist --prod`, `rsync`, `docker build && docker push`, etc. Currently deployment is manual (drag dist/ to Netlify Drop). Build when users have CLI-scriptable deploy targets.

### Per-task hook overrides
Allow individual tasks to override the project-level `after_run` hook. A decomposition parent might want no verification, while a code task wants full build + test. Currently handled by the decomposition detection (worktree clean → skip hook), but explicit per-task overrides would give more control.

## Retry intelligence

### Thrashing pattern detection (implemented — cap at 5)
Detect when an agent is failing with different errors each time (thrashing) and give up after a total failure cap. **Implemented**: 5 total failures trigger give-up, regardless of whether errors are identical.

### Same-error detection with normalization (implemented)
Detect when the last 3 failures have the identical error (after normalizing timestamps, paths, and durations). **Implemented**: triggers give-up and marks task as `wontfix`.

### Retry context injection (implemented)
On retries, inject the previous run's full error + build output into the prompt template so the agent sees exactly what went wrong. **Implemented**: `last_error` and `last_hook_output` Liquid variables.

### Cost tracking
Track token usage per run (if the agent CLI reports it) and show cumulative cost in the dashboard. Useful for budgeting and for the "this task cost $12 in retries" signal that tells you when to give up manually.
