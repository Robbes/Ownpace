// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAGE OF THE AUDIT EXPORT, AS THE OPERATOR'S PAGE ASKS FOR IT (workplan
 * 0129 T4, the managed half): `readAuditExportPage`.
 *
 *  - it asks for the largest page there is, since every page served is
 *    recorded as one read of every customer, after the cursor it was given;
 *  - the lines are kept as they came, even when a page of one line happens to
 *    be a JSON document too;
 *  - a refusal's sentence still reaches the screen;
 *  - a page that does not say where the next one starts is refused, rather
 *    than asked for again from the same place for ever.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import apiClient, { serverMessage } from './api.ts';
import { readAuditExportPage } from './support.ts';

const original = apiClient.defaults.adapter;
let asked: InternalAxiosRequestConfig | undefined;

afterEach(() => {
  apiClient.defaults.adapter = original;
  asked = undefined;
});

/** An adapter that answers as the API would have. */
const serving =
  (status: number, data: string, headers: Record<string, string>): AxiosAdapter =>
  async (config) => {
    asked = config;
    const response = { data, status, statusText: '', headers, config };
    if (status >= 400) throw Object.assign(new Error('refused'), { isAxiosError: true, config, response });
    return response;
  };

const LINE = '{"Body":"share.decided","Attributes":{"ownpace.audit.id":"0e2e0000-e29b-41d4-a716-446655440001"}}\n';

describe('a page of the audit export', () => {
  it('asks for the largest page after the cursor, and keeps the lines as they came', async () => {
    apiClient.defaults.adapter = serving(200, LINE, { 'ownpace-next-after': 'next', 'ownpace-caught-up': 'true' });

    const page = await readAuditExportPage('after');

    expect(asked?.url).toBe('/support/audit-export');
    expect(asked?.params).toEqual({ after: 'after', limit: 10_000 });
    expect(page).toEqual({ text: LINE, lines: 1, next: 'next', caughtUp: true });
  });

  it('asks from the first event when it has no cursor, and counts only lines that hold something', async () => {
    apiClient.defaults.adapter = serving(200, `${LINE}${LINE}\n`, {
      'ownpace-next-after': 'next',
      'ownpace-caught-up': 'false',
    });

    const page = await readAuditExportPage('');

    expect(asked?.params).toEqual({ limit: 10_000 });
    expect(page).toMatchObject({ lines: 2, caughtUp: false });
  });

  it("a refusal's own sentence reaches the screen", async () => {
    const said = "A cursor is a line's Timestamp and its ownpace.audit.id, joined by a hyphen.";
    apiClient.defaults.adapter = serving(400, JSON.stringify({ error: 'Bad request', field: 'after', message: said }), {});

    const error = await readAuditExportPage('yesterday').catch((e: unknown) => e);

    expect(serverMessage(error)).toBe(said);
  });

  it('refuses a page that does not say where the next one starts', async () => {
    apiClient.defaults.adapter = serving(200, LINE, { 'ownpace-caught-up': 'false' });
    await expect(readAuditExportPage('')).rejects.toThrow(/without saying where the next page starts/);

    apiClient.defaults.adapter = serving(200, LINE, { 'ownpace-next-after': 'next' });
    await expect(readAuditExportPage('')).rejects.toThrow(/without saying where the next page starts/);
  });
});
