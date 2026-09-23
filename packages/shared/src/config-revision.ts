// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A LIVE MIGRATION MAY CHANGE ABOUT ITSELF (workplan 0125 T1).
 *
 * ## Why this exists at all
 *
 * The owner's live Google migration refused twenty-one files with a sentence
 * telling him to *"set an export policy on the mapping"*. Neither edition
 * could carry that out the way its own operator would try:
 *
 *  - **Managed** has the picker, in the creation wizard, and nowhere else.
 *    `PUT /api/migrations/:mappingId` parsed a `sourceConfig` and dropped it,
 *    saying so in a comment. An interface with no changeability.
 *  - **The appliance** has no picker at all — `nativeFilePolicy` appears
 *    nowhere in `apps/selfhost/src` — but its config is a file its operator
 *    owns, so it can change anything at all, including things a ledger full of
 *    items cannot survive. Changeability with no interface, and no rule.
 *
 * Neither had "change it later" as a feature; the appliance got it for free
 * and unguarded. `config.ts` already states the rule both were breaking:
 * hard rule 5 says the editions do not differ in behaviour, and *"a
 * `nativeFilePolicy` the appliance refuses must not be a `nativeFilePolicy`
 * the managed edition silently accepts and then ignores"*. That is enforced
 * for what a value MEANS — one parser, both editions. It was not enforced for
 * whether a value may CHANGE. This is the same rule, one step along.
 *
 * ## A table, not a switch
 *
 * The fields are not alike, and a boolean over "config" would have to pick the
 * strictest of them or the loosest. Each row below carries its own answer and
 * its own reason, and the reason is the product: a refusal that does not say
 * what to do instead is how somebody concludes the tool is broken.
 *
 * ## Refusing is the safe direction
 *
 * Two rows — the source's root folder and the target account — are the ones
 * where the plan said *this must answer, not assume*. Both are refused, and
 * the asymmetry is deliberate: permitting a change that orphans copied items
 * is irreversible for the person it happens to, and loosening a rule later is
 * a line in this table. Neither refusal claims the change is impossible in
 * principle; each says it is not something this product will do to a ledger
 * that already holds items, and names the way round it.
 */

import type { GoogleNativeFilePolicy } from './config.ts';
import {
  GOOGLE_EDITOR_KINDS,
  nativeFilePoliciesOf,
  type NativeFilePolicies,
} from './google-native-coverage.ts';

/**
 * The fields a revision rule exists for, in the vocabulary BOTH editions can
 * speak.
 *
 * Dotted paths rather than either edition's own spelling: the appliance reads
 * `source.nativeFilePolicy` out of a mapping file and managed reads
 * `sourceConfig.nativeFilePolicy` out of a request body, and a rule keyed to
 * one of those would have to be translated — badly — for the other. The
 * caller maps its own names onto these once, at its own edge.
 */
export const REVISABLE_FIELDS = [
  'name',
  'schedule',
  'source.nativeFilePolicy',
  'source.rootFolderId',
  'source.type',
  'target.type',
  'target.account',
] as const;

export type RevisableField = (typeof REVISABLE_FIELDS)[number];

/** Whether a field is one this rule has an answer for. */
export function isRevisableField(value: unknown): value is RevisableField {
  return (REVISABLE_FIELDS as ReadonlyArray<unknown>).includes(value);
}

/**
 * What a proposed change to one field is answered with.
 *
 * `allowed` carries a `consequence` where there is one worth saying out loud
 * — not a warning to click past, a fact the caller may show. `refused` always
 * carries a reason, and the reason always names something the reader can do
 * instead.
 */
export type RevisionVerdict =
  | { readonly allowed: true; readonly consequence?: string }
  | { readonly allowed: false; readonly reason: string };

interface Rule {
  readonly field: RevisableField;
  readonly verdict: RevisionVerdict;
}

const RULES: ReadonlyArray<Rule> = [
  {
    // A label. Nothing reads it to decide anything — `mappingId` is the seed
    // the ledger row is keyed by, and `name` was added (2026-09-05) precisely
    // so somebody could fix what their emails say without re-keying.
    field: 'name',
    verdict: { allowed: true },
  },
  {
    // The next pass simply happens sooner or later. Nothing already copied is
    // described by a cadence.
    field: 'schedule',
    verdict: { allowed: true },
  },
  {
    /**
     * THE FIELD THE OWNER NEEDS, and the one this plan was opened for.
     *
     * Safe BECAUSE of ADR-0046, which is not a coincidence: 0042 T7(d) made
     * the rendering scheme travel with the content hash so no comparison
     * crosses schemes. A file exported under `export-odf` and the same file
     * under `export-office` are distinguishable to every later pass, so a
     * policy change cannot be read as a content change — which is exactly what
     * would otherwise make this the most dangerous row in the table rather
     * than the safest. Somebody left this door ajar on purpose.
     *
     * The consequence is real and is stated rather than hidden: items already
     * copied under the old policy keep the rendering they were copied as. This
     * product does not delete or overwrite on a target (hard rule 2), so the
     * new policy applies to what is copied from here on. And since a Google
     * document's name is its format's (0042 T8 (b)), every one is copied again
     * under its new name, and the old copy stays as an earlier export.
     *
     * ONE FIELD FOR THE FORMAT OF ALL FOUR KINDS, also since each kind can
     * have its own (0042 T9). What may change, and why it is safe, is the same
     * for a Doc as for a deck, so a second row would be a second copy of this
     * one. The consequence says "whose format changes" because a change to one
     * kind re-copies that kind and leaves the other three alone.
     */
    field: 'source.nativeFilePolicy',
    verdict: {
      allowed: true,
      consequence:
        'Items already copied keep the format they were copied in — this tool never ' +
        'overwrites what is on the new system. Every Google document whose format changes ' +
        'is copied again under the name the new format gives it; the copy in the old ' +
        'format stays, and the Deletions screen lists it as an earlier export, never as a ' +
        'deletion.',
    },
  },
  {
    /**
     * NARROWING SCOPE LEAVES COPIED ITEMS OUTSIDE IT, and there is no good
     * answer to what they then are.
     *
     * The ledger holds them as migrated, and they are: the copies exist on the
     * destination. But a verification pass scoped to the new root would not
     * find their sources, so every one of them reads as an item that vanished
     * — which is the shape a deletion detector acts on. Widening has the
     * mirror problem in a milder form: the newly-in-scope items are copied on
     * the next pass, which is probably what was wanted and is not what anybody
     * was told would happen.
     *
     * Refused rather than guessed at. A new migration keys a new ledger, and
     * the items already copied stay exactly where they are.
     */
    field: 'source.rootFolderId',
    verdict: {
      allowed: false,
      reason:
        'The folder this migration copies from cannot be changed once it has copied ' +
        'anything. Items already copied would sit outside the new folder, and nothing ' +
        'could then say whether they are still yours to keep. Start a second migration ' +
        'for the other folder — what this one has already copied stays where it is.',
    },
  },
  {
    /**
     * A ledger full of items keyed against one system, pointed at another.
     *
     * Every natural key, cursor and content hash in it was produced by the old
     * source's reader. The next pass would compare what a different provider
     * says against them, find nothing it recognises, and copy the whole
     * account again beside the first copy.
     */
    field: 'source.type',
    verdict: {
      allowed: false,
      reason:
        'The system this migration copies FROM cannot be changed. Everything it has ' +
        'recorded so far is keyed to the old one, so the next pass would copy the whole ' +
        'account again alongside what is already there. Start a new migration for the ' +
        'other system.',
    },
  },
  {
    // The same, from the other end: the ledger records what is on THIS target.
    field: 'target.type',
    verdict: {
      allowed: false,
      reason:
        'The system this migration copies TO cannot be changed. What it has recorded is ' +
        'a description of the old destination, and pointing it at a new one would make ' +
        'every one of those records a claim about a place that has never been written ' +
        'to. Start a new migration for the new destination.',
    },
  },
  {
    /**
     * The account within the destination — same shape as `rootFolderId`, and
     * refused for the same reason from the other side: the copies are in the
     * old account, and the ledger says they are on "the target".
     *
     * Not the same as the CREDENTIAL. Rotating a password or re-granting an
     * expired token is a different act on a different surface (the Connections
     * page), it is what `auth_expired` tells somebody to go and do, and
     * nothing here refuses it.
     */
    field: 'target.account',
    verdict: {
      allowed: false,
      reason:
        'The account this migration copies into cannot be changed once it has copied ' +
        'anything — what is already there would be left behind in the old one, with ' +
        'nothing recording that it is there. Reconnecting the same account with a new ' +
        'password or a renewed sign-in is a different thing and is done on the ' +
        'Connections page. To copy into a different account, start a new migration.',
    },
  },
];

/**
 * May this field be revised on a migration that already exists?
 *
 * Called by BOTH editions, for the reason `parseGoogleDriveSource` is: a
 * revision the appliance refuses must not be one the managed edition quietly
 * performs, and the way that stops being true is two implementations of the
 * same table.
 *
 * Deliberately answers per FIELD and not per value. "May this change at all"
 * is a property of what the field describes — a ledger keyed to one source, a
 * folder scope copied items sit inside — and it does not become safe because
 * the new value happens to be a nice one. Whether a VALUE is acceptable is
 * `parseGoogleDriveSource`'s question, and it is asked as well as this, never
 * instead of it.
 */
export function mayRevise(field: RevisableField): RevisionVerdict {
  const rule = RULES.find((r) => r.field === field);
  // Unreachable while the union and the table agree, and the guard test holds
  // that. `throw` rather than a permissive default: a field this table has no
  // opinion on must not be revised because nobody wrote a row for it.
  if (!rule) throw new Error(`no revision rule for "${field}" — add one to config-revision.ts`);
  return rule.verdict;
}

/**
 * Every field a caller proposed that this rule refuses, with its reason.
 *
 * The shape a route or a boot check wants: hand it what somebody asked to
 * change and get back the refusals to report. Empty means every proposed field
 * may change — which is not the same as "nothing was proposed", and a caller
 * that needs to tell those apart already knows what it passed in.
 *
 * ALL of them, never the first: somebody who changed three forbidden fields
 * and is told about one will fix it and be refused again, twice.
 */
export function refusalsFor(
  fields: Iterable<RevisableField>,
): ReadonlyArray<{ readonly field: RevisableField; readonly reason: string }> {
  const refused: Array<{ field: RevisableField; reason: string }> = [];
  for (const field of fields) {
    const verdict = mayRevise(field);
    if (!verdict.allowed) refused.push({ field, reason: verdict.reason });
  }
  return refused;
}

/**
 * WHAT A MIGRATION SAID IT WAS, keyed by the paths this rule already speaks
 * (workplan 0125 T2).
 *
 * The same dotted keys as `RevisableField`, for the reason those exist at all:
 * a snapshot spelled in one edition's own words would have to be translated —
 * badly — before this table could judge it.
 *
 * A field ABSENT from the snapshot means the config did not declare it, which
 * is itself a value worth comparing: dropping `source.rootFolderId` widens the
 * scope to the whole account, and that is exactly the change the rule refuses.
 * So absent-to-present and present-to-absent both count as a change.
 *
 * Callers pass EFFECTIVE values, not raw ones. `nativeFilePolicy` absent means
 * `refuse` to the engine, and a snapshot that recorded the literal absence
 * would report a change the first time somebody wrote the default down.
 */
export type RevisionSnapshot = Readonly<Partial<Record<RevisableField, string>>>;

export interface RevisionComparison {
  /**
   * Nothing was recorded before this, so there is nothing to compare against.
   *
   * NOT "nothing changed" — hard rule 9, at the one moment it decides whether
   * a running migration keeps running. An appliance upgrading into this has a
   * live migration and no snapshot, and refusing it on a comparison that was
   * never made would strand it for something nobody can show it did.
   */
  readonly firstRecord: boolean;
  /** Every field whose effective value differs, refused or not. */
  readonly changed: ReadonlyArray<RevisableField>;
  /** The changed fields this rule refuses, each with what it was and is. */
  readonly refusals: ReadonlyArray<{
    readonly field: RevisableField;
    readonly from: string;
    readonly to: string;
    readonly reason: string;
  }>;
}

/** How an absent value reads in a refusal, so "gone" never prints as nothing. */
const NOT_DECLARED = '(not set)';

/**
 * Compare what a migration declares NOW against what it declared last time.
 *
 * The half the appliance never had. Managed enforces `mayRevise` at its edit
 * route, where a change arrives as a request with the old values in the
 * database beside it. The appliance's config is a file its operator owns, so
 * there was no request and nothing to compare against — this is the
 * comparison, and `RevisionSnapshot` is the thing it compares against.
 *
 * Refuses NOTHING on a first record, by construction rather than by a caller
 * remembering to check: `previous === undefined` returns no refusals whatever
 * the current values are.
 */
export function compareRevision(
  previous: RevisionSnapshot | undefined,
  current: RevisionSnapshot,
): RevisionComparison {
  if (previous === undefined) return { firstRecord: true, changed: [], refusals: [] };
  const changed = REVISABLE_FIELDS.filter((f) => previous[f] !== current[f]);
  return {
    firstRecord: false,
    changed,
    // `refusalsFor` is the one place that decides WHICH changes are refused;
    // this only adds what each one was and is, so an operator reading the
    // refusal does not have to go and diff the file themselves.
    refusals: refusalsFor(changed).map((r) => ({
      field: r.field,
      from: previous[r.field] ?? NOT_DECLARED,
      to: current[r.field] ?? NOT_DECLARED,
      reason: r.reason,
    })),
  };
}

/**
 * What a mapping FILE declares, as the snapshot this rule compares.
 *
 * Only the appliance needs this: managed's mapping is rows in a database and
 * its edit route already has the old values beside the new ones. Here the
 * config file IS the record, so the fields have to be lifted out of it into
 * the rule's own vocabulary before anything can be compared.
 *
 * Typed against the config unions rather than a loose bag, so a source that
 * grows a root folder or a target that grows an account cannot quietly stop
 * being snapshotted: `in` narrows the union member, and a member without the
 * field contributes nothing rather than `undefined`.
 *
 * `source.nativeFilePolicy` is recorded EFFECTIVE — absent means `refuse` to
 * the engine, and a snapshot of the literal absence would report a change the
 * first time somebody wrote the default down in their own file. See
 * `nativeFilePolicySnapshot` for how a format per kind is recorded.
 */
export function revisionSnapshotOf(config: {
  readonly source: {
    readonly type: string;
    readonly rootFolderId?: unknown;
    readonly nativeFilePolicy?: GoogleNativeFilePolicy | undefined;
    readonly nativeFilePolicies?: NativeFilePolicies | undefined;
  };
  readonly target: { readonly type: string; readonly user?: unknown };
}): RevisionSnapshot {
  // Declared optional-and-`unknown` rather than narrowed here: every config
  // union member satisfies it (a member without the field simply has it
  // absent), so the call site needs no cast and a source that GROWS a root
  // folder is snapshotted the day it does. The export formats alone are typed,
  // because what is recorded is what they MEAN, and only a typed value can be
  // asked that.
  const { source, target } = config;
  return {
    'source.type': source.type,
    'target.type': target.type,
    ...('rootFolderId' in source && typeof source.rootFolderId === 'string'
      ? { 'source.rootFolderId': source.rootFolderId }
      : {}),
    ...('user' in target && typeof target.user === 'string'
      ? { 'target.account': target.user }
      : {}),
    'source.nativeFilePolicy': nativeFilePolicySnapshot(source),
  };
}

/**
 * `source.nativeFilePolicy` as a snapshot records it: the format each kind is
 * EFFECTIVELY exported in (workplan 0042 T9), as `nativeFilePoliciesOf`
 * answers it for the connector.
 *
 * One format when all four kinds agree, which is every mapping written before
 * a kind could have its own, so a snapshot already stored does not read as a
 * change on the first boot after this. One `kind: format` pair per kind when
 * they differ, so a change to any one kind is a change to this field. Writing
 * the single setting out per kind is therefore not a change either.
 */
function nativeFilePolicySnapshot(source: {
  readonly nativeFilePolicy?: GoogleNativeFilePolicy | undefined;
  readonly nativeFilePolicies?: NativeFilePolicies | undefined;
}): string {
  const effective = nativeFilePoliciesOf(source);
  const formats = GOOGLE_EDITOR_KINDS.map((kind) => effective[kind]);
  if (formats.every((format) => format === effective.document)) return effective.document;
  return GOOGLE_EDITOR_KINDS.map((kind) => `${kind}: ${effective[kind]}`).join(', ');
}
