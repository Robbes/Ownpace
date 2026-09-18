// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The text-request error path (0038 T7).
 *
 * The two markdown fetches use `responseType: 'text'`, so axios hands JSON
 * ERROR bodies over as unparsed strings — which meant the server's
 * carefully-written refusal sentences could NEVER reach a screen in
 * production: the components probe `.message`/`.reason` on an object that
 * was actually a string. The old component tests passed only because they
 * mocked an already-parsed rejection. This test rejects with the shape axios
 * ACTUALLY delivers — a string body — and pins that the service re-throws
 * with the body parsed, so the downstream probes work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        get: getMock,
        post: postMock,
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      }),
    },
  };
});

import {
  decideFailureGroup,
  fetchGroupRunbook,
  fetchPermissionReport,
} from './operating-service.ts';

/** An axios rejection as `responseType: 'text'` actually delivers it: the
 *  JSON error body is an UNPARSED STRING. `isAxiosError: true` is the flag
 *  axios.isAxiosError checks. */
const textRejection = (body: string, status = 501) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data: body },
});

beforeEach(() => {
  getMock.mockReset();
});

describe('fetchPermissionReport parses string error bodies', () => {
  it("re-throws with the server's JSON body PARSED, so .reason probes work", async () => {
    getMock.mockRejectedValue(
      textRejection(
        JSON.stringify({
          error: 'not_recorded',
          reason:
            'This migration does not record which mailbox it reads, so no permission report can be produced.',
        }),
      ),
    );

    const thrown = await fetchPermissionReport('acme-mail').catch((e: unknown) => e);
    const data = (thrown as { response: { data: { reason?: string } } }).response.data;
    expect(typeof data).toBe('object');
    expect(data.reason).toContain('does not record which mailbox it reads');
  });

  it('keeps a non-JSON body as the string it was', async () => {
    getMock.mockRejectedValue(textRejection('plain text error page', 502));

    const thrown = await fetchPermissionReport('acme-mail').catch((e: unknown) => e);
    expect((thrown as { response: { data: unknown } }).response.data).toBe(
      'plain text error page',
    );
  });
});

describe('fetchGroupRunbook has the same latent shape, fixed the same way', () => {
  it('parses the string body on rejection', async () => {
    getMock.mockRejectedValue(
      textRejection(JSON.stringify({ error: 'unavailable', message: 'No runbook yet.' })),
    );

    const thrown = await fetchGroupRunbook().catch((e: unknown) => e);
    expect(
      (thrown as { response: { data: { message?: string } } }).response.data.message,
    ).toBe('No runbook yet.');
  });
});

/**
 * THE FIELDS A GROUP PRESS ACTUALLY SENDS.
 *
 * The panel's own tests mock this module, so a field dropped HERE is invisible
 * to them: the panel would be proved to ask for a category that never leaves
 * the browser, the server would see a domain-only press, and it would change
 * every other category in that domain while the screen showed the group's own
 * count. This is the only place that can catch it.
 */
describe('decideFailureGroup posts the whole match', () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { status: 'ok', action: 'retry', matched: 2, effect: 'x' } });
  });

  it('carries the category, the kind and the needle', async () => {
    await decideFailureGroup('m-1', 'retry', {
      domain: 'contact',
      category: 'target_refused',
      errorContains: 'TypeError',
    });

    expect(postMock).toHaveBeenCalledWith(expect.stringContaining('m-1'), {
      action: 'retry',
      domain: 'contact',
      category: 'target_refused',
      errorContains: 'TypeError',
    });
  });

  it('sends only what the match actually narrows on', async () => {
    // An absent field must not become a present empty one: the route reads an
    // empty `errorContains` as "set but blank" when deciding whether the press
    // narrows at all.
    await decideFailureGroup('m-1', 'accept', { category: 'source_refused' });

    expect(postMock).toHaveBeenCalledWith(expect.stringContaining('m-1'), {
      action: 'accept',
      category: 'source_refused',
    });
  });
});
