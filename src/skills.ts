import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Logger } from './logger.js';

export interface SkillPack {
  id: string;
  name: string;
  repo: string;
  description: string;
  /** Directory name in the cloned repo that holds the skills (before rename). */
  sourceDir: string;
}

/**
 * Known community skill packs. Keyed by framework identifier (lowercase).
 * The brief agent returns these identifiers in its `frameworks` field;
 * cacophony maps them to a clone-able repo and install instructions.
 *
 * Add new entries here as community packs appear.
 */
export const SKILL_REGISTRY: Record<string, SkillPack> = {
  defold: {
    id: 'defold',
    name: 'Defold Agent Config',
    repo: 'indiesoftby/defold-agent-config',
    description:
      '13 skills for Defold game development: proto file editing, API docs, shader editing, project build, and more.',
    sourceDir: '.agents',
  },
};

export function lookupSkillPack(framework: string): SkillPack | undefined {
  return SKILL_REGISTRY[framework.toLowerCase()];
}

export function isSkillInstalled(projectRoot: string): boolean {
  const skillsDir = path.join(projectRoot, '.claude', 'skills');
  try {
    const entries = fs.readdirSync(skillsDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export interface InstallResult {
  installed: boolean;
  files: number;
  reason?: string;
}

/**
 * Clone a skill pack repo, rename its skill directory for Claude Code,
 * rewrite internal references, copy supporting files, and commit to git.
 */
export function installSkillPack(
  pack: SkillPack,
  projectRoot: string,
  logger: Logger,
): InstallResult {
  // Skip if skills already present
  if (isSkillInstalled(projectRoot)) {
    return { installed: false, files: 0, reason: 'skills already installed' };
  }

  // Clone into a temp directory
  const tmpDir = path.join(projectRoot, '.cacophony', 'tmp-skill-install');
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  fs.mkdirSync(tmpDir, { recursive: true });

  const repoUrl = `https://github.com/${pack.repo}.git`;
  try {
    execFileSync('git', ['clone', '--depth=1', repoUrl, tmpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  } catch (e) {
    logger.error('Failed to clone skill pack', { repo: pack.repo, error: String(e) });
    cleanup(tmpDir);
    return { installed: false, files: 0, reason: `clone failed: ${e}` };
  }

  logger.info('Cloned skill pack', { repo: pack.repo });

  let fileCount = 0;

  try {
    const srcSkills = path.join(tmpDir, pack.sourceDir, 'skills');
    const dstSkills = path.join(projectRoot, '.claude', 'skills');

    // Copy skills directory: <sourceDir>/skills/ → .claude/skills/
    if (fs.existsSync(srcSkills)) {
      fs.mkdirSync(dstSkills, { recursive: true });
      copyDirRecursive(srcSkills, dstSkills);
      // Rewrite internal references from sourceDir to .claude
      const srcRef = pack.sourceDir + '/';
      const dstRef = '.claude/';
      rewriteReferences(dstSkills, srcRef, dstRef);
      fileCount += countFiles(dstSkills);
    }

    // Copy AGENTS.md if it exists
    const agentsMd = path.join(tmpDir, 'AGENTS.md');
    if (fs.existsSync(agentsMd)) {
      const dst = path.join(projectRoot, 'AGENTS.md');
      fs.copyFileSync(agentsMd, dst);
      // Rewrite references in AGENTS.md too
      let content = fs.readFileSync(dst, 'utf-8');
      content = content.replaceAll(pack.sourceDir + '/', '.claude/');
      fs.writeFileSync(dst, content, 'utf-8');
      fileCount++;
    }

    // Copy supporting config files if they exist
    for (const name of ['.defignore', '.ignore']) {
      const src = path.join(tmpDir, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(projectRoot, name));
        fileCount++;
      }
    }

    // Create .claude/settings.json for Claude Code read permissions
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ permissions: { allow: ['Read(./.deps/**)'] } }, null, 2) + '\n',
        'utf-8',
      );
      fileCount++;
    }

    // Update .gitignore: add .deps/** and bob.jar if not already present
    const gitignorePath = path.join(projectRoot, '.gitignore');
    let gitignore = '';
    try {
      gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    } catch {
      // no .gitignore yet
    }
    let gitignoreChanged = false;
    if (!gitignore.includes('.deps')) {
      gitignore += '\n# Downloaded dependency sources for agent read-only context\n.deps/**\n';
      gitignoreChanged = true;
    }
    if (!gitignore.includes('bob.jar')) {
      gitignore += '/bob.jar\n';
      gitignoreChanged = true;
    }
    if (gitignoreChanged) {
      fs.writeFileSync(gitignorePath, gitignore, 'utf-8');
    }

    // Git add + commit
    try {
      execFileSync('git', ['add', '.claude/', 'AGENTS.md', '.defignore', '.ignore', '.gitignore'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      execFileSync('git', ['commit', '-m', `cacophony: install ${pack.name} skill pack`], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      logger.info('Committed skill pack', { pack: pack.name, files: fileCount });
    } catch (e) {
      logger.warn('Failed to commit skill pack (files are installed but not committed)', {
        error: String(e),
      });
    }
  } finally {
    cleanup(tmpDir);
  }

  return { installed: true, files: fileCount };
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function rewriteReferences(dir: string, from: string, to: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteReferences(fullPath, from, to);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.py')) {
      let content = fs.readFileSync(fullPath, 'utf-8');
      if (content.includes(from)) {
        content = content.replaceAll(from, to);
        fs.writeFileSync(fullPath, content, 'utf-8');
      }
    }
  }
}

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
