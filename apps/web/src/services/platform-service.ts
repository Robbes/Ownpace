// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator hold, from the screen's side (managed migration 0023).
 *
 * Managed-only. The appliance's operator IS the customer — there is nobody to
 * tell — so nothing under `/api/platform-pause` exists there, and every
 * caller here checks the edition rather than asking and swallowing a 404.
 */

import apiClient from './api.ts';
import { z } from 'zod';
import { isSelfHost } from './edition.ts';

export const PlatformPauseSchema = z.object({
  held: z.boolean(),
  since: z.string().optional(),
  /** The operator's own words. Rendered verbatim; absent when they typed none. */
  message: z.string().optional(),
});
export type PlatformPauseState = z.infer<typeof PlatformPauseSchema>;

export const PlatformPauseRecordSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  message: z.string().optional(),
  startedBy: z.string(),
  endedBy: z.string().optional(),
});
export type PlatformPauseRecord = z.infer<typeof PlatformPauseRecordSchema>;

/** Is the platform holding? `held: false` on the appliance, without asking. */
export async function fetchPlatformPause(): Promise<PlatformPauseState> {
  if (isSelfHost()) return { held: false };
  const response = await apiClient.get('/platform-pause');
  return PlatformPauseSchema.parse(response.data);
}

/** Every hold, newest first — an operator's screen. */
export async function fetchPlatformPauseHistory(): Promise<PlatformPauseRecord[]> {
  const response = await apiClient.get('/platform-pause/history');
  return z
    .object({ holds: z.array(PlatformPauseRecordSchema) })
    .parse(response.data).holds;
}

/** Start a hold, with the words customers will read. */
export async function startPlatformPause(message?: string): Promise<PlatformPauseState> {
  const response = await apiClient.post('/platform-pause', message ? { message } : {});
  return PlatformPauseSchema.parse(response.data);
}

/** Lift it. The next tick starts passes again. */
export async function endPlatformPause(): Promise<void> {
  await apiClient.delete('/platform-pause');
}
