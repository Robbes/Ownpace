// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TEST FOR THE MICROSOFT ACCOUNT KIND (workplan 0114 T10).
 *
 * 0114 wired the account kind's five faces for the PASSES and left the two
 * things a Test is made of untouched: the headline probe fell to the probe
 * module's `default` arm — "No probe exists for a 'microsoft' source
 * connection", an honest sentence about a gap — and the qualification had no
 * branch at all, so every badge on the card stayed `?`. The owner found both
 * on 2026-09-06, on the first Microsoft 365 account he connected, with a
 * grant that worked.
 *
 * Three things live here, and they share one reading of the grant.
 *
 * WHAT THE GRANT CARRIES is read from Microsoft, never assumed from the
 * wizard. The consent asks for exactly the faces a person ticked (0114 T2),
 * so a stored row may carry mail and files and no calendar — and nothing on
 * the row says which. Exchanging the refresh token for `.default` answers
 * with every scope the person consented to for Graph, in the response's own
 * `scope` field; that is the Google twin (0106 T1a) with Microsoft's words.
 *
 * THE HEADLINE PROBE picks ONE face and lists it, as every account kind's
 * probe does — the calendar first, the face the scheduling verdict belongs
 * to (0106 T3b, 0115 T5) — but the first face the grant CARRIES, in that
 * order. A calendar-first probe against a mail-and-files grant would refuse
 * with Microsoft's consent error for a connection the migration would run
 * fine, which is "test failed, create worked" — the lie the probe module
 * exists to prevent.
 *
 * THE QUALIFICATION asks every face the kind claims: a face the grant does
 * not carry is a MEASURED no with the remedy in the sentence (asking is
 * granting: reconnect with the face ticked), a face it carries is reached
 * with the same builder a pass uses and answers with its count, and a face
 * that refuses stays unknown with Graph's own words (the three-state rule,
 * 0106 T3a). Where a face offers a cheap measure — the drive's own quota,
 * the message count Exchange keeps on every folder, the cards in each
 * address book — the Measured line gets it.
 */

import {
  MICROSOFT_DOMAIN_SCOPES,
  PROVIDER_ACCOUNT_DOMAINS,
  graphScopesGranted,
  microsoftFaceScope,
  microsoftTenant,
  microsoftTokenEndpoint,
  withDeploymentMicrosoftClient,
} from '@openmig/shared';
import { missingCredentials } from '@openmig/shared';
import type { BilingualRefusal, DiscoveryDomain, ProbeUnit, SourceConfig } from '@openmig/shared';
import {
  buildCalendarSourceFromConnection,
  buildContactSourceFromConnection,
  buildFileSourceFromConnection,
  buildSourceConnectorFromCredentials,
  buildTaskSourceFromConnection,
} from './build-deps-from-mapping.ts';
import type { AccountQualification, MeasuredVolume, QualifiedDomain } from './account-qualification.ts';

/** The stored kind of a Microsoft 365 account row (0114 T3). */
export const MICROSOFT_ACCOUNT_KIND = 'microsoft';

export function isMicrosoftGrantKind(kind: string): boolean {
  return kind === MICROSOFT_ACCOUNT_KIND;
}

/**
 * The faces in the order the headline probe tries them: the calendar first —
 * the account-kind rule, because it is the face the scheduling verdict
 * belongs to — then the rest as the account table lists them. Read off
 * `PROVIDER_ACCOUNT_DOMAINS` so a sixth face joins here without an edit.
 */
export function microsoftFacesInProbeOrder(): ReadonlyArray<DiscoveryDomain> {
  const claimed = PROVIDER_ACCOUNT_DOMAINS.microsoft;
  return [...claimed.filter((f) => f === 'calendar'), ...claimed.filter((f) => f !== 'calendar')];
}

/** What each face counts, in the unit a screen words. */
export const MICROSOFT_FACE_UNIT: Readonly<Record<DiscoveryDomain, ProbeUnit>> = {
  email: 'folder',
  calendar: 'calendar',
  contact: 'addressBook',
  file: 'folder',
  task: 'taskList',
};

/** The Microsoft identity platform's `.default` for Graph: every consented scope. */
const GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';

export type MicrosoftGrantRead =
  | { readonly ok: true; readonly granted: ReadonlySet<string> }
  | {
      readonly ok: false;
      readonly reason: string;
      /** Set when the fault is OURS — a stored row missing what the read
       *  needs — so the probe can answer in the credential vocabulary, in
       *  both languages, rather than as a provider's refusal. */
      readonly refusal?: BilingualRefusal;
    };

export interface ReadMicrosoftGrantOptions {
  /** The token endpoint — a parameter so tests exchange against a stub. */
  readonly tokenEndpoint?: string;
}

/**
 * Read what a stored Microsoft grant ACTUALLY CARRIES.
 *
 * One refresh-token exchange asking for `.default`: the platform answers with
 * an access token for every scope the person consented to, and names them in
 * the response. Nothing is stored and the token is discarded — the question
 * is the `scope` field. A refused exchange reads nothing, and says so in
 * Microsoft's words, which are the same words the faces would refuse with.
 */
export async function readMicrosoftGrant(
  creds: Record<string, string>,
  options: ReadMicrosoftGrantOptions = {},
): Promise<MicrosoftGrantRead> {
  const clientId = (creds.clientId ?? '').trim();
  const refreshToken = (creds.refreshToken ?? '').trim();
  if (!clientId || !refreshToken) {
    // NAMED, one by one, because the two absences mean different things and
    // the first live Test (2026-09-06) met the one this sentence used to
    // hide: the row had a client id (the deployment's, filled in) and NO
    // token, because the record had dropped it — and "no clientId/refreshToken
    // pair" pointed a reader at the registration, which was fine.
    const missing = [...(!clientId ? ['clientId'] : []), ...(!refreshToken ? ['refreshToken'] : [])];
    const { refusal } = missingCredentials({
      subject: 'The Microsoft 365 account',
      missing,
      detailEn: !refreshToken
        ? 'The consent’s token is not on this connection. Remove it and connect the account ' +
          'again with Connect with Microsoft, so the token is stored with it.'
        : 'A row that took the grant button relies on the deployment’s own Microsoft ' +
          'application: set MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET, or ' +
          'send the connection’s own pair.',
      detailNl: !refreshToken
        ? 'Het token van de toestemming staat niet op deze koppeling. Verwijder de koppeling ' +
          'en verbind het account opnieuw met Verbinden met Microsoft, zodat het token erbij ' +
          'wordt opgeslagen.'
        : 'Een koppeling via de toestemmingsknop leunt op de eigen Microsoft-applicatie van ' +
          'deze installatie: stel MICROSOFT_OAUTH_CLIENT_ID en MICROSOFT_OAUTH_CLIENT_SECRET ' +
          'in, of stuur het eigen paar van de koppeling mee.',
    });
    return { ok: false, reason: refusal.en, refusal };
  }
  const tenant = (creds.tenantId ?? '').trim() || microsoftTenant();
  const tokenEndpoint = options.tokenEndpoint ?? microsoftTokenEndpoint(tenant);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: GRAPH_DEFAULT_SCOPE,
    ...(creds.clientSecret ? { client_secret: creds.clientSecret } : {}),
  });
  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, reason: `the token exchange failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!response.ok) {
    const head = (await response.text()).slice(0, 300);
    return { ok: false, reason: `the token exchange answered ${response.status}: ${head}` };
  }
  let token: { scope?: unknown };
  try {
    token = (await response.json()) as { scope?: unknown };
  } catch (err) {
    return { ok: false, reason: `the token exchange answered something that is not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, granted: graphScopesGranted(typeof token.scope === 'string' ? token.scope : '') };
}

/** Anything with the one question every source answers. */
export interface MicrosoftListable {
  listFolders(): Promise<ReadonlyArray<unknown>>;
}
/** The file face's cheaper question: the top level, capped (the drive is walked by a pass, never by a Test). */
export interface MicrosoftBoundedListable {
  listTopLevelFolders(): Promise<{ folders: ReadonlyArray<unknown>; truncated: boolean }>;
}

/**
 * The source behind one face of a stored Microsoft row, built EXACTLY as a
 * pass builds it — the same seams `build-deps-from-mapping.ts` reaches for,
 * so the Test cannot pass a shape a pass would refuse or refuse one a pass
 * would run (the probe module's reason, applied here).
 */
export function microsoftFaceSource(
  face: DiscoveryDomain,
  config: Record<string, unknown>,
  creds: Record<string, string>,
): unknown {
  const src = { config, creds, kind: MICROSOFT_ACCOUNT_KIND };
  switch (face) {
    case 'email': {
      const tenantId = String(config.tenantId ?? '').trim();
      const sourceConfig = {
        type: MICROSOFT_ACCOUNT_KIND,
        user: String(config.user ?? ''),
        ...(tenantId === '' ? {} : { tenantId }),
      } as unknown as SourceConfig;
      return buildSourceConnectorFromCredentials(sourceConfig, creds);
    }
    case 'calendar':
      return buildCalendarSourceFromConnection(src);
    case 'contact':
      return buildContactSourceFromConnection(src);
    case 'file':
      return buildFileSourceFromConnection(src);
    case 'task':
      return buildTaskSourceFromConnection(src);
  }
}

/** The test seam: build a face's source some other way (a stub, in a unit test). */
export type MicrosoftFaceSourceBuilder = (
  face: DiscoveryDomain,
  config: Record<string, unknown>,
  creds: Record<string, string>,
) => unknown;

const offers = <T>(source: unknown, method: keyof T & string): source is T =>
  typeof source === 'object' && source !== null && typeof (source as Record<string, unknown>)[method] === 'function';

/**
 * List a face with the cheapest question it answers: the top level for the
 * drive (bounded, a floor past the cap), the whole listing for the others
 * (calendars, address books, task lists and mail folders are few).
 */
export async function listMicrosoftFace(
  source: unknown,
): Promise<{ readonly count: number; readonly floor: boolean; readonly listed: ReadonlyArray<unknown> }> {
  if (offers<MicrosoftBoundedListable>(source, 'listTopLevelFolders')) {
    const { folders, truncated } = await source.listTopLevelFolders();
    return { count: folders.length, floor: truncated, listed: folders };
  }
  if (offers<MicrosoftListable>(source, 'listFolders')) {
    const listed = await source.listFolders();
    return { count: listed.length, floor: false, listed };
  }
  throw new Error(`the ${MICROSOFT_ACCOUNT_KIND} face's source answers no listing question`);
}

interface MessageCountable {
  countMessages(): Promise<{ messages: number }>;
}
interface UsageMeasurable {
  storageUsage(): Promise<{ bytes: number }>;
}
interface CardListable {
  listSince(folder: unknown): Promise<{
    items: ReadonlyArray<unknown>;
    /** Cards the listing found and could not read. See `ports.ts`. */
    unreadable?: number;
  }>;
}

/**
 * How much the face holds, in the cheapest honest way each face allows —
 * asked for by shape rather than by class, so the test seam can answer with
 * plain objects and a source without the method is simply not measured (the
 * yes stands on the listing, and no volume is claimed).
 */
async function measureMicrosoftFace(
  face: DiscoveryDomain,
  source: unknown,
  listed: ReadonlyArray<unknown>,
): Promise<MeasuredVolume | undefined> {
  switch (face) {
    case 'email': {
      if (!offers<MessageCountable>(source, 'countMessages')) return undefined;
      const { messages } = await source.countMessages();
      return { items: messages };
    }
    case 'file': {
      if (!offers<UsageMeasurable>(source, 'storageUsage')) return undefined;
      const { bytes } = await source.storageUsage();
      return { bytes };
    }
    case 'contact': {
      if (!offers<CardListable>(source, 'listSince')) return undefined;
      let items = 0;
      // COUNTED BESIDE THE CARDS THAT READ. A listing that drops a card it
      // cannot map would otherwise make an unreadable address book and an
      // empty one the same number.
      let unreadable = 0;
      for (const folder of listed) {
        const listing = await source.listSince(folder);
        items += listing.items.length;
        unreadable += listing.unreadable ?? 0;
      }
      return { items, ...(unreadable > 0 ? { unreadable } : {}) };
    }
    case 'calendar':
    case 'task':
      return undefined;
  }
}

function counted(count: number, unit: ProbeUnit): string {
  const noun = unit === 'addressBook' ? 'address book' : unit === 'taskList' ? 'task list' : unit;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The face's own English name for a sentence. */
const FACE_WORD: Readonly<Record<DiscoveryDomain, string>> = {
  email: 'mail',
  calendar: 'calendars',
  contact: 'contacts',
  file: 'files',
  task: 'tasks',
};

function allUnknown(why: string): AccountQualification {
  const domain: QualifiedDomain = { answer: 'unknown', detail: why };
  return { domains: { mail: domain, calendar: domain, contact: domain, file: domain, task: domain } };
}

export interface QualifyMicrosoftAccountOptions extends ReadMicrosoftGrantOptions {
  /** Build a face's source some other way — the unit tests' seam. */
  readonly source?: MicrosoftFaceSourceBuilder;
}

/**
 * QUALIFY A MICROSOFT ACCOUNT — read the grant, then reach every face it
 * carries with the builder a pass would use, and remember what answered.
 *
 * The three-state rule, face by face:
 *   - carried and listed: `yes`, with the count and (where cheap) the volume;
 *   - not carried: a MEASURED `no` — the consent said so — with the remedy;
 *   - carried and refused: `unknown`, with Graph's own words;
 *   - the grant unreadable: everything `unknown`, with the exchange's words.
 */
export async function qualifyMicrosoftAccount(
  kind: string,
  config: Record<string, unknown>,
  rawCreds: Record<string, string>,
  options: QualifyMicrosoftAccountOptions = {},
): Promise<AccountQualification | undefined> {
  if (!isMicrosoftGrantKind(kind)) return undefined;
  // The deployment's own registration, where it carries one (0114 T1): the
  // same fill the probe and the pass apply, so a row that stores no pair
  // measures too rather than answering "no clientId to read the grant from".
  const creds = withDeploymentMicrosoftClient(true, rawCreds);
  const grant = await readMicrosoftGrant(creds, options);
  if (!grant.ok) return allUnknown(`Unmeasured — ${grant.reason}`);

  const build = options.source ?? microsoftFaceSource;
  const faceFromGrant = async (face: DiscoveryDomain): Promise<QualifiedDomain> => {
    const scope = microsoftFaceScope(face);
    if (!scope) {
      return { answer: 'no', detail: `A Microsoft 365 account does not carry ${FACE_WORD[face]} through this product.` };
    }
    if (!grant.granted.has(scope)) {
      return {
        answer: 'no',
        detail:
          `The consent did not include ${scope}, so ${FACE_WORD[face]} cannot be read — asking is ` +
          `granting: connect the account again with ${FACE_WORD[face]} ticked to add it.`,
      };
    }
    const unit = MICROSOFT_FACE_UNIT[face];
    try {
      const source = build(face, config, creds);
      const { count, floor, listed } = await listMicrosoftFace(source);
      const answered: QualifiedDomain = {
        answer: 'yes',
        detail: `The consent carries ${scope}; ${floor ? 'at least ' : ''}${counted(count, unit)} visible.`,
        count,
        unit,
      };
      // MEASURED once the face has answered — and a measure that fails does
      // not take the yes away: the listing is the capability evidence, the
      // volume a second fact, failing aloud in the evidence sentence rather
      // than as a missing number nobody explains.
      try {
        const volume = await measureMicrosoftFace(face, source, listed);
        return volume ? { ...answered, volume } : answered;
      } catch (err) {
        return { ...answered, volume: { failed: err instanceof Error ? err.message : String(err) } };
      }
    } catch (err) {
      // A refusal is NOT a no: the consent carries the scope, so "cannot
      // carry" would be false, and nothing answered, so it is not a yes.
      return {
        answer: 'unknown',
        detail: `The consent carries ${scope}, but the face did not answer: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  };

  const [mail, calendar, contact, file, task] = await Promise.all([
    faceFromGrant('email'),
    faceFromGrant('calendar'),
    faceFromGrant('contact'),
    faceFromGrant('file'),
    faceFromGrant('task'),
  ]);
  return { domains: { mail, calendar, contact, file, task } };
}

/** Every face of the account kind, for the guard that asks whether each has a scope. */
export const MICROSOFT_FACES_WITH_A_SCOPE: ReadonlyArray<DiscoveryDomain> = Object.keys(
  MICROSOFT_DOMAIN_SCOPES,
) as ReadonlyArray<DiscoveryDomain>;
