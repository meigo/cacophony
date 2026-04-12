import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { dashboardHtml } from '../src/dashboard.js';

/**
 * Find the inline `<script>` block that contains `function app()`, skipping
 * any earlier inline scripts (e.g. the sync theme-init script in the head).
 * Returns the script body without the surrounding tags.
 */
function extractAppScript(html: string): string {
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1].includes('function app')) {
      return match[1];
    }
  }
  throw new Error('could not find inline script containing function app()');
}

describe('dashboard', () => {
  it('renders HTML containing the Alpine app() function', () => {
    const html = dashboardHtml();
    expect(html).toContain('function app()');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('sync theme-init script sets dataset.theme before Alpine loads', () => {
    // Head contains a synchronous <script> that reads localStorage and applies
    // the saved theme before Alpine defers. This prevents a flash of the
    // wrong theme on reload. Check both that the script exists and that it
    // runs before the deferred Alpine bundle in document order.
    const html = dashboardHtml();
    expect(html).toMatch(/document\.documentElement\.dataset\.theme/);
    expect(html).toMatch(/caco\.theme/);
    const themeIdx = html.indexOf('caco.theme');
    const alpineIdx = html.indexOf('alpinejs');
    expect(themeIdx).toBeGreaterThan(-1);
    expect(alpineIdx).toBeGreaterThan(-1);
    expect(themeIdx).toBeLessThan(alpineIdx);
  });

  it('inline app() script parses as valid JavaScript', () => {
    // The dashboard HTML is built inside a template literal in dashboard.ts.
    // It's easy to accidentally interpolate an escape sequence (e.g. '\n')
    // into a literal newline character that breaks the embedded JS at runtime.
    // This test catches that class of bug at compile time.
    const script = extractAppScript(dashboardHtml());
    expect(() => new vm.Script(script + '\nvoid app;')).not.toThrow();
  });

  it('app() initializes to a plain object with the expected top-level fields', () => {
    const script = extractAppScript(dashboardHtml());
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
      theme: 'dark',
    });
  });
});
