import type { TrackerAdapter, TrackerConfig, Issue } from '../types.js';

const DEFAULT_ENDPOINT = 'https://api.linear.app/graphql';

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  state: { name: string };
  branchName: string | null;
  url: string;
  labels: { nodes: Array<{ name: string }> };
  relations: {
    nodes: Array<{
      type: string;
      relatedIssue: { id: string; identifier: string; state: { name: string } };
    }>;
  };
  createdAt: string;
  updatedAt: string;
}

export class LinearTracker implements TrackerAdapter {
  kind = 'linear';
  private endpoint: string;
  private apiKey: string;
  private projectSlug: string;
  private activeStates: string[];
  private terminalStates: string[];

  constructor(config: TrackerConfig) {
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.apiKey = config.apiKey ?? '';
    this.projectSlug = config.projectSlug ?? '';
    this.activeStates = config.activeStates ?? ['todo', 'in progress'];
    this.terminalStates = config.terminalStates ?? [
      'closed',
      'cancelled',
      'canceled',
      'duplicate',
      'done',
    ];

    if (!this.apiKey) throw new Error('tracker.api_key is required for Linear');
    if (!this.projectSlug) throw new Error('tracker.project_slug is required for Linear');
  }

  async fetchCandidates(): Promise<Issue[]> {
    const query = `
      query($projectSlug: String!, $states: [String!]!) {
        issues(
          filter: {
            project: { slugId: { eq: $projectSlug } }
            state: { name: { in: $states } }
          }
          first: 100
          orderBy: createdAt
        ) {
          nodes {
            id identifier title description priority
            state { name }
            branchName url
            labels { nodes { name } }
            relations {
              nodes {
                type
                relatedIssue { id identifier state { name } }
              }
            }
            createdAt updatedAt
          }
        }
      }
    `;

    // Linear state names are case-sensitive in the API, pass original-case active states
    const data = await this.graphql<{
      issues: { nodes: LinearIssue[] };
    }>(query, {
      projectSlug: this.projectSlug,
      states: this.activeStates,
    });

    return data.issues.nodes.map((li) => this.normalize(li));
  }

  async fetchIssueStatesByIds(
    ids: string[],
  ): Promise<Pick<Issue, 'id' | 'identifier' | 'state'>[]> {
    const query = `
      query($ids: [ID!]!) {
        issues(filter: { id: { in: $ids } }) {
          nodes {
            id identifier
            state { name }
          }
        }
      }
    `;

    const data = await this.graphql<{
      issues: { nodes: Array<{ id: string; identifier: string; state: { name: string } }> };
    }>(query, { ids });

    return data.issues.nodes.map((n) => ({
      id: n.id,
      identifier: n.identifier,
      state: n.state.name.toLowerCase(),
    }));
  }

  async fetchTerminalIssues(): Promise<Issue[]> {
    const query = `
      query($projectSlug: String!, $states: [String!]!) {
        issues(
          filter: {
            project: { slugId: { eq: $projectSlug } }
            state: { name: { in: $states } }
          }
          first: 200
        ) {
          nodes {
            id identifier title description priority
            state { name }
            branchName url
            labels { nodes { name } }
            relations {
              nodes {
                type
                relatedIssue { id identifier state { name } }
              }
            }
            createdAt updatedAt
          }
        }
      }
    `;

    const data = await this.graphql<{
      issues: { nodes: LinearIssue[] };
    }>(query, {
      projectSlug: this.projectSlug,
      states: this.terminalStates,
    });

    return data.issues.nodes.map((li) => this.normalize(li));
  }

  private normalize(li: LinearIssue): Issue {
    const blockedBy = li.relations.nodes
      .filter((r) => r.type === 'blocks')
      .map((r) => ({
        id: r.relatedIssue.id,
        identifier: r.relatedIssue.identifier,
        state: r.relatedIssue.state.name.toLowerCase(),
      }));

    return {
      id: li.id,
      identifier: li.identifier,
      title: li.title,
      description: li.description,
      priority: li.priority,
      state: li.state.name.toLowerCase(),
      branchName: li.branchName,
      url: li.url,
      labels: li.labels.nodes.map((l) => l.name.toLowerCase()),
      blockedBy,
      createdAt: new Date(li.createdAt),
      updatedAt: new Date(li.updatedAt),
    };
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      throw new Error(`Linear GraphQL errors: ${json.errors.map((e) => e.message).join(', ')}`);
    }

    if (!json.data) {
      throw new Error('Linear API returned no data');
    }

    return json.data;
  }
}
