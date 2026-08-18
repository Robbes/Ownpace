// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The migration completion report (workplan 0047) — the document an owner
 * hands their customer when a migration is done, or reads themselves to
 * decide it is.
 *
 * Nothing in it is new information: every number already lives on some screen
 * — per-domain status, the three queues, the receipts. What was missing was
 * ONE document that says "what moved, what was left behind and why, what was
 * removed and on whose decision", assembled at a moment in time and
 * downloadable. For a consultancy, that is the deliverable; for an owner, it
 * is the closing checklist.
 *
 * Lives in shared because BOTH editions serve it from the same builder
 * (rule 5): the appliance and the managed API gather the same inputs from
 * their own stores and call the same two functions. The builder is PURE —
 * inputs in, report out — so the numbers on the document can be pinned by
 * unit tests without a database.
 */

import { standingGrantsFor, type StandingGrant } from './standing-grants';
import type { DomainStatusReport } from './operating-contract';
import type { ItemDeletion, ItemFailure, ItemMove } from './ports';

/** One domain's line in the report. */
export interface CompletionDomainLine {
  readonly domain: DomainStatusReport['domain'];
  readonly state: DomainStatusReport['state'];
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly bytesTransferred: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
}

/** The queues, summarised — open items are the reasons a migration is not done. */
export interface CompletionQueueSummary {
  readonly movesOpen: number;
  readonly movesAcknowledged: number;
  /** Open moves that are RELOCATIONS (appliable) — the actionable subset. */
  readonly relocationsOpen: number;
  readonly deletionsOpen: number;
  readonly deletionsAcknowledged: number;
  readonly failuresNeedingDecision: number;
}

/**
 * What the destructive path actually did, where the edition can say.
 *
 * The managed edition counts its `apply_receipt` rows; the appliance answers
 * applies synchronously and records them in its run log, so it omits this and
 * the report SAYS so instead of showing zeros that would read as "nothing was
 * ever removed".
 */
export interface CompletionAppliedSummary {
  readonly deletionsApplied: number;
  readonly relocationsApplied: number;
  readonly refused: number;
}

/**
 * The sharing checklist's closing state (ADR-0032, workplan 0052 T6b): what
 * was carried over, by whom's tick, and what is still open. Open rows do NOT
 * hold the verdict — the checklist is worked AFTER finishing (the cutover
 * gate on apply says so) — but a closing document that hid them would be the
 * silence the checklist exists to prevent.
 */
export interface CompletionSharingSummary {
  readonly applied: number;
  readonly doneManual: number;
  readonly skipped: number;
  readonly open: number;
  readonly openManual: number;
}

export interface CompletionReportInputs {
  readonly mappingId: string;
  readonly name?: string;
  readonly sourceType: string;
  readonly targetType: string;
  readonly lifecycle: string;
  readonly generatedAt: string;
  readonly domains: ReadonlyArray<DomainStatusReport>;
  readonly moves: ReadonlyArray<ItemMove>;
  readonly deletions: ReadonlyArray<ItemDeletion>;
  readonly failures: ReadonlyArray<ItemFailure>;
  readonly applied?: CompletionAppliedSummary;
  readonly sharing?: CompletionSharingSummary;
}

export interface CompletionReport {
  readonly mappingId: string;
  readonly name?: string;
  readonly sourceType: string;
  readonly targetType: string;
  readonly lifecycle: string;
  readonly generatedAt: string;
  readonly domains: ReadonlyArray<CompletionDomainLine>;
  readonly queues: CompletionQueueSummary;
  readonly applied?: CompletionAppliedSummary;
  readonly sharing?: CompletionSharingSummary;
  /**
   * The one-sentence verdict, derived, never hand-set: "complete" only when
   * every enabled domain completed AND nothing is waiting on a decision. A
   * report that says done while a queue holds open items would be the exact
   * silence the queues exist to prevent.
   */
  readonly verdict: 'complete' | 'complete_with_decisions_pending' | 'in_progress';
  /**
   * The permissions the OWNER still has to withdraw themselves
   * (workplan 0085 T4b — owner's finding, 2026-08-18).
   *
   * A finished migration is exactly where this gets forgotten. The person has
   * cut over, it worked, they are done with us — and a standing consent to
   * read their old mailbox is still sitting in their Entra tenant or their
   * Google account, granted six weeks ago and now serving no purpose.
   *
   * Derived from the source and target types, never hand-set, for the same
   * reason `verdict` is: a report that could be told what to say about this
   * would eventually be told nothing.
   *
   * Empty when neither side leaves a grant behind — a password-based IMAP
   * connection has no consent object anywhere — so a renderer shows no section
   * rather than an empty heading.
   */
  readonly standingGrants: ReadonlyArray<StandingGrant>;
}

/** Assemble the report. Pure — same inputs, same document, either edition. */
export function buildCompletionReport(inputs: CompletionReportInputs): CompletionReport {
  const openMoves = inputs.moves.filter((m) => m.acknowledgedAt === undefined);
  const queues: CompletionQueueSummary = {
    movesOpen: openMoves.length,
    movesAcknowledged: inputs.moves.length - openMoves.length,
    relocationsOpen: openMoves.filter((m) => m.toNaturalKeyHash !== undefined).length,
    deletionsOpen: inputs.deletions.filter((d) => d.confirmed && d.acknowledgedAt === undefined)
      .length,
    deletionsAcknowledged: inputs.deletions.filter((d) => d.acknowledgedAt !== undefined).length,
    failuresNeedingDecision: inputs.failures.filter((f) => f.needsDecision).length,
  };

  // Only ENABLED domains judge completion: a skipped domain is the owner's
  // scoping decision, not unfinished work (the same rule DomainSyncResult's
  // `disabled` comment records).
  const enabled = inputs.domains.filter((d) => d.state !== 'skipped');
  const allComplete = enabled.length > 0 && enabled.every((d) => d.state === 'completed');
  const decisionsPending =
    queues.movesOpen > 0 || queues.deletionsOpen > 0 || queues.failuresNeedingDecision > 0;

  return {
    mappingId: inputs.mappingId,
    ...(inputs.name ? { name: inputs.name } : {}),
    standingGrants: standingGrantsFor([inputs.sourceType, inputs.targetType]),
    sourceType: inputs.sourceType,
    targetType: inputs.targetType,
    lifecycle: inputs.lifecycle,
    generatedAt: inputs.generatedAt,
    domains: inputs.domains.map((d) => ({
      domain: d.domain,
      state: d.state,
      itemsSynced: d.itemsSynced,
      itemsFailed: d.itemsFailed,
      bytesTransferred: d.bytesTransferred,
      ...(d.lastSyncedAt ? { lastSyncedAt: d.lastSyncedAt } : {}),
      ...(d.lastError ? { lastError: d.lastError } : {}),
    })),
    queues,
    ...(inputs.applied ? { applied: inputs.applied } : {}),
    ...(inputs.sharing ? { sharing: inputs.sharing } : {}),
    verdict: !allComplete
      ? 'in_progress'
      : decisionsPending
        ? 'complete_with_decisions_pending'
        : 'complete',
  };
}

const VERDICT_SENTENCES: Record<CompletionReport['verdict'], string> = {
  complete:
    'Every enabled domain has completed and no queue is waiting on a decision.',
  complete_with_decisions_pending:
    'Every enabled domain has completed, but items are still waiting on an owner decision — ' +
    'see the queues below. The migration is not closed until they are answered.',
  in_progress: 'Not every enabled domain has completed. This is a progress snapshot, not a closing document.',
};

/** Render the report as the Markdown document an owner downloads and hands over. */
export function renderCompletionReportMarkdown(report: CompletionReport): string {
  const lines: string[] = [];
  lines.push(`# Migration completion report${report.name ? ` — ${report.name}` : ''}`);
  lines.push('');
  lines.push(`- **Mapping:** \`${report.mappingId}\``);
  lines.push(`- **Source → target:** ${report.sourceType} → ${report.targetType}`);
  lines.push(`- **Lifecycle:** ${report.lifecycle}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push('');
  lines.push(`## Verdict: ${report.verdict.replace(/_/g, ' ')}`);
  lines.push('');
  lines.push(VERDICT_SENTENCES[report.verdict]);
  lines.push('');
  lines.push('## What moved');
  lines.push('');
  lines.push('| domain | state | items synced | failed | bytes | last synced |');
  lines.push('|---|---|---:|---:|---:|---|');
  for (const d of report.domains) {
    lines.push(
      `| ${d.domain} | ${d.state} | ${d.itemsSynced} | ${d.itemsFailed} | ` +
        `${d.bytesTransferred} | ${d.lastSyncedAt ?? '—'} |`,
    );
  }
  const skipped = report.domains.filter((d) => d.state === 'skipped');
  if (skipped.length > 0) {
    lines.push('');
    lines.push(
      `${skipped.map((d) => d.domain).join(', ')}: not selected for this migration — ` +
        'not synced, not checked (an owner scoping decision, not unfinished work).',
    );
  }
  lines.push('');
  lines.push('## What is waiting on a decision');
  lines.push('');
  lines.push(`- Moves open: **${report.queues.movesOpen}** (of which relocations, appliable: ${report.queues.relocationsOpen}); acknowledged: ${report.queues.movesAcknowledged}`);
  lines.push(`- Deletions open: **${report.queues.deletionsOpen}**; decided: ${report.queues.deletionsAcknowledged}`);
  lines.push(`- Failures needing a decision: **${report.queues.failuresNeedingDecision}**`);
  lines.push('');
  lines.push('## What was removed, and on whose decision');
  lines.push('');
  if (report.applied) {
    lines.push(
      `- Deletions applied: ${report.applied.deletionsApplied}; relocations applied ` +
        `(old copies removed, bytes confirmed present under the new key): ${report.applied.relocationsApplied}; ` +
        `refused by a gate: ${report.applied.refused}`,
    );
    lines.push('');
    lines.push(
      'Every apply is an explicit decision — an owner\'s, or `system:auto-apply` where the ' +
        'mapping opted into ADR-0031 — and each is individually recorded.',
    );
  } else {
    lines.push(
      'This edition answers applies synchronously and records each one in its run log; ' +
        'receipts are a managed-edition construct. Nothing is ever removed without an ' +
        'explicit decision (hard rule 2).',
    );
  }
  if (report.sharing) {
    lines.push('');
    lines.push('## Access carried over (the sharing checklist)');
    lines.push('');
    lines.push(
      `- Shares re-created on the target (its own invitation sent): **${report.sharing.applied}**`,
    );
    lines.push(`- Done by hand and ticked off: **${report.sharing.doneManual}**`);
    lines.push(`- Deliberately not carried over: **${report.sharing.skipped}**`);
    lines.push(
      `- Still open: **${report.sharing.open}**` +
        (report.sharing.openManual > 0
          ? ` (of which manual steps for the owner: ${report.sharing.openManual})`
          : ''),
    );
    if (report.sharing.open > 0) {
      lines.push('');
      lines.push(
        'Open rows do not hold this migration back — the checklist is worked after ' +
          'finishing — but access nobody carried over stops working when the source is ' +
          'retired. Work the Sharing screen until this line reads zero.',
      );
    }
  }
  // The last section on purpose. Everything above is what happened; this is the
  // one thing still outstanding, and it is outstanding on the READER's side —
  // so it is what they should be looking at when they stop reading.
  if (report.standingGrants.length > 0) {
    lines.push('');
    lines.push('## Access you granted, which only you can withdraw');
    lines.push('');
    lines.push(
      'This migration is finished and we have stopped using the access it needed. The ' +
        'permission you granted is a separate thing, it lives in your own account, and it ' +
        'stays there until you remove it. We cannot do this for you — we can only tell you ' +
        'it is still there.',
    );
    for (const grant of report.standingGrants) {
      lines.push('');
      lines.push(`- **${grant.whatTheyCallIt}** — ${grant.en}`);
      lines.push(`  Where: ${grant.where}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
