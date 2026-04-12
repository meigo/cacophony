import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runBrief, extractBriefJson, validateBriefResult, type BriefResult } from '../src/brief.js';
import type { AgentConfig } from '../src/types.js';
import { Logger } from '../src/logger.js';
import { tmpDir, cleanup } from './helpers.js';

const baseAgent: AgentConfig = {
  command: '',
  promptDelivery: 'file',
  timeoutMs: 10_000,
  maxConcurrent: 1,
  maxTurns: 10,
  maxRetryBackoffMs: 60_000,
};

describe('extractBriefJson', () => {
  it('parses a raw JSON object', () => {
    const out = '{"status":"ready","title":"hi","prompt":"do a thing"}';
    expect(extractBriefJson(out)).toEqual({
      status: 'ready',
      title: 'hi',
      prompt: 'do a thing',
    });
  });

  it('parses JSON wrapped in extra prose', () => {
    const out =
      'Sure, here is my response:\n{"status":"clarify","questions":["A?"]}\nHope that helps.';
    expect(extractBriefJson(out)).toEqual({
      status: 'clarify',
      questions: ['A?'],
    });
  });

  it('parses JSON inside ```json fences', () => {
    const out = '```json\n{"status":"ready","title":"t","prompt":"p"}\n```';
    expect(extractBriefJson(out)).toEqual({ status: 'ready', title: 't', prompt: 'p' });
  });

  it('parses Claude stream-json assistant text events', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '{"status":"ready","title":"x","prompt":"y"}' }],
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ];
    expect(extractBriefJson(lines.join('\n'))).toEqual({
      status: 'ready',
      title: 'x',
      prompt: 'y',
    });
  });

  it('returns null for garbage output', () => {
    expect(extractBriefJson('no json here, sorry')).toBeNull();
  });

  it('returns null for empty output', () => {
    expect(extractBriefJson('')).toBeNull();
  });
});

describe('validateBriefResult', () => {
  it('accepts a well-formed ready result', () => {
    expect(validateBriefResult({ status: 'ready', title: 'title', prompt: 'prompt' })).toEqual({
      status: 'ready',
      title: 'title',
      prompt: 'prompt',
    });
  });

  it('accepts a ready result with detected frameworks', () => {
    const r = validateBriefResult({
      status: 'ready',
      title: 'Tetris',
      prompt: 'Build Tetris in Defold',
      frameworks: ['Defold', 'Lua'],
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r.frameworks).toEqual(['defold', 'lua']);
  });

  it('omits frameworks field when empty or absent', () => {
    const r1 = validateBriefResult({
      status: 'ready',
      title: 't',
      prompt: 'p',
      frameworks: [],
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r1.frameworks).toBeUndefined();

    const r2 = validateBriefResult({
      status: 'ready',
      title: 't',
      prompt: 'p',
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r2.frameworks).toBeUndefined();
  });

  it('accepts suggestedHooks with after_run command', () => {
    const r = validateBriefResult({
      status: 'ready',
      title: 'SvelteKit app',
      prompt: 'Build a todo app',
      frameworks: ['sveltekit'],
      suggestedHooks: { after_run: 'npx svelte-check && npx vitest run' },
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r.suggestedHooks).toEqual({ after_run: 'npx svelte-check && npx vitest run' });
  });

  it('omits suggestedHooks when absent or empty', () => {
    const r = validateBriefResult({
      status: 'ready',
      title: 't',
      prompt: 'p',
      suggestedHooks: { after_run: '' },
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r.suggestedHooks).toBeUndefined();
  });

  it('filters out invalid framework entries', () => {
    const r = validateBriefResult({
      status: 'ready',
      title: 't',
      prompt: 'p',
      frameworks: ['defold', '', 42, null, 'godot'],
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r.frameworks).toEqual(['defold', 'godot']);
  });

  it('accepts a well-formed structured clarify result and caps at 3 questions', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: [
        { question: 'one', options: ['a', 'b'] },
        { question: 'two', options: ['c', 'd'] },
        { question: 'three', options: [] },
        { question: 'four', options: ['e'] },
        { question: 'five', options: [] },
      ],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.status).toBe('clarify');
    expect(r.questions).toHaveLength(3);
    expect(r.questions).toEqual([
      { question: 'one', options: ['a', 'b'] },
      { question: 'two', options: ['c', 'd'] },
      { question: 'three', options: [] },
    ]);
  });

  it('caps options per question at 4', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: [{ question: 'q', options: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.questions[0].options).toHaveLength(4);
    expect(r.questions[0].options).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops empty-string options', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: [{ question: 'q', options: ['real', '', '  ', 'also-real'] }],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.questions[0].options).toEqual(['real', 'also-real']);
  });

  it('upgrades legacy plain-string questions to empty-options structured form', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: ['legacy', 'also legacy'],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.questions).toEqual([
      { question: 'legacy', options: [] },
      { question: 'also legacy', options: [] },
    ]);
  });

  it('accepts mixed legacy-string and structured questions', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: ['plain string q', { question: 'structured q', options: ['x', 'y'] }],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toEqual({ question: 'plain string q', options: [] });
    expect(r.questions[1]).toEqual({ question: 'structured q', options: ['x', 'y'] });
  });

  it('drops questions with missing or empty question text', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: [
        '',
        '  ',
        { options: ['x'] }, // missing question
        { question: '', options: ['x'] },
        { question: 'real', options: ['x'] },
      ],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.questions).toEqual([{ question: 'real', options: ['x'] }]);
  });

  it('rejects clarify with zero valid questions', () => {
    expect(validateBriefResult({ status: 'clarify', questions: ['', '  '] })).toBeNull();
    expect(validateBriefResult({ status: 'clarify', questions: [] })).toBeNull();
  });

  it('defaults options to empty array if missing or non-array', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: [
        { question: 'no options field' },
        { question: 'null options', options: null },
        { question: 'string options', options: 'nope' },
      ],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.questions).toHaveLength(3);
    expect(r.questions.every((q) => Array.isArray(q.options) && q.options.length === 0)).toBe(true);
  });

  it('rejects unknown status', () => {
    expect(validateBriefResult({ status: 'huh', title: 't', prompt: 'p' })).toBeNull();
  });

  it('rejects ready missing title or prompt', () => {
    expect(validateBriefResult({ status: 'ready', title: 't' })).toBeNull();
    expect(validateBriefResult({ status: 'ready', prompt: 'p' })).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(validateBriefResult(null)).toBeNull();
    expect(validateBriefResult('string')).toBeNull();
    expect(validateBriefResult(42)).toBeNull();
  });

  it('caps title at 80 chars', () => {
    const long = 'x'.repeat(200);
    const r = validateBriefResult({
      status: 'ready',
      title: long,
      prompt: 'p',
    }) as Extract<BriefResult, { status: 'ready' }>;
    expect(r.title.length).toBeLessThanOrEqual(80);
  });
});

describe('runBrief (with fake agent)', () => {
  let dir: string;
  let fakeAgent: string;
  const logger = new Logger();

  beforeEach(() => {
    dir = tmpDir();
    // Create a `.cacophony` directory so brief has a place to work
    fs.mkdirSync(path.join(dir, '.cacophony'), { recursive: true });
    fakeAgent = path.join(dir, 'fake-agent.sh');
  });

  afterEach(() => {
    cleanup(dir);
  });

  function writeFakeAgent(body: string): void {
    fs.writeFileSync(fakeAgent, `#!/bin/bash\n${body}\n`, 'utf-8');
    fs.chmodSync(fakeAgent, 0o755);
  }

  it('returns parsed result when the agent outputs valid ready JSON', async () => {
    writeFakeAgent(`echo '{"status":"ready","title":"refined","prompt":"do the real thing"}'`);
    const result = await runBrief({
      transcript: [{ role: 'user', content: 'do a thing' }],
      round: 1,
      maxRounds: 2,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 5000,
      logger,
    });
    expect(result).toEqual({
      status: 'ready',
      title: 'refined',
      prompt: 'do the real thing',
    });
  });

  it('returns structured clarify questions when the agent asks for them', async () => {
    writeFakeAgent(
      `echo '{"status":"clarify","questions":[{"question":"which module?","options":["auth","billing","api"]},{"question":"sync or async?","options":["sync","async"]}]}'`,
    );
    const result = await runBrief({
      transcript: [{ role: 'user', content: 'fix the bug' }],
      round: 1,
      maxRounds: 3,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 5000,
      logger,
    });
    expect(result.status).toBe('clarify');
    if (result.status === 'clarify') {
      expect(result.questions).toEqual([
        { question: 'which module?', options: ['auth', 'billing', 'api'] },
        { question: 'sync or async?', options: ['sync', 'async'] },
      ]);
    }
  });

  it('upgrades legacy plain-string questions from an older agent gracefully', async () => {
    writeFakeAgent(`echo '{"status":"clarify","questions":["legacy q1","legacy q2"]}'`);
    const result = await runBrief({
      transcript: [{ role: 'user', content: 'fix something' }],
      round: 1,
      maxRounds: 3,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 5000,
      logger,
    });
    expect(result.status).toBe('clarify');
    if (result.status === 'clarify') {
      expect(result.questions).toEqual([
        { question: 'legacy q1', options: [] },
        { question: 'legacy q2', options: [] },
      ]);
    }
  });

  it('falls back to ready(raw prompt) when the agent outputs garbage', async () => {
    writeFakeAgent(`echo 'here is some garbage output, sorry'`);
    const result = await runBrief({
      transcript: [{ role: 'user', content: 'original user prompt' }],
      round: 1,
      maxRounds: 2,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 5000,
      logger,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.prompt).toBe('original user prompt');
    }
  });

  it('falls back to ready when the agent times out', async () => {
    writeFakeAgent(`sleep 5`);
    const result = await runBrief({
      transcript: [{ role: 'user', content: 'slow thing' }],
      round: 1,
      maxRounds: 2,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 500,
      logger,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.prompt).toBe('slow thing');
    }
  }, 10_000);

  it('forces ready on final round even if the agent returns clarify', async () => {
    writeFakeAgent(`echo '{"status":"clarify","questions":["still need info"]}'`);
    const result = await runBrief({
      transcript: [
        { role: 'user', content: 'the task' },
        { role: 'assistant', content: 'prior clarify' },
        { role: 'user', content: 'some answers' },
      ],
      round: 2,
      maxRounds: 2,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 5000,
      logger,
    });
    expect(result.status).toBe('ready');
  });

  it('cleans up the scratch session directory after running', async () => {
    writeFakeAgent(`echo '{"status":"ready","title":"t","prompt":"p"}'`);
    await runBrief({
      transcript: [{ role: 'user', content: 'go' }],
      round: 1,
      maxRounds: 2,
      agent: { ...baseAgent, command: fakeAgent },
      projectRoot: dir,
      timeoutMs: 5000,
      logger,
    });
    const briefRoot = path.join(dir, '.cacophony', 'brief');
    const leftovers = fs.existsSync(briefRoot) ? fs.readdirSync(briefRoot) : [];
    expect(leftovers).toHaveLength(0);
  });
});
