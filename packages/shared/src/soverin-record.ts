// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH KIND OF SOVERIN MAILBOX ANSWERED (workplan 0175 §5.4).
 *
 * One Soverin card serves two kinds of mailbox. A personal mailbox keeps its
 * calendars and contacts on Soverin's own server, `caldav.soverin.net`. A
 * mailbox with a Soverin Suite licence keeps the same IMAP and has its
 * calendars and contacts on Suite's Nextcloud, behind a login of its own
 * (§3.2, §3.3). Nobody is asked which they have: the Test measures it, and
 * this is the record of what it measured.
 *
 * Kept in `connection.qualification`, not in `config`: `config` is what the
 * person typed, and this is what the provider answered (ledger 0029's rule).
 * A record written before 0175 has no `soverin` key; its next pass measures
 * the kind once, before its DAV faces (D6).
 *
 * `suite` is never written until the maintainer's live test (T0) has fixed
 * the rule that tells the two apart. The readers below already answer for
 * it, so that rule lands without reshaping anything.
 */

export const SOVERIN_KINDS = ['personal', 'suite', 'unknown'] as const;
export type SoverinKind = (typeof SOVERIN_KINDS)[number];

export interface SoverinRecord {
  readonly kind: SoverinKind;
  /** The DAV root that answered: `caldav.soverin.net`, or Suite's `/remote.php/dav/`. */
  readonly davRoot?: string;
  /** The principal that answered, as the server gave it. Never built from the address. */
  readonly principal?: string;
  /** Suite only: the files home the principal named. */
  readonly fileRoot?: string;
  /** For `unknown`: the words of what failed, verbatim. */
  readonly reason?: string;
  /** When it was measured, ISO 8601. */
  readonly measuredAt: string;
}

function isKind(value: unknown): value is SoverinKind {
  return typeof value === 'string' && (SOVERIN_KINDS as ReadonlyArray<string>).includes(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The record on a stored qualification, or `undefined` when there is none or
 * it is malformed. A malformed record is read as no record: it is measured
 * again, never guessed from.
 */
export function soverinRecordOf(qualification: unknown): SoverinRecord | undefined {
  if (typeof qualification !== 'object' || qualification === null) return undefined;
  const raw = (qualification as { soverin?: unknown }).soverin;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const measuredAt = text(r.measuredAt);
  if (!isKind(r.kind) || measuredAt === undefined) return undefined;
  const davRoot = text(r.davRoot);
  const principal = text(r.principal);
  const fileRoot = text(r.fileRoot);
  const reason = text(r.reason);
  return {
    kind: r.kind,
    ...(davRoot !== undefined ? { davRoot } : {}),
    ...(principal !== undefined ? { principal } : {}),
    ...(fileRoot !== undefined ? { fileRoot } : {}),
    ...(reason !== undefined ? { reason } : {}),
    measuredAt,
  };
}

/** The config keys that name where a DAV face goes; the record's root replaces all of them. */
const DAV_ADDRESS_KEYS = ['url', 'baseUrl', 'host', 'port', 'useSsl'] as const;

/**
 * THE CONFIG A SOVERIN ROW'S DAV FACES ARE WRITTEN WITH (§5.4).
 *
 * For a `soverin` row whose record names the root that answered (a personal
 * or a Suite mailbox), that root, in place of every address the row typed:
 * the writers go where the Test found the calendars, not where the form
 * pointed. For a row with no record (tested before 0175), or an `unknown`
 * one, the row's own config, as it was tested with: nothing is guessed. Any
 * other kind's config as it is. Mail keeps `mailHost`, which the record does
 * not touch: IMAP is the same for both kinds (§3.3).
 */
export function davConfigOf(
  kind: string,
  config: Readonly<Record<string, unknown>>,
  qualification: unknown,
): Record<string, unknown> {
  if (kind !== 'soverin') return { ...config };
  const record = soverinRecordOf(qualification);
  if (!record || record.kind === 'unknown' || !record.davRoot) return { ...config };
  const out: Record<string, unknown> = { ...config };
  for (const key of DAV_ADDRESS_KEYS) delete out[key];
  out.url = record.davRoot;
  return out;
}
