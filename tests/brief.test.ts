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

  it('accepts a well-formed clarify result and caps at 3 questions', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: ['one', 'two', 'three', 'four', 'five'],
    }) as Exclude<BriefResult, { status: 'ready' }>;
    expect(r.status).toBe('clarify');
    expect(r.questions).toHaveLength(3);
    expect(r.questions).toEqual(['one', 'two', 'three']);
  });

  it('drops empty-string questions from clarify', () => {
    const r = validateBriefResult({
      status: 'clarify',
      questions: ['real', '', '  '],
    });
    expect(r).toEqual({ status: 'clarify', questions: ['real'] });
  });

  it('rejects clarify with zero valid questions', () => {
    expect(validateBriefResult({ status: 'clarify', questions: ['', '  '] })).toBeNull();
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

  it('returns clarify questions when the agent asks for them', async () => {
    writeFakeAgent(`echo '{"status":"clarify","questions":["which module?","sync or async?"]}'`);
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
      expect(result.questions).toEqual(['which module?', 'sync or async?']);
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
