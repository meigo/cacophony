import type { LocalTaskStore } from './types.js';

/**
 * Turn a free-form user prompt into a short, filesystem/git-safe identifier.
 *
 * Takes the first non-empty line of the prompt, strips a leading markdown
 * heading marker, lowercases, replaces runs of non-alphanumeric characters
 * with a single hyphen, trims hyphens from the ends, caps at 40 characters,
 * and trims any trailing hyphen left over from the cap. Empty input or input
 * with no alphanumerics falls back to "task".
 */
export function slugifyPrompt(prompt: string): string {
  const firstLine = prompt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
    ?.replace(/^#+\s*/, '');
  const source = firstLine ?? 'task';
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'task';
}

/**
 * Given a base slug, return either the base itself (if not taken) or the
 * base with a numeric suffix (`-2`, `-3`, ...) until a free name is found.
 */
export function uniqueIdentifier(store: LocalTaskStore, base: string): string {
  if (!store.getTask(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!store.getTask(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
