// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Levelled logging, and the guard that keeps it in force.
 *
 * The product had 422 raw `console.*` calls and no way to turn detail up or
 * down — for a tool whose output is the audit trail of someone else's data
 * move, a gap in both directions. These tests pin the two things that make the
 * replacement worth having: that levels actually gate, and that adopting it
 * changed no output by default.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  log,
  parseLogLevel,
  getLogLevel,
  setLogLevel,
  resetLogLevel,
  isLevelEnabled,
  DEFAULT_LOG_LEVEL,
} from './logger.ts';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
  resetLogLevel();
});

function captureStreams() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')));
  return { out, err };
}

describe('parseLogLevel', () => {
  it('defaults to info, which is what keeps adoption output-neutral', () => {
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel('')).toBe('info');
    expect(DEFAULT_LOG_LEVEL).toBe('info');
  });

  it('accepts the four levels, case- and whitespace-insensitively', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel('  warn ')).toBe('warn');
    expect(parseLogLevel('error')).toBe('error');
  });

  it('warns and falls back on a typo rather than throwing or going silent', () => {
    // A mistyped LOG_LEVEL must not stop a migration — and must not silently
    // suppress its logs either, which is the worse of the two failures.
    const { err } = captureStreams();
    expect(parseLogLevel('verbose')).toBe('info');
    expect(err.join('\n')).toContain('unknown LOG_LEVEL');
  });
});

describe('level gating', () => {
  it('emits everything at debug', () => {
    setLogLevel('debug');
    const { out, err } = captureStreams();
    log.error('e'); log.warn('w'); log.info('i'); log.debug('d');
    expect(err).toEqual(['e', 'w']);
    expect(out).toEqual(['i', 'd']);
  });

  it('drops debug at the default level', () => {
    setLogLevel('info');
    const { out } = captureStreams();
    log.info('i'); log.debug('d');
    expect(out).toEqual(['i']);
  });

  it('drops info and debug at warn', () => {
    setLogLevel('warn');
    const { out, err } = captureStreams();
    log.error('e'); log.warn('w'); log.info('i'); log.debug('d');
    expect(err).toEqual(['e', 'w']);
    expect(out).toEqual([]);
  });

  it('keeps only errors at error', () => {
    setLogLevel('error');
    const { out, err } = captureStreams();
    log.error('e'); log.warn('w'); log.info('i');
    expect(err).toEqual(['e']);
    expect(out).toEqual([]);
  });

  it('never suppresses errors, whatever the level', () => {
    // The one message class an operator must always see.
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      setLogLevel(level);
      expect(isLevelEnabled('error')).toBe(true);
    }
  });
});

describe('streams', () => {
  it('keeps error and warn on stderr, info and debug on stdout', () => {
    // Docker, journald and GitHub Actions all separate these. Moving a message
    // to a different stream would break log collection that already works.
    setLogLevel('debug');
    const { out, err } = captureStreams();
    log.error('e'); log.warn('w'); log.info('i'); log.debug('d');
    expect(err).toEqual(['e', 'w']);
    expect(out).toEqual(['i', 'd']);
  });
});

describe('configuration', () => {
  it('reads LOG_LEVEL from the environment', () => {
    process.env.LOG_LEVEL = 'warn';
    resetLogLevel();
    expect(getLogLevel()).toBe('warn');
  });

  it('lets an entrypoint override the env, for a --verbose flag', () => {
    process.env.LOG_LEVEL = 'error';
    resetLogLevel();
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');
  });
});
