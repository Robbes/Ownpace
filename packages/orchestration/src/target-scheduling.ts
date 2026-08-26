// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What this target will DO with calendar writes — measured, worded, recorded
 * (workplan 0105 T0, the 0103 T3 remainder).
 *
 * One module for the three moments the same question is asked:
 *   - at connection test, where `probe-connection.ts` appends the sentence to
 *     the result a person is looking at;
 *   - before a mapping's first calendar write, where `schedulingRecorder`
 *     writes the verdict to the audit log;
 *   - in the migration assessment, which quotes the same sentences.
 *
 * Its own module rather than a corner of `probe-connection.ts` because the
 * deps-builders need `schedulingRecorder` and the probe module imports those
 * builders — the recorder living there would close an import cycle.
 */

import { detectCaldavScheduling } from '@openmig/connectors';
import type { CaldavSchedulingCapability, HttpClient } from '@openmig/connectors';
import { log } from '@openmig/shared';
import type { Ledger, MappingId, TenantId } from '@openmig/shared';

/**
 * The will-do/cannot-do verdict for calendar writes on a DAV target
 * (0105 T0). Three states, none of them a guess: RFC 6638 requires the
 * `calendar-auto-schedule` compliance class in the DAV header, so one
 * OPTIONS request answers what this server does with a scheduling object —
 * and a server that answers nothing is UNKNOWN, which is reported as
 * unmeasured, never as safe (the run-#6 lesson). The writer neutralises
 * unconditionally either way (ADR-0043); this sentence tells the person
 * whether that neutralising is load-bearing on THEIR target.
 */
export interface SchedulingVerdict {
  readonly capability: CaldavSchedulingCapability;
  readonly sentence: string;
}

const SCHEDULING_SENTENCES: Record<CaldavSchedulingCapability, string> = {
  'auto-schedule':
    'This target runs calendar auto-scheduling (RFC 6638): a raw import would ' +
    'invite every attendee of every migrated meeting. Ownpace neutralises each ' +
    'calendar object it writes, so migrating sends no invitations — measured on ' +
    'this target, not assumed.',
  none:
    'This target does not advertise calendar auto-scheduling, so invitation ' +
    'fan-out cannot happen here. Ownpace neutralises what it writes anyway.',
  unknown:
    'Whether this target auto-schedules is UNMEASURED — it answered no DAV ' +
    'compliance header. Unmeasured is not safe; Ownpace still neutralises every ' +
    'calendar object it writes.',
};

/** The OPTIONS probe wants only status + headers; the body stays unread. */
const optionsHttpClient: HttpClient = {
  request: async ({ url, method, headers }) => {
    const response = await fetch(url, { method, headers });
    return {
      status: response.status,
      body: '',
      headers: Object.fromEntries(response.headers.entries()),
    };
  },
};

export async function measureTargetScheduling(
  url: string,
  username: string,
  password: string,
  httpClient: HttpClient = optionsHttpClient,
): Promise<SchedulingVerdict> {
  const capability = await detectCaldavScheduling(
    url,
    `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    httpClient,
  );
  return { capability, sentence: SCHEDULING_SENTENCES[capability] };
}

/** The audit action the once-per-mapping verdict is recorded under. */
export const CALENDAR_TARGET_SCHEDULING_ACTION = 'calendar.target_scheduling';

/**
 * The once-per-mapping RECORD of the verdict (0105 T0's other half). The
 * connection test shows the sentence to whoever pressed the button and then
 * forgets it; this writes it to the audit log the first time a calendar pass
 * runs for a mapping — so the measurement provably happened BEFORE the first
 * calendar write, on the exact endpoint that pass writes to, and the answer
 * to "what did we measure on THIS target" survives the button press.
 *
 * Once per mapping, not per run: the guard is the audit log itself
 * (`latestAuditEventAt`), so a retried or resumed pass re-measures nothing.
 *
 * NEVER a pass-killer, deliberately: the writer neutralises every calendar
 * object unconditionally (ADR-0043), so a mapping must not fail to migrate
 * because this advisory record could not be written. A failure is reported
 * (rule 9 — said, not swallowed) and the pass continues.
 */
export function schedulingRecorder(
  endpoint: { readonly url: string; readonly username: string; readonly password: string },
  deps: {
    readonly ledger: Pick<Ledger, 'recordAuditEvent' | 'latestAuditEventAt'>;
    readonly tenantId: TenantId;
    readonly mappingId: MappingId;
  },
): () => Promise<void> {
  return async () => {
    try {
      const already = await deps.ledger.latestAuditEventAt(deps.tenantId, {
        action: CALENDAR_TARGET_SCHEDULING_ACTION,
        mappingId: deps.mappingId,
      });
      if (already) return;
      const verdict = await measureTargetScheduling(
        endpoint.url,
        endpoint.username,
        endpoint.password,
      );
      await deps.ledger.recordAuditEvent(deps.tenantId, {
        actor: 'system',
        action: CALENDAR_TARGET_SCHEDULING_ACTION,
        detail: {
          mappingId: deps.mappingId,
          capability: verdict.capability,
          sentence: verdict.sentence,
          url: endpoint.url,
        },
      });
    } catch (err) {
      log.error(
        '[scheduling] the verdict could not be recorded; the pass continues — the writer neutralises regardless (ADR-0043)',
        err instanceof Error ? err.message : err,
      );
    }
  };
}
