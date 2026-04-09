import chalk from 'chalk';
import type { RunEntry, RetryEntry } from './types.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_COLORS: Record<LogLevel, (s: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
};

export class Logger {
  private context: Record<string, unknown>;
  private isTTY: boolean;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
    this.isTTY = process.stderr.isTTY ?? false;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra });
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.log('debug', msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.log('info', msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.log('warn', msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.log('error', msg, ctx);
  }

  statusLine(running: RunEntry[], retrying: RetryEntry[]): void {
    if (!this.isTTY) return;

    const runIds = running.map((r) => r.issueIdentifier).join(', ');
    const retryIds = retrying.map((r) => r.identifier).join(', ');

    const parts: string[] = [
      chalk.green(`${running.length} running`),
      chalk.yellow(`${retrying.length} retrying`),
    ];

    if (runIds) parts.push(chalk.dim(`[${runIds}]`));
    if (retryIds) parts.push(chalk.dim(`retry: [${retryIds}]`));

    process.stderr.write(`\r\x1b[K${chalk.bold('cacophony')} ${parts.join(' | ')}`);
  }

  clearStatus(): void {
    if (!this.isTTY) return;
    process.stderr.write('\r\x1b[K');
  }

  private log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    const merged = { ...this.context, ...extra };
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...merged,
    };

    // Always emit JSON line
    process.stderr.write(JSON.stringify(entry) + '\n');

    // Pretty print for TTY
    if (this.isTTY) {
      const color = LEVEL_COLORS[level];
      const prefix = color(`[${level.toUpperCase().padEnd(5)}]`);
      const ctxStr = Object.keys(merged).length ? chalk.dim(` ${JSON.stringify(merged)}`) : '';
      process.stderr.write(`${prefix} ${msg}${ctxStr}\n`);
    }
  }
}
