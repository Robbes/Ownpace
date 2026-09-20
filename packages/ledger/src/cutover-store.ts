// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Cutover State Store
 * 
 * Provides persistent storage and retrieval of cutover state machine data.
 * Rehydrates state from the database and logs all state transitions as events.
 * 
 * See docs/architecture/solution-architecture.md §11 (shadow & cutover)
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { TenantId, MappingId } from '@openmig/shared';
import { eq, and, asc } from 'drizzle-orm';
import * as schema from './schema-pg.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';

// Generic database type that works with both pg and postgres-js drivers
// We use unknown and cast at call sites to avoid version mismatch issues
export type AnyPgDatabase = unknown;
import type {
  CutoverState,
  CutoverPhase,
  CutoverStatus,
  CutoverEvent,
} from '@openmig/core/cutover-state';
// A value import of a leaf module with no runtime imports of its own — it
// cannot cycle back here. `rollbackAvailable` on a read is the state
// machine's answer, never a constant (ADR-0047).
import { canRollback } from '@openmig/core/cutover-state';

/**
 * Port interface for cutover state persistence.
 * This is the contract that the core cutover orchestrators depend on.
 */
export interface CutoverStateStore {
  initializeCutover(params: {
    tenantId: TenantId;
    mappingId: MappingId;
    targetMailServer?: string;
    startedBy?: string;
  }): Promise<CutoverStatus>;

  saveCutoverState(status: CutoverStatus): Promise<void>;

  loadCutoverState(
    tenantId: TenantId,
    mappingId: MappingId
  ): Promise<CutoverStatus | undefined>;

  loadEvents(
    tenantId: TenantId,
    mappingId: MappingId,
    limit?: number
  ): Promise<CutoverEvent[]>;

  getEventHistory(
    tenantId: TenantId,
    mappingId: MappingId,
    limit?: number
  ): Promise<CutoverEvent[]>;

  transitionState(
    tenantId: TenantId,
    mappingId: MappingId,
    toState: CutoverState,
    metadataOrReason?: string | Record<string, unknown>
  ): Promise<CutoverStatus>;
}

/**
 * The cutover ledger for ONE tenant, every call inside `withTenant`.
 *
 * `cutover_state` and `cutover_event` carry the tenant policies since
 * migration 0055, FORCEd like every other tenant table: a session that is
 * not a superuser sees their rows only with `app.current_tenant` set. The
 * cutover job, the rollback job and the operator CLI used to hand a bare
 * `drizzle(pool)` to `CutoverStore`, which was fine only because the bundled
 * deployments connect as a superuser — on hard rule 5's shape, an operator's
 * own Postgres with an ordinary owner, that store would now read nothing and
 * write nothing. This is the store those callers use instead: each method
 * opens `withTenant(source, tenantId, …)` — BEGIN, the driver's role if it
 * has one, the tenant context, the call, COMMIT — and the three statements
 * of a `transitionState` land in one transaction, which they never did before.
 *
 * Bound to one tenant on purpose. Every method still takes the tenant id the
 * interface prescribes; a call for another tenant is refused before any
 * query, because a store that quietly answered for whichever tenant the
 * caller named would be the exact hole the policies close.
 */
export function tenantCutoverStore(source: LedgerDriver | Pool, tenantId: TenantId): CutoverStateStore {
  const inTenant = <T>(fn: (store: CutoverStore) => Promise<T>): Promise<T> =>
    withTenant(source, tenantId, (db) => fn(new CutoverStore(db)));
  const same = (asked: TenantId): void => {
    if (asked !== tenantId) {
      throw new Error(`This cutover store is bound to tenant ${tenantId}; it was asked about ${asked}.`);
    }
  };
  // Every method is async so the binding refusal is a rejection, never a
  // synchronous throw: a store method that throws before returning a promise
  // is a store a caller's `.catch` cannot see.
  return {
    initializeCutover: async (params) => {
      same(params.tenantId);
      return inTenant((store) => store.initializeCutover(params));
    },
    saveCutoverState: async (status) => {
      same(status.tenantId);
      return inTenant((store) => store.saveCutoverState(status));
    },
    loadCutoverState: async (t, mappingId) => {
      same(t);
      return inTenant((store) => store.loadCutoverState(t, mappingId));
    },
    loadEvents: async (t, mappingId, limit) => {
      same(t);
      return inTenant((store) => store.loadEvents(t, mappingId, limit));
    },
    getEventHistory: async (t, mappingId, limit) => {
      same(t);
      return inTenant((store) => store.getEventHistory(t, mappingId, limit));
    },
    transitionState: async (t, mappingId, toState, metadataOrReason) => {
      same(t);
      return inTenant((store) => store.transitionState(t, mappingId, toState, metadataOrReason));
    },
  };
}

/**
 * Implementation of CutoverStateStore using PostgreSQL.
 * Works with both pg and postgres-js drivers via structural typing.
 */
export class CutoverStore implements CutoverStateStore {
  private readonly db: unknown;

  constructor(db: unknown) {
    this.db = db;
  }

  // Type assertion helper for internal use
  private getDb() {
    return this.db as ReturnType<typeof import('drizzle-orm/postgres-js').drizzle>;
  }

  /**
   * Initialize a new cutover and return the status.
   *
   * Idempotent by design: if a cutover already exists for this mapping it is
   * returned UNCHANGED. This used to unconditionally upsert `state: PREPARING`,
   * so re-running the cutover job (or `start-cutover`) on an APPROVED mapping
   * silently revoked the operator's approval and reset the state machine —
   * measured against a real Postgres: "state before re-init: APPROVED / state
   * after re-init: PREPARING". That is a state change nobody asked for, made
   * without going through `transitionState`'s validation and recorded only as a
   * CUTOVER_INITIALIZED event, so the audit trail did not show the revocation
   * either (hard rule 2). Restarting a cutover is an explicit transition, not a
   * side effect of asking for one.
   */
  async initializeCutover(params: {
    tenantId: TenantId;
    mappingId: MappingId;
    targetMailServer?: string;
    startedBy?: string;
  }): Promise<CutoverStatus> {
    const existing = await this.loadCutoverState(params.tenantId, params.mappingId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const status: CutoverStatus = {
      tenantId: params.tenantId,
      mappingId: params.mappingId,
      state: 'PREPARING',
      phase: 'PREPARATION',
      startedAt: now,
      updatedAt: now,
      verificationStatus: 'PENDING',
      totalItemsMigrated: 0,
      itemsVerified: 0,
      discrepanciesFound: 0,
      rollbackAvailable: canRollback('PREPARING'),
      currentState: 'PREPARING',
      targetMailServer: params.targetMailServer,
      startedBy: params.startedBy,
    };

    await this.saveCutoverState(status);

    // Log initialization event
    const initEvent: CutoverEvent = {
      tenantId: params.tenantId,
      mappingId: params.mappingId,
      timestamp: now,
      fromState: null,
      toState: 'PREPARING',
      triggeredBy: params.startedBy || 'system',
      eventType: 'CUTOVER_INITIALIZED',
      description: 'Cutover initialized',
    };
    await this.logCutoverEvent(initEvent);

    return status;
  }

  /**
   * Save cutover state to the database
   */
  async saveCutoverState(status: CutoverStatus): Promise<void> {
    const now = new Date().toISOString();
    
    await this.getDb().insert(schema.cutoverState).values({
      // A fresh row id. This used to be `status.tenantId`, but `cutover_state.id`
      // is the PRIMARY KEY while the upsert arbiter is (tenant_id, mapping_id) —
      // so the SECOND mapping in a tenant hit "duplicate key value violates
      // unique constraint cutover_state_pkey" on the insert, before ON CONFLICT
      // could help. A tenant could have exactly one cutover, ever.
      id: randomUUID(),
      tenantId: status.tenantId,
      mappingId: status.mappingId,
      state: this.mapStateToDb(status.state),
      phase: this.mapPhaseToDb(status.phase),
      verificationStatus: this.mapVerificationStatus(status.verificationStatus),
      verificationReport: status.verificationReport ? JSON.parse(status.verificationReport) : {},
      gracePeriodHours: this.extractGracePeriodHours(status),
      gracePeriodStartedAt: status.gracePeriodStartedAt ? new Date(status.gracePeriodStartedAt) : null,
      gracePeriodCompletedAt: status.gracePeriodCompletedAt ? new Date(status.gracePeriodCompletedAt) : null,
      targetMailServer: status.targetMailServer ?? null,
      metadata: this.buildMetadata(status),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }).onConflictDoUpdate({
      target: [schema.cutoverState.tenantId, schema.cutoverState.mappingId],
      set: {
        state: this.mapStateToDb(status.state),
        phase: this.mapPhaseToDb(status.phase),
        verificationStatus: this.mapVerificationStatus(status.verificationStatus),
        verificationReport: status.verificationReport ? JSON.parse(status.verificationReport) : {},
        gracePeriodHours: this.extractGracePeriodHours(status),
        gracePeriodStartedAt: status.gracePeriodStartedAt ? new Date(status.gracePeriodStartedAt) : null,
        gracePeriodCompletedAt: status.gracePeriodCompletedAt ? new Date(status.gracePeriodCompletedAt) : null,
        targetMailServer: status.targetMailServer ?? null,
        metadata: this.buildMetadata(status),
        updatedAt: new Date(now),
      },
    });
  }

  /**
   * Load cutover state from the database
   */
  async loadCutoverState(
    tenantId: TenantId,
    mappingId: MappingId
  ): Promise<CutoverStatus | undefined> {
    const result = await this.getDb()
      .select()
      .from(schema.cutoverState)
      .where(
        and(
          eq(schema.cutoverState.tenantId, tenantId),
          eq(schema.cutoverState.mappingId, mappingId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return undefined;
    }

    const row = result[0]!;
    return this.mapRowToStatus(row);
  }

  /**
   * Log a cutover event to the database
   */
  async logCutoverEvent(event: CutoverEvent): Promise<void> {
    const insertData = {
      tenantId: event.tenantId,
      mappingId: event.mappingId,
      timestamp: new Date(event.timestamp),
      fromState: event.fromState ? this.mapStateToDb(event.fromState) : null,
      toState: this.mapStateToDb(event.toState),
      triggeredBy: event.triggeredBy,
      reason: event.reason || null,
      eventType: event.eventType || 'STATE_TRANSITION',
      metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : {},
    };
    await this.getDb().insert(schema.cutoverEvent).values(insertData);
  }
  /**
   * Load cutover events from the database
   */
  async loadEvents(
    tenantId: TenantId,
    mappingId: MappingId,
    limit?: number
  ): Promise<CutoverEvent[]> {
    const query = this.getDb()
      .select()
      .from(schema.cutoverEvent)
      .where(
        and(
          eq(schema.cutoverEvent.tenantId, tenantId),
          eq(schema.cutoverEvent.mappingId, mappingId)
        )
      );
    
    const orderedQuery = query.orderBy(asc(schema.cutoverEvent.timestamp));
    
    const rows = limit ? await orderedQuery.limit(limit) : await orderedQuery;

    return rows.map((row: typeof schema.cutoverEvent.$inferSelect) => {
      const baseDescription = row.eventType === 'CUTOVER_INITIALIZED'
        ? 'Cutover initialized'
        : row.toState === 'ROLLED_BACK'
          ? row.fromState
            ? `${row.fromState} rolled back to ${row.toState}`
            : `Rolled back to ${row.toState}`
          : row.fromState
            ? `Transitioned from ${row.fromState} to ${row.toState}`
            : `Transitioned to ${row.toState}`;
      // Include reason in description if available
      const description = row.reason ? `${baseDescription}: ${row.reason}` : baseDescription;
      
      return {
        tenantId: row.tenantId as TenantId,
        mappingId: row.mappingId as MappingId,
        timestamp: row.timestamp.toISOString(),
        fromState: row.fromState,
        toState: row.toState,
        triggeredBy: row.triggeredBy,
        reason: row.reason ?? undefined,
        metadata: row.metadata as Record<string, unknown>,
        eventType: row.eventType ?? 'STATE_TRANSITION',
        description,
      };
    });
  }

  /**
   * Get event history for a mapping
   */
  async getEventHistory(
    tenantId: TenantId,
    mappingId: MappingId,
    limit?: number
  ): Promise<CutoverEvent[]> {
    return this.loadEvents(tenantId, mappingId, limit);
  }

  /**
   * Transition cutover state and log the event
   */
  async transitionState(
    tenantId: TenantId,
    mappingId: MappingId,
    toState: CutoverState,
    metadataOrReason?: string | Record<string, unknown>
  ): Promise<CutoverStatus> {
    // Load current state
    const current = await this.loadCutoverState(tenantId, mappingId);
    if (!current) {
      throw new Error(`No cutover state found for mapping ${mappingId}`);
    }

    // Validate transition (import from cutover-state)
    const { isValidTransition } = await import('@openmig/core/cutover-state');
    if (!isValidTransition(current.state, toState)) {
      const reason = typeof metadataOrReason === 'string' ? metadataOrReason : 'No reason provided';
      throw new Error(
        `Invalid transition from ${current.state} to ${toState}. Reason: ${reason}`
      );
    }

    // Extract reason and metadata from the parameter
    let reason: string | undefined;
    let metadata: Record<string, unknown> | undefined;
    
    if (typeof metadataOrReason === 'string') {
      reason = metadataOrReason;
    } else if (metadataOrReason && typeof metadataOrReason === 'object') {
      metadata = metadataOrReason;
      // Extract reason from various possible fields depending on the transition
      reason = (metadata.reason as string) || (metadata.failureReason as string) || (metadata.rollbackReason as string);
    }

    // Create event
    const event: CutoverEvent = {
      tenantId,
      mappingId,
      timestamp: new Date().toISOString(),
      fromState: current.state,
      toState,
      triggeredBy: typeof metadataOrReason === 'string' ? 'system' : 'cli',
      reason,
      metadata,
      eventType: 'STATE_TRANSITION',
      description: reason ? `Transitioned from ${current.state} to ${toState}: ${reason}` : `Transitioned from ${current.state} to ${toState}`,
    };

    // Log event
    await this.logCutoverEvent(event);

    // Update state
    const { updateCutoverStatus } = await import('@openmig/core/cutover-state');
    const updated = updateCutoverStatus(current, toState, reason);

    // Merge metadata into the status if provided
    if (metadata) {
      Object.assign(updated, metadata);
    }

    await this.saveCutoverState(updated);

    return updated;
  }

  // Helper methods

  private mapStateToDb(state: CutoverState): 'PREPARING' | 'READY_FOR_CUTOVER' | 'APPROVED' | 'CUTOVER_IN_PROGRESS' | 'GRACE_PERIOD' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK' {
    const stateMap: Record<CutoverState, 'PREPARING' | 'READY_FOR_CUTOVER' | 'APPROVED' | 'CUTOVER_IN_PROGRESS' | 'GRACE_PERIOD' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK'> = {
      'PREPARING': 'PREPARING',
      'READY_FOR_CUTOVER': 'READY_FOR_CUTOVER',
      'APPROVED': 'APPROVED',
      'CUTOVER_IN_PROGRESS': 'CUTOVER_IN_PROGRESS',
      'GRACE_PERIOD': 'GRACE_PERIOD',
      'COMPLETED': 'COMPLETED',
      'FAILED': 'FAILED',
      'ROLLED_BACK': 'ROLLED_BACK',
    };
    return stateMap[state] || 'PREPARING';
  }

  private mapPhaseToDb(phase: CutoverPhase): 'verification' | 'cutover' | 'grace' | 'completion' | 'rollback' {
    const phaseMap: Record<CutoverPhase, 'verification' | 'cutover' | 'grace' | 'completion' | 'rollback'> = {
      'PREPARATION': 'verification',
      'VERIFICATION': 'verification',
      'CUTOVER': 'cutover',
      'GRACE': 'grace',
      'COMPLETION': 'completion',
      'ROLLBACK': 'rollback',
      'ERROR': 'rollback',
    };
    return phaseMap[phase] || 'verification';
  }

  private mapVerificationStatus(status: string): 'pending' | 'pass' | 'fail' | 'warn' | 'skipped' {
    const statusMap: Record<string, 'pending' | 'pass' | 'fail' | 'warn' | 'skipped'> = {
      'PENDING': 'pending',
      'PASS': 'pass',
      'WARN': 'warn',
      'FAIL': 'fail',
    };
    return statusMap[status] || 'pending';
  }

  private extractGracePeriodHours(status: CutoverStatus): number {
    if (status.metadata) {
      try {
        const meta = typeof status.metadata === 'string' 
          ? JSON.parse(status.metadata) 
          : status.metadata;
        return meta.gracePeriodDurationHours || 72;
      } catch {
        return 72;
      }
    }
    return 72;
  }

  private buildMetadata(status: CutoverStatus): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      gracePeriodDurationHours: 72,
      autoCompleteAfterGrace: true,
    };
    
    if (status.errorMessage) {
      meta.errorMessage = status.errorMessage;
    }
    if (status.errorDetails) {
      meta.errorDetails = status.errorDetails;
    }
    
    return meta;
  }

  private mapRowToStatus(row: typeof schema.cutoverState.$inferSelect): CutoverStatus {
    const verificationStatusMap: Record<string, 'PENDING' | 'PASS' | 'WARN' | 'FAIL'> = {
      'pending': 'PENDING',
      'pass': 'PASS',
      'warn': 'WARN',
      'fail': 'FAIL',
    };

    const dbPhaseToPhase: Record<string, CutoverPhase> = {
      'verification': 'PREPARATION',
      'cutover': 'CUTOVER',
      'grace': 'GRACE',
      'completion': 'COMPLETION',
      'rollback': 'ROLLBACK',
    };

    const metadata = row.metadata;

    return {
      tenantId: row.tenantId as TenantId,
      mappingId: row.mappingId as MappingId,
      state: row.state,
      phase: dbPhaseToPhase[row.phase] || 'PREPARATION',
      startedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.gracePeriodCompletedAt?.toISOString() as string,
      verificationStatus: verificationStatusMap[row.verificationStatus] || 'PENDING',
      verificationReport: typeof row.verificationReport === 'string'
        ? row.verificationReport
        : JSON.stringify(row.verificationReport || {}),
      cutoverStartedAt: undefined,
      cutoverCompletedAt: undefined,
      gracePeriodStartedAt: row.gracePeriodStartedAt?.toISOString() as string,
      gracePeriodEndsAt: undefined,
      totalItemsMigrated: 0,
      itemsVerified: 0,
      discrepanciesFound: 0,
      // It was hardcoded `false` here while `updateCutoverStatus` computed it
      // on every transition — so the flag was right in memory for the length
      // of one call and wrong on every read after (workplan 0101 T5's third
      // finding). In GRACE_PERIOD, where rolling back is exactly what the
      // operator is being invited to consider, this said it was unavailable.
      rollbackAvailable: canRollback(row.state),
      currentState: row.state,
      targetMailServer: row.targetMailServer ?? undefined,
      metadata: metadata as Record<string, unknown>,
    };
  }
}
