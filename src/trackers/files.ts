import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TrackerAdapter, LocalTaskStore, TrackerConfig, Issue } from '../types.js';
import { ISSUE_STATES } from '../types.js';

interface TaskFrontMatter {
  state?: string;
  priority?: number;
  labels?: string[];
  branch?: string;
  blocked_by?: string[];
  parent?: string;
}

function parseTaskFile(filePath: string, identifier: string): Issue | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let frontMatter: TaskFrontMatter = {};
  let description: string;

  if (raw.startsWith('---')) {
    const endIdx = raw.indexOf('---', 3);
    if (endIdx !== -1) {
      try {
        frontMatter = (parseYaml(raw.slice(3, endIdx)) as TaskFrontMatter) ?? {};
      } catch {
        frontMatter = {};
      }
      description = raw.slice(endIdx + 3).trim();
    } else {
      description = raw.trim();
    }
  } else {
    description = raw.trim();
  }

  // Extract title from first heading or first line
  const titleMatch = description.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : description.split('\n')[0].trim();

  const stat = fs.statSync(filePath);

  return {
    id: identifier,
    identifier,
    title,
    description,
    priority: frontMatter.priority ?? null,
    state: (frontMatter.state ?? ISSUE_STATES.TODO).toLowerCase(),
    branchName: frontMatter.branch ?? null,
    url: null,
    labels: (frontMatter.labels ?? []).map((l) => l.toLowerCase()),
    blockedBy: [],
    parent: frontMatter.parent ?? null,
    createdAt: stat.birthtime,
    updatedAt: stat.mtime,
  };
}

export class FilesTracker implements TrackerAdapter, LocalTaskStore {
  kind = 'files';
  private dir: string;
  private activeStates: string[];
  private terminalStates: string[];

  constructor(config: TrackerConfig) {
    this.dir = path.resolve(config.dir ?? '.cacophony/tasks');
    this.activeStates = config.activeStates ?? [ISSUE_STATES.TODO, ISSUE_STATES.IN_PROGRESS];
    this.terminalStates = config.terminalStates ?? [
      ISSUE_STATES.DONE,
      ISSUE_STATES.CANCELLED,
      ISSUE_STATES.WONTFIX,
    ];

    // Create tasks dir if it doesn't exist
    fs.mkdirSync(this.dir, { recursive: true });
  }

  getDir(): string {
    return this.dir;
  }

  getTasksDir(): string {
    return this.dir;
  }

  async fetchCandidates(): Promise<Issue[]> {
    const files = this.listTaskFiles();
    const allIssues = new Map<string, Issue>();

    // First pass: parse all files
    for (const file of files) {
      const identifier = this.fileToIdentifier(file);
      const issue = parseTaskFile(path.join(this.dir, file), identifier);
      if (issue) allIssues.set(identifier, issue);
    }

    // Second pass: resolve blocked_by references
    for (const file of files) {
      const identifier = this.fileToIdentifier(file);
      const issue = allIssues.get(identifier);
      if (!issue) continue;

      const raw = fs.readFileSync(path.join(this.dir, file), 'utf-8');
      if (raw.startsWith('---')) {
        const endIdx = raw.indexOf('---', 3);
        if (endIdx !== -1) {
          try {
            const fm = (parseYaml(raw.slice(3, endIdx)) as TaskFrontMatter) ?? {};
            if (fm.blocked_by?.length) {
              issue.blockedBy = fm.blocked_by
                .filter((ref) => ref !== identifier) // no self-references
                .map((ref) => {
                  const blocker = allIssues.get(ref);
                  return {
                    id: ref,
                    identifier: ref,
                    state: blocker?.state ?? ISSUE_STATES.DELETED,
                  };
                });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }

    // Filter to active issues
    const issues: Issue[] = [];
    for (const issue of allIssues.values()) {
      if (this.activeStates.includes(issue.state) && !this.terminalStates.includes(issue.state)) {
        issues.push(issue);
      }
    }

    // Sort by priority (ascending, null last), then creation date
    issues.sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return issues;
  }

  async fetchIssueStatesByIds(
    ids: string[],
  ): Promise<Pick<Issue, 'id' | 'identifier' | 'state'>[]> {
    const results: Pick<Issue, 'id' | 'identifier' | 'state'>[] = [];

    for (const id of ids) {
      const filePath = this.identifierToFile(id);
      if (!fs.existsSync(filePath)) {
        results.push({ id, identifier: id, state: ISSUE_STATES.DELETED });
        continue;
      }

      const issue = parseTaskFile(filePath, id);
      if (!issue) {
        results.push({ id, identifier: id, state: ISSUE_STATES.DELETED });
        continue;
      }

      results.push({ id: issue.id, identifier: issue.identifier, state: issue.state });
    }

    return results;
  }

  async fetchTerminalIssues(): Promise<Issue[]> {
    const files = this.listTaskFiles();
    const issues: Issue[] = [];

    for (const file of files) {
      const identifier = this.fileToIdentifier(file);
      const issue = parseTaskFile(path.join(this.dir, file), identifier);
      if (!issue) continue;

      if (this.terminalStates.includes(issue.state)) {
        issues.push(issue);
      }
    }

    return issues;
  }

  async setIssueState(issueId: string, state: string): Promise<void> {
    this.updateTaskState(issueId, state);
  }

  async deleteIssue(issueId: string): Promise<void> {
    this.deleteTask(issueId);
  }

  // --- File management (used by API) ---

  createTask(
    identifier: string,
    state: string,
    priority: number | null,
    content: string,
    parent: string | null = null,
  ): void {
    const fileName = `${identifier}.md`;
    const filePath = path.join(this.dir, fileName);

    const frontMatter: string[] = [];
    frontMatter.push(`state: ${state}`);
    if (priority != null) frontMatter.push(`priority: ${priority}`);
    if (parent) frontMatter.push(`parent: ${parent}`);

    const fileContent = `---\n${frontMatter.join('\n')}\n---\n\n${content}\n`;
    fs.writeFileSync(filePath, fileContent, 'utf-8');
  }

  updateTaskState(identifier: string, newState: string): boolean {
    const filePath = this.identifierToFile(identifier);
    if (!fs.existsSync(filePath)) return false;

    const raw = fs.readFileSync(filePath, 'utf-8');

    if (raw.startsWith('---')) {
      const endIdx = raw.indexOf('---', 3);
      if (endIdx !== -1) {
        const yamlStr = raw.slice(3, endIdx);
        const body = raw.slice(endIdx + 3);
        const updated = yamlStr.replace(/^state:\s*.+$/m, `state: ${newState}`);
        if (updated === yamlStr) {
          // No state field found — add it
          fs.writeFileSync(filePath, `---\nstate: ${newState}\n${yamlStr}---${body}`, 'utf-8');
        } else {
          fs.writeFileSync(filePath, `---${updated}---${body}`, 'utf-8');
        }
        return true;
      }
    }

    // No front matter — add it
    fs.writeFileSync(filePath, `---\nstate: ${newState}\n---\n\n${raw}`, 'utf-8');
    return true;
  }

  deleteTask(identifier: string): boolean {
    const filePath = this.identifierToFile(identifier);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  getTask(identifier: string): Issue | null {
    const filePath = this.identifierToFile(identifier);
    if (!fs.existsSync(filePath)) return null;
    return parseTaskFile(filePath, identifier);
  }

  getAllTasks(): Issue[] {
    const files = this.listTaskFiles();
    const issues: Issue[] = [];

    for (const file of files) {
      const identifier = this.fileToIdentifier(file);
      const issue = parseTaskFile(path.join(this.dir, file), identifier);
      if (issue) issues.push(issue);
    }

    return issues;
  }

  // --- Helpers ---

  private listTaskFiles(): string[] {
    try {
      return fs.readdirSync(this.dir).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }
  }

  private fileToIdentifier(fileName: string): string {
    return fileName.replace(/\.md$/, '');
  }

  private identifierToFile(identifier: string): string {
    return path.join(this.dir, `${identifier}.md`);
  }
}
