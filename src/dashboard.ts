import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(here, 'dashboard');

/**
 * The dashboard is three real files under `src/dashboard/`: index.html,
 * styles.css, app.js. We read them once at module load and splice in the
 * CSS and JS at two well-known markers. Keeping the UI as authored files
 * rather than a single 1500-line template literal means editors type-check
 * and syntax-highlight each piece, and the JS is no longer subject to
 * template-literal escape gotchas.
 *
 * For this to work after `tsc` build, the dashboard assets must be copied
 * into dist/dashboard/ — see the postbuild step in package.json.
 */
const html = fs.readFileSync(path.join(assetsDir, 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(assetsDir, 'styles.css'), 'utf-8');
const js = fs.readFileSync(path.join(assetsDir, 'app.js'), 'utf-8');

const composed = html
  .replace('<!-- __STYLES__ -->', css)
  .replace('<!-- __APP_SCRIPT__ -->', js);

export function dashboardHtml(): string {
  return composed;
}
