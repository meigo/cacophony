import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../src/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('writes JSON log lines to stderr', () => {
    const logger = new Logger();
    logger.info('test message');

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('test message');
    expect(parsed.ts).toBeDefined();
  });

  it('includes context in log output', () => {
    const logger = new Logger({ component: 'test' });
    logger.info('hello', { extra: 'data' });

    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.component).toBe('test');
    expect(parsed.extra).toBe('data');
  });

  it('child inherits parent context', () => {
    const parent = new Logger({ parent: true });
    const child = parent.child({ child: true });
    child.info('from child');

    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.parent).toBe(true);
    expect(parsed.child).toBe(true);
  });

  it('child overrides parent context on conflict', () => {
    const parent = new Logger({ key: 'parent' });
    const child = parent.child({ key: 'child' });
    child.info('override');

    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.key).toBe('child');
  });

  it('logs all levels', () => {
    const logger = new Logger();

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    const levels = stderrSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(call[0] as string).level;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    expect(levels).toContain('debug');
    expect(levels).toContain('info');
    expect(levels).toContain('warn');
    expect(levels).toContain('error');
  });
});
