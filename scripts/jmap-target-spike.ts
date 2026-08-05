// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Workplan 0031 T0 — the spike that can end the plan.
 *
 * The owner decided to build JMAP as a full target for calendars, contacts and
 * files (0026 T3 row 18) because JMAP is judged more future-proof. This script
 * is the go/no-go, and it exists because the plan's whole risk is a silent one:
 * the engine's idempotency rests on the natural key for an item being IDENTICAL
 * whatever transport carried it. That is why switching a mail mapping between
 * IMAP and Graph cannot duplicate a mailbox. If a DAV-written calendar event
 * and the same event read back over JMAP hash differently, then a mapping
 * switched between the two RE-COPIES EVERYTHING — and nobody notices, because
 * a duplicate is a successful write.
 *
 * IT ASKS THE CHEAP QUESTION FIRST, and that ordering is the point.
 *
 *   Step 1 costs one HTTP request: does the server ADVERTISE the capabilities
 *   at all? JMAP for mail is RFC 8621 and settled. JMAP for calendars and
 *   contacts is younger, and there is no JMAP file-sharing standard in the
 *   sense WebDAV provides one. If Stalwart does not advertise them, the plan is
 *   blocked on the SERVER rather than on our keys — a completely different
 *   answer, reached in seconds instead of after three connectors.
 *
 *   Step 2 only runs for capabilities that exist, and does the round trip that
 *   actually matters.
 *
 * It writes NOTHING to the ledger and creates nothing outside the throwaway
 * account it is pointed at. It is a question, not a migration.
 *
 *   Usage (on a host that can reach the dev stack):
 *     pnpm exec tsx scripts/jmap-target-spike.ts
 *
 *   Environment:
 *     JMAP_BASE_URL   default http://127.0.0.1:8080
 *     JMAP_USER       default admin
 *     JMAP_PASSWORD   default (required — no default; rule 3)
 */

const BASE = process.env.JMAP_BASE_URL || 'http://127.0.0.1:8080';
const USER = process.env.JMAP_USER || 'admin';
const PASSWORD = process.env.JMAP_PASSWORD;

/**
 * The capabilities T1-T3 would each need, with what the absence of one MEANS.
 *
 * Named individually rather than as a list, because they fail independently
 * and the plan branches per domain: calendars could be buildable while files
 * are not, and "JMAP is not ready" would be the wrong summary of that.
 */
const NEEDED = [
  {
    domain: 'calendars (0031 T1)',
    urn: 'urn:ietf:params:jmap:calendars',
    absence:
      'Stalwart does not offer JMAP calendars. T1 cannot be built against this ' +
      'server at all — the blocker is the server, not our natural keys.',
  },
  {
    domain: 'contacts (0031 T2)',
    urn: 'urn:ietf:params:jmap:contacts',
    absence: 'Stalwart does not offer JMAP contacts. T2 is blocked on the server.',
  },
  {
    domain: 'files (0031 T3)',
    urn: 'urn:ietf:params:jmap:blob',
    absence:
      'No JMAP blob capability. Note that even WITH it, JMAP has no file-sharing ' +
      'model equivalent to WebDAV collections — T3 may be unbuildable on ' +
      'protocol grounds rather than server grounds, which is worth settling ' +
      'before T1 starts rather than after.',
  },
] as const;

interface JmapSession {
  readonly capabilities?: Record<string, unknown>;
  readonly apiUrl?: string;
  readonly primaryAccounts?: Record<string, string>;
}

async function main(): Promise<number> {
  if (!PASSWORD) {
    console.error(
      'JMAP_PASSWORD is not set. This script authenticates against a real server;\n' +
        'it does not carry a default password (hard rule 3).',
    );
    return 2;
  }

  const auth = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
  const sessionUrl = `${BASE}/.well-known/jmap`;

  console.log(`\n=== Step 1 — what does ${BASE} actually advertise?\n`);

  let session: JmapSession;
  try {
    const res = await fetch(sessionUrl, { headers: { Authorization: auth } });
    if (!res.ok) {
      // Rule 9: the server's own words. A 401 here means credentials, a 404
      // means this is not a JMAP server, and they need different fixes.
      console.error(`The session endpoint answered ${res.status}: ${await res.text()}`);
      return 1;
    }
    session = (await res.json()) as JmapSession;
  } catch (err) {
    console.error(`Could not reach ${sessionUrl}: ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  const advertised = Object.keys(session.capabilities ?? {});
  console.log('Capabilities advertised:');
  for (const c of advertised.sort()) console.log(`  ${c}`);

  let blocked = 0;
  console.log('\nWhat 0031 needs:\n');
  for (const need of NEEDED) {
    const present = advertised.includes(need.urn);
    console.log(`  ${present ? 'PRESENT ' : 'ABSENT  '} ${need.urn}   (${need.domain})`);
    if (!present) {
      console.log(`            ${need.absence}`);
      blocked++;
    }
  }

  if (blocked === NEEDED.length) {
    console.log(
      `\n=== ANSWER: the plan is blocked on the SERVER, not on our natural keys.\n` +
        `    None of the three capabilities is advertised, so there is nothing to\n` +
        `    round-trip against. This is workplan 0031 T0's third answer arriving\n` +
        `    in one request rather than after three connectors.\n\n` +
        `    Take this back to the owner: the row 18 decision assumed JMAP could\n` +
        `    carry these domains against the target we actually ship with. Record\n` +
        `    what this server offers, and revisit when Stalwart adds them.\n`,
    );
    return 1;
  }

  if (blocked > 0) {
    console.log(
      `\n=== PARTIAL: ${blocked} of ${NEEDED.length} domains are not available here.\n` +
        `    Build order should follow what EXISTS rather than the plan's\n` +
        `    assumption; the absent ones are blocked on the server.\n`,
    );
  }

  console.log(
    `\n=== Step 2 — the natural-key round trip\n\n` +
      `    NOT AUTOMATED YET, and deliberately not faked. Step 1 decides whether\n` +
      `    step 2 is even a question, and until a capability is advertised there\n` +
      `    is nothing to write over DAV and read back over JMAP.\n\n` +
      `    When it is: create a recurring event with a MODIFIED OCCURRENCE over\n` +
      `    CalDAV, read it back through JMAP, and compare\n` +
      `    naturalKeyForCalendar() computed from each side. That case, not the\n` +
      `    simple one, is the whole test — a series and its modified occurrences\n` +
      `    share a UID under RFC 5545, and the key only tells them apart because\n` +
      `    RECURRENCE-ID was added to it on 2026-08-04 after it silently lost\n` +
      `    occurrences. If JMAP does not expose a recurrence identifier that\n` +
      `    hashes identically, a switched mapping re-copies every modified\n` +
      `    occurrence and reports success.\n\n` +
      `    apiUrl:         ${session.apiUrl ?? '(absent)'}\n` +
      `    primaryAccounts: ${JSON.stringify(session.primaryAccounts ?? {})}\n`,
  );

  return blocked > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
