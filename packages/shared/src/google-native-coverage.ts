// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH OF SOMEBODY'S GOOGLE FILES EACH EXPORT POLICY ACTUALLY CARRIES.
 *
 * THE DEFECT THIS EXISTS TO FIX. The wizard offers four options in a `<select>`
 * — leave them behind, OpenDocument, Microsoft Office, PDF — and presents them
 * as equals, differing only in file extension. They are not equals. As measured
 * on 2026-09-16 and 2026-09-17 (workplan 0042 T3, `EXPORT_STABILITY`):
 *
 *   - **OpenDocument leaves every Google Doc behind.** The `.odt` renderer's
 *     `settings.xml` changes between two exports of an unchanged document.
 *   - **Microsoft Office leaves every Slides deck behind.** Five members of the
 *     `.pptx` change content between draws.
 *   - **PDF carries all four**, and is the only policy that does.
 *
 * So a customer choosing "OpenDocument — .odt, .ods, .odp" was choosing, without
 * being told, to leave behind the single most common kind of file in the list
 * the label starts with. They found out afterwards: at discovery, from
 * `discovery.refusedNative.*`, or in the failures queue one file at a time.
 * Both of those are downstream of a choice already made.
 *
 * THE TRADE, STATED ONCE: an export that stays editable drops a whole category,
 * and the export that drops nothing is not editable. That is the whole of it,
 * and it belongs where the choice is made.
 *
 * ## Why this is here and not beside the measurements
 *
 * `EXPORT_STABILITY` and `NATIVE_EXPORT_TYPES` live in `@openmig/connectors`,
 * with a comment saying why: they describe Google's wire format. `apps/web`
 * depends on `@openmig/shared` and not on the connectors, and should not — a
 * chooser does not need Google's MIME spellings.
 *
 * What it needs is the product fact those tables imply, which is this file, and
 * which sits beside `GoogleNativeFilePolicy` for the same reason that type does.
 * **The two are held together by a guard rather than by memory**:
 * `a-chooser-that-hid-which-files-it-would-drop.unit.test.ts` derives this table
 * from the measurements and fails if they disagree, so a cell that flips colour
 * cannot leave a stale promise on the wizard.
 *
 * ## `unstable` is the only thing that leaves a file behind
 *
 * Not "anything that is not `stable`". The connector refuses a combination the
 * table calls `unstable` and copies everything else, `unmeasured` included — a
 * blank is recorded, not acted on. So this table follows BEHAVIOUR: a kind is
 * carried unless the measurement says it would be rewritten nightly. Deriving
 * it from the greens instead would put a warning on the screen for a type
 * nobody has measured, about a refusal that would never happen.
 */

import type { GoogleNativeFilePolicy } from './config.ts';

/**
 * The four Google EDITOR types, by the suffix of their MIME type.
 *
 * The same keys `migration_discovery.refused_native` stores and
 * `discovery.refusedNative.kind.*` translates, so a screen already knows how to
 * say each of these in both languages and no fifth spelling is invented here.
 *
 * Forms, Sites, My Maps and Apps Scripts are deliberately absent: Drive exports
 * those in no format at all, so no policy carries them and offering one as a
 * remedy would send somebody to a setting that changes nothing.
 */
export const GOOGLE_EDITOR_KINDS = [
  'document',
  'spreadsheet',
  'presentation',
  'drawing',
] as const;

export type GoogleEditorKind = (typeof GOOGLE_EDITOR_KINDS)[number];

/** The MIME type Drive gives this editor kind. */
export function googleEditorMime(kind: GoogleEditorKind): string {
  return `application/vnd.google-apps.${kind}`;
}

/**
 * What each export policy carries, in `GOOGLE_EDITOR_KINDS` order.
 *
 * `refuse` is absent rather than empty: it is not an export policy, it carries
 * nothing by definition, and a reader that wants "what does refuse carry" is
 * asking the wrong question — the wizard has its own sentence for it.
 */
export const NATIVE_POLICY_COVERAGE: Readonly<
  Record<Exclude<GoogleNativeFilePolicy, 'refuse'>, readonly GoogleEditorKind[]>
> = {
  // No Doc: `settings.xml` moves between draws, so every Doc would be rewritten
  // on every pass. The most common file type in the list, dropped by the policy
  // whose label leads with `.odt`.
  'export-odf': ['spreadsheet', 'presentation', 'drawing'],
  // No deck: five members of the `.pptx` change content.
  'export-office': ['document', 'spreadsheet', 'drawing'],
  // All four, measured across five draws each. The only policy that leaves
  // nothing behind, and the only one nothing comes back editable from.
  'export-pdf': ['document', 'spreadsheet', 'presentation', 'drawing'],
};

/** The kinds this policy carries. */
export function policyCarries(
  policy: Exclude<GoogleNativeFilePolicy, 'refuse'>,
): readonly GoogleEditorKind[] {
  return NATIVE_POLICY_COVERAGE[policy];
}

/**
 * The kinds this policy leaves behind — the half a chooser never showed.
 *
 * In `GOOGLE_EDITOR_KINDS` order rather than the order they were discovered in,
 * so two sentences about two policies read the same way round.
 */
export function policyLeavesBehind(
  policy: Exclude<GoogleNativeFilePolicy, 'refuse'>,
): readonly GoogleEditorKind[] {
  const carried = new Set(NATIVE_POLICY_COVERAGE[policy]);
  return GOOGLE_EDITOR_KINDS.filter((kind) => !carried.has(kind));
}

/**
 * Whether this policy carries every editor type.
 *
 * Asked rather than hard-coded to `export-pdf`, because the interesting day is
 * the one where that stops being the answer: a second policy measured green
 * everywhere, or PDF measured red somewhere. Either way the sentence follows
 * the table instead of a name somebody typed.
 */
export function policyCarriesEveryKind(
  policy: Exclude<GoogleNativeFilePolicy, 'refuse'>,
): boolean {
  return policyLeavesBehind(policy).length === 0;
}
