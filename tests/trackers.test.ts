import { describe, it, expect } from 'vitest';
import { createTracker } from '../src/trackers/interface.js';
import type { TrackerConfig } from '../src/types.js';

describe('createTracker', () => {
  it('creates a GitHub tracker for kind=github', async () => {
    const config: TrackerConfig = {
      kind: 'github',
      repo: 'test-org/test-repo',
      activeLabels: ['todo'],
      terminalLabels: ['done'],
    };
    const tracker = await createTracker(config);
    expect(tracker.kind).toBe('github');
  });

  it('creates a Linear tracker for kind=linear', async () => {
    const config: TrackerConfig = {
      kind: 'linear',
      apiKey: 'test-key',
      projectSlug: 'test-project',
      activeStates: ['todo'],
      terminalStates: ['done'],
    };
    const tracker = await createTracker(config);
    expect(tracker.kind).toBe('linear');
  });

  it('throws for nonexistent custom tracker path', async () => {
    const config: TrackerConfig = {
      kind: '/nonexistent/tracker.js',
    };
    await expect(createTracker(config)).rejects.toThrow('Failed to load custom tracker');
  });
});

describe('GitHubTracker', () => {
  // These tests mock execFileSync since they'd need `gh` installed and authenticated

  it('constructs with valid config', async () => {
    const config: TrackerConfig = {
      kind: 'github',
      repo: 'org/repo',
      activeLabels: ['todo', 'in-progress'],
      terminalLabels: ['done'],
    };
    const tracker = await createTracker(config);
    expect(tracker.kind).toBe('github');
  });

  it('throws without repo', async () => {
    const config: TrackerConfig = { kind: 'github' };
    await expect(createTracker(config)).rejects.toThrow('tracker.repo is required');
  });
});

describe('LinearTracker', () => {
  it('constructs with valid config', async () => {
    const config: TrackerConfig = {
      kind: 'linear',
      apiKey: 'lin_api_key',
      projectSlug: 'my-project',
    };
    const tracker = await createTracker(config);
    expect(tracker.kind).toBe('linear');
  });

  it('throws without api_key', async () => {
    const config: TrackerConfig = {
      kind: 'linear',
      projectSlug: 'my-project',
    };
    await expect(createTracker(config)).rejects.toThrow('api_key is required');
  });

  it('throws without project_slug', async () => {
    const config: TrackerConfig = {
      kind: 'linear',
      apiKey: 'key',
    };
    await expect(createTracker(config)).rejects.toThrow('project_slug is required');
  });
});
