// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH KIND OF SOVERIN MAILBOX THIS IS, MEASURED (workplan 0175 §5.2, T2).
 *
 * The Test asks, read-only: A, mail at the row's IMAP server (the mail face,
 * measured as before); B, Soverin's personal DAV server, for the principal
 * the login names and for the collections under it; and C, Suite's
 * Nextcloud. **C is not asked yet.** Its host is one of the four things
 * Soverin's pages leave open (§3.4 q1), measured by the maintainer's live
 * test (T0), and a host this product does not know is not guessed. So this
 * half decides from B alone, and decides only what B alone can show:
 *
 * | B answers                               | Kind                         |
 * |-----------------------------------------|------------------------------|
 * | a principal, collections listed         | `personal`                   |
 * | a principal, no collections             | `unknown` until T0 (row 2)   |
 * | refused                                 | `unknown` until T0 (rows 2–3)|
 * | no answer (time-out, 5xx, the network)  | `unknown` (row 5)            |
 *
 * And with C, once T0 has named its host: C answering beside B is row 4,
 * `unknown` until T0 names the tie-breaker. `suite` is never written here.
 *
 * A refusal is not a kind: it is `unknown`, with the server's words, so the
 * person reads what failed (rule 9: nothing swallowed, nothing guessed).
 */

import { CalDAVSource, CarddavSource } from '@openmig/connectors';
import type { SoverinRecord } from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import { davUrl } from './dav-endpoint.ts';

/** What one DAV root answered when asked for the current user's principal. */
export type PrincipalAnswer =
  | { readonly answered: 'principal'; readonly principal: string }
  /** The server answered, and named no principal: a status it gave, or a 207 without one. */
  | { readonly answered: 'refused'; readonly status: number; readonly words: string }
  /** Nothing answered: a time-out, a 5xx or 429, the network. */
  | { readonly answered: 'nothing'; readonly words: string };

/** The same allowance every face of the Test has. */
const ASK_BUDGET_MS = 20_000;

const PRINCIPAL_PROPFIND =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>';

/** The principal's href in a multistatus, or undefined. Namespace prefixes vary by server. */
function principalHref(body: string): string | undefined {
  const block = /<(?:[\w-]+:)?current-user-principal\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?current-user-principal>/i.exec(body);
  const href = block?.[1] ? /<(?:[\w-]+:)?href\b[^>]*>([^<]*)<\/(?:[\w-]+:)?href>/i.exec(block[1]) : null;
  const value = href?.[1]?.trim();
  return value ? value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : undefined;
}

function statusWords(response: Response): string {
  return `${response.status} ${response.statusText}`.trim();
}

/**
 * B: one PROPFIND for `current-user-principal` (RFC 5397) at the DAV root,
 * Depth 0, with the login. Read-only. Through `tenantFetch`, as every request
 * to a host a tester typed (workplan 0136 T1).
 */
export async function askPrincipal(url: string, username: string, password: string): Promise<PrincipalAnswer> {
  let response: Response;
  try {
    response = await tenantFetch(url, {
      method: 'PROPFIND',
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      body: PRINCIPAL_PROPFIND,
      signal: AbortSignal.timeout(ASK_BUDGET_MS),
    });
  } catch (err) {
    return { answered: 'nothing', words: err instanceof Error ? err.message : String(err) };
  }
  if (response.status >= 500 || response.status === 429) {
    return { answered: 'nothing', words: statusWords(response) };
  }
  if (response.status !== 207) {
    return { answered: 'refused', status: response.status, words: statusWords(response) };
  }
  const principal = principalHref(await response.text());
  return principal
    ? { answered: 'principal', principal }
    : { answered: 'refused', status: 207, words: '207 Multi-Status, naming no current-user-principal' };
}

/** What `decideSoverinKind` reads: B's answers, and C's once T0 has named its host. */
export interface SoverinAnswers {
  /** The DAV root B was asked at. */
  readonly davRoot: string;
  /** B: Soverin's personal DAV server. */
  readonly b: PrincipalAnswer;
  /** The calendars and address books B listed, when the listing answered. */
  readonly collections?: number;
  /** The listing's own words, when it failed. */
  readonly listing?: string;
  /** C: Suite's Nextcloud. Absent until T0 has named its host (§3.4 q1). */
  readonly c?: PrincipalAnswer;
  readonly measuredAt: string;
}

const PERSONAL_SERVER = "Soverin's personal server";

/**
 * §5.2's rule, on recorded answers: pure, so each row of the table is one
 * unit test. Writes `personal` or `unknown`; `suite` waits for T0's rule.
 */
export function decideSoverinKind(answers: SoverinAnswers): SoverinRecord {
  const { b, c, measuredAt } = answers;
  const unknown = (reason: string): SoverinRecord => ({ kind: 'unknown', reason, measuredAt });
  if (b.answered === 'nothing') return unknown(`${PERSONAL_SERVER} did not answer: ${b.words}`);
  if (b.answered === 'refused') {
    // Rows 2 and 3: a Suite mailbox may be refused here, or a password may be
    // wrong. T0 step 6 measures which; until then it is not decided.
    return unknown(`${PERSONAL_SERVER} refused this mailbox's login: ${b.words}`);
  }
  if (c?.answered === 'principal') {
    // Row 4: T0 names the tie-breaker (§15, the first risk).
    return unknown(
      `Both ${PERSONAL_SERVER} and Soverin Suite answered for this mailbox, and which one Soverin reads is not known yet.`,
    );
  }
  if (answers.listing !== undefined) {
    return unknown(
      `${PERSONAL_SERVER} named this mailbox, and listing its calendars and address books failed: ${answers.listing}`,
    );
  }
  if (answers.collections === undefined) {
    return unknown(`${PERSONAL_SERVER} named this mailbox; its calendars and address books were not listed.`);
  }
  if (answers.collections === 0) {
    // Row 2's other half: an empty account may be what the personal server
    // gives a Suite mailbox (§3.4 q3). Not guessed personal.
    return unknown(
      `${PERSONAL_SERVER} named this mailbox and holds no calendars and no address books for it, ` +
        'which is not enough to tell a personal mailbox from one with a Soverin Suite licence.',
    );
  }
  return { kind: 'personal', davRoot: answers.davRoot, principal: b.principal, measuredAt };
}

/** The seams `measureSoverinKind` asks through, so a unit test measures the decision and not sockets. */
export interface MeasureSoverinDeps {
  readonly now?: () => Date;
  readonly principal?: (url: string, username: string, password: string) => Promise<PrincipalAnswer>;
  readonly calendars?: (url: string, username: string, password: string) => Promise<number>;
  readonly addressBooks?: (url: string, username: string, password: string) => Promise<number>;
}

/**
 * B, measured whole, for a row that has no kind yet (D6): its principal, then
 * its calendars and address books, at the row's own DAV root (`config.host`,
 * as it was tested with) and with the mailbox login. Read-only. Used by a
 * pass before its DAV faces; the Test reads the same answers off the faces it
 * measures anyway (`qualifyAccount`).
 */
export async function measureSoverinKind(
  config: Readonly<Record<string, unknown>>,
  login: { readonly username: string; readonly password: string },
  deps: MeasureSoverinDeps = {},
): Promise<SoverinRecord> {
  const davRoot = davUrl({ ...config }, 'soverin', 'calendar');
  const measuredAt = (deps.now ?? (() => new Date()))().toISOString();
  const b = await (deps.principal ?? askPrincipal)(davRoot, login.username, login.password);
  if (b.answered !== 'principal') return decideSoverinKind({ davRoot, b, measuredAt });
  const calendars =
    deps.calendars ??
    (async (url, username, password) => (await new CalDAVSource({ url, username, password }).listFolders()).length);
  const addressBooks =
    deps.addressBooks ??
    (async (url, username, password) => (await new CarddavSource({ url, username, password }).listFolders()).length);
  try {
    const [c, a] = await Promise.all([
      calendars(davRoot, login.username, login.password),
      addressBooks(davRoot, login.username, login.password),
    ]);
    return decideSoverinKind({ davRoot, b, collections: c + a, measuredAt });
  } catch (err) {
    return decideSoverinKind({ davRoot, b, listing: err instanceof Error ? err.message : String(err), measuredAt });
  }
}
