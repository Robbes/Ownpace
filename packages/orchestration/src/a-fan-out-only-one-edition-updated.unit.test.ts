// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAN-OUT ONLY ONE EDITION UPDATED (workplan 0117 T2; owner decision
 * 2026-09-11, option (b)).
 *
 * Opening "every domain's target that can enumerate itself" was written twice,
 * once per edition — `buildTargetReindexers` over connection rows, and
 * `verifyMapping`'s own inline loop over the `MappingConfig` file — and neither
 * copy knew about the other. `build-reindexers.ts` records the price of that
 * shape in full: the task domain got a source, a writer, a ledger row, a tick,
 * a place in the report and named assertions in both gates, and never a line in
 * one of those loops. Nothing failed. A lookup answered `undefined`, every
 * layer above read it as an honest no, and E2E #168 reported `tasks 0/4` about
 * a target the tasks were sitting on.
 *
 * The confirmation pass was about to make it three, on the one document
 * somebody deletes their originals from. So there is now one `fanOutTargets`,
 * and the editions differ only in an `OpenTarget`.
 *
 * **What this file guards is the RELEASE behaviour**, because that is the part
 * that was duplicated and is easy to get subtly wrong: a target that opened but
 * cannot be used has to be let go immediately, a fan-out that dies halfway must
 * not strand one connection per domain, and `close()` has to release every one
 * of them even when the first release throws. Each of those was a line in two
 * places; now it is a line in one, and these are the assertions that keep it
 * honest.
 *
 * And one refusal that is not a domain's (workplan 0085 T2): a closed
 * organisation fails the whole fan-out, and what was open is released, so a
 * verification or a confirmation queued before the close records no verdict.
 */

import { describe, it, expect } from 'vitest';
import {
  CredentialRefusalError,
  DISCOVERY_DOMAINS,
  grantWithdrawnRefusal,
  organisationClosedRefusal,
  type DiscoveryDomain,
} from '@openmig/shared';
import { asReindexer, fanOutTargets, GATE_NAME, LEDGER_DOMAIN } from './target-fan-out.ts';

/** A target that can enumerate itself, and one that cannot. */
const enumerable = { listEntries: () => Promise.resolve([]) };
const inert = { writeOnly: true };

/** An opener that records what it was asked for and what it released. */
function recordingOpener(
  behaviour: Partial<Record<DiscoveryDomain, 'enumerable' | 'inert' | 'throws' | 'closed' | 'withdrawn'>> = {},
) {
  const asked: DiscoveryDomain[] = [];
  const released: DiscoveryDomain[] = [];
  const open = (domain: DiscoveryDomain) => {
    asked.push(domain);
    const how = behaviour[domain] ?? 'enumerable';
    if (how === 'throws') return Promise.reject(new Error(`no ${domain} connection`));
    // What the managed builders throw for a closed organisation (0085 T2), and
    // for a grant the person took back: two refusals, only one of them the
    // whole organisation's.
    if (how === 'closed') {
      return Promise.reject(new CredentialRefusalError(organisationClosedRefusal({ closedAt: null, purgeAfter: null })));
    }
    if (how === 'withdrawn') return Promise.reject(new CredentialRefusalError(grantWithdrawnRefusal(new Date())));
    return Promise.resolve({
      target: how === 'enumerable' ? enumerable : inert,
      close: () => {
        released.push(domain);
        return Promise.resolve();
      },
    });
  };
  return { asked, released, open };
}

const keepEnumerable = (target: unknown) => asReindexer(target);

describe('one loop, and every edition feeds it', () => {
  it('opens every wanted domain and keeps the ones that can enumerate', async () => {
    const o = recordingOpener({ contact: 'inert' });
    const fanned = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(o.asked).toEqual([...DISCOVERY_DOMAINS]);
    expect(fanned.domains).toEqual(DISCOVERY_DOMAINS.filter((d) => d !== 'contact'));
  });

  it('opens ONLY what was wanted', async () => {
    // The first confirmation builder opened all five and discarded the ones
    // nobody asked for — a connection and a full account walk per domain, paid
    // for and thrown away.
    const o = recordingOpener();
    await fanOutTargets({
      wanted: ['email', 'file'],
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(o.asked).toEqual(['email', 'file']);
  });

  it('reports domains in the ledger’s own order, whatever order they were asked in', async () => {
    // So two callers that want the same domains get the same list, and a
    // screen showing "confirming: …" does not reorder between runs.
    const o = recordingOpener();
    const fanned = await fanOutTargets({
      wanted: ['task', 'email', 'calendar'],
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(fanned.domains).toEqual(['email', 'calendar', 'task']);
  });
});

describe('nothing is held open that will not be used', () => {
  it('releases a target that opened but cannot enumerate, immediately', async () => {
    // Not tidiness: the domain is going to be reported unreadable either way,
    // and holding a connection per unusable domain for the length of a pass is
    // how a family-sized migration runs out of them.
    const o = recordingOpener({ contact: 'inert', file: 'inert' });
    const fanned = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(o.released).toEqual(['contact', 'file']);
    await fanned.close();
  });

  it('skips a domain whose target will not open, and still builds the rest', async () => {
    // A mapping with no DAV connection has no calendar target. That is not a
    // failure of the fan-out: the domain is left out, the gate reports it
    // unverifiable, and a confirmation leaves its rows `unchecked` rather than
    // calling them missing.
    const o = recordingOpener({ calendar: 'throws' });
    const fanned = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(fanned.domains).not.toContain('calendar');
    expect(fanned.domains).toContain('email');
  });

  it('releases everything already open when `keep` throws, then rethrows', async () => {
    // `keep` does real work for a confirmation — `readerOverTarget` walks the
    // whole account — so it can fail on the third domain having succeeded on
    // two. The caller never receives the `close()` it would have used, so the
    // fan-out has to release them itself or the connections are simply gone.
    const o = recordingOpener();
    let seen = 0;
    await expect(
      fanOutTargets({
        wanted: DISCOVERY_DOMAINS,
        open: o.open,
        keep: (target) => {
          seen += 1;
          if (seen === 3) throw new Error('the target went away mid-enumeration');
          return asReindexer(target);
        },
        label: '[test]',
      }),
    ).rejects.toThrow('the target went away mid-enumeration');
    // The two kept before it, plus the one being worked on when it failed.
    expect(o.released.sort()).toEqual(['calendar', 'contact', 'email']);
  });

  it('fails the whole fan-out for a closed organisation, and releases what was already open', async () => {
    // Workplan 0085 T2. The builders refuse a closed organisation for every
    // domain. Left out one by one, a verification queued before the close
    // finished as a report of nothing but NOT_VERIFIABLE, and a confirmation as
    // a run that checked nothing, each still the latest after a reopen. The
    // close's refusal goes up to the task instead, which fails with it.
    const o = recordingOpener({ contact: 'closed' });
    const refused = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused, 'a closed organisation’s fan-out went on without it').toBeInstanceOf(CredentialRefusalError);
    expect((refused as CredentialRefusalError).refusal.code).toBe('account_closed');
    // Nothing past the refusal is opened, and what was kept before it is let go.
    expect(o.asked).toEqual(['email', 'calendar', 'contact']);
    expect(o.released.sort()).toEqual(['calendar', 'email']);
  });

  it('still leaves out a data type refused for a reason of its own', async () => {
    // Only the close is the whole organisation's. A grant withdrawn on one
    // migration's source is that domain's answer, as before.
    const o = recordingOpener({ calendar: 'withdrawn' });
    const fanned = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(fanned.domains).toEqual(DISCOVERY_DOMAINS.filter((d) => d !== 'calendar'));
    await fanned.close();
  });

  it('close() releases every kept target', async () => {
    const o = recordingOpener();
    const fanned = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: o.open,
      keep: keepEnumerable,
      label: '[test]',
    });
    expect(o.released).toEqual([]);
    await fanned.close();
    expect(o.released.sort()).toEqual([...DISCOVERY_DOMAINS].sort());
  });

  it('close() releases the rest even when one release throws, and reports it', async () => {
    // A failed release must not strand the other four. Reported rather than
    // swallowed — a connection nobody let go of is a real problem, and one
    // nobody is told about is a worse one.
    const released: string[] = [];
    const fanned = await fanOutTargets({
      wanted: DISCOVERY_DOMAINS,
      open: (domain) =>
        Promise.resolve({
          target: enumerable,
          close: () => {
            if (domain === 'calendar') return Promise.reject(new Error('socket already gone'));
            released.push(domain);
            return Promise.resolve();
          },
        }),
      keep: keepEnumerable,
      label: '[test]',
    });
    await expect(fanned.close()).rejects.toThrow('socket already gone');
    expect(released.sort()).toEqual(['contact', 'email', 'file', 'task']);
  });
});

/**
 * The gap between two spellings of the same five domains.
 *
 * The ledger says `email | calendar | contact | file | task`; the verification
 * gate says `mail | calendar | contacts | files | tasks`. That gap is what cost
 * `tasks 0/4`, and with one fan-out there is now exactly one place the two
 * meet.
 */
describe('the two spellings', () => {
  it('spells the four that differ the way the gate does', () => {
    // Written out rather than derived, and that is the point: `contacts` and
    // `contact` are one letter apart, so a test that computed the expectation
    // from the map it is checking would pass on any spelling at all.
    expect(GATE_NAME.email).toBe('mail');
    expect(GATE_NAME.contact).toBe('contacts');
    expect(GATE_NAME.file).toBe('files');
    expect(GATE_NAME.task).toBe('tasks');
    expect(GATE_NAME.calendar).toBe('calendar');
  });

  it('never collides two ledger domains onto one gate slot', () => {
    // A collision would silently confirm one domain's items against another
    // domain's listing — the failure the whole translation exists to prevent.
    const gate = DISCOVERY_DOMAINS.map((d) => GATE_NAME[d]);
    expect(new Set(gate).size).toBe(DISCOVERY_DOMAINS.length);
  });

  it('round-trips, so the two maps cannot drift apart', () => {
    // `LEDGER_DOMAIN` is the same map read the other way, and a reader who
    // edits one and not the other has broken exactly the lookup that returns
    // `undefined` and reads as an honest no.
    for (const domain of DISCOVERY_DOMAINS) {
      expect(LEDGER_DOMAIN[GATE_NAME[domain]], domain).toBe(domain);
    }
  });
});
