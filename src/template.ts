import { Liquid } from 'liquidjs';
import type { Issue, WorkflowConfig } from './types.js';

const liquid = new Liquid({ strictVariables: false, strictFilters: true });

/** Variables available in the user's workflow prompt template (`promptTemplate`). */
export interface PromptContext {
  issue: Omit<Issue, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
  attempt: number | null;
  last_error: string | null;
  last_hook_output: string | null;
  config: WorkflowConfig;
  project_root: string;
  tasks_dir: string | undefined;
}

/** Variables available in the `agent.command` template. */
export interface CommandContext {
  prompt_file: string;
  workspace: string;
  identifier: string;
  attempt: number;
}

/** Variables available in the internal brief-intake template. */
export interface BriefContext {
  user_prompt: string;
  prior_turns: string;
  round: number;
  max_rounds: number;
}

export function renderPrompt(template: string, ctx: PromptContext): string {
  return liquid.parseAndRenderSync(template, ctx as unknown as Record<string, unknown>) as string;
}

export function renderCommand(template: string, ctx: CommandContext): string {
  return liquid.parseAndRenderSync(template, ctx as unknown as Record<string, unknown>) as string;
}

export function renderBrief(template: string, ctx: BriefContext): string {
  return liquid.parseAndRenderSync(template, ctx as unknown as Record<string, unknown>) as string;
}
