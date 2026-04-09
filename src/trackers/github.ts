import { execFileSync } from 'node:child_process';
import type { TrackerAdapter, TrackerConfig, Issue } from '../types.js';

interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  url: string;
  assignees: Array<{ login: string }>;
}

function execGh(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export class GitHubTracker implements TrackerAdapter {
  kind = 'github';
  private repo: string;
  private activeLabels: string[];
  private terminalLabels: string[];

  constructor(config: TrackerConfig) {
    if (!config.repo) throw new Error('tracker.repo is required for GitHub tracker');
    this.repo = config.repo;
    this.activeLabels = config.activeLabels ?? ['todo', 'in-progress'];
    this.terminalLabels = config.terminalLabels ?? ['done', 'wontfix', 'closed'];
  }

  async fetchCandidates(): Promise<Issue[]> {
    const seen = new Set<number>();
    const issues: Issue[] = [];

    for (const label of this.activeLabels) {
      try {
        const raw = execGh([
          'issue',
          'list',
          '--repo',
          this.repo,
          '--state',
          'open',
          '--label',
          label,
          '--json',
          'number,title,body,state,labels,createdAt,updatedAt,url,assignees',
          '--limit',
          '100',
        ]);
        const ghIssues: GhIssue[] = JSON.parse(raw);

        for (const gi of ghIssues) {
          if (seen.has(gi.number)) continue;
          seen.add(gi.number);

          const labels = gi.labels.map((l) => l.name.toLowerCase());
          // Skip if it has any terminal label
          if (labels.some((l) => this.terminalLabels.includes(l))) continue;

          // State = first matching active label
          const state = labels.find((l) => this.activeLabels.includes(l)) ?? 'open';

          issues.push({
            id: String(gi.number),
            identifier: `GH-${gi.number}`,
            title: gi.title,
            description: gi.body || null,
            priority: null,
            state,
            branchName: null,
            url: gi.url,
            labels,
            blockedBy: [],
            createdAt: new Date(gi.createdAt),
            updatedAt: new Date(gi.updatedAt),
          });
        }
      } catch (e) {
        throw new Error(`Failed to fetch GitHub issues with label "${label}": ${e}`);
      }
    }

    // Sort: createdAt ascending
    issues.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return issues;
  }

  async fetchIssueStatesByIds(
    ids: string[],
  ): Promise<Pick<Issue, 'id' | 'identifier' | 'state'>[]> {
    const results: Pick<Issue, 'id' | 'identifier' | 'state'>[] = [];

    for (const id of ids) {
      try {
        const raw = execGh([
          'issue',
          'view',
          id,
          '--repo',
          this.repo,
          '--json',
          'number,state,labels',
        ]);
        const gi = JSON.parse(raw) as {
          number: number;
          state: string;
          labels: Array<{ name: string }>;
        };

        const labels = gi.labels.map((l) => l.name.toLowerCase());

        let state: string;
        if (gi.state === 'CLOSED' || labels.some((l) => this.terminalLabels.includes(l))) {
          state = labels.find((l) => this.terminalLabels.includes(l)) ?? 'closed';
        } else {
          state = labels.find((l) => this.activeLabels.includes(l)) ?? 'open';
        }

        results.push({
          id: String(gi.number),
          identifier: `GH-${gi.number}`,
          state,
        });
      } catch {
        // Issue not found or API error — treat as terminal
        results.push({ id, identifier: `GH-${id}`, state: 'closed' });
      }
    }

    return results;
  }

  async fetchTerminalIssues(): Promise<Issue[]> {
    try {
      const raw = execGh([
        'issue',
        'list',
        '--repo',
        this.repo,
        '--state',
        'closed',
        '--json',
        'number,title,body,state,labels,createdAt,updatedAt,url,assignees',
        '--limit',
        '200',
      ]);
      const ghIssues: GhIssue[] = JSON.parse(raw);
      return ghIssues.map((gi) => ({
        id: String(gi.number),
        identifier: `GH-${gi.number}`,
        title: gi.title,
        description: gi.body || null,
        priority: null,
        state: 'closed',
        branchName: null,
        url: gi.url,
        labels: gi.labels.map((l) => l.name.toLowerCase()),
        blockedBy: [],
        createdAt: new Date(gi.createdAt),
        updatedAt: new Date(gi.updatedAt),
      }));
    } catch {
      return [];
    }
  }
}
