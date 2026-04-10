import path from 'node:path';
import type { TrackerAdapter, TrackerConfig } from '../types.js';

export async function createTracker(config: TrackerConfig): Promise<TrackerAdapter> {
  switch (config.kind) {
    case 'github': {
      const { GitHubTracker } = await import('./github.js');
      return new GitHubTracker(config);
    }
    case 'linear': {
      const { LinearTracker } = await import('./linear.js');
      return new LinearTracker(config);
    }
    case 'files': {
      const { FilesTracker } = await import('./files.js');
      return new FilesTracker(config);
    }
    default: {
      // Treat as file path to custom tracker plugin
      const resolved = path.resolve(config.kind);
      try {
        const mod = await import(resolved);
        if (typeof mod.default !== 'function') {
          throw new Error(`Custom tracker at ${resolved} must export a default factory function`);
        }
        const tracker = mod.default(config) as TrackerAdapter;
        if (!tracker.fetchCandidates || !tracker.fetchIssueStatesByIds) {
          throw new Error(
            `Custom tracker must implement fetchCandidates() and fetchIssueStatesByIds()`,
          );
        }
        return tracker;
      } catch (e) {
        throw new Error(`Failed to load custom tracker from ${resolved}: ${e}`);
      }
    }
  }
}
