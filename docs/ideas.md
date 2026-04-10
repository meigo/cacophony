# Future ideas

Captured during design discussions. Not committed to, just a parking lot for things to revisit.

## Intake agent — LLM-driven task creation

**Today:** the dashboard's task creation form takes a free-form prompt + priority. Cacophony slugifies the first line of the prompt into an identifier, saves the full prompt as the task content, sets state to `todo`. Mechanical, predictable, no LLM call.

**Idea:** make task creation go through an "intake agent" — a synchronous LLM call that runs once when the user submits a prompt and returns a structured response that cacophony writes to disk.

The intake agent would:

1. **Generate a short, meaningful title** for the identifier (instead of a mechanical slug). E.g. "Create a simple web page with centered text 'Hello'…" → `centered-hello-page` rather than `create-a-simple-web-page-with-centered-text`.
2. **Rephrase the user's prompt** into a high-quality prompt for the coding agent. Add structure, acceptance criteria, surface ambiguities.
3. **Decide whether to split into subtasks.** If the request spans multiple distinct concerns, write multiple task files with `blocked_by: [parent-id]` references and let the orchestrator's existing blocker logic handle ordering.

The dashboard then shows whatever the intake agent decided. Regular coding agents pick the resulting tasks up from `.cacophony/tasks/` like any other.

### Open questions

- **Which model?** Could reuse the coding agent's model (simplest, single config) or have a separate `intake.command` block in `WORKFLOW.md` pointing at a cheaper/faster model. Start with reuse, add separation only if needed.
- **Latency.** The intake call is synchronous from the user's POV. A few seconds is fine, 30+ is not. Cap with a timeout and fall back to mechanical slugify on timeout.
- **Structured output.** The intake agent has to emit something cacophony can parse — easiest is JSON. That means picking models that reliably produce valid JSON, or wrapping the call with a JSON-schema-constrained tool.
- **Graceful fallback.** If intake isn't configured, fails, or returns invalid output, fall back to mechanical slugify + single task. Never block task creation on the intake call.

### Self-decomposition variant

A lighter-weight version: skip the intake step entirely, but include in the regular coding agent's prompt:

> *If this is small, just do it. If it spans multiple distinct workstreams, write subtask `.md` files into `.cacophony/tasks/` with `blocked_by: [parent-id]` and exit. The parent will re-dispatch once subtasks finish.*

The orchestrator's existing retry/continuation + blocker logic handles the rest. No new infrastructure, no extra LLM call, the agent self-decides each invocation.

**Tradeoff:** less control. The agent might over-split a borderline task (doubling invocations) or under-split and run out of context on something it should have decomposed. The intake agent variant is more deterministic because the planning step happens before any code-touching work.

## Historical context: the planner pattern

The pre-rewrite cacophony (when it was tied to GitHub Issues) had a "planner pattern": tasks labeled `plan` got a different prompt that instructed the agent to decompose the work into child issues via `gh issue create` with `Blocked by #N` references. Subtasks then executed in dependency order on subsequent poll cycles.

That's gone now (ripped out with the rest of the GitHub support), but the *shape* of it is what the intake agent / self-decomposition ideas above are reaching for — the files tracker version would write `.md` files into `.cacophony/tasks/` instead of calling the GitHub API.
