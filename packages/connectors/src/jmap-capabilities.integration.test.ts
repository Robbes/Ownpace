// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The JMAP capability probe against a REAL Stalwart (workplan 0031 T4).
 *
 * The unit tests run against a fake session, so they pin how the probe REASONS
 * and prove nothing about what a server actually says. This asserts the thing
 * the reasoning is worth nothing without: that the URNs it looks for are the
 * ones this server really advertises.
 *
 * **That is a specific hazard on this surface rather than a general worry.**
 * The spike checked `urn:ietf:params:jmap:blob` for files, reasoned correctly
 * that blob gives no collection model, and would have reported files as
 * unsupported — while the server had been advertising
 * `urn:ietf:params:jmap:filenode` all along. Perfect logic over the wrong
 * constant. A probe is exactly the kind of code that can be self-consistently
 * wrong forever, which is why this file compares its answer against the same
 * connectors' own behaviour rather than against a list written from memory.
 *
 * NOTHING NEEDS CONFIGURING: `vitest.global-setup.ts` provisions Stalwart with
 * Testcontainers and exports `STALWART_JMAP_URL` / `_USERNAME` / `_PASSWORD`
 * before any test file loads, so this runs — and is gated — under
 * `pnpm test:integration`.
 */

import { describe, it, expect } from 'vitest';
import { probeJmapCapabilities, usableJmapDomains } from './jmap-capabilities.ts';
import { JmapContactTarget } from './jmap-contact-target.ts';
import { JmapFileTarget } from './jmap-file-target.ts';

const BASE = process.env.STALWART_JMAP_URL;
const USER = process.env.STALWART_JMAP_USERNAME ?? 'target@dev.local';
/** See the sibling JMAP integration tests: a committed dev fixture, loopback only. */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(BASE ?? '');
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? (LOOPBACK ? 'target_password' : undefined);

if (!BASE || !PASSWORD) {
  console.warn(
    '[jmap-capabilities] NOT RUN: no STALWART_JMAP_URL. Under `pnpm test:integration` the global ' +
      'setup provides one, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('JMAP capability probe — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('probeJmapCapabilities against a real Stalwart', () => {
    const config = { baseUrl: BASE, username: USER, password: PASSWORD };

    it('offers exactly the domains whose connectors actually work here', async () => {
      const report = await probeJmapCapabilities(config);
      const usable = [...usableJmapDomains(report)].sort();

      // Contacts and files, because `JmapContactTarget` and `JmapFileTarget`
      // both have integration tests writing to this same server. Mail, because
      // `JmapTargetWriter` has been the reference target since 0001.
      expect(usable).toEqual(['contact', 'file', 'mail']);
    }, 60_000);

    it('agrees with the connectors it is describing, rather than with a list', async () => {
      // THE ASSERTION THIS FILE EXISTS FOR. A probe can be self-consistently
      // wrong forever — the spike once checked `:blob` for files and would have
      // reported them unsupported while the server advertised `:filenode`. So
      // rather than re-asserting the URNs, this asks the CONNECTORS whether
      // they can reach the account the probe says exists.
      const report = await probeJmapCapabilities(config);
      expect(report.domains.find((d) => d.domain === 'contact')!.usable).toBe(true);
      expect(report.domains.find((d) => d.domain === 'file')!.usable).toBe(true);

      // `connect()` on both resolves the account from the same primaryAccounts
      // entry the probe checked, and REFUSES rather than guessing when there
      // isn't one. If either throws, the probe's answer was wrong.
      await new JmapContactTarget(config).connect();
      await new JmapFileTarget(config).connect();
    }, 60_000);

    it('reports calendars as spoken by the server and NOT carryable by us', async () => {
      const calendar = (await probeJmapCapabilities(config)).domains.find(
        (d) => d.domain === 'calendar',
      )!;
      // Stalwart really does advertise JMAP calendars, and 0031 T1 is really
      // parked — it refuses `recurrenceRules`, so a calendar target would write
      // a recurring series as a single event plus orphaned overrides, silently.
      // A picker gating on the URN alone would offer that. This is the case
      // that makes the two fields worth separating, and it is live rather than
      // hypothetical.
      expect(calendar.serverSpeaks).toBe(true);
      expect(calendar.usable).toBe(false);
      expect(calendar.reason).toMatch(/parked/);
    }, 60_000);

    it('THROWS on a wrong credential rather than reporting nothing usable', async () => {
      // The failure mode that matters for a picker: a typo'd password must not
      // present as "this server speaks no JMAP", which would send an operator
      // to configure a different protocol.
      await expect(
        probeJmapCapabilities({ ...config, password: 'definitely-not-the-password' }),
      ).rejects.toThrow(/UNKNOWN — not "none"/);
    }, 60_000);

    it('makes the WRITERS blame the credential too, not account resolution', async () => {
      // The follow-up to the case above, against the real server that produced
      // it. All four call sites share `loadJmapSession` now, so a rejected
      // credential has to arrive as a rejected credential everywhere — but
      // "everywhere" is a claim about four files, and only Stalwart can say
      // whether its 401 really looks the way the unit fakes assume.
      //
      // Before the shared loader these threw `Could not resolve a JMAP contacts
      // account…`, which is true of the parsed error document and useless to
      // whoever reads it: nothing is wrong with account provisioning.
      const wrong = { ...config, password: 'definitely-not-the-password' };
      for (const connect of [
        () => new JmapContactTarget(wrong).connect(),
        () => new JmapFileTarget(wrong).connect(),
      ]) {
        const err = (await connect().then(
          () => null,
          (e: Error) => e,
        )) as Error | null;
        expect(err).toBeInstanceOf(Error);
        // The load-bearing half: the old, wrong diagnosis is GONE, and what
        // replaces it points at the session request that actually failed.
        expect(err!.message).not.toMatch(/resolve a JMAP/);
        expect(err!.message).toMatch(/\.well-known\/jmap/);
        // 4xx rather than 401 specifically. Stalwart's exact status for a bad
        // password has not been observed from here — no Docker on the author's
        // machine, so this file is CI-only — and asserting a number nobody has
        // seen would be pinning a guess. The unit tests pin every status's
        // wording; this pins that a rejected credential reaches the operator as
        // a rejected REQUEST rather than as a missing account.
        expect(err!.message).toMatch(/returned HTTP 4\d\d/);
      }
    }, 60_000);
  });
}
