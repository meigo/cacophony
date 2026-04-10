import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { Issue } from '../src/types.js';

export function tmpDir(prefix = 'cacophony-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: '1',
    identifier: 'GH-1',
    title: 'Test issue',
    description: 'Test description',
    priority: null,
    state: 'todo',
    branchName: null,
    url: 'https://github.com/test/repo/issues/1',
    labels: ['todo'],
    blockedBy: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Initialize a git repo in a temp directory with one commit on main.
 * Returns the absolute path to the repo.
 */
export function tmpGitRepo(prefix = 'cacophony-test-repo-'): string {
  const dir = tmpDir(prefix);
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test User']);
  run(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n', 'utf-8');
  run(['add', '.']);
  run(['commit', '-q', '-m', 'initial']);
  return dir;
}

export function fixturesDir(): string {
  return path.join(import.meta.dirname, 'fixtures');
}

export function fixturePath(name: string): string {
  return path.join(fixturesDir(), name);
}
