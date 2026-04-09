import { execFileSync } from 'node:child_process';
import type { TrackerAdapter, TrackerConfig, Issue, BlockerRef } from '../types.js';

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

export function parseBlockedByNumbers(body: string | null): number[] {
  if (!body) return [];
  const matches = body.matchAll(/blocked\s+by\s+#(\d+)/gi);
  const numbers = new Set<number>();
  for (const m of matches) {
    numbers.add(parseInt(m[1], 10));
  }
  return Array.from(numbers);
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

    // Resolve blocker references
    await this.resolveBlockers(issues);

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

  private async resolveBlockers(issues: Issue[]): Promise<void> {
    // Collect all unique blocker numbers across all issues
    const allBlockerNumbers = new Set<number>();
    const issueBlockerMap = new Map<string, number[]>();

    for (const issue of issues) {
      const numbers = parseBlockedByNumbers(issue.description);
      // Filter out self-references
      const selfNumber = parseInt(issue.id, 10);
      const filtered = numbers.filter((n) => n !== selfNumber);
      if (filtered.length > 0) {
        issueBlockerMap.set(issue.id, filtered);
        for (const n of filtered) allBlockerNumbers.add(n);
      }
    }

    if (allBlockerNumbers.size === 0) return;

    // Build state map: first check issues we already have
    const stateMap = new Map<number, BlockerRef>();
    for (const issue of issues) {
      const num = parseInt(issue.id, 10);
      stateMap.set(num, { id: issue.id, identifier: issue.identifier, state: issue.state });
    }

    // Fetch states for blockers we don't already have
    const unknownNumbers = Array.from(allBlockerNumbers).filter((n) => !stateMap.has(n));
    if (unknownNumbers.length > 0) {
      const states = await this.fetchIssueStatesByIds(unknownNumbers.map(String));
      for (const s of states) {
        stateMap.set(parseInt(s.id, 10), { id: s.id, identifier: s.identifier, state: s.state });
      }
    }

    // Attach blockers to issues
    for (const issue of issues) {
      const numbers = issueBlockerMap.get(issue.id);
      if (!numbers) continue;
      issue.blockedBy = numbers
        .map((n) => stateMap.get(n))
        .filter((b): b is BlockerRef => b !== undefined);
    }
  }
}
