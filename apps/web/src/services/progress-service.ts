// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE EACH DATA TYPE OF EACH MIGRATION IS, FOR A PERSON'S LINES (workplan
 * 0154 T1 (b) to (d)), from either edition.
 *
 * Managed asks `GET /api/migrations/progress`. The appliance has no list, and
 * builds the same rows from the status every appliance page already polls and
 * its last check (`progressFromStatus`), so a line reads one shape on both.
 *
 * Parsed on managed, as every read the screens draw from is: `z.object` keeps
 * what it names, and a field it did not name would be a total the line says it
 * does not know (see `MappingDomainStatusSchema`).
 */
import { z } from 'zod';
import { DISCOVERY_DOMAINS, DOMAIN_STATES, progressFromStatus, type ProgressReport } from '@openmig/shared';
import apiClient from './api.ts';
import { isSelfHost } from './edition.ts';
import { fetchStatus, fetchVerifyReport } from './operating-service.ts';

const DomainProgressSchema = z.object({
  domain: z.enum(DISCOVERY_DOMAINS),
  state: z.enum(DOMAIN_STATES),
  phase: z.string(),
  stopped: z.literal(true).optional(),
  itemsSynced: z.number(),
  itemsFound: z.number().optional(),
  itemsAdopted: z.number().optional(),
  bytesTransferred: z.number(),
  bytesFound: z.number().optional(),
  lastSyncedAt: z.string().optional(),
  lastActiveAt: z.string().optional(),
});

const CheckFactsSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_run') }),
  z.object({ state: z.literal('running'), since: z.string() }),
  z.object({ state: z.literal('could_not_run'), at: z.string() }),
  z.object({ state: z.literal('passed'), at: z.string() }),
  z.object({ state: z.literal('not_passed'), at: z.string() }),
]);

export const ProgressReportSchema = z.object({
  mappings: z.array(
    z.object({
      mappingId: z.string(),
      domains: z.array(DomainProgressSchema),
      check: CheckFactsSchema,
    }),
  ),
});

/**
 * Every migration's progress. A read that fails is a failure for the caller to
 * show, never an empty report: no lines is not the same claim as no progress
 * (hard rule 9).
 */
export async function fetchProgress(): Promise<ProgressReport> {
  if (isSelfHost()) {
    const [status, verify] = await Promise.all([fetchStatus(), fetchVerifyReport()]);
    return { mappings: progressFromStatus(status, verify) };
  }
  return ProgressReportSchema.parse((await apiClient.get('/migrations/progress')).data);
}
