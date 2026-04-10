import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { dashboardHtml } from '../src/dashboard.js';

describe('dashboard', () => {
  it('renders HTML containing the Alpine app() function', () => {
    const html = dashboardHtml();
    expect(html).toContain('function app()');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('inline script parses as valid JavaScript', () => {
    // The dashboard HTML is built inside a template literal in dashboard.ts.
    // It's easy to accidentally interpolate an escape sequence (e.g. '\n')
    // into a literal newline character that breaks the embedded JS at runtime.
    // This test catches that class of bug at compile time.
    const html = dashboardHtml();
    const match = html.match(/<script>\s*\n([\s\S]*?)\n<\/script>/);
    expect(match).not.toBeNull();
    const script = match![1];
    // Wrap in a no-op so we don't actually call app(); we just want a parse check.
    expect(() => new vm.Script(script + '\nvoid app;')).not.toThrow();
  });

  it('app() initializes to a plain object with the expected top-level fields', () => {
    const html = dashboardHtml();
    const match = html.match(/<script>\s*\n([\s\S]*?)\n<\/script>/);
    const script = match![1];
    const sandbox: { app?: () => Record<string, unknown> } = {};
    vm.createContext(sandbox);
    new vm.Script(script).runInContext(sandbox);
    expect(typeof sandbox.app).toBe('function');
    const state = sandbox.app!();
    expect(state).toMatchObject({
      tasks: [],
      runs: [],
      running: [],
      retrying: [],
      filter: 'active',
      selected: null,
    });
  });
});
