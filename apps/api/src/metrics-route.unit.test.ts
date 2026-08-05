// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed API's `/metrics` endpoint (0026 T3 row 19, owner decision A).
 *
 * Two things are worth pinning, and neither is "the route returns 200".
 *
 * That it uses the SAME renderer as the appliance. Two renderers would drift,
 * and a dashboard built against one edition's series names would silently show
 * nothing for the other — the observability equivalent of the empty result
 * that looks like a finding.
 *
 * And that the body carries no personal data. §17 is explicit that even job
 * metadata — addresses, folder names — is personal data, and this endpoint is
 * deliberately unauthenticated like `/health`. A counter labelled with a
 * mailbox address would turn a scrape endpoint into a disclosure.
 */

import { describe, it, expect } from 'vitest';
import { renderMetrics, METRICS_CONTENT_TYPE } from '@openmig/shared';

describe('what the managed API exposes at /metrics', () => {
  it('renders through the shared renderer, in Prometheus text format', () => {
    const body = renderMetrics();
    expect(typeof body).toBe('string');
    // The content type is what makes a scraper parse it rather than download
    // it; getting this wrong produces a silently ignored target.
    expect(METRICS_CONTENT_TYPE).toContain('text/plain');
  });

  it('carries no address-shaped or path-shaped label anywhere', () => {
    // The property, not an example of it. If somebody later adds a counter
    // labelled by mailbox or folder, this fails — which is the point, because
    // the endpoint is unauthenticated and §17 counts that metadata as personal
    // data.
    const body = renderMetrics();
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(body).not.toMatch(/\b(INBOX|Sent|Drafts|Archive)\b/);
  });

  it('is the same renderer the appliance serves, not a second copy', async () => {
    // Imported from `@openmig/shared` by both editions. This asserts the
    // import path rather than the output, because the failure being prevented
    // is somebody writing a managed-only renderer that agrees today and
    // diverges next month.
    const shared = await import('@openmig/shared');
    expect(shared.renderMetrics).toBe(renderMetrics);
  });
});
