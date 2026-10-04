// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S REPORT, PARSED FOR ITS PAGE (workplan 0154 T5).
 *
 * The completion report (0047) is one builder on both editions, served with
 * its Markdown beside it. The download hands the Markdown over as it is; the
 * page draws the report itself, in the reader's language, so the report is
 * parsed here: a shape that drifted would otherwise draw a page that says less
 * than the server did, with no error anywhere (0033 T1's lesson). `z.object`
 * keeps what it names, which is everything the page draws.
 */
import { z } from 'zod';
import { DISCOVERY_DOMAINS, DOMAIN_STATES } from '@openmig/shared';
import { fetchCompletionReport } from './operating-service.ts';

const LineSchema = z.object({
  domain: z.enum(DISCOVERY_DOMAINS),
  state: z.enum(DOMAIN_STATES),
  itemsSynced: z.number(),
  itemsFailed: z.number(),
  bytesTransferred: z.number(),
  lastSyncedAt: z.string().optional(),
  lastError: z.string().optional(),
  stoppedByOwner: z.literal(true).optional(),
  itemsFound: z.number().optional(),
  itemsAdopted: z.number().optional(),
});

export const CompletionReportSchema = z.object({
  mappingId: z.string(),
  name: z.string().optional(),
  sourceType: z.string(),
  targetType: z.string(),
  lifecycle: z.string(),
  generatedAt: z.string(),
  domains: z.array(LineSchema),
  queues: z.object({
    movesOpen: z.number(),
    movesAcknowledged: z.number(),
    relocationsOpen: z.number(),
    deletionsOpen: z.number(),
    deletionsAcknowledged: z.number(),
    failuresNeedingDecision: z.number(),
  }),
  applied: z
    .object({ deletionsApplied: z.number(), relocationsApplied: z.number(), refused: z.number() })
    .optional(),
  sharing: z
    .object({
      applied: z.number(),
      doneManual: z.number(),
      skipped: z.number(),
      open: z.number(),
      openManual: z.number(),
    })
    .optional(),
  verdict: z.enum(['complete', 'complete_with_decisions_pending', 'in_progress']),
});

export type ReadReport = z.infer<typeof CompletionReportSchema>;

/** One migration's report, parsed, and its Markdown for the download. */
export async function fetchReport(mappingId: string): Promise<{ report: ReadReport; markdown: string }> {
  const { report, markdown } = await fetchCompletionReport(mappingId);
  return { report: CompletionReportSchema.parse(report), markdown };
}
