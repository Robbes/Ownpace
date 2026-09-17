// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The byte-stability verdict, from the samples alone (workplan 0042 T0 Q3).
 *
 * Split out of `drive-export-stability.ts` for the same reason
 * `drive-export-credentials.ts` was: that module runs `main()` on import, so
 * nothing inside it can be reached by a unit test. This can.
 *
 * ## Why TWO exports was not enough, and how we found out
 *
 * The owner measured `export-odf` twice against one unchanged Doc on
 * 2026-09-16. Four exports in total:
 *
 *   run 1   3127560, 3127558
 *   run 2   3127561, 3127560
 *
 * Three distinct sizes inside a FOUR-BYTE window — and 3127560 appeared in both
 * runs. A variation that small can collide. Two draws of a rendering that
 * wobbles by a byte or two can come back identical, and a script that concludes
 * from two draws would print STABLE over a policy that rewrites every document
 * in the migration, nightly, forever, with every write succeeding.
 *
 * That is the exact failure this whole measurement exists to prevent, arriving
 * through the instrument built to prevent it. More draws is the cheap fix.
 *
 * ## The asymmetry, which the verdict states out loud
 *
 * A policy needs a UNIVERSAL claim: every document, every pass. So:
 *
 *   - **NOT STABLE is conclusive.** One counterexample disproves a universal
 *     claim. No sample size to argue about, and a second failing draw would add
 *     nothing.
 *   - **STABLE is not the mirror image.** It means only that N draws failed to
 *     disprove it. It is evidence, not proof, and it gets weaker the smaller
 *     the wobble being hunted.
 *
 * Reporting those two as if they were the same strength is how an unstable
 * renderer gets enabled.
 */

/** One export: what it weighed, and the hash of what it contained. */
export interface ExportSample {
  readonly bytes: number;
  readonly hash: string;
}

export interface StabilityVerdict {
  /** True only when every sample hashed identically. */
  readonly stable: boolean;
  /** How many DISTINCT renderings came back. 1 means stable. */
  readonly renderings: number;
  /** The distinct byte lengths seen, ascending. */
  readonly sizes: readonly number[];
  /**
   * The sentence describing what varied. Same length with different bytes says
   * something inside the rendering moved without changing size (a timestamp
   * overwritten in place); different lengths say a field changed SIZE, which
   * rules out the cheapest workaround — you cannot skip a fixed offset.
   */
  readonly note: string;
}

export function stabilityVerdict(samples: readonly ExportSample[]): StabilityVerdict {
  if (samples.length < 2) {
    // A single draw cannot disagree with anything. Refusing here rather than
    // reporting `stable: true` matters: the caller's happy path would otherwise
    // read one export as proof.
    throw new Error(`stabilityVerdict needs at least 2 samples, got ${samples.length}`);
  }
  const renderings = new Set(samples.map((s) => s.hash)).size;
  const sizes = [...new Set(samples.map((s) => s.bytes))].sort((a, b) => a - b);
  if (renderings === 1) {
    return { stable: true, renderings, sizes, note: '' };
  }
  const note =
    sizes.length === 1
      ? `Same LENGTH every time (${sizes[0]}), different bytes — so something inside the ` +
        'rendering varies (a timestamp, a generated id) rather than the content.'
      : `Lengths differ: ${sizes.join(', ')}.`;
  return { stable: false, renderings, sizes, note };
}

/**
 * What a container reading found, when the rendering is a zip at all.
 *
 * `settled` means the draws agree once the zip's own stamps and member order
 * are ignored — the case ADR-0046's `containerContentHash` exists for.
 */
export type ContainerReading = 'settled' | 'not-settled' | 'no-container';

/**
 * WHICH OF THE TABLE'S THREE ANSWERS THIS RUN FOUND.
 *
 * `EXPORT_STABILITY` has always had three — `stable` is defined as
 * "byte-identical OR settleable by the container hash" — and the script had
 * two. So a container-only result printed "the draws agree once normalised"
 * and then, one sentence later, "MUST NOT be enabled ... keep the default
 * `refuse`", which the table contradicts and the connector ignores. The owner
 * met that on 2026-09-17 measuring `export-odf` on a Sheet and a Slide, and
 * both were recorded `stable` — on the same evidence the script had just told
 * him to refuse.
 *
 * ## Why this is a function and not an `if` in the script
 *
 * The first guard for it read the script's SOURCE and asserted the settled
 * branch appeared before the refusal sentence. It passed against
 * `if (container === 'settled' && false)` — the mutation neutered the branch
 * and left the text alone, so a test that had been written to prove the fix
 * proved nothing. A decision worth guarding has to be callable; this is.
 */
export function exportOutcome(
  byteIdentical: boolean,
  container: ContainerReading,
): 'byte-identical' | 'settled-by-container' | 'unstable' {
  if (byteIdentical) return 'byte-identical';
  return container === 'settled' ? 'settled-by-container' : 'unstable';
}
