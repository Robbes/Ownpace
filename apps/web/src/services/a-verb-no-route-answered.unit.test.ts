// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VERB NO ROUTE ANSWERED (ADR-0049, workplan 0101 T7).
 *
 * The Finish page's "keep copying after cutover" press sent `PATCH
 * /api/migrations/:id` from 2026-09-10 to 2026-09-20. The API serves that
 * path with `PUT` — the verb `pause` uses — and has no PATCH handler on it, so
 * every press answered 404 and the page showed its generic "failed". The lane
 * (0117 T1) could be entered from a curl and never from the screen built for
 * it, and nothing was red: the page's tests mock this whole module, and the
 * API's spec guard checks routes against the spec, not against callers.
 *
 * So the verb is pinned here, at the call, with the axios instance mocked the
 * way `operating-service.unit.test.ts` mocks it — and deliberately WITHOUT a
 * `patch` on the fake, so a regression to PATCH fails as a missing function
 * rather than as an unasserted call.
 */

import { describe, it, expect, vi } from 'vitest';

const { putMock } = vi.hoisted(() => ({ putMock: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        get: vi.fn(),
        post: vi.fn(),
        put: putMock,
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      }),
    },
  };
});

import { keepCopyingAfterCutover } from './operating-service.ts';

describe('keepCopyingAfterCutover', () => {
  it('PUTs the lifecycle to the migration — the verb the API serves on this path', async () => {
    putMock.mockResolvedValue({ data: {} });

    await keepCopyingAfterCutover('m-1');

    expect(putMock).toHaveBeenCalledTimes(1);
    const [path, body] = putMock.mock.calls[0]!;
    expect(path).toMatch(/\/migrations\/m-1$/);
    expect(body).toEqual({ status: 'continuous' });
  });

  it("surfaces the API's refusal rather than swallowing it — the page shows 'failed' from this", async () => {
    // The lane is entered from 'cutover' or 'done'; from anywhere else the
    // API now answers 409 lifecycle_refused (ADR-0049). The page's catch is
    // what turns that into a visible state, so the rejection must reach it.
    putMock.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { code: 'before_cutover' } } });

    await expect(keepCopyingAfterCutover('m-1')).rejects.toMatchObject({ response: { status: 409 } });
  });
});
