import { describe, it, expect } from 'vitest';
import { createTracker } from '../src/trackers/interface.js';
import type { TrackerConfig } from '../src/types.js';

describe('createTracker', () => {
  it('throws for nonexistent custom tracker path', async () => {
    const config: TrackerConfig = {
      kind: '/nonexistent/tracker.js',
    };
    await expect(createTracker(config)).rejects.toThrow('Failed to load custom tracker');
  });
});
