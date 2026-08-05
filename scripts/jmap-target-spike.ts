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
 *   Bring the dev Stalwart up first, if it is not already:
 *     deploy/selfhost/setup-stalwart.sh
 *
 *   Then:
 *     pnpm exec tsx scripts/jmap-target-spike.ts
 *
 *   Environment:
 *     JMAP_BASE_URL   default http://127.0.0.1:18080 — `setup-stalwart.sh`'s
 *                     published port (STALWART_JMAP_PORT), not JMAP's 8080.
 *                     Inside the dev network the same server is stalwart:8080.
 *     JMAP_USER       default target@dev.local — one of the accounts
 *                     `setup-stalwart.sh` leaves behind, and the right one:
 *                     0031 is about JMAP as a TARGET.
 *     JMAP_PASSWORD   defaults to that account's dev password ONLY against a
 *                     loopback URL — see below.
 *
 * NOT `admin:provision_password`. That credential exists only during the setup
 * script's PHASE 1 (recovery mode, `STALWART_RECOVERY_ADMIN`); phase 2 restarts
 * the container without it and the account stops authenticating. Using it here
 * cost a 401 and a puzzled minute on 2026-08-05 — the script's own closing
 * output lists the accounts that survive, and those are the ones to use.
 */

const BASE = process.env.JMAP_BASE_URL || 'http://127.0.0.1:18080';
const USER = process.env.JMAP_USER || 'target@dev.local';

/**
 * Loopback gets the dev default; anything else must be told.
 *
 * `target_password` is not a secret — it is `setup-stalwart.sh`'s committed
 * fixture credential, in the repo in plain text, for a throwaway container of
 * `dev.local` accounts. Refusing to run without it would be theatre: it
 * protects nothing and costs everybody a lookup.
 *
 * What hard rule 3 is actually about is a real credential reaching a real
 * server, so the default stops at the boundary where that becomes possible.
 * Point this at a host that is not loopback and it demands the password,
 * because at that point the script no longer knows what it is talking to.
 */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(BASE);
const PASSWORD = process.env.JMAP_PASSWORD || (LOOPBACK ? 'target_password' : undefined);

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
    // CORRECTED 2026-08-05 by the first real run. This asked for
    // `urn:ietf:params:jmap:blob` and warned that blob alone gives no
    // collection model — true of blob, and beside the point, because Stalwart
    // advertises `urn:ietf:params:jmap:filenode`, which IS the file-node
    // concept. Checking the wrong URN would have reported a doubt that the
    // server had already answered.
    domain: 'files (0031 T3)',
    urn: 'urn:ietf:params:jmap:filenode',
    absence:
      'No JMAP filenode capability. Blob alone is not enough: it addresses ' +
      'opaque content, not a named hierarchy, so without filenode there is no ' +
      'collection model to map WebDAV paths onto and T3 is blocked on ' +
      'protocol grounds rather than server grounds.',
  },
] as const;

interface JmapSession {
  readonly state?: string;
  readonly capabilities?: Record<string, unknown>;
  readonly apiUrl?: string;
  readonly primaryAccounts?: Record<string, string>;
}

async function main(): Promise<number> {
  if (!PASSWORD) {
    console.error(
      `JMAP_PASSWORD is not set, and ${BASE} is not loopback.\n` +
        'The dev-stack default is only applied to 127.0.0.1 — against anything\n' +
        'else this script does not know what it is authenticating to, so it asks.',
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
      // Rule 9: the server's own words. A 401 means credentials, a 404 means
      // this is not a JMAP server, and they need different fixes — so the
      // hint is attached to the status rather than printed for every failure.
      console.error(`The session endpoint answered ${res.status}: ${await res.text()}`);
      if (res.status === 401) {
        console.error(
          `\nAuthenticated as ${USER}. If that is the dev stack's own account the\n` +
            'password may have changed; if you overrode JMAP_USER with `admin`, note\n' +
            "that `admin:provision_password` works only during setup-stalwart.sh's\n" +
            'PHASE 1 (recovery mode). Phase 2 restarts without it. The accounts that\n' +
            'survive are the ones that script prints when it finishes.',
        );
      }
      return 1;
    }
    session = (await res.json()) as JmapSession;
  } catch (err) {
    // Name the fix rather than the symptom: on a fresh box the answer is
    // almost always that the dev Stalwart was never brought up.
    console.error(
      `Could not reach ${sessionUrl}: ${err instanceof Error ? err.message : err}\n\n` +
        'If the dev stack is not running, start it with:\n' +
        '    deploy/selfhost/setup-stalwart.sh\n' +
        'That script provisions the container, the dev.local domain and the\n' +
        'source/target/shared accounts, and publishes JMAP on 18080.',
    );
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

  // -------------------------------------------------------------------------
  // Step 1b — can we actually CALL the API, and what is on this account?
  //
  // Two facts step 2 needs and cannot assume. First, that the rebuilt endpoint
  // works: the session's own apiUrl is unroutable here, so every later request
  // depends on the baseUrl reconstruction being right rather than on the
  // server's advice. Second, the calendar ids — step 2 has to write an event
  // somewhere, and inventing a container id is how a spike fails for a reason
  // that has nothing to do with what it was asking.
  // -------------------------------------------------------------------------
  const apiUrl = BASE.endsWith('/') ? `${BASE}jmap` : `${BASE}/jmap`;
  const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:calendars'];
  console.log(`\n=== Step 1b — calling ${apiUrl} (NOT the advertised apiUrl)\n`);

  if (!accountId) {
    console.log('    No primary account for calendars, so there is nothing to call with.');
  } else {
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:calendars'],
          methodCalls: [['Calendar/get', { accountId, ids: null }, '0']],
        }),
      });
      const text = await res.text();
      console.log(`    HTTP ${res.status}`);
      // Printed raw and whole. This is a spike: the field NAMES are the
      // finding, and a summarised version would drop exactly the detail step 2
      // is being written against.
      console.log(text.slice(0, 2000));
    } catch (err) {
      console.log(`    The call failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2 — does a modified occurrence keep an identity our key can see?
  //
  // The whole plan turns on this. A recurring series and each of its modified
  // occurrences share a UID under RFC 5545, so the UID alone does not identify
  // one of them; `naturalKeyForCalendar()` appends RECURRENCE-ID for exactly
  // that reason, after the key collided and silently lost occurrences on
  // 2026-08-04.
  //
  // JSCalendar does not model an override as a separate object with its own
  // RECURRENCE-ID field. It nests them under `recurrenceOverrides`, KEYED BY
  // the recurrence id. So the question is not "is there a RECURRENCE-ID
  // property" — there is not — but whether the key of that map is the same
  // value CalDAV would have put in RECURRENCE-ID. If it is, the transformation
  // is mechanical and answer 2 in the plan applies. If it is not, answer 3.
  //
  // This CREATES one event in the dev calendar and then DELETES it. That is
  // the first thing in this file to write anything, so it is confined to the
  // throwaway `dev.local` account, and the delete runs even when the read
  // fails — a spike that leaves debris behind poisons the next run.
  // -------------------------------------------------------------------------
  console.log(`\n=== Step 2 — a modified occurrence, written and read back\n`);
  const calendarId = 'b';
  const uid = `openmig-spike-${session.state ?? 'x'}-recurring`;
  const OVERRIDE_AT = '2026-09-08T09:00:00';

  if (!accountId) {
    console.log('    No calendars account; cannot run step 2.');
    return 1;
  }

  const call = async (methodCalls: unknown[][]): Promise<string> => {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:calendars'],
        methodCalls,
      }),
    });
    return res.text();
  };

  // A LADDER, not a single attempt. The first run was refused with
  // `invalidProperties: ["recurrenceRules"]`, which says the rule shape was
  // wrong — NOT that Stalwart lacks recurrence, and not anything at all about
  // `recurrenceOverrides`, which it never got far enough to judge. Concluding
  // "no recurrence support" from that would have been the spike answering a
  // question it had not asked.
  //
  // So each rung adds ONE thing to the rung below, and the first failure names
  // the exact property that is not accepted. Every rung cleans up after itself.
  const rungs: Array<{ name: string; props: Record<string, unknown> }> = [
    { name: '1. plain single event', props: {} },
    {
      name: '2. + recurrenceRules WITH @type',
      props: { recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'weekly', count: 3 }] },
    },
    {
      name: '3. + recurrenceRules WITHOUT @type',
      props: { recurrenceRules: [{ frequency: 'weekly', count: 3 }] },
    },
    {
      // `count` is the likelier culprit than `frequency`: it is optional in
      // JSCalendar and a server may implement only `until`.
      name: '4. + recurrenceRules with until instead of count',
      props: {
        recurrenceRules: [{ frequency: 'weekly', until: '2026-09-22T09:00:00' }],
      },
    },
    {
      name: '5. + recurrenceOverrides ONLY (no rule)',
      props: { recurrenceOverrides: { [OVERRIDE_AT]: { title: 'openmig spike — MOVED' } } },
    },
  ];

  for (const rung of rungs) {
    const base = {
      '@type': 'Event',
      calendarIds: { [calendarId]: true },
      uid: `${uid}-${rung.name.slice(0, 1)}`,
      title: 'openmig spike',
      start: '2026-09-01T09:00:00',
      timeZone: 'Europe/Amsterdam',
      duration: 'PT1H',
      ...rung.props,
    };
    let id: string | undefined;
    try {
      const out = await call([['CalendarEvent/set', { accountId, create: { r: base } }, '0']]);
      id = (/"id":"([^"]+)"/.exec(out) ?? [])[1];
      console.log(`  ${id ? 'OK   ' : 'FAIL '} ${rung.name}`);
      if (!id) {
        // The server's own words, verbatim: `properties` names exactly what it
        // would not take, and that is the finding rather than the failure.
        console.log(`         ${out.slice(0, 600)}`);
      } else {
        const read = await call([['CalendarEvent/get', { accountId, ids: [id] }, '0']]);
        console.log(`         read back: ${read.slice(0, 1200)}`);
      }
    } catch (err) {
      console.log(`  ERROR ${rung.name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (id) await call([['CalendarEvent/set', { accountId, destroy: [id] }, '0']]).catch(() => undefined);
    }
  }

  console.log(
    `\n    Read the highest rung that succeeded, and its read-back object.\n` +
      `    uid written: ${uid}-N      override map key: ${OVERRIDE_AT}\n` +
      `    The question is whether an override's map key survives UNCHANGED —\n` +
      `    that key is what must equal CalDAV's RECURRENCE-ID for\n` +
      `    naturalKeyForCalendar() to agree across a transport switch.\n`,
  );

  // -------------------------------------------------------------------------
  // Step 3 — contacts and files (0031 T2/T3), same question, same method.
  //
  // Added on the owner's call after calendars came back blocked: the useful
  // question is no longer "can T1 be built" but "is the calendar gap an
  // EXCEPTION or a PATTERN". Stalwart's own JMAP conformance suite covers mail
  // only — its maintainers said so — so these surfaces are less exercised than
  // the mail one this product already relies on, and finding out costs a
  // request each.
  //
  // For each: write with an identity we control, read it back, and see whether
  // that identity survives. Contacts key on the vCard UID; files key on a
  // normalised path. Both are what `hash.ts` hashes.
  // -------------------------------------------------------------------------
  console.log(`\n=== Step 3 — contacts and files\n`);

  const contactsAccount = session.primaryAccounts?.['urn:ietf:params:jmap:contacts'];
  if (contactsAccount) {
    const contactUid = `openmig-spike-contact-${session.state ?? 'x'}`;
    let cid: string | undefined;
    try {
      const out = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'],
          methodCalls: [
            [
              'ContactCard/set',
              {
                accountId: contactsAccount,
                create: {
                  c: { '@type': 'Card', uid: contactUid, name: { full: 'Openmig Spike' } },
                },
              },
              '0',
            ],
          ],
        }),
      }).then((r) => r.text());
      cid = (/"id":"([^"]+)"/.exec(out) ?? [])[1];
      console.log(`  ${cid ? 'OK   ' : 'FAIL '} ContactCard/set`);
      console.log(`         ${out.slice(0, 800)}`);
      if (cid) {
        const back = await fetch(apiUrl, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'],
            methodCalls: [['ContactCard/get', { accountId: contactsAccount, ids: [cid] }, '0']],
          }),
        }).then((r) => r.text());
        console.log(`         read back: ${back.slice(0, 1200)}`);
        console.log(`         uid written: ${contactUid}  <- must appear UNCHANGED above`);
        await fetch(apiUrl, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'],
            methodCalls: [['ContactCard/set', { accountId: contactsAccount, destroy: [cid] }, '0']],
          }),
        }).catch(() => undefined);
      }
    } catch (err) {
      console.log(`  ERROR contacts: ${err instanceof Error ? err.message : err}`);
    }
  }

  const filesAccount = session.primaryAccounts?.['urn:ietf:params:jmap:filenode'];
  if (filesAccount) {
    try {
      // READ ONLY for files. The identity question here is what a FileNode
      // calls itself — name, parentId, or a path — and listing answers that
      // without creating anything in a hierarchy whose shape is still unknown.
      const out = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:filenode'],
          methodCalls: [['FileNode/get', { accountId: filesAccount, ids: null }, '0']],
        }),
      }).then((r) => r.text());
      console.log(`\n  FileNode/get (read-only): ${out.slice(0, 1500)}`);
      console.log(
        `         The finding is the FIELD NAMES: does a node carry a path, or\n` +
          `         only a name plus a parentId? fileNaturalKeyHash() hashes a\n` +
          `         normalised PATH, so a parent-chain model needs a documented\n` +
          `         reconstruction before T3 can key anything.`,
      );
    } catch (err) {
      console.log(`  ERROR files: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\n    apiUrl (as advertised): ${session.apiUrl ?? '(absent)'} — not followed; see above.\n`,
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
