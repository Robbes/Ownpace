// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The metrics registry, and — the part that actually matters — that it cannot
 * be used to leak personal data.
 *
 * §17 is explicit that job metadata, "addresses, folder names", is personal
 * data. A metrics store is scraped, federated and long-retained, with entirely
 * different access controls from the ledger. A label like
 * `folder="Inbox/Clients/AcmeBV"` is one keystroke to add, invisible in review,
 * and effectively impossible to withdraw once it has been scraped for a year.
 *
 * So the restriction is enforced at the point of instrumentation, and this is
 * the enforcement.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  metrics,
  renderMetrics,
  resetMetrics,
  assertOpaqueLabel,
  METRICS_CONTENT_TYPE,
} from './metrics.ts';

afterEach(() => {
  resetMetrics();
});

describe('label privacy', () => {
  it('refuses a label value that looks like an email address', () => {
    expect(() => assertOpaqueLabel('user', 'anna@example.com')).toThrow(/personal data/);
  });

  it('refuses a label value that looks like a folder path', () => {
    expect(() => assertOpaqueLabel('folder', 'Inbox/Clients/AcmeBV')).toThrow(/personal data/);
    expect(() => assertOpaqueLabel('folder', 'Documents\\2026')).toThrow(/personal data/);
  });

  it('allows the identifiers we actually label with', () => {
    expect(() => assertOpaqueLabel('tenant', 'e0d15000-e29b-41d4-a716-446655440030')).not.toThrow();
    expect(() => assertOpaqueLabel('domain', 'file')).not.toThrow();
    expect(() => assertOpaqueLabel('outcome', 'adopted')).not.toThrow();
  });

  it('refuses at the metric, not merely in the helper', () => {
    // The guard is worthless if a metric can bypass it.
    const c = new Counter('t_total', 'help');
    expect(() => c.inc({ folder: 'Inbox/Sent' })).toThrow(/personal data/);
    const g = new Gauge('t_gauge', 'help');
    expect(() => g.set({ user: 'bob@example.com' }, 1)).toThrow(/personal data/);
    const h = new Histogram('t_hist', 'help');
    expect(() => h.observe({ path: 'a/b' }, 1)).toThrow(/personal data/);
  });

  it('never emits a value resembling personal data from the real registry', () => {
    // End to end: whatever the product records, the scrape body must not carry
    // an address or a path.
    metrics.itemsMigrated.inc({ tenant: 't1', mapping: 'm1', domain: 'email', outcome: 'created' }, 5);
    metrics.passOverlap.set({ tenant: 't1', mapping: 'm1', domain: 'email' }, 3.9);
    const body = renderMetrics();
    expect(body).not.toMatch(/@/);
    // Only the metric names themselves may contain a slash-free underscore path;
    // no label VALUE may contain a separator.
    for (const m of body.matchAll(/\{([^}]*)\}/g)) {
      for (const pair of m[1]!.split(',')) {
        const value = pair.split('=')[1] ?? '';
        expect(value).not.toMatch(/[/\\]/);
      }
    }
  });
});

describe('exposition format', () => {
  it('renders a counter Prometheus can parse', () => {
    const c = new Counter('om_test_total', 'A test counter.');
    c.inc({ domain: 'file' }, 3);
    c.inc({ domain: 'file' });
    expect(c.render()).toEqual([
      '# HELP om_test_total A test counter.',
      '# TYPE om_test_total counter',
      'om_test_total{domain="file"} 4',
    ]);
  });

  it('keeps series apart by label set', () => {
    const c = new Counter('om_x_total', 'h');
    c.inc({ domain: 'file' }, 1);
    c.inc({ domain: 'email' }, 2);
    const body = c.render().join('\n');
    expect(body).toContain('om_x_total{domain="file"} 1');
    expect(body).toContain('om_x_total{domain="email"} 2');
  });

  it('emits CUMULATIVE histogram buckets, which is what Prometheus requires', () => {
    const h = new Histogram('om_d_seconds', 'h', [1, 5, 10]);
    h.observe({ domain: 'file' }, 0.5); // <=1, <=5, <=10
    h.observe({ domain: 'file' }, 7); //        <=10
    const body = h.render().join('\n');
    expect(body).toContain('om_d_seconds_bucket{domain="file",le="1"} 1');
    expect(body).toContain('om_d_seconds_bucket{domain="file",le="5"} 1');
    expect(body).toContain('om_d_seconds_bucket{domain="file",le="10"} 2');
    expect(body).toContain('om_d_seconds_bucket{domain="file",le="+Inf"} 2');
    expect(body).toContain('om_d_seconds_count{domain="file"} 2');
    expect(body).toContain('om_d_seconds_sum{domain="file"} 7.5');
  });

  it('escapes label values so a stray quote cannot corrupt the body', () => {
    const c = new Counter('om_e_total', 'h');
    c.inc({ tag: 'a"b' });
    expect(c.render().join('\n')).toContain('om_e_total{tag="a\\"b"} 1');
  });

  it('advertises the content type Prometheus expects', () => {
    expect(METRICS_CONTENT_TYPE).toContain('text/plain');
    expect(METRICS_CONTENT_TYPE).toContain('version=0.0.4');
  });

  it('renders every registered metric with HELP and TYPE', () => {
    // A metric missing either is silently dropped by some scrapers.
    const body = renderMetrics();
    const names = [...body.matchAll(/^# TYPE (\S+)/gm)].map((m) => m[1]);
    expect(names.length).toBe(Object.keys(metrics).length);
    for (const n of names) expect(body).toContain(`# HELP ${n}`);
  });
});
