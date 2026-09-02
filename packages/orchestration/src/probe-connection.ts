// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Prove a connection before anything is created (workplan 0046).
 *
 * The docs keep ending with "one read-only command that proves the
 * credentials" — and a managed operator has no shell to run it in. This module
 * is that command as a function: build the connector EXACTLY the way a sync
 * pass would (the same builders, the same credential vocabulary), ask it the
 * cheapest read-only question it answers (`listFolders`), and report the
 * outcome in the same words a pass would fail with.
 *
 * WHAT A PASSED PROBE MEANS, precisely: the credentials as typed reach the
 * provider, authenticate, and can enumerate collections. It deliberately runs
 * on the SHAPES THE CREATE ROUTE WOULD STORE — config blob and credential
 * record — so "test passed, create, first pass fails" cannot be caused by the
 * probe testing something other than what was saved.
 *
 * READ-ONLY BY CONSTRUCTION: every connector consulted here is a SOURCE-class
 * connector (including for target probes — a CalDAV target is probed with the
 * CalDAV source's PROPFIND against the target URL), and `listFolders` writes
 * nothing anywhere.
 */

import { isCredentialRefusal, withDeploymentDropboxClient, withDeploymentGoogleClient } from '@openmig/shared';
import { isGoogleGrantKind } from './account-qualification.ts';
import type { SourceConfig, ProbeOutcome, ProbeUnit } from '@openmig/shared';
import { CalDAVSource, CarddavSource, DropboxFileSource, WebdavFileSource } from '@openmig/connectors';
import { measureTargetScheduling } from './target-scheduling.ts';
import type { SchedulingVerdict } from './target-scheduling.ts';

// The verdict's own module holds the recorder too; re-exported here so the
// probe's consumers keep one import site for everything a test result carries.
export {
  CALENDAR_TARGET_SCHEDULING_ACTION,
  measureTargetScheduling,
  schedulingRecorder,
} from './target-scheduling.ts';
export type { SchedulingVerdict } from './target-scheduling.ts';
import { buildImapSourceFrom } from './mail-source-factory.ts';
import {
  buildFileSourceFromConnection,
  buildSourceConnectorFromCredentials,
} from './build-deps-from-mapping.ts';
import { GMAIL_CONNECTION_KIND, STORED_GMAIL_CREDENTIAL_NAMES, buildGmailSourceFrom } from './gmail-source-factory.ts';
import {
  DROPBOX_CONNECTION_KIND,
  STORED_DROPBOX_CREDENTIAL_NAMES,
  buildDropboxSourceFrom,
} from './dropbox-source-factory.ts';
import { BOX_CONNECTION_KIND } from './box-source-factory.ts';
import {
  GOOGLE_DRIVE_CONNECTION_KIND,
  STORED_GOOGLE_CREDENTIAL_NAMES,
  buildGoogleDriveSourceFrom,
} from './drive-source-factory.ts';
import {
  GOOGLE_ACCOUNT_CONNECTION_KIND,
  GOOGLE_CALENDAR_CONNECTION_KIND,
  GOOGLE_CONTACTS_CONNECTION_KIND,
  STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
  buildGoogleCalendarDavSourceFrom,
  buildGoogleContactsDavSourceFrom,
} from './google-dav-source-factory.ts';
import { davEndpointFromCreds } from './dav-endpoint.ts';

/**
 * One probe's outcome. Never a throw for a provider-side failure: "your
 * password is wrong" is an ANSWER the person asked for, not an error, and it
 * arrives verbatim — the same sentence a sync pass would have failed with,
 * shown before anything was created instead of after (rule 9).
 */
export type ProbeResult =
  | {
      readonly ok: true;
      readonly detail: string;
      readonly outcome: ProbeOutcome;
      /**
       * DAV targets only (0105 T0): what this target will DO with the
       * calendar objects a migration writes — measured by one OPTIONS
       * request, never assumed. Absent on every other probe.
       */
      readonly scheduling?: SchedulingVerdict;
    }
  | { readonly ok: false; readonly reason: string; readonly outcome: ProbeOutcome };

/** The English `detail` for a successful listing — the fallback, not the UI. */
function connectedDetail(count: number, unit: ProbeUnit, floor = false): string {
  const noun =
    unit === 'addressBook' ? 'address book' : unit === 'collection' ? 'collection' : unit;
  return `Connected. ${floor ? 'At least ' : ''}${count} ${noun}${count === 1 ? '' : 's'} visible.`;
}

/** Anything with the one question every source answers. */
interface Listable {
  listFolders(): Promise<ReadonlyArray<unknown>>;
}

/** A listing that stops at a cap: past it the count is a floor, and says so. */
interface BoundedListable {
  listTopLevelFolders(): Promise<{ folders: ReadonlyArray<unknown>; truncated: boolean }>;
}

/**
 * HOW LONG A PROBE MAY TAKE before the answer is "it did not answer"
 * (2026-09-02). The web client gives up at 30 s; this leaves the door room
 * to write the row and answer. The work in flight is not cancelled — a
 * provider walk has no abort handle — so a slow probe still finishes in the
 * background; what changes is that the person gets an answer.
 */
export const PROBE_DEADLINE_MS = 20_000;

function timedOut(ms: number): ProbeResult {
  const seconds = Math.round(ms / 1000);
  return {
    ok: false,
    reason:
      `The test did not answer within ${seconds} seconds. The connection is kept; test it ` +
      'again later, or give it a narrower root folder.',
    outcome: { code: 'timedOut', seconds },
  };
}

/** Run one probe under the deadline: the first of the two answers wins. */
export function withProbeDeadline(
  run: () => Promise<ProbeResult>,
  ms = PROBE_DEADLINE_MS,
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    const timer = setTimeout(() => resolve(timedOut(ms)), ms);
    run().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err: unknown) => {
        clearTimeout(timer);
        resolve(providerRefused(err));
      },
    );
  });
}

/**
 * A refusal, labelled with WHOSE it is.
 *
 * Two very different things reach this catch. A provider's error —
 * `invalid_client` from Dropbox — is theirs, and the whole point of 0080 is
 * that it renders verbatim. A credential refusal thrown by one of our own
 * source factories is OURS, and mislabelling it as the provider's is why it
 * stayed English in a Dutch UI: the render-verbatim rule was being applied to
 * a sentence we wrote (workplan 0083).
 *
 * `reason` is the English either way, so nothing that only knows about
 * `reason` changes.
 */
function providerRefused(err: unknown): ProbeResult {
  if (isCredentialRefusal(err)) {
    return {
      ok: false,
      reason: err.refusal.en,
      outcome: { code: 'credentialsRefused', refusal: err.refusal },
    };
  }
  return {
    ok: false,
    reason: err instanceof Error ? err.message : String(err),
    outcome: { code: 'providerRefused' },
  };
}

async function probeListable(build: () => Listable, unit: ProbeUnit): Promise<ProbeResult> {
  try {
    const folders = await build().listFolders();
    return {
      ok: true,
      detail: connectedDetail(folders.length, unit),
      outcome: { code: 'connected', count: folders.length, unit },
    };
  } catch (err) {
    return providerRefused(err);
  }
}

async function probeBounded(build: () => BoundedListable, unit: ProbeUnit): Promise<ProbeResult> {
  try {
    const { folders, truncated } = await build().listTopLevelFolders();
    return {
      ok: true,
      detail: connectedDetail(folders.length, unit, truncated),
      outcome: {
        code: 'connected',
        count: folders.length,
        unit,
        ...(truncated ? { floor: true } : {}),
      },
    };
  } catch (err) {
    return providerRefused(err);
  }
}

/**
 * Probe a SOURCE as the create route would store it: `kind` is the
 * connection.kind the mapping would get, `config` the JSONB blob, `creds` the
 * record that would be encrypted. The same builders a sync pass uses do the
 * interpreting, so the probe cannot pass on a shape the pass would refuse.
 */
export function probeSourceConnection(
  kind: string,
  config: Record<string, unknown>,
  rawCreds: Record<string, string>,
): Promise<ProbeResult> {
  return withProbeDeadline(() => probeSourceNow(kind, config, rawCreds));
}

async function probeSourceNow(
  kind: string,
  config: Record<string, unknown>,
  rawCreds: Record<string, string>,
): Promise<ProbeResult> {
  /**
   * THE DEPLOYMENT'S OWN GOOGLE CLIENT, where it has one and this row is a
   * Google one (ADR-0041, owner decision 2026-09-01 — option B).
   *
   * Here rather than at the four call sites in `apps/api`, for the reason this
   * whole file exists: **the probe must build exactly what a pass builds.** A
   * fallback applied on the run path and not on the probe means Test refuses a
   * connection the migration would have accepted — "test failed, create
   * worked", which is the same lie as its more famous twin and reads as a
   * broken product rather than as a missing field.
   *
   * The kind gate is not tidiness: Dropbox and Box store their own app key and
   * secret under the same `clientId`/`clientSecret` names, and handing them
   * Google's application would fail at their provider naming nothing useful.
   */
  const creds = withDeploymentDropboxClient(
    kind === DROPBOX_CONNECTION_KIND,
    withDeploymentGoogleClient(isGoogleGrantKind(kind), rawCreds),
  );
  const user = String(config.user ?? '');
  switch (kind) {
    case GMAIL_CONNECTION_KIND:
      return probeListable(
        () => buildGmailSourceFrom(user, creds, STORED_GMAIL_CREDENTIAL_NAMES),
        'folder',
      );
    case GOOGLE_DRIVE_CONNECTION_KIND:
      return probeListable(() => buildFileSourceFromConnection({ config, creds, kind }), 'folder');
    case DROPBOX_CONNECTION_KIND:
      // The same builder a pass uses (workplan 0055), a CHEAPER question
      // (2026-09-02): `listFolders` is one recursive listing of the whole
      // tree, which the owner's whole-Dropbox Test could not finish inside
      // the browser's 30 s. The top level, capped, proves "reachable and
      // listing" in one round trip; past the cap the count is a floor.
      return probeBounded(() => {
        const source = buildFileSourceFromConnection({ config, creds, kind });
        if (!(source instanceof DropboxFileSource)) {
          throw new Error('the file-source builder did not answer a Dropbox source for the dropbox kind');
        }
        return source;
      }, 'folder');
    case BOX_CONNECTION_KIND:
      // Box (workplan 0056): same route again — the builder holds the CCG
      // branching, so test-connection proves exactly what a pass builds.
      return probeListable(() => buildFileSourceFromConnection({ config, creds, kind }), 'folder');
    // The ACCOUNT kind answers with its CALENDAR face (workplan 0106 T3b),
    // the same choice T4a made for `soverin` and for the same reason: it is
    // the face the scheduling verdict belongs to, and a headline probe has to
    // pick one. The other faces are not guessed from it — the qualification
    // measures each separately and the badges report all of them.
    case GOOGLE_ACCOUNT_CONNECTION_KIND:
    case GOOGLE_CALENDAR_CONNECTION_KIND:
      return probeListable(
        () => buildGoogleCalendarDavSourceFrom(user, creds, STORED_GOOGLE_DAV_CREDENTIAL_NAMES),
        'calendar',
      );
    case GOOGLE_CONTACTS_CONNECTION_KIND:
      return probeListable(
        () => buildGoogleContactsDavSourceFrom(user, creds, STORED_GOOGLE_DAV_CREDENTIAL_NAMES),
        'addressBook',
      );
    case 'imap':
    case 'o365':
      // The managed mail builder handles both: a password, a static token, or
      // the per-customer app registration (which selects XOAUTH2 minting, with
      // Graph behind it for an O365 tenant).
      return probeListable(
        () => buildSourceConnectorFromCredentials(config as unknown as SourceConfig, creds),
        'folder',
      );
    default:
      return {
        ok: false,
        reason: `No probe exists for a '${kind}' source connection. This is a wiring gap, not a credential problem.`,
        outcome: { code: 'noProbe', kind },
      };
  }
}

/**
 * Probe a TARGET with read-only questions only. DAV targets are asked via the
 * SOURCE connectors' PROPFIND (same URL resolution as the real target
 * builders, via `davEndpointFromCreds`); an IMAP target via a LIST; a JMAP
 * target by fetching its session document — the same `.well-known/jmap` every
 * JMAP client here starts with.
 */
export function probeTargetConnection(
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav' | 'soverin',
  config: Record<string, unknown>,
  creds: Record<string, string>,
): Promise<ProbeResult> {
  return withProbeDeadline(() => probeTargetNow(targetType, config, creds));
}

async function probeTargetNow(
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav' | 'soverin',
  config: Record<string, unknown>,
  creds: Record<string, string>,
): Promise<ProbeResult> {
  try {
    if (targetType === 'jmap') {
      const baseUrl = String(config.baseUrl ?? '');
      const sessionUrl = `${baseUrl}/.well-known/jmap`;
      const res = await fetch(sessionUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        return {
          ok: false,
          reason:
            `The JMAP session document at ${sessionUrl} answered ${res.status}. ` +
            (res.status === 401
              ? 'The server is reachable and refused the credentials.'
              : 'Check the target host and port.'),
          outcome: { code: 'targetStatus', url: sessionUrl, status: res.status },
        };
      }
      return {
        ok: true,
        detail: 'Connected. The JMAP session document answered.',
        outcome: { code: 'connectedSession' },
      };
    }
    if (targetType === 'imap') {
      const source = buildImapSourceFrom(
        {
          host: String(config.host ?? ''),
          port: Number(config.port ?? 993),
          tls: config.useSsl !== false,
          user: String(config.user ?? creds.username ?? ''),
        },
        { authType: 'LOGIN', password: creds.password },
      );
      const folders = await source.listFolders();
      return {
        ok: true,
        detail: connectedDetail(folders.length, 'folder'),
        outcome: { code: 'connected', count: folders.length, unit: 'folder' },
      };
    }
    // The DAV-shaped targets: same URL resolution as the real target builders.
    const endpoint = davEndpointFromCreds('target', config, creds);
    const listable: Listable =
      // A `soverin` account's headline face is its calendar (0106 T4a): the
      // most informative single answer, and the one the scheduling verdict
      // belongs to. The qualification beside it carries the other faces.
      targetType === 'caldav' || targetType === 'soverin'
        ? new CalDAVSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password })
        : targetType === 'carddav'
          ? new CarddavSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password })
          : new WebdavFileSource({ url: endpoint.url, username: endpoint.username, password: endpoint.password });
    const folders = await listable.listFolders();
    // What this target will DO with calendar writes (0105 T0, the 0103 T3
    // remainder): measured here, at the moment a person is looking at the
    // test result, on the exact endpoint a pass would write to. carddav is
    // skipped — an address-book target has no scheduling to measure.
    const scheduling =
      targetType === 'carddav'
        ? undefined
        : await measureTargetScheduling(endpoint.url, endpoint.username, endpoint.password);
    return {
      ok: true,
      // Appended to the fallback text so every consumer that shows `detail`
      // shows the verdict; the structured field is beside it for UIs that
      // render their own words.
      detail:
        connectedDetail(folders.length, 'collection') +
        (scheduling ? ` ${scheduling.sentence}` : ''),
      outcome: { code: 'connected', count: folders.length, unit: 'collection' },
      ...(scheduling ? { scheduling } : {}),
    };
  } catch (err) {
    return providerRefused(err);
  }
}

/**
 * The shared drives a Google credential can see (workplan 0049) — the
 * onboarding question "which id goes in rootFolderId?" answered by the API
 * instead of a walk through the admin console. Built by the same factory a
 * pass uses, in the stored-credential vocabulary the wizard collects; a
 * refusal (missing credential, bad consent) arrives verbatim, exactly like a
 * probe's.
 */
export async function listGoogleSharedDrives(
  creds: Record<string, string>,
): Promise<
  | { readonly ok: true; readonly drives: ReadonlyArray<{ id: string; name: string }> }
  | { readonly ok: false; readonly reason: string }
> {
  try {
    const source = buildGoogleDriveSourceFrom({}, creds, STORED_GOOGLE_CREDENTIAL_NAMES) as {
      listSharedDrives?: () => Promise<ReadonlyArray<{ id: string; name: string }>>;
    };
    if (typeof source.listSharedDrives !== 'function') {
      return {
        ok: false,
        reason: 'This Drive source cannot enumerate shared drives. This is a wiring gap, not a credential problem.',
      };
    }
    return { ok: true, drives: await source.listSharedDrives() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The shared folders a Dropbox credential can see (the 0049/0051 browse,
 * Dropbox's turn) — same factory a pass uses, refusals verbatim. A mounted
 * folder's `path` is what goes in `rootPath`; an unmounted one is shown so
 * the owner knows it exists (mountable only from Dropbox itself).
 */
export async function listDropboxSharedFolders(
  creds: Record<string, string>,
): Promise<
  | {
      readonly ok: true;
      readonly folders: ReadonlyArray<{ id: string; name: string; path?: string }>;
    }
  | { readonly ok: false; readonly reason: string }
> {
  try {
    const source = buildDropboxSourceFrom(
      {},
      {
        appKey: creds[STORED_DROPBOX_CREDENTIAL_NAMES.appKey],
        appSecret: creds[STORED_DROPBOX_CREDENTIAL_NAMES.appSecret],
        refreshToken: creds[STORED_DROPBOX_CREDENTIAL_NAMES.refreshToken],
      },
      STORED_DROPBOX_CREDENTIAL_NAMES,
    ) as { listSharedFolders?: () => Promise<ReadonlyArray<{ id: string; name: string; path?: string }>> };
    if (typeof source.listSharedFolders !== 'function') {
      return {
        ok: false,
        reason: 'This Dropbox source cannot enumerate shared folders. This is a wiring gap, not a credential problem.',
      };
    }
    return { ok: true, folders: await source.listSharedFolders() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The folders other accounts shared with this credential (workplan 0051) —
 * the second half of the same browse: a shared FOLDER migrates by rooting a
 * mapping at its id, and this answers "which id?" for folders exactly as
 * `listGoogleSharedDrives` does for shared drives. Same factory, same
 * stored-credential vocabulary, refusals verbatim.
 */
export async function listGoogleSharedFolders(
  creds: Record<string, string>,
): Promise<
  | {
      readonly ok: true;
      readonly folders: ReadonlyArray<{ id: string; name: string; owner?: string }>;
    }
  | { readonly ok: false; readonly reason: string }
> {
  try {
    const source = buildGoogleDriveSourceFrom({}, creds, STORED_GOOGLE_CREDENTIAL_NAMES) as {
      listSharedWithMeFolders?: () => Promise<
        ReadonlyArray<{ id: string; name: string; owner?: string }>
      >;
    };
    if (typeof source.listSharedWithMeFolders !== 'function') {
      return {
        ok: false,
        reason:
          'This Drive source cannot enumerate shared folders. This is a wiring gap, not a credential problem.',
      };
    }
    return { ok: true, folders: await source.listSharedWithMeFolders() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
