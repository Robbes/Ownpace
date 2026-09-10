// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// The job a person starts (workplan 0117 T2, slice 4).
//
// D7(a): *"confirm every item by re-reading it from the target, for files and
// mail, offered as a job the person starts and we report on rather than a wait
// before the list appears."* Slice 2 built the deciding, slice 3 the recording,
// #915 made the evidence cross between them. This is the thing that runs.
//
// ## What it is, and what it deliberately is not
//
// It drives: ledger rows in, `confirmEach` over them, findings recorded, run
// row closed. It performs no I/O against a provider itself — the
// `ConfirmationReader` is handed in, which is what keeps this testable against
// a real database with a fake target, and keeps the adapter over the real
// connectors somewhere it can be built per domain.
//
// ## Three rules, and each one is a way the list could lie
//
// 1. **The run row always closes.** A pass that dies leaves `failed`, never a
//    row stuck in `running` (0120's rule). A person who pressed the button is
//    owed an answer, and "still going" three days later is not one.
//
// 2. **Only a CONSULTED finding is recorded.** Where `needsTargetRead` waives a
//    status the answer is a placeholder, and storing it would write *we looked
//    and it is not there* about an item nobody asked about. `item.confirmed_answer`
//    means "what the target said", and a NULL there is load-bearing.
//
// 3. **What was confirmed before a failure stays confirmed.** Evidence is not
//    all-or-nothing: fifty thousand items read and recorded before the network
//    dropped are fifty thousand real answers, and throwing them away would make
//    the next pass pay for them again.

import type {
  ConfirmableItem,
  ConfirmationReader,
  ConfirmedFinding,
} from './confirmation-pass.ts';
import { confirmEach, tally, type ConfirmationTally } from './confirmation-pass.ts';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';

/**
 * One item to decide about, and the id a finding is recorded against.
 *
 * `ConfirmableItem` — what the pass reasons over — plus the ledger's own id,
 * which is what `record` writes against and what `naturalKeyHash` is not.
 */
export interface ConfirmableRowRef extends ConfirmableItem {
  readonly itemId: string;
}

/**
 * What this needs from the ledger — the two verbs, and nothing else.
 *
 * A port rather than the concrete `ConfirmationStore` so the runner can be
 * driven against a real database in one test and a counting fake in another,
 * and so `@openmig/core` does not reach for drizzle.
 */
export interface ConfirmationRecorder {
  itemsToConfirm(args: {
    tenantId: TenantId;
    mappingId: MappingId;
    domain: DiscoveryDomain;
  }): AsyncIterable<ConfirmableRowRef>;
  record(args: {
    tenantId: TenantId;
    runId: string;
    finding: { itemId: string; answer: ConfirmedFinding['answer'] };
  }): Promise<void>;
}

/** What this needs from the run ledger. */
export interface ConfirmationRunLog {
  startRun(input: {
    tenantId: TenantId;
    mappingId: MappingId;
    kind: 'confirm';
    trigger: 'manual' | 'schedule' | 'event';
  }): Promise<string>;
  finishRun(
    runId: string,
    outcome: 'succeeded' | 'failed' | 'cancelled',
    stats?: Record<string, unknown>,
  ): Promise<void>;
}

/** What one finished pass reports. */
export interface ConfirmationRunResult {
  readonly runId: string;
  readonly tally: ConfirmationTally;
  /** How many findings were written down. Never more than `tally.total`. */
  readonly recorded: number;
}

/**
 * Run a confirmation pass over one mapping's domains, and report on it.
 *
 * `readerFor` is asked per domain and may answer `undefined` — a domain with no
 * way to re-read the target is skipped, and its rows keep their NULL answer and
 * read as `unchecked`. That is the honest outcome: the alternative is a domain
 * silently reported as confirmed by a pass that never asked it anything.
 */
export async function runConfirmationPass(args: {
  tenantId: TenantId;
  mappingId: MappingId;
  domains: readonly DiscoveryDomain[];
  readerFor: (domain: DiscoveryDomain) => ConfirmationReader | undefined;
  ledger: ConfirmationRecorder;
  runs: ConfirmationRunLog;
  trigger?: 'manual' | 'schedule' | 'event';
}): Promise<ConfirmationRunResult> {
  const runId = await args.runs.startRun({
    tenantId: args.tenantId,
    mappingId: args.mappingId,
    kind: 'confirm',
    // `manual` by default: D7(a) made this a job a PERSON starts. A pass that
    // arrives on a schedule is a different product decision, and it should have
    // to say so rather than inherit the word.
    trigger: args.trigger ?? 'manual',
  });

  const rows: ConfirmedFinding['row'][] = [];
  let recorded = 0;

  // EVERYTHING INSIDE THE TRY, so rule 1 holds for a throw anywhere — the
  // reader, the ledger, or the stream itself.
  try {
    for (const domain of args.domains) {
      const reader = args.readerFor(domain);
      if (!reader) continue;
      const items = args.ledger.itemsToConfirm({
        tenantId: args.tenantId,
        mappingId: args.mappingId,
        domain,
      });
      for await (const found of confirmEach(domain, items, reader)) {
        rows.push(found.row);
        // Rule 2. `consulted` is the pass's own word for "the target was asked",
        // and it is the only thing that may put a value in that column.
        if (found.consulted) {
          await args.ledger.record({
            tenantId: args.tenantId,
            runId,
            finding: { itemId: found.item.itemId, answer: found.answer },
          });
          recorded += 1;
        }
      }
    }
  } catch (err) {
    // Rule 3: what is already recorded stays recorded — nothing is undone here.
    // The counters go on the row so a person can see how far it got, which is
    // the difference between "it failed" and "it failed after 50,000 items".
    await args.runs.finishRun(runId, 'failed', {
      itemsProcessed: rows.length,
      errors: 1,
      recorded,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const counted = tally(rows);
  await args.runs.finishRun(runId, 'succeeded', {
    itemsProcessed: counted.total,
    errors: 0,
    recorded,
    verified: counted.verified,
    byState: counted.byState,
  });
  return { runId, tally: counted, recorded };
}
