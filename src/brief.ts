import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentConfig } from './types.js';
import type { Logger } from './logger.js';
import { slugifyPrompt } from './slug.js';
import { renderBrief, renderCommand } from './template.js';

export type BriefMessage = { role: 'user' | 'assistant'; content: string };

export type BriefReady = {
  status: 'ready';
  title: string;
  prompt: string;
  /** Frameworks/engines the brief agent detected from the user's prompt. */
  frameworks?: string[];
  /** Suggested verification hooks based on the detected tech stack. */
  suggestedHooks?: { after_run?: string };
};

/**
 * A single clarification question. `options` is an enumerated list of 2-4
 * short, mutually exclusive answers the user can pick from. The dashboard
 * renders these as radio buttons plus a "Other..." text field as an escape
 * hatch for cases the options don't cover. An empty `options` array means
 * "genuinely free-form — no sensible enumeration exists".
 */
export type BriefQuestion = { question: string; options: string[] };
export type BriefClarify = { status: 'clarify'; questions: BriefQuestion[] };
export type BriefResult = BriefReady | BriefClarify;

export interface RunBriefOpts {
  transcript: BriefMessage[];
  round: number;
  maxRounds: number;
  agent: AgentConfig;
  projectRoot: string;
  timeoutMs: number;
  logger: Logger;
}

const BRIEF_TEMPLATE = `You are a task intake assistant for cacophony, an orchestrator for autonomous coding agents.

A user just submitted this task description:
---
{{ user_prompt }}
---

{% if prior_turns != "" -%}
Prior clarification so far:
{{ prior_turns }}
{%- endif %}

Current round: {{ round }} of {{ max_rounds }}.

Your job: decide whether this task is clear enough for a coding agent to execute autonomously with no further human input.

- If YES, respond with ONLY this JSON (no markdown, no commentary, no code fences):
{"status":"ready","title":"<short human title, max 60 chars>","prompt":"<refined prompt with explicit scope, constraints, acceptance criteria>","frameworks":["<framework-or-engine-id if any>"]}

The "frameworks" array should list any specific game engine or framework the task targets, using lowercase identifiers: "defold", "godot", "unity", "unreal", "nextjs", "sveltekit", "astro", "flutter", etc. Omit the field or use an empty array if no specific framework is involved (e.g. a plain CLI tool, a vanilla HTML page, or a generic library).

The "suggestedHooks" object should contain an "after_run" shell command that verifies the project builds, passes tests, AND passes linting for the detected stack. Always include a linter — prefer Biome (fast, all-in-one) for JS/TS projects unless the user specifies otherwise. Examples:
- SvelteKit: "npx svelte-check && npx vitest run && npx biome check --write ."
- Next.js: "npm run build && npm run lint && npx vitest run"
- Astro: "npm run build && npx astro check && npx biome check --write ."
- Rust: "cargo build && cargo test && cargo clippy"
- Go: "go build ./... && go test ./... && go vet ./..."
- Python: "pytest && ruff check ."
- Defold: "java -jar bob.jar build"
- Generic Node.js: "npm run build && npm test && npx biome check --write ."
If the user hasn't specified a linting preference and the task involves a JS/TS project, include a clarification question asking which linting tools to use (options: "Biome", "ESLint + Prettier", "None"). Include their choice in the suggestedHooks.
Omit suggestedHooks if no specific verification is needed or if the stack is unknown.

- If NO, ask up to 3 short, focused clarifying questions, EACH with 2-4 short, mutually exclusive options the user can pick from. Prefer clickable options over free-form questions — users will click faster than they can type. Return ONLY this JSON:
{"status":"clarify","questions":[{"question":"<q1>","options":["<opt1>","<opt2>","<opt3>"]},{"question":"<q2>","options":["<optA>","<optB>"]}]}

If a question genuinely has no enumerable answer (e.g. "what is the project name?") use an empty options array: {"question":"<q>","options":[]}. The dashboard will show a plain text field in that case. Prefer this only when listing options would be nonsense, not as a lazy fallback.

{% if round >= max_rounds -%}
You have hit max_rounds — you MUST return "ready" this round. Commit to the best interpretation you can.
{%- endif %}

Output nothing but the JSON object. No prose. No markdown.`;

function buildPromptFile(transcript: BriefMessage[], round: number, maxRounds: number): string {
  const firstUser = transcript.find((m) => m.role === 'user')?.content ?? '';
  const priorTurns = transcript
    .slice(1)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n');
  return renderBrief(BRIEF_TEMPLATE, {
    user_prompt: firstUser,
    prior_turns: priorTurns,
    round,
    max_rounds: maxRounds,
  });
}

/**
 * Try several parsing strategies to extract a JSON object from arbitrary
 * agent stdout. Agents have wildly different output formats (plain text,
 * stream-json events, markdown with fences, etc.) and we want the brief
 * feature to tolerate all of them.
 */
export function extractBriefJson(stdout: string): unknown | null {
  const candidates: string[] = [];

  // Strategy 1: the whole output is a JSON object.
  candidates.push(stdout.trim());

  // Strategy 2: the first {...} block anywhere in the output (naive brace match).
  const braceMatch = stdout.match(/\{[\s\S]*\}/);
  if (braceMatch) candidates.push(braceMatch[0]);

  // Strategy 3: content inside a ```json ... ``` or plain ``` fence.
  const fenceMatch = stdout.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());

  // Strategy 4: Claude Code stream-json format. Each line is a JSON event;
  // collect all assistant text chunks, concatenate, and look for JSON inside.
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const assistantTexts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: { content?: Array<{ type?: string; text?: string }> };
      };
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            assistantTexts.push(block.text);
          }
        }
      }
    } catch {
      // not a JSON line, skip
    }
  }
  if (assistantTexts.length > 0) {
    const combined = assistantTexts.join('');
    candidates.push(combined.trim());
    const combinedBrace = combined.match(/\{[\s\S]*\}/);
    if (combinedBrace) candidates.push(combinedBrace[0]);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }
  return null;
}

export function validateBriefResult(parsed: unknown): BriefResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.status === 'ready' && typeof obj.title === 'string' && typeof obj.prompt === 'string') {
    const frameworks = Array.isArray(obj.frameworks)
      ? (obj.frameworks as unknown[])
          .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
          .map((f) => f.trim().toLowerCase())
      : [];
    // Extract suggested verification hooks (after_run command for the project's stack)
    let suggestedHooks: { after_run?: string } | undefined;
    if (obj.suggestedHooks && typeof obj.suggestedHooks === 'object') {
      const sh = obj.suggestedHooks as Record<string, unknown>;
      if (typeof sh.after_run === 'string' && sh.after_run.trim().length > 0) {
        suggestedHooks = { after_run: sh.after_run.trim() };
      }
    }
    return {
      status: 'ready',
      title: obj.title.slice(0, 80).trim() || 'task',
      prompt: obj.prompt.trim(),
      ...(frameworks.length > 0 ? { frameworks } : {}),
      ...(suggestedHooks ? { suggestedHooks } : {}),
    };
  }
  if (obj.status === 'clarify' && Array.isArray(obj.questions)) {
    // Accept both the structured shape {question, options} and the legacy
    // plain-string shape. A plain-string question upgrades to an empty
    // options array (free-form text only in the UI).
    const normalized: BriefQuestion[] = [];
    for (const raw of obj.questions as unknown[]) {
      if (typeof raw === 'string') {
        const text = raw.trim();
        if (text.length > 0) normalized.push({ question: text, options: [] });
        continue;
      }
      if (raw && typeof raw === 'object') {
        const q = raw as Record<string, unknown>;
        if (typeof q.question !== 'string') continue;
        const text = q.question.trim();
        if (text.length === 0) continue;
        const options = Array.isArray(q.options)
          ? (q.options as unknown[])
              .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
              .map((o) => o.trim())
              .slice(0, 4)
          : [];
        normalized.push({ question: text, options });
      }
    }
    const questions = normalized.slice(0, 3);
    if (questions.length === 0) return null;
    return { status: 'clarify', questions };
  }
  return null;
}

function fallbackReady(transcript: BriefMessage[]): BriefReady {
  const firstUser = transcript.find((m) => m.role === 'user')?.content ?? 'task';
  return {
    status: 'ready',
    title: slugifyPrompt(firstUser),
    prompt: firstUser.trim(),
  };
}

/**
 * Run a single brief round: spawn the agent command with an intake-flavored
 * prompt, capture stdout, parse JSON. Never throws — on any error (spawn
 * failure, timeout, invalid JSON, etc.) returns a safe ready fallback so
 * task creation always succeeds.
 */
export async function runBrief(opts: RunBriefOpts): Promise<BriefResult> {
  const { transcript, round, maxRounds, agent, projectRoot, timeoutMs, logger } = opts;

  if (transcript.length === 0) {
    return { status: 'ready', title: 'task', prompt: '' };
  }

  // Isolated scratch directory so the agent doesn't stomp on the project.
  const briefRoot = path.join(projectRoot, '.cacophony', 'brief');
  fs.mkdirSync(briefRoot, { recursive: true });
  const briefDir = fs.mkdtempSync(path.join(briefRoot, 'session-'));

  const promptFile = path.join(briefDir, '.cacophony-prompt.md');
  const promptContent = buildPromptFile(transcript, round, maxRounds);
  fs.writeFileSync(promptFile, promptContent, 'utf-8');

  const renderedCommand = renderCommand(agent.command, {
    prompt_file: promptFile,
    workspace: briefDir,
    identifier: 'brief',
    attempt: 0,
  });

  logger.info('Running brief', { round, maxRounds });

  const stdout = await new Promise<string>((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : 'bash';
    const shellArgs = isWindows ? ['/c', renderedCommand] : ['-lc', renderedCommand];

    const child = spawn(shell, shellArgs, {
      cwd: briefDir,
      env: { ...process.env, ...agent.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let finished = false;

    const cleanup = (): void => {
      try {
        fs.rmSync(briefDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };

    const finish = (result: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };

    if (agent.promptDelivery === 'stdin') {
      child.stdin.write(promptContent);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.stdout.on('data', (data: Buffer) => {
      out += data.toString();
    });
    child.stderr.on('data', () => {
      // intentionally ignored — brief tools often stream progress to stderr
    });
    child.on('error', (err) => {
      logger.warn('Brief subprocess error', { error: err.message });
      finish(out);
    });
    child.on('close', () => {
      finish(out);
    });

    const timer = setTimeout(() => {
      logger.warn('Brief timed out', { timeoutMs });
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      finish(out);
    }, timeoutMs);
  });

  const parsed = extractBriefJson(stdout);
  const validated = parsed ? validateBriefResult(parsed) : null;
  if (!validated) {
    logger.warn('Brief returned unparseable output, falling back', {
      preview: stdout.slice(0, 200),
    });
    return fallbackReady(transcript);
  }

  if (round >= maxRounds && validated.status !== 'ready') {
    logger.info('Brief hit max rounds, forcing ready fallback');
    return fallbackReady(transcript);
  }

  return validated;
}
