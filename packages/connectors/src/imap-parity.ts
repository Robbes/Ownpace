// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Run two `SourceConnector`s against the same server and report every way they
 * disagree (workplan 0032 T0).
 *
 * **This exists before a single line of the imapflow migration.** 0032 moves
 * 1430 lines of production code off `imap-simple`, and the path being moved is
 * the one thing in this product with nightly end-to-end evidence behind it. A
 * rewrite that lands in one commit trades that evidence for a hope. This is
 * what makes the trade unnecessary: a difference shows up as a named
 * comparison rather than as a behaviour change discovered in somebody's
 * mailbox.
 *
 * ## The specific thing it exists to catch
 *
 * `imap-source.ts` produces `messageId`, which `naturalKeyForItem()` hashes.
 * That key is what makes an IMAP↔Graph transport switch safe, and it is why a
 * re-run copies nothing. **If a new client normalises that header differently
 * — whitespace, angle brackets, casing — every message re-copies on the next
 * pass, and every write succeeds while it happens** (hard rule 1). No count is
 * wrong, no error is raised, and the mailbox is simply twice its size.
 *
 * Everything else compared here is secondary to that one field, and the
 * ordering of `FIELDS` below says so.
 *
 * ## What a green run does and does not claim
 *
 * A green run says the two clients agreed **on the folders and messages that
 * exist on the server it was pointed at**. It is not a proof of equivalence:
 * an empty mailbox agrees about nothing, and a fixture with no unusual headers
 * cannot disagree about them. So the caller is expected to assert the
 * comparison actually had something to compare — `compareSources` returns the
 * counts for exactly that, and the integration test that uses it checks them.
 */

import type { SourceConnector, MailFolder, MailItem } from '@openmig/shared';

/** One way the two connectors disagreed. */
export interface ParityDifference {
  /** Where: `folders`, `INBOX/items/<messageId>`, `INBOX/bytes/<sourceRef>`. */
  readonly where: string;
  /** Which property, so a diff of one field does not read as a diff of the item. */
  readonly field: string;
  readonly a: string;
  readonly b: string;
}

export interface ParityResult {
  readonly differences: ReadonlyArray<ParityDifference>;
  /** How many folders were compared. Zero means this proved nothing. */
  readonly foldersCompared: number;
  /** How many items were compared. Zero means this proved nothing. */
  readonly itemsCompared: number;
  /** How many message bodies were fetched and compared bytewise. */
  readonly bodiesCompared: number;
}

/**
 * The fields compared on a `MailItem`, most load-bearing first.
 *
 * `messageId` leads because it is the natural key and the only one whose
 * divergence is silent AND destructive. The rest are ordinary bugs: a wrong
 * `receivedAt` is a wrong date, a dropped keyword is a lost flag — visible,
 * complainable, fixable. A wrong `messageId` is a second copy of a mailbox.
 */
const ITEM_FIELDS = ['messageId', 'keywords', 'receivedAt', 'size', 'sourceRef'] as const;

/** The fields compared on a `MailFolder`. */
const FOLDER_FIELDS = ['path', 'name', 'specialUse'] as const;

/**
 * Compare two connectors against whatever server they are both pointed at.
 *
 * @param sampleBodies how many message bodies to fetch and compare bytewise
 *   per folder. Bodies are the expensive comparison and the least likely to
 *   differ subtly — a body that differs at all usually differs completely — so
 *   a small sample is the right trade. Zero skips the leg entirely, and
 *   `bodiesCompared` then says so rather than the result implying it ran.
 */
export async function compareSources(
  a: SourceConnector,
  b: SourceConnector,
  options: { readonly sampleBodies?: number } = {},
): Promise<ParityResult> {
  const sampleBodies = options.sampleBodies ?? 2;
  const differences: ParityDifference[] = [];

  const foldersA = [...(await a.listFolders())].sort(byPath);
  const foldersB = [...(await b.listFolders())].sort(byPath);

  // Sorted before comparing: IMAP does not promise an order for LIST, so two
  // clients returning the same folders in a different sequence is not a
  // difference, and reporting it as one would bury the differences that are.
  const pathsA = foldersA.map((f) => f.path);
  const pathsB = foldersB.map((f) => f.path);
  if (!sameStrings(pathsA, pathsB)) {
    differences.push({
      where: 'folders',
      field: 'path',
      a: JSON.stringify(pathsA),
      b: JSON.stringify(pathsB),
    });
  }

  const commonFolders = foldersA.filter((f) => pathsB.includes(f.path));
  for (const folder of commonFolders) {
    const other = foldersB.find((f) => f.path === folder.path)!;
    for (const field of FOLDER_FIELDS) {
      const av = String(folder[field] ?? '');
      const bv = String(other[field] ?? '');
      if (av !== bv) {
        differences.push({ where: `folders/${folder.path}`, field, a: av, b: bv });
      }
    }
  }

  let itemsCompared = 0;
  let bodiesCompared = 0;

  for (const folder of commonFolders) {
    const listedA = await a.listSince(folder);
    const listedB = await b.listSince(folder);

    // Keyed by sourceRef, not by messageId. sourceRef is `<folder>:<uid>` and
    // the UID is the SERVER's, so it identifies the same message on both sides
    // even when the thing under suspicion is precisely how each client read the
    // Message-ID. Keying by messageId would make a normalisation difference
    // look like "one message present, another missing" — true, useless, and
    // pointing at the wrong thing.
    const byRefA = new Map(listedA.items.map((i) => [i.sourceRef, i]));
    const byRefB = new Map(listedB.items.map((i) => [i.sourceRef, i]));

    const refsA = [...byRefA.keys()].sort();
    const refsB = [...byRefB.keys()].sort();
    if (!sameStrings(refsA, refsB)) {
      differences.push({
        where: `${folder.path}/items`,
        field: 'sourceRef set',
        a: JSON.stringify(refsA),
        b: JSON.stringify(refsB),
      });
    }

    if (listedA.nextCursor.value !== listedB.nextCursor.value) {
      // A cursor that differs is not cosmetic: it is what the next pass resumes
      // from, so two clients disagreeing about it means one of them will re-scan
      // or skip on every subsequent run.
      differences.push({
        where: `${folder.path}/cursor`,
        field: 'nextCursor',
        a: listedA.nextCursor.value,
        b: listedB.nextCursor.value,
      });
    }

    if ((listedA.unkeyable ?? 0) !== (listedB.unkeyable ?? 0)) {
      // The count of messages we had to invent an id for. A difference here
      // means the two clients disagree about which messages HAVE a Message-ID,
      // which is the same defect as a normalisation difference wearing a
      // different hat.
      differences.push({
        where: `${folder.path}/unkeyable`,
        field: 'unkeyable',
        a: String(listedA.unkeyable ?? 0),
        b: String(listedB.unkeyable ?? 0),
      });
    }

    for (const ref of refsA.filter((r) => byRefB.has(r))) {
      const ia = byRefA.get(ref)!;
      const ib = byRefB.get(ref)!;
      itemsCompared++;
      for (const field of ITEM_FIELDS) {
        const av = normaliseField(ia, field);
        const bv = normaliseField(ib, field);
        if (av !== bv) {
          differences.push({ where: `${folder.path}/items/${ref}`, field, a: av, b: bv });
        }
      }
    }

    for (const ref of refsA.filter((r) => byRefB.has(r)).slice(0, sampleBodies)) {
      const rawA = await a.fetch(byRefA.get(ref)!);
      const rawB = await b.fetch(byRefB.get(ref)!);
      bodiesCompared++;
      if (!sameBytes(rawA.rfc822, rawB.rfc822)) {
        differences.push({
          where: `${folder.path}/bytes/${ref}`,
          field: 'rfc822',
          // The bytes themselves are useless in a failure message and may carry
          // personal data (§17 counts message content as such). Report the
          // shape of the difference instead.
          a: `${rawA.rfc822.byteLength} bytes`,
          b: `${rawB.rfc822.byteLength} bytes`,
        });
      }
    }
  }

  return {
    differences,
    foldersCompared: commonFolders.length,
    itemsCompared,
    bodiesCompared,
  };
}

/**
 * A one-line summary for a test failure message.
 *
 * Named fields rather than a JSON dump: the whole value of this harness is
 * that a difference arrives saying WHICH property of WHICH message moved.
 */
export function describeDifferences(result: ParityResult): string {
  if (result.differences.length === 0) {
    return (
      `no differences (${result.foldersCompared} folder(s), ${result.itemsCompared} item(s), ` +
      `${result.bodiesCompared} body/bodies compared)`
    );
  }
  return result.differences
    .map((d) => `${d.where} · ${d.field}: ${truncate(d.a)} vs ${truncate(d.b)}`)
    .join('\n');
}

function truncate(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function byPath(x: MailFolder, y: MailFolder): number {
  return x.path < y.path ? -1 : x.path > y.path ? 1 : 0;
}

function sameStrings(x: ReadonlyArray<string>, y: ReadonlyArray<string>): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function sameBytes(x: Uint8Array, y: Uint8Array): boolean {
  return x.byteLength === y.byteLength && x.every((v, i) => v === y[i]);
}

/**
 * One item field as a comparable string.
 *
 * `keywords` is SORTED before comparison: the set of flags on a message is a
 * set, and two clients reporting `$seen,$flagged` and `$flagged,$seen` have not
 * disagreed about anything. Everything else is compared verbatim — especially
 * `messageId`, where trimming or unwrapping here would hide the exact class of
 * difference this harness exists to catch.
 */
function normaliseField(item: MailItem, field: (typeof ITEM_FIELDS)[number]): string {
  if (field === 'keywords') return [...item.keywords].sort().join(',');
  return String(item[field] ?? '');
}
