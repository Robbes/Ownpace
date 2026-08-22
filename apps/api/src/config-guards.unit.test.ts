// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Production URL guards: the localhost fallbacks that used to fail silently
 * at runtime (unreachable Mollie webhook, stranded redirect) now refuse to
 * boot — with billing live — or warn, in words that name the consequence.
 */
import { describe, it, expect } from 'vitest';
import { describeUrlConfigProblems, assertProductionUrlConfig } from './config-guards.ts';

const prodBilling = {
  NODE_ENV: 'production',
  MOLLIE_API_KEY: 'live_key',
};

describe('describeUrlConfigProblems', () => {
  it('is silent outside production regardless of values', () => {
    expect(
      describeUrlConfigProblems({ NODE_ENV: 'development', MOLLIE_API_KEY: 'k' }),
    ).toEqual([]);
  });

  it('refuses a localhost or unset API_URL/WEB_URL in production once billing is live', () => {
    const problems = describeUrlConfigProblems({
      ...prodBilling,
      API_URL: 'http://localhost:3001',
      WEB_URL: undefined,
      CORS_ORIGIN: 'https://app.example.com',
    });
    const fatal = problems.filter((p) => p.fatal);
    expect(fatal).toHaveLength(2);
    // The refusal names the consequence, not just the variable.
    expect(fatal[0]!.message).toContain('invoices stay sent forever');
    expect(fatal[1]!.message).toContain('redirect paying customers');
  });

  it('accepts public URLs, and never makes URL problems FATAL while billing is off', () => {
    expect(
      describeUrlConfigProblems({
        ...prodBilling,
        API_URL: 'https://api.example.com',
        WEB_URL: 'https://app.example.com',
        CORS_ORIGIN: 'https://app.example.com',
      }),
    ).toEqual([]);

    // THIS EXPECTED `[]` UNTIL WORKPLAN 0095, on the reasoning that with no
    // MOLLIE_API_KEY "localhost URLs are harmless — nothing external calls
    // them". That was true when it was written and stopped being true when a
    // granted person's email started naming WEB_URL as the place to sign in:
    // it is now read by somebody OUTSIDE the system, which is exactly what
    // "nothing external calls them" ruled out.
    //
    // What the case is actually about survives, and is asserted more precisely
    // than before: with billing off, a URL problem is a WARNING and never
    // fatal. A missing WEB_URL must not refuse to boot a deployment that was
    // serving yesterday — the operator learns per grant, in the response.
    const withoutBilling = describeUrlConfigProblems({
      NODE_ENV: 'production',
      API_URL: 'http://localhost:3001',
      CORS_ORIGIN: 'https://app.example.com',
    });
    expect(withoutBilling.filter((p) => p.fatal)).toEqual([]);
    // API_URL is still ungated without billing; only WEB_URL now speaks up.
    expect(withoutBilling).toHaveLength(1);
    expect(withoutBilling[0]!.message).toContain('WEB_URL');
    expect(withoutBilling[0]!.message).toContain('send no email');
  });

  it('localhost CORS_ORIGIN in production is a warning (same-origin proxy makes it moot), never fatal', () => {
    // WEB_URL is set so this case stays about CORS. Before workplan 0095 an
    // unset WEB_URL contributed nothing here; now it warns, and a test that
    // silently absorbed both would stop being about either.
    const problems = describeUrlConfigProblems({
      NODE_ENV: 'production',
      WEB_URL: 'https://app.example.com',
      CORS_ORIGIN: 'http://localhost:3123',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.fatal).toBe(false);
    expect(problems[0]!.message).toContain('same-origin /api proxy');
  });
});

describe('assertProductionUrlConfig', () => {
  it('throws on fatal problems and routes warnings to the given sink', () => {
    const oldEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.MOLLIE_API_KEY = 'live_key';
      process.env.API_URL = 'http://127.0.0.1:3001';
      process.env.WEB_URL = 'https://app.example.com';
      delete process.env.CORS_ORIGIN;
      const warnings: string[] = [];
      expect(() => assertProductionUrlConfig((m) => warnings.push(m))).toThrow(
        /invoices stay sent forever/,
      );
      expect(warnings.some((w) => w.includes('CORS_ORIGIN'))).toBe(true);
    } finally {
      process.env = oldEnv;
    }
  });
});
