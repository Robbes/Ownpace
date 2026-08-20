// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * DNS Verify-Only Unit Tests (workplan 0009 T3)
 *
 * Covers the public-resolver (DoH) consensus checks and the guided runbook
 * generator with a stubbed `fetch` — no real network calls, no system resolver.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  PUBLIC_DNS_RESOLVERS,
  verifyMX,
  verifySPF,
  verifyDKIM,
  verifyDMARC,
  verifyAutodiscover,
  verifyAllDns,
  checkPropagation,
  generateDnsRunbook,
} from './dns-verify-only.ts';

/** Which of the three public resolvers a DoH URL targets. */
function resolverNameFromUrl(url: string): string {
  const match = PUBLIC_DNS_RESOLVERS.find((r) => url.startsWith(r.url));
  if (!match) throw new Error(`unexpected DoH URL in test: ${url}`);
  return match.name;
}

/** Answer-set keyed by `${recordType}:${queriedDomain}`; missing key = no records. */
type DnsAnswerMap = Record<string, string[]>;

function makeFetchMock(opts: { records: DnsAnswerMap; failResolvers?: Set<string> }) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const name = resolverNameFromUrl(url);
    if (opts.failResolvers?.has(name)) {
      return { ok: false, status: 500, statusText: 'Internal Server Error' };
    }
    const parsed = new URL(url);
    const qDomain = parsed.searchParams.get('name') ?? '';
    const qType = parsed.searchParams.get('type') ?? '';
    const records = opts.records[`${qType}:${qDomain}`] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ Answer: records.map((data) => ({ data })) }),
    };
  });
}

describe('dns-verify-only', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyMX', () => {
    it('succeeds when 2+ resolvers agree on an MX record (consensus)', async () => {
      global.fetch = makeFetchMock({
        records: { 'MX:example.com': ['10 mail.example.com'] },
      }) as unknown as typeof fetch;

      const result = await verifyMX('example.com');

      expect(result.success).toBe(true);
      expect(result.consensus).toBe(true);
      expect(result.found).toContain('10 mail.example.com');
      expect(result.missing).toEqual([]);
    });

    it('fails when only one resolver responds (no consensus)', async () => {
      global.fetch = makeFetchMock({
        records: { 'MX:example.com': ['10 mail.example.com'] },
        failResolvers: new Set(['Google', 'Quad9']),
      }) as unknown as typeof fetch;

      const result = await verifyMX('example.com');

      expect(result.consensus).toBe(false);
      expect(result.success).toBe(false);
    });

    it('fails when no MX records exist anywhere', async () => {
      global.fetch = makeFetchMock({ records: {} }) as unknown as typeof fetch;

      const result = await verifyMX('example.com');

      expect(result.success).toBe(false);
      expect(result.found).toEqual([]);
      expect(result.missing).toContain('MX records not found');
    });
  });

  describe('verifySPF', () => {
    it('succeeds and warns when the expected sender is present', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:example.com': ['v=spf1 include:_spf.example.com ~all'] },
      }) as unknown as typeof fetch;

      const result = await verifySPF('example.com', '_spf.example.com');

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('warns when the expected sender is missing from an otherwise valid SPF record', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:example.com': ['v=spf1 include:other.example.com ~all'] },
      }) as unknown as typeof fetch;

      const result = await verifySPF('example.com', '_spf.example.com');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Expected sender "_spf.example.com" not found');
    });

    it('ignores non-SPF TXT records at the apex', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:example.com': ['google-site-verification=abc123'] },
      }) as unknown as typeof fetch;

      const result = await verifySPF('example.com');

      expect(result.success).toBe(false);
      expect(result.warnings).toContain('No SPF record found');
    });
  });

  describe('verifyDKIM', () => {
    it('queries the selector-scoped _domainkey host and succeeds on a valid record', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:selector1._domainkey.example.com': ['v=DKIM1; k=rsa; p=ABC123'] },
      }) as unknown as typeof fetch;

      const result = await verifyDKIM('example.com', 'selector1');

      expect(result.success).toBe(true);
      expect(result.found[0]).toContain('v=DKIM1');
    });

    it('fails and names the selector when no DKIM record is configured', async () => {
      global.fetch = makeFetchMock({ records: {} }) as unknown as typeof fetch;

      const result = await verifyDKIM('example.com', 'selector1');

      expect(result.success).toBe(false);
      expect(result.missing).toContain('No DKIM for selector1');
    });
  });

  describe('verifyDMARC', () => {
    it('succeeds and extracts the policy value', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:_dmarc.example.com': ['v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com'] },
      }) as unknown as typeof fetch;

      const result = await verifyDMARC('example.com');

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('warns when the policy is "none" even though the record is valid', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:_dmarc.example.com': ['v=DMARC1; p=none'] },
      }) as unknown as typeof fetch;

      const result = await verifyDMARC('example.com');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('DMARC policy is "none"');
    });

    it('fails when no DMARC record exists', async () => {
      global.fetch = makeFetchMock({ records: {} }) as unknown as typeof fetch;

      const result = await verifyDMARC('example.com');

      expect(result.success).toBe(false);
      expect(result.missing).toContain('No DMARC');
    });
  });

  describe('verifyAutodiscover', () => {
    it('succeeds on an A record when present', async () => {
      global.fetch = makeFetchMock({
        records: { 'A:autodiscover.example.com': ['203.0.113.10'] },
      }) as unknown as typeof fetch;

      const result = await verifyAutodiscover('example.com');

      expect(result.success).toBe(true);
      expect(result.recordType).toBe('A');
    });

    it('falls back to CNAME when no A record is present', async () => {
      global.fetch = makeFetchMock({
        records: { 'CNAME:autodiscover.example.com': ['mail.example.com'] },
      }) as unknown as typeof fetch;

      const result = await verifyAutodiscover('example.com');

      expect(result.success).toBe(true);
      expect(result.recordType).toBe('CNAME');
    });

    it('fails when neither A nor CNAME is configured', async () => {
      global.fetch = makeFetchMock({ records: {} }) as unknown as typeof fetch;

      const result = await verifyAutodiscover('example.com');

      expect(result.success).toBe(false);
      expect(result.warnings).toContain('Autodiscover not configured');
    });
  });

  describe('verifyAllDns', () => {
    it('aggregates all five checks, including a real (non-hardcoded) DKIM result', async () => {
      global.fetch = makeFetchMock({
        records: {
          'MX:example.com': ['10 mail.example.com'],
          'TXT:example.com': ['v=spf1 mx ~all'],
          'TXT:selector1._domainkey.example.com': ['v=DKIM1; k=rsa; p=ABC'],
          'TXT:_dmarc.example.com': ['v=DMARC1; p=quarantine'],
          'A:autodiscover.example.com': ['203.0.113.10'],
        },
      }) as unknown as typeof fetch;

      const status = await verifyAllDns('example.com', 'selector1');

      expect(status.mxVerified).toBe(true);
      expect(status.spfVerified).toBe(true);
      expect(status.dkimVerified).toBe(true);
      expect(status.dmarcVerified).toBe(true);
      expect(status.autodiscoverVerified).toBe(true);
      expect(status.allVerified).toBe(true);
      expect(status.verifiedAt).toBeDefined();
    });

    it('reports dkimVerified: false (not silently true) when DKIM is missing, without blocking allVerified', async () => {
      global.fetch = makeFetchMock({
        records: {
          'MX:example.com': ['10 mail.example.com'],
          'TXT:example.com': ['v=spf1 mx ~all'],
          'TXT:_dmarc.example.com': ['v=DMARC1; p=quarantine'],
          // no DKIM, no autodiscover records configured
        },
      }) as unknown as typeof fetch;

      const status = await verifyAllDns('example.com', 'selector1');

      expect(status.dkimVerified).toBe(false);
      expect(status.warnings.some((w) => w.includes('selector1'))).toBe(true);
      // DKIM/autodiscover are advisory — they don't gate the overall MX/SPF/DMARC verdict.
      expect(status.allVerified).toBe(true);
    });

    it('defaults the DKIM selector to "default" when none is passed', async () => {
      global.fetch = makeFetchMock({
        records: { 'TXT:default._domainkey.example.com': ['v=DKIM1; k=rsa; p=ABC'] },
      }) as unknown as typeof fetch;

      const status = await verifyAllDns('example.com');

      expect(status.dkimVerified).toBe(true);
    });
  });

  describe('checkPropagation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true on the first attempt without waiting when records already match', async () => {
      global.fetch = makeFetchMock({
        records: { 'MX:example.com': ['10 mail.example.com'] },
      }) as unknown as typeof fetch;
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const result = await checkPropagation('example.com', [{ type: 'MX', value: 'mail.example.com' }], 5, 30000);

      expect(result).toBe(true);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('backs off by exactly backoffMs between retries (no hot loop) and succeeds once propagated', async () => {
      // Each checkPropagation attempt fires 3 resolver calls (one per PUBLIC_DNS_RESOLVERS
      // entry). The first attempt (calls 1-3) finds nothing; the second (calls 4-6) does.
      let callCount = 0;
      global.fetch = vi.fn(async () => {
        callCount++;
        const propagated = callCount > 3;
        const records = propagated ? ['10 mail.example.com'] : [];
        return { ok: true, status: 200, json: async () => ({ Answer: records.map((data) => ({ data })) }) };
      }) as unknown as typeof fetch;

      const promise = checkPropagation('example.com', [{ type: 'MX', value: 'mail.example.com' }], 5, 10000);

      // Let attempt 1's 3 concurrent DoH calls settle (no real timer involved).
      await vi.advanceTimersByTimeAsync(0);
      // The retry only fires once the full backoff has elapsed.
      await vi.advanceTimersByTimeAsync(10000);

      const result = await promise;

      expect(result).toBe(true);
      expect(callCount).toBe(6); // exactly 2 attempts x 3 resolvers — no extra hot-loop calls
    });

    it('gives up after maxAttempts with backoff between every attempt, never hot-looping', async () => {
      global.fetch = makeFetchMock({ records: {} }) as unknown as typeof fetch; // never propagates
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const promise = checkPropagation('example.com', [{ type: 'MX', value: 'mail.example.com' }], 3, 5000);
      // 3 attempts -> 2 backoff waits (no wait after the final attempt).
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await promise;

      expect(result).toBe(false);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      for (const call of setTimeoutSpy.mock.calls) {
        expect(call[1]).toBe(5000);
      }
    });

    it('treats a resolver-query exception as "not found" rather than throwing', async () => {
      global.fetch = vi.fn(async () => {
        throw new Error('network unreachable');
      }) as unknown as typeof fetch;

      const result = await checkPropagation('example.com', [{ type: 'MX', value: 'mail.example.com' }], 1, 1000);

      expect(result).toBe(false);
    });
  });

  describe('generateDnsRunbook', () => {
    it('enumerates exactly the records verifyAllDns checks, for the same domain/selector', async () => {
      const domain = 'dev.example.com';
      const selector = 'mig2026';
      const runbook = generateDnsRunbook(domain, 'mail.target.example.com', undefined, selector);

      // Same host-construction rules used by verifyMX/verifySPF/verifyDKIM/verifyDMARC/verifyAutodiscover.
      const expectedDigTargets = [
        `MX ${domain}`,
        `TXT ${domain}`,
        `TXT ${selector}._domainkey.${domain}`,
        `TXT _dmarc.${domain}`,
        `A autodiscover.${domain}`,
      ];

      for (const target of expectedDigTargets) {
        expect(runbook).toContain(`dig ${target}`);
      }

      // No stray dig commands beyond exactly this set.
      const digLines = runbook.match(/dig .+/g) ?? [];
      expect(digLines).toHaveLength(expectedDigTargets.length);
    });

    it('documents the DKIM record (not just MX/SPF/DMARC/Autodiscover)', () => {
      const runbook = generateDnsRunbook('example.com', 'mail.example.com', undefined, 'sel1');

      expect(runbook).toContain('sel1._domainkey');
      expect(runbook).toContain('v=DKIM1');
    });

    it('defaults the DKIM selector to "default" when none is passed', () => {
      const runbook = generateDnsRunbook('example.com', 'mail.example.com');

      expect(runbook).toContain('default._domainkey');
    });

    it('uses targetIp for the autodiscover record when provided, else falls back to the mail server', () => {
      const withIp = generateDnsRunbook('example.com', 'mail.example.com', '203.0.113.10');
      expect(withIp).toContain('autodiscover: 203.0.113.10');

      const withoutIp = generateDnsRunbook('example.com', 'mail.example.com');
      expect(withoutIp).toContain('autodiscover: mail.example.com');
    });
  });
});
