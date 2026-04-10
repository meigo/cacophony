import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { slugifyPrompt, uniqueIdentifier } from '../src/slug.js';
import { FilesTracker } from '../src/trackers/files.js';
import { tmpDir, cleanup } from './helpers.js';

describe('slugifyPrompt', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugifyPrompt('Fix Login Bug')).toBe('fix-login-bug');
  });

  it('takes only the first non-empty line', () => {
    const slug = slugifyPrompt('First line of intent\n\nMore detail on the next line');
    expect(slug).toBe('first-line-of-intent');
  });

  it('strips leading markdown heading markers', () => {
    expect(slugifyPrompt('# Important Task')).toBe('important-task');
    expect(slugifyPrompt('### Triple hash')).toBe('triple-hash');
  });

  it('skips leading blank lines before picking the first line', () => {
    expect(slugifyPrompt('\n\n   \n# Real title\nbody')).toBe('real-title');
  });

  it('caps slugs at 40 characters and trims trailing hyphens', () => {
    const long =
      'Create a single-page website about american band cacophony. astro v6, tailwind v4';
    const slug = slugifyPrompt(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(slugifyPrompt('foo!!!---bar  ___baz')).toBe('foo-bar-baz');
  });

  it('falls back to "task" for empty input', () => {
    expect(slugifyPrompt('')).toBe('task');
    expect(slugifyPrompt('   \n\t\n')).toBe('task');
  });

  it('falls back to "task" for input with no alphanumerics', () => {
    expect(slugifyPrompt('!!! ??? ...')).toBe('task');
  });

  it('handles unicode by stripping it', () => {
    // Non-ASCII becomes hyphens; surviving alphanumerics stay
    expect(slugifyPrompt('héllo wörld 你好')).toBe('h-llo-w-rld');
  });
});

describe('uniqueIdentifier', () => {
  let dir: string;
  let tracker: FilesTracker;

  beforeEach(() => {
    dir = tmpDir();
    tracker = new FilesTracker({ kind: 'files', dir: path.join(dir, 'tasks') });
  });

  afterEach(() => {
    cleanup(dir);
  });

  it('returns the base when no collision exists', () => {
    expect(uniqueIdentifier(tracker, 'fresh-task')).toBe('fresh-task');
  });

  it('appends -2, -3 ... on collision', () => {
    tracker.createTask('busy', 'todo', null, 'first');
    expect(uniqueIdentifier(tracker, 'busy')).toBe('busy-2');

    tracker.createTask('busy-2', 'todo', null, 'second');
    expect(uniqueIdentifier(tracker, 'busy')).toBe('busy-3');
  });

  it('handles multiple collisions in sequence', () => {
    tracker.createTask('multi', 'todo', null, '1');
    tracker.createTask('multi-2', 'todo', null, '2');
    tracker.createTask('multi-3', 'todo', null, '3');
    tracker.createTask('multi-4', 'todo', null, '4');
    expect(uniqueIdentifier(tracker, 'multi')).toBe('multi-5');
  });
});
