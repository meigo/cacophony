import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Liquid } from 'liquidjs';
import type { AgentConfig } from './types.js';
import type { Logger } from './logger.js';
import { slugifyPrompt } from './slug.js';

const liquid = new Liquid({ strictVariables: false, strictFilters: true });

export type BriefMessage = { role: 'user' | 'assistant'; content: string };

export type BriefReady = { status: 'ready'; title: string; prompt: string };
export type BriefClarify = { status: 'clarify'; questions: string[] };
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
{"status":"ready","title":"<short human title, max 60 chars>","prompt":"<refined prompt with explicit scope, constraints, acceptance criteria>"}

- If NO, ask up to 3 short, focused clarifying questions as ONLY this JSON:
{"status":"clarify","questions":["<q1>","<q2>","<q3>"]}

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
  return liquid.parseAndRenderSync(BRIEF_TEMPLATE, {
    user_prompt: firstUser,
    prior_turns: priorTurns,
    round,
    max_rounds: maxRounds,
  }) as string;
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
    return {
      status: 'ready',
      title: obj.title.slice(0, 80).trim() || 'task',
      prompt: obj.prompt.trim(),
    };
  }
  if (obj.status === 'clarify' && Array.isArray(obj.questions)) {
    const questions = (obj.questions as unknown[])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, 3);
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

  const renderedCommand = liquid.parseAndRenderSync(agent.command, {
    prompt_file: promptFile,
    workspace: briefDir,
    identifier: 'brief',
    attempt: 0,
  }) as string;

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
