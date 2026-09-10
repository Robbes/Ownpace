// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LIST SOMEBODY DELETES ON THE STRENGTH OF (workplan 0117 T2, D7 branch (a)).
 *
 * T2 hands a person a list and they empty a folder on the back of it. There is
 * no undo on the other side of that: the source copy is gone, and if our row
 * was wrong by one word the item now exists nowhere. Every assertion here is
 * about a word.
 *
 * The failure this guards is not a crash. It is a pass that **succeeds and
 * says the wrong thing** — which no amount of integration testing catches,
 * because the machinery worked perfectly.
 *
 * ## The three ways this list can lie, one describe block each
 *
 * **1. It can say "verified" over something that was never put there.** Four
 * of the ledger's nine statuses are rows that are not copies. They must appear
 * — omitting them tells somebody their library is smaller than it is — and
 * they must claim nothing.
 *
 * **2. It can say "verified" over the customer's own bytes.** The `adopted`
 * status covers two different rows (see `confirmed-list.ts` for the reading
 * out of `domain-sync.ts`), and one of them is EXPECTED to differ from what
 * the ledger holds. A naive hash comparison reports a customer's own edited
 * file as changed, in the one document where alarm is most expensive.
 *
 * **3. It can say "verified by hash" over a calendar entry.** For calendar and
 * contacts there is no byte-hash claim to be made at all, permanently and by
 * design — a DAV server re-serialises what it stores. The comparison is real;
 * the word "hash" is not. §7d of the workplan is explicit that the list holds
 * two kinds of row and must say which per row.
 *
 * `packages/shared/src/confirmed-list.ts` is the whole subject, and it is
 * deliberately pure: no I/O, nothing to mock, and therefore no way for this
 * guard to pass because a fake behaved.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimCeilingFor,
  countsAsVerified,
  mustAppearDespiteNoClaim,
  needsTargetRead,
  rowFor,
  DISCOVERY_DOMAINS,
  type ClaimKind,
  type ConfirmedRow,
  type DiscoveryDomain,
  type LedgerRecord,
} from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Whole-line comments stripped, so a guard never matches its own explanation. */
const source = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

/** Every status the ledger's CHECK constraint admits, plus the pre-column row. */
const ALL_STATUSES: ReadonlyArray<LedgerRecord['status']> = [
  undefined,
  'pending',
  'copied',
  'updated',
  'adopted',
  'skipped',
  'failed',
  'left_behind',
  'deleted_source',
  'tombstoned',
];

/** Every answer a re-read can give. */
const ALL_ANSWERS = [
  { onTarget: false },
  { onTarget: true, comparison: 'match' },
  { onTarget: true, comparison: 'differ' },
  { onTarget: true, comparison: 'unavailable' },
  // The answer slice 2 had to add: the target could not be asked at all.
  { unreachable: true },
] as const;

/**
 * The answers where the target ACTUALLY ANSWERED.
 *
 * Three tests below make claims of the form *"whatever the target says"*, and
 * those claims are about a target that said something. `{ unreachable: true }`
 * is not the target saying something — it is us failing to ask — and it
 * deliberately outranks every ledger status (see the last describe). Sweeping
 * it into those three would turn each of them into an assertion that the
 * unreachable rule does not exist.
 */
const ANSWERED = ALL_ANSWERS.filter((a) => !('unreachable' in a));

const everyRow = (): Array<{
  domain: DiscoveryDomain;
  status: LedgerRecord['status'];
  answer: (typeof ALL_ANSWERS)[number];
  row: ConfirmedRow;
}> => {
  const out = [];
  for (const domain of DISCOVERY_DOMAINS) {
    for (const status of ALL_STATUSES) {
      for (const answer of ALL_ANSWERS) {
        out.push({ domain, status, answer, row: rowFor({ domain, status, answer }) });
      }
    }
  }
  return out;
};

describe('a row that was never placed cannot read as verified, and cannot be hidden', () => {
  const NEVER_PLACED = [undefined, 'pending', 'skipped', 'failed', 'left_behind'] as const;

  it('claims nothing, whatever the target says', () => {
    // Crucially INCLUDING `comparison: 'match'`. A re-read can find something
    // under the natural key of an item we never placed — the customer's own,
    // or a later manual copy — and a rule that consulted the answer first
    // would confirm an item this product never migrated.
    for (const status of NEVER_PLACED) {
      for (const domain of DISCOVERY_DOMAINS) {
        for (const answer of ANSWERED) {
          const row = rowFor({ domain, status, answer });
          expect(
            row,
            `status '${String(status)}' on ${domain} with answer ${JSON.stringify(answer)} ` +
              'produced a claim. Nothing was placed; there is nothing to confirm.',
          ).toEqual({ state: 'never-placed', claim: 'none' });
        }
      }
    }
  });

  it('is still a row the list has to show', () => {
    // 0117 §7c: "a list that silently omits them tells somebody their library
    // is smaller than it is." The predicate exists so a template cannot filter
    // them out without this failing.
    for (const status of NEVER_PLACED) {
      const row = rowFor({ domain: 'file', status, answer: { onTarget: false } });
      expect(mustAppearDespiteNoClaim(row), `'${String(status)}' would be filtered out`).toBe(true);
    }
  });

  it('never counts toward the headline', () => {
    for (const { row } of everyRow()) {
      if (row.state !== 'never-placed') continue;
      expect(countsAsVerified(row)).toBe(false);
    }
  });
});

describe("the customer's own bytes are never reported as ours, verified or wrong", () => {
  it('an adopted row says `yours` and claims nothing, on every answer', () => {
    // The load-bearing case is `differ`. An adopted-by-conflict row holds the
    // hash of what WE wrote and the target has since been edited by the
    // customer — hard rule 2 left it alone deliberately — so a re-read
    // SHOULD differ. Reporting that as `differs` would tell somebody their
    // own edit is a migration fault.
    for (const domain of DISCOVERY_DOMAINS) {
      for (const answer of ANSWERED) {
        expect(
          rowFor({ domain, status: 'adopted', answer }),
          `adopted/${domain} with ${JSON.stringify(answer)} did not read as 'yours'`,
        ).toEqual({ state: 'yours', claim: 'none' });
      }
    }
  });

  it('and is excluded from the verified headline even though it is on the target', () => {
    const row = rowFor({
      domain: 'file',
      status: 'adopted',
      answer: { onTarget: true, comparison: 'match' },
    });
    expect(row.state).toBe('yours');
    expect(
      countsAsVerified(row),
      'an adopted row counted as verified. The headline says "verified"; this was not.',
    ).toBe(false);
  });

  it('the reading that produced this rule is recorded where the rule lives', () => {
    // 0117 §7c says of adopted items "we never wrote these and never hashed
    // them", and that is wrong on both halves — the source item was fetched
    // and hashed, and one of the two adopted shapes was written by us. If the
    // correction is ever deleted, the next reader will re-derive the naive
    // comparison from the workplan and ship it.
    const src = read('packages/shared/src/confirmed-list.ts');
    expect(src, 'the two adopted shapes are no longer distinguished in the docblock').toMatch(
      /adopted at first sight/i,
    );
    expect(src).toMatch(/adopted by conflict/i);
    expect(
      src,
      'the docblock no longer says the ledger cannot tell the two shapes apart — which is ' +
        'the entire reason `yours` exists rather than a hash comparison.',
    ).toMatch(/cannot tell the two apart/i);
  });
});

describe('the two kinds of claim, and the one word that must not travel', () => {
  it('files and mail can claim bytes; calendar, contacts and tasks never can', () => {
    expect(claimCeilingFor('file')).toBe('byte-hash');
    expect(claimCeilingFor('email')).toBe('byte-hash');
    expect(claimCeilingFor('calendar')).toBe('fingerprint');
    expect(claimCeilingFor('contact')).toBe('fingerprint');
    // Tasks are VTODO over CalDAV (0113) — the same re-serialisation, so the
    // same ceiling. A task inheriting the file answer would be the fan-out
    // defect this repo has now paid for twice.
    expect(claimCeilingFor('task')).toBe('fingerprint');
  });

  it('every domain has an answer — a new one cannot default into bytes', () => {
    for (const domain of DISCOVERY_DOMAINS) {
      const ceiling: ClaimKind = claimCeilingFor(domain);
      expect(['byte-hash', 'fingerprint', 'none']).toContain(ceiling);
    }
  });

  it('a matching calendar row is verified BY FINGERPRINT, never by hash', () => {
    const row = rowFor({
      domain: 'calendar',
      status: 'copied',
      answer: { onTarget: true, comparison: 'match' },
    });
    expect(row.state).toBe('verified');
    expect(
      row.claim,
      'a calendar row claimed a byte hash. A DAV server re-serialises what it stores, so the ' +
        'two strings compared were fingerprints — the comparison is real and the word is not.',
    ).toBe('fingerprint');
  });

  it('no row anywhere claims more than its domain allows', () => {
    // The sweep. Anything that raises a claim above the ceiling — a rule that
    // read the answer before the domain, say — fails here rather than in the
    // one hand-written case above.
    for (const { domain, status, answer, row } of everyRow()) {
      if (row.claim === 'none') continue;
      expect(
        row.claim,
        `${domain}/${String(status)}/${JSON.stringify(answer)} claims '${row.claim}' above its ` +
          `ceiling '${claimCeilingFor(domain)}'`,
      ).toBe(claimCeilingFor(domain));
    }
  });

  it('an uncomparable answer is `present`, not a mismatch and not a pass', () => {
    // A JMAP contact target implements no contentHashFor at all, deliberately.
    // Scoring those as mismatches would fail a migration that is fine;
    // scoring them as matches would confirm something nobody checked.
    const row = rowFor({
      domain: 'contact',
      status: 'copied',
      answer: { onTarget: true, comparison: 'unavailable' },
    });
    expect(row).toEqual({ state: 'present', claim: 'none' });
    expect(countsAsVerified(row)).toBe(false);
  });
});

describe('the states that need somebody to do something', () => {
  it('a placed item the re-read cannot find is `missing`', () => {
    for (const status of ['copied', 'updated', 'deleted_source'] as const) {
      expect(rowFor({ domain: 'file', status, answer: { onTarget: false } })).toEqual({
        state: 'missing',
        claim: 'none',
      });
    }
  });

  it('a tombstoned row is `removed`, not missing — it is a decision, not a loss', () => {
    // The only status this product creates by destroying something. Reading it
    // as missing would turn a completed decision into an alarm, which is the
    // same mistake `isOnTarget` documents for §20 verification.
    for (const answer of ANSWERED) {
      expect(rowFor({ domain: 'file', status: 'tombstoned', answer })).toEqual({
        state: 'removed',
        claim: 'none',
      });
    }
  });

  it('`deleted_source` is still confirmable — that is the situation this list is for', () => {
    // The source no longer has the item. That is precisely when somebody wants
    // to know their copy is safe, so the row must be able to reach `verified`.
    const row = rowFor({
      domain: 'file',
      status: 'deleted_source',
      answer: { onTarget: true, comparison: 'match' },
    });
    expect(row).toEqual({ state: 'verified', claim: 'byte-hash' });
    expect(countsAsVerified(row)).toBe(true);
  });
});

describe('the headline is assembled in one place', () => {
  it('only `verified` counts, and every other state is excluded by name', () => {
    const seen = new Set<string>();
    for (const { row } of everyRow()) {
      seen.add(row.state);
      expect(
        countsAsVerified(row),
        `state '${row.state}' counted toward the verified headline`,
      ).toBe(row.state === 'verified');
    }
    // The sweep is only worth anything if it reached every state.
    expect([...seen].sort()).toEqual([
      'differs',
      'missing',
      'never-placed',
      'present',
      'removed',
      'unchecked',
      'verified',
      'yours',
    ]);
  });

  it('the module performs no I/O — there is nothing here a fake could satisfy', () => {
    // A pure module is what lets every assertion above be exhaustive rather
    // than sampled. An import of anything that reads the world would end that,
    // and would also mean the claim vocabulary had started deciding things.
    const src = source('packages/shared/src/confirmed-list.ts');
    const imports = [...src.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]!);
    expect(imports.sort(), 'confirmed-list.ts grew an import it should not have').toEqual([
      './discovery.ts',
      './ports.ts',
    ]);
    expect(/\bawait\b|\basync\b/.test(src), 'confirmed-list.ts became asynchronous').toBe(false);
  });
});

/**
 * The state the MACHINERY needed, and the vocabulary did not have
 * (workplan 0117 T2 slice 2).
 *
 * Slice 1 built the words before the pass on the grounds that a pass which
 * succeeds and says the wrong word is the dangerous failure. Building the pass
 * proved the point from the other side: `TargetAnswer` could say *there* and
 * *not there* and had no way to say *we could not tell*, so a timeout had
 * nowhere to go but `missing` — the loudest row on the list, on the document
 * somebody deletes their originals from, produced by a network blip.
 *
 * `ports.ts` already states the rule for the write side — *"treating an outage
 * as absence is how a removal gets authorised by a broken network"*. This is
 * the same rule on the reading side.
 */
describe('the pass may only skip a read where the answer could not have mattered', () => {
  it('every status `needsTargetRead` waives is decided identically by every ANSWER', () => {
    // The property that makes skipping the read safe (workplan 0117 T2 slice
    // 2, D7's cost half): *had we asked, the answer could not have changed the
    // row.* If a waived status ever became answer-dependent, the pass would
    // quietly stop checking something the list then claimed.
    //
    // `ANSWERED`, not `ALL_ANSWERS`, and the reason is the rule rather than
    // convenience. `unreachable` is not an answer the pass can receive for
    // these statuses, because it never asks — and the claim it does make about
    // them is not a claim about the target at all. `never-placed` says *it was
    // never put there*, which is a fact about our own history; `removed` says
    // *we took it back*, likewise. A target that cannot be reached leaves both
    // of those exactly as true as they were.
    for (const domain of DISCOVERY_DOMAINS) {
      for (const status of ALL_STATUSES) {
        if (needsTargetRead(status)) continue;
        const rows = ANSWERED.map((answer) => rowFor({ domain, status, answer }));
        const first = rows[0]!;
        for (const row of rows) {
          expect(
            row,
            `status '${String(status)}' is waived from the target read but its row ` +
              'depends on the answer — the pass would be skipping a read that matters',
          ).toEqual(first);
        }
      }
    }
  });

  it('and every status it does NOT waive is answer-dependent, or the read is wasted', () => {
    for (const status of ALL_STATUSES) {
      if (!needsTargetRead(status)) continue;
      // ANSWERED again, and for the same reason as above — plus one this
      // mutation harness found on 2026-09-10. With `unreachable` in the sweep
      // every status looks answer-dependent, because `unreachable` alone
      // produces `unchecked`; the assertion passed for a `needsTargetRead`
      // that had started demanding a read for `skipped`, which is exactly the
      // waste it exists to catch.
      const seen = new Set(
        ANSWERED.map((answer) => rowFor({ domain: 'file', status, answer }).state),
      );
      expect(seen.size, `status '${String(status)}' reads the target and never varies`).
        toBeGreaterThan(1);
    }
  });
});

describe('a row we could not ask about is not a row we found missing', () => {
  it('answers `unchecked` for every status, including the ones decided without the target', () => {
    // The ordering rule: `unreachable` is honoured BEFORE the status switch.
    // `skipped` and `left_behind` would answer `never-placed` from the ledger
    // alone and be right — and the list would then quietly mix rows we checked
    // with rows we did not.
    for (const domain of DISCOVERY_DOMAINS) {
      for (const status of ALL_STATUSES) {
        const row = rowFor({ domain, status, answer: { unreachable: true } });
        expect(row, `${domain}/${String(status)} on an unreachable target`).toEqual({
          state: 'unchecked',
          claim: 'none',
        });
      }
    }
  });

  it('never counts toward the headline, and can never be filtered out', () => {
    const row = rowFor({ domain: 'file', status: 'copied', answer: { unreachable: true } });
    expect(countsAsVerified(row)).toBe(false);
    // The one a template would drop hardest: it looks like an absence of
    // information rather than a fact. It is a fact, and it is the one a person
    // about to delete most needs.
    expect(mustAppearDespiteNoClaim(row)).toBe(true);
  });

  it('is a different answer from "we looked and it is gone"', () => {
    const gone = rowFor({ domain: 'file', status: 'copied', answer: { onTarget: false } });
    const unknown = rowFor({ domain: 'file', status: 'copied', answer: { unreachable: true } });
    expect(gone.state).toBe('missing');
    expect(unknown.state).toBe('unchecked');
    expect(gone).not.toEqual(unknown);
  });
});
