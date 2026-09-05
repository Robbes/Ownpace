// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH BUILDER SPEAKS FOR WHICH FACE OF WHICH STORED CONNECTION.
 *
 * Workplan 0114 T5a. Three seams in `build-deps-from-mapping.ts` chose a
 * source builder, and all three had the same shape:
 *
 *   googleDavServes(kind, 'calendar') ? Google : DAV
 *   googleDavServes(kind, 'contact')  ? Google : DAV
 *   dropbox / box / googleDriveServes / DAV
 *
 * **Every one of those is a two-way condition, and Microsoft is the third
 * provider.** A `microsoft` account row reaching them takes the last branch,
 * is handed to `davEndpointFromCreds`, and is refused for a missing username
 * and password — credentials that do not exist for this provider — from
 * inside a sync pass. That is the #597 symptom, and it is the same sentence
 * `buildFileSourceFromConnection` already carried at the top of it about
 * Google Drive.
 *
 * ## Why a table, and why an exhaustive name
 *
 * The family this repository keeps meeting is the one where **adding a
 * provider is not a compile error**. A `?:` chain takes its else branch and
 * reports success; an array literal grows silently; a bare `else` does the
 * wrong work.
 *
 * So the answer here is a NAME rather than a boolean, and the seams `switch`
 * on it with a `never` check. Adding a builder to this union breaks the build
 * at every seam that has not been told what to do about it — which is the
 * only mechanism in this codebase that has ever reliably stopped a fan-out.
 *
 * ## What this decides, and what it does not
 *
 * It says which BUILDER speaks for a row's face — protocol resolution, the
 * #597 rule. It says nothing about what that row can carry: capability is
 * read off the account's measured qualification record (0106 T0/T1a), and
 * only a measured `no` constrains anything (0106 T3a). A provider account
 * advertising a face it cannot build is a defect, and
 * `scripts/a-face-a-provider-account-cannot-build.unit.test.ts` is what makes
 * it a failing test rather than a support ticket.
 */

import type { DiscoveryDomain } from '@openmig/shared';
import {
  PROVIDER_ACCOUNT_DOMAINS,
  GOOGLE_RESTRICTED_ACCOUNT_DOMAINS,
  isProviderAccountKind,
  type ProviderAccountKind,
} from '@openmig/shared';
import { ARCHIVE_CONNECTION_KIND } from './archive-source-factory.ts';
import { BOX_CONNECTION_KIND } from './box-source-factory.ts';
import { DROPBOX_CONNECTION_KIND } from './dropbox-source-factory.ts';
import { GOOGLE_DRIVE_CONNECTION_KIND } from './drive-source-factory.ts';
import { GMAIL_CONNECTION_KIND } from './gmail-source-factory.ts';
import {
  GOOGLE_CALENDAR_CONNECTION_KIND,
  GOOGLE_CONTACTS_CONNECTION_KIND,
} from './google-dav-source-factory.ts';

/**
 * The builders a stored source connection's face can resolve to.
 *
 * `dav` and `imap` are the PROTOCOL defaults — a row that named a host and a
 * password, which is what every connection was before the provider kinds
 * arrived. They are named here rather than left implicit precisely so that
 * "fell through to DAV" is a decision somebody wrote down.
 */
export type SourceFaceBuilder =
  | 'gmail'
  | 'google-dav'
  | 'google-drive'
  | 'graph-mail'
  | 'graph-calendar'
  | 'graph-contacts'
  | 'graph-drive'
  // Microsoft To Do (workplan 0114 T9): the one task face that is not a CalDAV
  // collection, and the fifth Graph builder.
  | 'graph-todo'
  | 'dropbox'
  | 'box'
  // An EXPORT ARCHIVE's file face (workplan 0116 T1). Named here BEFORE the
  // builder exists, deliberately: without a name of its own an `archive` row
  // falls to `protocolDefault('file')` and is handed to `dav`, which aims a
  // WebDAV client at a folder on a disk and refuses it for a missing password.
  // That is #597's shape exactly — a fan-out whose absence is invisible until
  // somebody runs one. With a name, the file seam has an arm that says what is
  // actually true: placement (T5) and idempotency (T6) are not built, so an
  // archive connects, tests and measures but does not yet migrate.
  | 'archive'
  | 'imap'
  | 'dav';

/**
 * The faces of a PROVIDER ACCOUNT — one row that holds one credential and
 * serves several domains.
 *
 * Total over every face the kind can ever claim, including the ones a
 * deployment's own application unlocks: `google` serves calendar and contact
 * by default and gains mail and files when the deployment declares its
 * restricted scopes (`GOOGLE_RESTRICTED_ACCOUNT_DOMAINS`). A table that only
 * covered the default would build the two nobody had to ask about and drop
 * the two that needed a declaration — the failure landing on the deployment
 * that had gone to the most trouble.
 */
const ACCOUNT_FACE_BUILDERS: Readonly<
  Record<ProviderAccountKind, Readonly<Partial<Record<DiscoveryDomain, SourceFaceBuilder>>>>
> = {
  google: {
    email: 'gmail',
    calendar: 'google-dav',
    contact: 'google-dav',
    file: 'google-drive',
  },
  // DAV and IMAP throughout, and that is the provider's own shape rather than
  // a fallback: Soverin publishes IMAP for mail and a DAV root for the rest
  // (0106 T4a/T4b). `task` is a CalDAV collection declaring VTODO in its
  // supported-calendar-component-set (0113 T5), so it is the same builder as
  // calendar and not a fifth one.
  soverin: {
    email: 'imap',
    calendar: 'dav',
    contact: 'dav',
    task: 'dav',
  },
  // Four Graph builders that already existed — wired in `build-deps.ts` for
  // the appliance, from OAUTH2_* environment variables, and reachable from a
  // stored connection for the first time in 0114 T5a — and a FIFTH (0114 T9):
  // Microsoft To Do, the task face Google has not got at any scope tier and
  // Microsoft serves at `/me/todo/lists`. It is `graph-todo` rather than
  // `dav` because a To Do list is not a CalDAV collection; the connector
  // builds the VTODO the task domain reads.
  microsoft: {
    email: 'graph-mail',
    calendar: 'graph-calendar',
    contact: 'graph-contacts',
    file: 'graph-drive',
    task: 'graph-todo',
  },
  // Soverin's row, a different provider (workplan 0115). Apple publishes no
  // OAuth scope for its own data, so an Apple account is reached with an
  // app-specific password over IMAP and DAV — which makes these the SAME
  // builders `soverin` uses, and that is the finding rather than a shortcut:
  // this row needed no new connector at all. `task` is DAV because Reminders
  // are VTODO in the calendar account (0113 T5), which is why Apple's task
  // face worked on the day the kind arrived, a slice before Microsoft's did.
  apple: {
    email: 'imap',
    calendar: 'dav',
    contact: 'dav',
    task: 'dav',
  },
};

/**
 * The single-purpose kinds — one row, one product, one face.
 *
 * They keep answering for themselves rather than being folded into the
 * account table, because they are genuinely different rows: a `gmail`
 * connection is not a `google` account with three faces switched off, it is a
 * mailbox somebody named. The account kinds cohabit with them (0106 T3b).
 */
const SINGLE_PURPOSE_FACES: Readonly<
  Record<string, Readonly<Partial<Record<DiscoveryDomain, SourceFaceBuilder>>>>
> = {
  [GMAIL_CONNECTION_KIND]: { email: 'gmail' },
  [GOOGLE_CALENDAR_CONNECTION_KIND]: { calendar: 'google-dav' },
  [GOOGLE_CONTACTS_CONNECTION_KIND]: { contact: 'google-dav' },
  [GOOGLE_DRIVE_CONNECTION_KIND]: { file: 'google-drive' },
  [DROPBOX_CONNECTION_KIND]: { file: 'dropbox' },
  [BOX_CONNECTION_KIND]: { file: 'box' },
  // The export archive (0116 T1). In the single-purpose table rather than the
  // account table because it is emphatically not an account — one row, one
  // export, one face — which is the same reason `google_drive` sits here.
  [ARCHIVE_CONNECTION_KIND]: { file: 'archive' },
};

/**
 * The default for a face nothing else claims: the protocol the row named.
 *
 * `email` goes to IMAP and everything else to DAV, which is what every
 * pre-provider connection is and must remain.
 */
function protocolDefault(domain: DiscoveryDomain): SourceFaceBuilder {
  return domain === 'email' ? 'imap' : 'dav';
}

/**
 * Which builder speaks for this stored connection's face.
 *
 * Never throws and never returns undefined: a kind nobody has claimed is a
 * protocol row, which is the honest answer and the pre-existing behaviour.
 */
export function sourceFaceBuilder(kind: string, domain: DiscoveryDomain): SourceFaceBuilder {
  if (isProviderAccountKind(kind)) {
    return ACCOUNT_FACE_BUILDERS[kind][domain] ?? protocolDefault(domain);
  }
  return SINGLE_PURPOSE_FACES[kind]?.[domain] ?? protocolDefault(domain);
}

/**
 * Every face a provider account kind can EVER claim — the guard's question.
 *
 * Reads the ceiling tables rather than a deployment's environment on purpose:
 * a face that only appears when somebody declares their restricted scopes is
 * exactly the one a test run without that declaration would miss.
 */
export function everyFaceClaimedBy(kind: ProviderAccountKind): ReadonlyArray<DiscoveryDomain> {
  const declared =
    kind === 'google'
      ? [...PROVIDER_ACCOUNT_DOMAINS.google, ...GOOGLE_RESTRICTED_ACCOUNT_DOMAINS]
      : PROVIDER_ACCOUNT_DOMAINS[kind];
  return [...new Set(declared)];
}
