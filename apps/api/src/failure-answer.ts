// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE MANAGED API SAYS OF A FAILURE A PASS RECORDED (workplan 0136 T3,
 * the second step).
 *
 * T3's first step stopped the Test button reading aloud what a host a tester
 * typed answered (`probe-answer.ts`). A pass records the same messages: a DAV
 * writer puts the response body into its refusal, and the refusal's message is
 * the item's `last_error`. The failures route returned it as it was, and so
 * did the migration page's failure line, the completion report, the confirm
 * screen's counts, the runs panel, the Check page's report and an apply
 * receipt. They reach the organisation more slowly than a Test button, and
 * they carry the same bytes.
 *
 * So those routes answer through the same rule, here. The error is gone by
 * the time a route answers, and only its message is stored, so the rule is
 * read off the text, by the vocabulary every refusal of ours writes it in: our
 * prose, an HTTP status, then `: ` or ` - `, then what the server sent.
 *
 * - What the server sent stays only when it is an error document of a kind §3
 *   lists, in the form the stored text carries it: a WebDAV `error`, Google's
 *   JSON error document or a JMAP problem document as they came, and Google's
 *   GData and Sabre's refusal as `davRefusalBody` already unwrapped them.
 *   Matched whole, with no markup or JSON in their words, and capped.
 *   Anything else is said as *"the server answered with something that is
 *   not a DAV, JMAP or IMAP error"*. Our prose before it stays: the method,
 *   the item's path and the status are ours, not the server's.
 * - A socket error is said without the name or address it tried, a
 *   certificate without the names it carries, and the rule's refusal (0136 T1)
 *   without the host, in the Test button's own sentences.
 * - An IMAP server's `NO` or `BAD` line keeps its words, capped.
 * - Everything else is ours, and reads as stored.
 *
 * WHICH FAILURES. A host a tester typed, as on the Test button: every target,
 * and a source whose config names its host. A source refusal from a provider's
 * fixed host (Google, Microsoft, Dropbox, Box, Apple's published roots) keeps
 * its words (0080, 0115 T5). A failure whose side is not known may be the
 * target's, so it is answered by the rule. A refusal of ours (`policy_refused`,
 * `too_large`) reads as we wrote it.
 *
 * NOT YET HERE. A share's refusal on apply (`sharing/…`) is answered on its
 * own request with what the target's OCS endpoint said: OCS's message is the
 * sentence a person acts on ("User does not exist"), it is no document §3
 * lists, and the text no longer tells it from a body. It needs the parts, as
 * the Test has them (0136 Status, 2026-10-05).
 *
 * THE LEDGER IS NOT TOUCHED. The row keeps every byte. No route serves it to
 * the operator: the operator reads an item's text on the database, by its
 * `naturalKeyHash`, and a data type's failure in the log, under the
 * `lastErrorReference` the pass logged its full text under. The appliance
 * does not come here: its only user is its owner, who reads the full text,
 * as T3's first step left it.
 */

import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { PROVIDER_WORDS_CAP, providerErrorWords } from '@openmig/shared';
import type {
  ApplyReceipt,
  DiscoveryRecord,
  FailureCategory,
  ItemFailure,
  MigrationStatus,
  RunEventReport,
  RunReport,
  VerificationRunReport,
  VerifyResponse,
} from '@openmig/shared';
import { whatHappenedSentence } from './probe-answer.ts';

/** What a server sent is said as this when it is no error document we know. */
export const NOT_AN_ERROR_DOCUMENT =
  'the server answered with something that is not a DAV, JMAP or IMAP error.';

/**
 * An HTTP status as our refusals write it: after `status`, `answered`, `HTTP`,
 * `with`, or a bracket. Any three digits from 100: the server picks its status,
 * and Node's fetch passes a 600 or a 999 through as it came.
 */
const STATUS = /(?:\bstatus|\banswered|\bHTTP|\bwith|\()[ \t]*[1-9]\d\d\b/g;

/** Where the server's answer starts after its status: the first `: ` or ` - ` on the same line. */
const ANSWER_STARTS = /^[^\n]*?(?::\s|\s-\s)/;

/*
 * The stored forms are matched whole, not by how they start: a body that only
 * begins like one (`error — <html>…`) is not one. Their words carry no markup
 * and no JSON (`NO_MARKUP`).
 */
/** Sabre's refusal as `davRefusalBody` leaves it: the exception's class, alone or then ` — ` and its message. */
const SABRE_WORDS = /^[A-Z][A-Za-z0-9_]*(?:\\[A-Za-z0-9_]+)+(?: — .+)?$/;
/** Google's GData refusal as `davRefusalBody` leaves it: its code, ` — `, its reason. */
const GDATA_WORDS = /^[a-z][A-Za-z]* — .+$/;
/**
 * Google's GData code alone, when the document carried no reason: only a code
 * Google documents, because one word is how any server may answer.
 */
const GDATA_CODES: ReadonlySet<string> = new Set([
  'accessNotConfigured',
  'authError',
  'backendError',
  'badRequest',
  'conflict',
  'dailyLimitExceeded',
  'deleted',
  'duplicate',
  'forbidden',
  'insufficientPermissions',
  'internalError',
  'invalid',
  'notFound',
  'preconditionFailed',
  'quotaExceeded',
  'rateLimitExceeded',
  'required',
  'serviceUnavailable',
  'unauthorized',
  'userRateLimitExceeded',
]);
/** A JMAP problem document as the JMAP readers leave it: its type, alone or then ` — ` or ` - ` and its detail. */
const JMAP_WORDS = /^urn:ietf:params:jmap:error:[A-Za-z]+(?: [—-] .+)?$/;
/** Words, not a document: no markup and no JSON. */
const NO_MARKUP = /^[^<>{}]*$/;

/** The rule's refusal (`HostInsideOurNetwork` in `reachable-host.ts`), by its sentence. */
const INSIDE_OUR_NETWORK = /is an address inside this service's own network/;

/** Socket and transport codes that mean nothing usable answered at the address. */
const UNREACHABLE =
  /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_[A-Z_]+)\b/;

/** A certificate that did not verify, by Node's and OpenSSL's codes and sentences. */
const CERTIFICATE =
  /\b(?:DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ERR_TLS_CERT_ALTNAME_INVALID)\b|self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer certificate|certificate has expired|certificate is not yet valid|does not match certificate's altnames/i;

/**
 * Where an IMAP server's own line starts: after our `The IMAP server refused: `
 * (`imapRefusalDetail`), or a `NO` or `BAD` line on its own.
 */
const IMAP_LINE = /The IMAP server refused: |^(?=(?:NO|BAD)\b)/;

/** A JSON parser's quote of the text it could not read (Node's `JSON.parse`). */
const PARSER_QUOTE = /, "(?:[^"\\]|\\.)*"(?:\.\.\.)? is not valid JSON/;

function capped(words: string): string {
  const flat = words.replace(/\s+/g, ' ').trim();
  return flat.length > PROVIDER_WORDS_CAP ? `${flat.slice(0, PROVIDER_WORDS_CAP - 1)}…` : flat;
}

/** The server's words, when what it sent is an error document of a kind we know; else none. */
function documentWords(sent: string): string | undefined {
  const document = providerErrorWords(sent);
  if (document !== undefined) return document;
  const flat = sent.replace(/\s+/g, ' ').trim();
  if (!NO_MARKUP.test(flat)) return undefined;
  if (SABRE_WORDS.test(flat) || GDATA_WORDS.test(flat) || GDATA_CODES.has(flat) || JMAP_WORDS.test(flat)) {
    return capped(flat);
  }
  return undefined;
}

/** Where what the server sent starts in a refusal of ours, or `undefined` when it carries none. */
function answerStart(text: string): number | undefined {
  for (const status of text.matchAll(STATUS)) {
    const after = status.index + status[0].length;
    const separator = ANSWER_STARTS.exec(text.slice(after));
    if (separator) return after + separator[0].length;
  }
  return undefined;
}

/**
 * A failure's stored text as the managed API may answer it: our prose, and
 * none of the server's bytes but the words of an error document we know.
 */
export function failureInOurWords(text: string): string {
  if (INSIDE_OUR_NETWORK.test(text)) return whatHappenedSentence({ kind: 'insideOurNetwork' });
  const start = answerStart(text);
  if (start !== undefined) {
    return `${text.slice(0, start)}${documentWords(text.slice(start)) ?? NOT_AN_ERROR_DOCUMENT}`;
  }
  if (UNREACHABLE.test(text)) return whatHappenedSentence({ kind: 'unreachable' });
  if (CERTIFICATE.test(text)) return whatHappenedSentence({ kind: 'certificate' });
  // An IMAP server's NO or BAD line keeps its words, capped as the Test
  // button caps them (`imapRefusalWords`).
  const imap = IMAP_LINE.exec(text);
  if (imap) {
    const at = imap.index + imap[0].length;
    if (text.length - at > PROVIDER_WORDS_CAP) return `${text.slice(0, at)}${capped(text.slice(at))}`;
  }
  return text.replace(PARSER_QUOTE, ' in an answer that is not valid JSON');
}

/** The config keys that name a host somebody typed, as `davUrl` and the mail builders read them. */
const TYPED_HOST_KEYS = ['url', 'baseUrl', 'host', 'mailHost'] as const;

/**
 * Whether a source reaches a host somebody typed, rather than a provider's
 * fixed host or published root. A source nobody could read is taken as
 * typed: the rule then answers, which says less, never more.
 */
export function sourceNamesItsHost(kind: string | undefined, config: Record<string, unknown>): boolean {
  if (kind === undefined) return true;
  // An export read from a folder of the destination's files (0148 T9).
  if (kind === 'archive') return config.where === 'target';
  return TYPED_HOST_KEYS.some((key) => {
    const value = config[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/** The refusals that are ours: no provider was asked (`failure-category.ts`). */
const OURS: ReadonlySet<FailureCategory> = new Set<FailureCategory>(['policy_refused', 'too_large']);

/** Whose host a migration's failures may come from. Every target's host was typed. */
export interface FailureHosts {
  readonly sourceTyped: boolean;
}

/** Each surface's failure, as the managed API answers it for one migration. */
export interface FailureAnswers {
  item(failure: ItemFailure): ItemFailure;
  status(status: MigrationStatus): MigrationStatus;
  discovery(record: DiscoveryRecord): DiscoveryRecord;
  event(event: RunEventReport): RunEventReport;
  run(run: RunReport): RunReport;
}

export function failureAnswers(hosts: FailureHosts): FailureAnswers {
  /** Whether a failure from this side, of this category, is answered by the rule. */
  const reaches = (category: FailureCategory | undefined, side: 'source' | 'target' | undefined): boolean => {
    if (category !== undefined && OURS.has(category)) return false;
    return side === 'source' ? hosts.sourceTyped : true;
  };
  // A run's event carries no side, so it is answered by the rule whatever the
  // source: a fixed host's words on the queue and the page, not here.
  const event = (said: RunEventReport): RunEventReport => ({ ...said, message: failureInOurWords(said.message) });
  return {
    item: (failure) => {
      // At the item level the side IS the category (`schema-pg.ts`, `item.last_error_category`).
      const side = failure.category === 'source_refused' ? 'source' : undefined;
      return reaches(failure.category, side) ? { ...failure, lastError: failureInOurWords(failure.lastError) } : failure;
    },
    status: (status) => {
      if (!status.lastError) return status;
      const side = status.failedSide ?? (status.lastErrorCategory === 'source_refused' ? 'source' : undefined);
      return reaches(status.lastErrorCategory, side)
        ? { ...status, lastError: failureInOurWords(status.lastError) }
        : status;
    },
    discovery: (record) => {
      // A count is the source's answer alone.
      if (!record.lastError || !reaches(undefined, 'source')) return record;
      return { ...record, lastError: failureInOurWords(record.lastError) };
    },
    event,
    run: (run) => ({ ...run, events: run.events.map(event) }),
  };
}

/** An issue's message as the rule says it, when it has one. */
function issueInOurWords<T>(issue: T): T {
  if (typeof issue !== 'object' || issue === null) return issue;
  const { message } = issue as { message?: unknown };
  return typeof message === 'string' ? { ...issue, message: failureInOurWords(message) } : issue;
}

/** One migration's verification result, each issue and recommendation by the rule. */
function resultInOurWords(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;
  const said: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === 'recommendations' && Array.isArray(value)) {
      said[key] = value.map((r: unknown) => (typeof r === 'string' ? failureInOurWords(r) : r));
    } else if (typeof value === 'object' && value !== null && Array.isArray((value as { issues?: unknown }).issues)) {
      // A data type's verification.
      said[key] = { ...value, issues: (value as { issues: unknown[] }).issues.map(issueInOurWords) };
    } else {
      said[key] = value;
    }
  }
  return said;
}

/**
 * THE CHECK PAGE (`verify/report`, review of T3's second step). A check
 * reads the target, whose host was typed, and an issue quotes what a target
 * that could not be read answered (`verification.ts`); a recommendation may
 * repeat it, and a failed scan's error is the pass's message. All three by
 * the rule. The row keeps them.
 */
export function verificationInOurWords(run: VerificationRunReport): VerificationRunReport {
  if (run.state === 'failed') return { ...run, error: failureInOurWords(run.error) };
  if (run.state !== 'done') return run;
  const report: Record<string, unknown> = {};
  for (const [mappingId, result] of Object.entries(run.report)) report[mappingId] = resultInOurWords(result);
  return { ...run, report: report as VerifyResponse };
}

/**
 * AN APPLY RECEIPT (review of T3's second step). A removal or a move that
 * failed carries the target's message (`dav-remove.ts`), so its error is said
 * by the rule. A refusal is ours, from a gate, and reads as written.
 */
export function receiptInOurWords(receipt: ApplyReceipt): ApplyReceipt {
  return receipt.state === 'failed' ? { ...receipt, error: failureInOurWords(receipt.error) } : receipt;
}

/**
 * The answers for one migration, from its source connection's kind and its
 * config as a pass merges it: the mapping's override over the connection's,
 * key by key (`build-deps-from-mapping`). Read inside the caller's tenant
 * transaction.
 */
export async function readFailureAnswers(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<FailureAnswers> {
  const [source] = await db
    .select({
      kind: schema.connection.kind,
      config: schema.connection.config,
      override: schema.mailboxMapping.sourceConfigOverride,
    })
    .from(schema.mailboxMapping)
    .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
    .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
    .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
  const config = {
    ...((source?.config as Record<string, unknown> | null) ?? {}),
    ...((source?.override as Record<string, unknown> | null) ?? {}),
  };
  return failureAnswers({ sourceTyped: sourceNamesItsHost(source?.kind, config) });
}
