// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE THE APPLIANCE LANDS (workplan 0153 T8; the owner's D5, and their
 * reading of 2026-10-03: started means *"was ever started"*).
 *
 * `GET /` opens Review & confirm until every migration in the config directory
 * has been started, and its one person's page from then on. A migration paused
 * since, or finished, has been started, so the landing stays the person's page,
 * where it shows as paused and its *Details* hold its controls. One added to
 * the directory later has not, and brings the landing back to Review & confirm,
 * where it is started. With nothing configured it is Review & confirm too.
 */

import { IMPLICIT_PERSON_ID, type MappingLifecycle } from '@openmig/shared';

/** What the landing reads of one configured migration. */
export interface LandingFacts {
  readonly status: MappingLifecycle;
  /**
   * Whether its data types have their paths. Its first Start writes them
   * (`applyMappingStatusChange`), and every pause after keeps them.
   */
  readonly hasPaths: boolean;
}

/** Whether a migration was ever started: it is not paused, or its first Start wrote its paths. */
export function everStarted(m: LandingFacts): boolean {
  return m.status !== 'paused' || m.hasPaths;
}

/** The landing, as a path under the UI's mount. */
export function landingPath(migrations: readonly LandingFacts[]): string {
  return migrations.length > 0 && migrations.every(everStarted) ? `/people/${IMPLICIT_PERSON_ID}` : '/confirm';
}
