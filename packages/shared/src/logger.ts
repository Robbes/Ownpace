// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Levelled logging.
 *
 * The product had 422 raw `console.*` calls and no way to turn detail up or
 * down. For a tool whose run output is effectively the audit trail of someone
 * else's data move, that is a gap in both directions: an operator debugging a
 * stuck migration cannot ask for more, and one running a 500k-item move cannot
 * ask for less.
 *
 * Deliberately small. A logging library would bring transports, serialisers and
 * a config surface this does not need; what was missing was a level, not an
 * ecosystem.
 *
 * Streams are preserved exactly as they were: `error`/`warn` to stderr,
 * `info`/`debug` to stdout. Docker, journald and GitHub Actions all separate
 * those, and changing which stream a message lands on would break log
 * collection that already works.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Ascending verbosity. A message is emitted when its level <= the active one. */
const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const LEVELS = Object.keys(RANK) as LogLevel[];

/**
 * `info` — every message that exists today keeps being printed unless it is
 * explicitly demoted, so adopting this changes no output by default.
 */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Parse a level, falling back to the default.
 *
 * An unrecognised value warns and falls back rather than throwing: a typo in
 * LOG_LEVEL must not stop a migration, and it must not silently produce
 * silence either.
 */
export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return DEFAULT_LOG_LEVEL;
  const normalised = raw.trim().toLowerCase();
  if ((LEVELS as string[]).includes(normalised)) return normalised as LogLevel;
  // Straight to console: the logger is what is being configured here.
  console.warn(
    `[log] unknown LOG_LEVEL ${JSON.stringify(raw)}; expected one of ` +
      `${LEVELS.join(', ')}. Falling back to ${DEFAULT_LOG_LEVEL}.`,
  );
  return DEFAULT_LOG_LEVEL;
}

// Resolved once. Read per call it would cost a `process.env` lookup on every
// item of a large migration, and the level cannot change mid-process anyway.
let active: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

/** The level in force. */
export function getLogLevel(): LogLevel {
  return active;
}

/**
 * Override the level at runtime. Intended for tests and for an entrypoint that
 * takes a `--verbose` flag; normal configuration is the LOG_LEVEL env var.
 */
export function setLogLevel(level: LogLevel): void {
  active = level;
}

/** Re-read LOG_LEVEL from the environment (tests). */
export function resetLogLevel(): void {
  active = parseLogLevel(process.env.LOG_LEVEL);
}

/**
 * Whether a level would be emitted.
 *
 * Worth checking before building an expensive message — a JSON.stringify of a
 * large object costs the same whether or not the result is printed. For a
 * plain string, just call the method.
 */
export function isLevelEnabled(level: LogLevel): boolean {
  return RANK[level] <= RANK[active];
}

export const log = {
  /** Something failed. Always emitted. */
  error(...args: unknown[]): void {
    if (RANK.error <= RANK[active]) console.error(...args);
  },
  /** Something is wrong but the run continues. */
  warn(...args: unknown[]): void {
    if (RANK.warn <= RANK[active]) console.warn(...args);
  },
  /** The default narrative of a run: what started, what finished, totals. */
  info(...args: unknown[]): void {
    if (RANK.info <= RANK[active]) console.log(...args);
  },
  /** Per-item and per-request detail. Off unless asked for. */
  debug(...args: unknown[]): void {
    if (RANK.debug <= RANK[active]) console.log(...args);
  },
} as const;
