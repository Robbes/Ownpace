// Copyright 2026 The Ownpace authors (Apache-2.0)
import type { AppEvent, AppEventSink } from '@openmig/shared';
import type { PgDatabase } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import * as schemaPg from './schema-pg.ts';

/**
 * Where a process's errors and warnings are written (workplan 0129 T1).
 *
 * Handed to `setAppEventSink` once, at start-up, with the process's own
 * database. Insert only, and without RETURNING: the application's role may
 * write an event and may not read one (migration 0059), and a RETURNING clause
 * would need the read it does not have.
 */
export class PgAppEventStore implements AppEventSink {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  async record(event: AppEvent): Promise<void> {
    await this.db.insert(schemaPg.appEvent).values({
      level: event.level,
      event: event.event,
      reference: event.reference,
      ...(event.tenantId ? { tenantId: event.tenantId } : {}),
      ...(event.mappingId ? { mappingId: event.mappingId } : {}),
      ...(event.category ? { category: event.category } : {}),
    });
  }
}

/**
 * The sink a process hands to `setAppEventSink`: one connection per event,
 * taken from the process's own driver and given straight back.
 *
 * Outside any tenant transaction on purpose. An event is written after the
 * work it describes has failed, and inside that work's transaction a refused
 * insert would abort the transaction and take the failure's own record with
 * it. Here it can only cost the event.
 */
export function appEventSinkOn(driver: LedgerDriver): AppEventSink {
  return {
    async record(event: AppEvent): Promise<void> {
      const conn = await driver.acquire();
      try {
        await new PgAppEventStore(conn.db).record(event);
        conn.release();
      } catch (err) {
        conn.release(err as Error);
        throw err;
      }
    },
  };
}

