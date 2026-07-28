// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The §20 verification gate, against real servers, for the first time.
//
// Everything proving the gate so far has run against Testcontainers Postgres
// with in-memory or canned targets. The pieces it depends on have never met a
// real server:
//   - the CalDAV/CardDAV/WebDAV reindexers (#142) — unit-tested against canned
//     207 bodies only, never a real Nextcloud;
//   - `contentHashFor` for mail (#143) — whether a JMAP blob comes back
//     byte-identical to what was submitted is a property of the SERVER, not of
//     our code, and cannot be established by a test double;
//   - `sizeBytes` → `totalBytesTarget`, likewise.
//
// The restart-resume gate that e2e.yml already runs exercises the sync path —
// the target WRITERS. It never calls `listEntries` and never calls
// `runVerification`, so a green e2e has so far said nothing about any of this.
//
// This runs the real gate over the data the restart-resume gate just synced,
// via the appliance's `GET /verify`, and reports the diagnostics that only a
// real server can settle. It is deliberately loud about them: a systematic
// 100% checksum mismatch means the JMAP server does not store blobs verbatim
// and mail needs the same treatment CalDAV/CardDAV got, which is exactly the
// kind of thing that must not be discovered during someone's cutover.
//
// PREREQUISITES: same running stack as selfhost-restart-resume.e2e.test.ts, and
// it must have run TO COMPLETION first so there is synced data to verify.
//
// That ordering is not advisory. e2e.yml used to filter both suites with
// `pnpm test:e2e -- --grep "..."`, which filtered nothing at all (pnpm forwards
// a literal `--`, and vitest discards everything after it), so both files ran
// in one process in parallel: this suite called `GET /verify` ~0.4s in, before
// a single item had synced and while runAllDomains was still mid-flight against
// the same targets. The workflow now selects each suite by file path, one step
// each, in order.

import { describe, it, expect, beforeAll } from 'vitest';

const SELFHOST_PORT = process.env.SELFHOST_PORT || '8081';
const SELFHOST_BIND = process.env.SELFHOST_BIND || '127.0.0.1';
const VERIFY_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}/verify`;

const DOMAINS: string[] = (process.env.E2E_DOMAINS || 'email,calendar,contact,file')
  .split(',')
  .map((d) => d.trim())
  .filter((d) => d.length > 0);

/** Verification domain names, as the report keys them. */
const DOMAIN_KEY: Record<string, 'mail' | 'calendar' | 'contacts' | 'files'> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contacts',
  file: 'files',
};

interface DataTypeVerification {
  dataType: string;
  status: string;
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  missingOnTarget: number;
  extraOnTarget: number;
  checksumSampleSize: number;
  checksumMatches: number;
  checksumMismatches: number;
  checksumUnavailable: number;
  totalBytesSource: number;
  totalBytesTarget: number | null;
  issues: Array<{ id: string; severity: string; message: string }>;
}

interface VerificationReport {
  overallStatus: string;
  score: number;
  canProceedToCutover: boolean;
  totalItemsSource: number;
  totalItemsTarget: number;
  totalDiscrepancies: number;
  recommendations: string[];
  mail: DataTypeVerification;
  calendar: DataTypeVerification;
  contacts: DataTypeVerification;
  files: DataTypeVerification;
}

let report: VerificationReport;

describe('Verification gate against real servers', () => {
  beforeAll(async () => {
    const response = await fetch(VERIFY_URL);
    const raw = await response.text();
    // Read the body BEFORE asserting. Asserting on `response.ok` alone threw
    // the diagnosis away: run #29 failed with a bare "500" and the cause —
    // which the endpoint had put in the body — was never printed, so the run
    // proved only that something broke.
    expect(response.ok, `GET /verify failed: ${response.status}\n${raw}`).toBe(true);
    const byMapping = JSON.parse(raw) as Record<string, VerificationReport>;

    const first = Object.values(byMapping)[0];
    expect(first, 'no mapping in the /verify response').toBeTruthy();
    report = first!;

    // Print the whole thing. When this fails on someone's stack the numbers are
    // the diagnosis, and a bare assertion message is not enough to act on.
    console.log('[e2e] verification report:', JSON.stringify(report, null, 2));
  }, 300000);

  it('PASSES over the data the sync just wrote', () => {
    // The headline. Everything else here explains a failure of this.
    expect(report.overallStatus, report.recommendations.join('; ')).not.toBe('FAIL');
    expect(report.canProceedToCutover).toBe(true);
  });

  for (const domain of DOMAINS) {
    const key = DOMAIN_KEY[domain]!;

    it(`${domain}: the target reindexer can read the target at all`, () => {
      const d = report[key];
      // NOT_VERIFIABLE means the domain was enabled and no reindexer could read
      // it. For the DAV domains this is the first time the reindexers built in
      // #142 have faced a real Nextcloud.
      expect(d.status, d.issues.map((i) => i.message).join('; ')).not.toBe('NOT_VERIFIABLE');
    });

    it(`${domain}: counts match between the ledger and the target`, () => {
      const d = report[key];
      if (d.status === 'SKIPPED') return; // nothing synced for this domain

      expect(d.sourceCount).toBeGreaterThan(0);
      expect(d.targetCount).toBe(d.sourceCount);
      expect(d.missingOnTarget).toBe(0);
    });
  }

  it('reports whether checksum sampling actually ran, and how it went', () => {
    // Not an assertion so much as the measurement this whole run exists to
    // take. A systematic mismatch (every sample) means the server does not
    // store what we sent byte-for-byte — a property of the server, which no
    // amount of unit testing can establish.
    for (const key of ['mail', 'calendar', 'contacts', 'files'] as const) {
      const d = report[key];
      if (d.status === 'SKIPPED' || d.checksumSampleSize === 0) continue;
      console.log(
        `[e2e] ${key} checksums: ${d.checksumMatches} match, ${d.checksumMismatches} mismatch, ` +
          `${d.checksumUnavailable} unavailable of ${d.checksumSampleSize} sampled`,
      );
    }

    const mail = report.mail;
    if (mail.status !== 'SKIPPED' && mail.checksumMatches + mail.checksumMismatches > 0) {
      // If the JMAP blob does NOT round-trip byte-identically, every single
      // sample mismatches. That is distinguishable from real corruption, and it
      // means mail's contentHashFor must be withdrawn the way CalDAV/CardDAV's
      // already is.
      expect(
        mail.checksumMismatches,
        'every mail checksum mismatched — the JMAP server is not storing blobs verbatim, ' +
          'so mail contentHashFor is comparing re-serialized bytes against source bytes',
      ).toBeLessThan(mail.checksumMatches + mail.checksumMismatches);
    }
  });

  it('reports whether target bytes could be measured', () => {
    for (const key of ['mail', 'calendar', 'contacts', 'files'] as const) {
      const d = report[key];
      if (d.status === 'SKIPPED') continue;
      console.log(
        `[e2e] ${key} bytes: source=${d.totalBytesSource} target=${d.totalBytesTarget ?? 'not measured'}`,
      );
    }
    // Deliberately not asserted: null is an honest answer for a target that
    // does not report sizes for every item, and failing on it would push
    // someone toward fabricating a number.
    expect(report.totalItemsTarget).toBeGreaterThan(0);
  });

  it('finds nothing on the target that the ledger does not know about', () => {
    // Extras are not a hard failure — the target may hold pre-existing data —
    // but on a freshly-provisioned e2e stack there should be none, and any
    // would mean the sync wrote something it did not record.
    expect(report.totalDiscrepancies).toBe(0);
  });
});
