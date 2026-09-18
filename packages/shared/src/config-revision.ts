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
     * new policy applies to what is copied from here on.
     */
    field: 'source.nativeFilePolicy',
    verdict: {
      allowed: true,
      consequence:
        'Items already copied keep the format they were copied in — this tool never ' +
        'overwrites what is on the new system. The new format applies to items copied ' +
        'from now on, including any you retry.',
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
