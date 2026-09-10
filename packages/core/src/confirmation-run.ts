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
//
// ## The fourth rule, added with the budget (D9)
//
// 4. **A pass that runs out of the day's bytes STOPS, and is not a failure.**
//    D9: *"it shares the tenant's budget... a large confirmation will slow a
//    migration running at the same time. That slowdown must be visible rather
//    than avoided."* 0090 T4 already settled the shape of the stop and this
//    reuses it whole — `BudgetPause`, no ledger row, nothing retried into the
//    ceiling, because the reported penalty for crossing it is a ~24-hour
//    lockout of the customer's own live account.
//
//    Stopping matters more here than in a sync. A confirmation that kept going
//    with an exhausted budget would not merely be slow: the reader's refusal
//    becomes `unreachable`, so every remaining item would be RECORDED as
//    `unchecked` — *we asked and could not tell* about items nobody asked
//    about. The gate is in this loop rather than in the reader for exactly
//    that reason: only the loop can stop taking new work.
//
//    Visible, per D9, means it reaches the run row: the pause and its numbers
//    go into `finishRun`'s stats and come back on the result, so the person who
//    pressed the button is told the limit, how much of it went, and when it
//    resets — not left watching a pass that mysteriously did half an account.

import type {
  ConfirmableItem,
  ConfirmationReader,
  ConfirmedFinding,
} from './confirmation-pass.ts';
import { confirmEach, tally, type ConfirmationTally } from './confirmation-pass.ts';
import {
  log,
  type BudgetPause,
  type ByteBudgetState,
  type DiscoveryDomain,
  type DownloadMeter,
  type MappingId,
  type TenantId,
} from '@openmig/shared';

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
  /**
   * Set when the pass stopped at the day's download ceiling (rule 4). Its
   * presence is the difference between "this is the whole account" and "this
   * is as far as today's bytes went" — which is the one thing a person must
   * not have to guess about a list they delete their originals on.
   */
  readonly budgetPause?: BudgetPause;
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
  /**
   * The tenant's byte meter for the TARGET's provider (D9, rule 4) — the same
   * instance the readers spend, so the state read here is the state their
   * fetches moved. Absent means no ceiling is known for that target and the
   * pass runs to the end, which is the right answer for a server that has one
   * and would be a dangerous one for a server that has none.
   */
  meter?: DownloadMeter;
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

  /**
   * Set the moment the meter reads empty, and never cleared: the pass stops
   * taking new work — this domain and every domain after it. Copied in
   * SEMANTICS from `domain-sync`'s `pauseNow`, not in code: that one also
   * withholds a cursor, and there is no cursor here. What is the same is the
   * contract — no ledger row, no retry, no failure — and the sentence.
   */
  const meter = args.meter;
  let budgetPause: BudgetPause | undefined;
  const pauseNow = (state: ByteBudgetState): void => {
    if (budgetPause) return;
    budgetPause = {
      provider: meter!.provider,
      ceilingBytes: state.ceilingBytes,
      spentBytes: state.spentBytes,
      windowResetsAt: state.windowResetsAt ? state.windowResetsAt.toISOString() : null,
    };
    log.info(
      `[confirm] the day's download budget for ${budgetPause.provider} is spent — ` +
        `${budgetPause.spentBytes} of ${budgetPause.ceilingBytes} bytes. This is a scheduled ` +
        `pause, not an error: the items already confirmed keep their answers, the rest are ` +
        `left UNASKED rather than recorded as unchecked, and the next pass carries on` +
        (budgetPause.windowResetsAt ? ` after the window resets at ${budgetPause.windowResetsAt}` : ' tomorrow') +
        `. It is not retried into: the ceiling's reported penalty is a lockout of the account's ` +
        `own live mail.`,
    );
  };

  /**
   * Has the day's budget run out? Read BEFORE the item that would spend it, so
   * the ceiling bounds what the pass starts rather than what it finishes.
   *
   * Only asked for a domain that can actually read bytes. `hashOnTarget` is
   * absent for CalDAV and CardDAV by design (§7d), so a calendar pass spends
   * nothing, and charging it a round trip per item to discover that would be
   * this file paying for a limit it cannot reach.
   */
  const outOfBytes = async (spends: boolean): Promise<boolean> => {
    if (!meter || !spends) return false;
    const state = await meter.budget.state(meter.tenantId, meter.provider);
    if (state.remainingBytes > 0) return false;
    pauseNow(state);
    return true;
  };

  // EVERYTHING INSIDE THE TRY, so rule 1 holds for a throw anywhere — the
  // reader, the ledger, or the stream itself.
  try {
    for (const domain of args.domains) {
      if (budgetPause) break;
      const reader = args.readerFor(domain);
      if (!reader) continue;
      // Whether THIS domain's reads cost bytes: the ceiling is only asked
      // about where it can be reached.
      const spends = reader.hashOnTarget !== undefined;
      if (await outOfBytes(spends)) break;
      const items = args.ledger.itemsToConfirm({
        tenantId: args.tenantId,
        mappingId: args.mappingId,
        domain,
      });
      for await (const found of confirmEach(domain, items, reader)) {
        // By the time `confirmEach` yields, the target has ALREADY been asked
        // about this item and its bytes are already spent. So it is counted and
        // recorded like any other — dropping it here would throw away an answer
        // that was paid for — and the gate below stops the NEXT one.
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
        // The gate for the item that has not been asked about yet. Breaking
        // here leaves the remaining rows with their NULL answer — UNASKED,
        // which reads as `unchecked` — rather than recording `unreachable`
        // about items nobody looked at, which is what letting the loop run on
        // an exhausted budget would write down.
        if (await outOfBytes(spends)) break;
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
      // A pass can pause and THEN fail — on the very next domain's ledger read,
      // say. Both are true and both are reported: the failure is the outcome,
      // the pause explains why the counts stop where they do.
      ...(budgetPause ? { budgetPause } : {}),
    });
    throw err;
  }

  const counted = tally(rows);
  // `succeeded`, pause or no pause: 0090 T4's rule is that a scheduled stop is
  // not a failure, and calling it one here would put a red run on the page of
  // somebody whose account is fine and whose budget is merely spent. The pause
  // rides in the stats instead, which is what D9's "visible" means concretely —
  // the run row carries the limit, what went, and when it resets.
  await args.runs.finishRun(runId, 'succeeded', {
    itemsProcessed: counted.total,
    errors: 0,
    recorded,
    verified: counted.verified,
    byState: counted.byState,
    ...(budgetPause ? { budgetPause } : {}),
  });
  return { runId, tally: counted, recorded, ...(budgetPause ? { budgetPause } : {}) };
}
