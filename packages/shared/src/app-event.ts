// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1).
 *
 * The application's own errors and warnings went to the container's output
 * and nowhere else. No screen could search them, and a person quoting the
 * reference a failed request answered with could only be matched by somebody
 * reading the host's log. The owner's decision (0129 D1, D3): record errors
 * and warnings in the database, metadata only (time, level, customer,
 * migration, event, error category, reference number), so a page can search
 * them.
 *
 * ## Metadata only, and the database holds the line too
 *
 * An event is a NAME from code, never the log line's text: `api.list_failed`,
 * `sync.calendar.failed`. A message can carry an address, a subject or a file
 * name, and the operator's screens show none of those (the support rule,
 * workplan 0110). So a name is held to a shape nothing personal fits: lower-
 * case letters, digits, `.`, `_` and `-`, at most 64 characters. It is checked
 * here, and again by a CHECK on the table, so a caller that passed a message
 * is refused twice. The text stays where it always was, in the container's
 * output, on a line that carries the same reference.
 *
 * ## Recording never fails the work it describes
 *
 * A request that answered 500, or a pass that failed, has already gone wrong
 * once. A second failure while writing that down must not become the failure
 * anybody sees, so {@link recordAppEvent} never throws: a refused or failed
 * write is said in the log, and it costs the row, nothing else.
 *
 * ## One sink per process
 *
 * Each process (the API, the worker, the appliance) points this at its own
 * database once, at start-up, with {@link setAppEventSink}. Until then, and in
 * a process that never does, recording is a no-op beyond the log line, which
 * is exactly what happened before this existed.
 */

import { log } from './logger.ts';
import {
  classifyFailure,
  isFailureCategory,
  type FailureCategory,
  type FailureSide,
} from './failure-category.ts';

export type AppEventLevel = 'warn' | 'error';

/** A name from code, never a sentence. The table's CHECK is the same pattern. */
export const APP_EVENT_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;

/**
 * Eight lower-case hex characters: the reference `serverFault` has given every
 * failed request since workplan 0079, now the one the log page searches by.
 */
export const APP_EVENT_REFERENCE = /^[0-9a-f]{8}$/;

export interface AppEvent {
  readonly level: AppEventLevel;
  /** A name from code: see {@link APP_EVENT_NAME}. */
  readonly event: string;
  /** What a person quotes: see {@link APP_EVENT_REFERENCE}. */
  readonly reference: string;
  readonly tenantId?: string;
  readonly mappingId?: string;
  readonly category?: FailureCategory;
}

/** Where a process writes its events: its own database. */
export interface AppEventSink {
  record(event: AppEvent): Promise<void>;
}

/** A new reference: short enough to read out over the phone. */
export function newReference(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

/** Why an event would be refused, or undefined when it is well formed. */
export function appEventProblem(event: AppEvent): string | undefined {
  if (event.level !== 'warn' && event.level !== 'error') return `level ${JSON.stringify(event.level)}`;
  if (!APP_EVENT_NAME.test(event.event)) return 'an event name that is not a name from code';
  if (!APP_EVENT_REFERENCE.test(event.reference)) return 'a reference that is not eight hex characters';
  if (event.category !== undefined && !isFailureCategory(event.category)) {
    return 'a category that is not a failure category';
  }
  return undefined;
}

/** An event with a new reference, for a caller that names everything else. */
export function newAppEvent(event: Omit<AppEvent, 'reference'>): AppEvent {
  return { ...event, reference: newReference() };
}

/**
 * The event a domain records when its pass fails: `sync.<domain>.failed`, with
 * the category the message classifies as. The same call `markFailed` makes, so
 * the log page and the customer's progress strip name the same category.
 */
export function domainFailedEvent(args: {
  readonly tenantId: string;
  readonly mappingId: string;
  readonly domain: string;
  readonly message: string;
  readonly side?: FailureSide;
}): AppEvent {
  return newAppEvent({
    level: 'error',
    event: `sync.${args.domain}.failed`,
    tenantId: args.tenantId,
    mappingId: args.mappingId,
    category: classifyFailure(args.message, args.side),
  });
}

let sink: AppEventSink | undefined;

/** Point this process's events at its database; `undefined` stops recording. */
export function setAppEventSink(next: AppEventSink | undefined): void {
  sink = next;
}

/**
 * Record one event, and never throw.
 *
 * Refuses a malformed event before it reaches the database, and says so in the
 * log without repeating the event's text: a caller that passed a message as the
 * name would otherwise be writing that message to the log a second time.
 */
export async function recordAppEvent(event: AppEvent): Promise<void> {
  const problem = appEventProblem(event);
  if (problem !== undefined) {
    log.warn(`[app-event] not recorded (ref ${safeReference(event.reference)}): ${problem}.`);
    return;
  }
  if (!sink) return;
  try {
    await sink.record(event);
  } catch (err) {
    log.warn(
      `[app-event] ${event.event} (ref ${event.reference}) could not be recorded: ` +
        `${(err as Error)?.message ?? String(err)}`,
    );
  }
}

function safeReference(reference: string): string {
  return APP_EVENT_REFERENCE.test(reference) ? reference : '?';
}
