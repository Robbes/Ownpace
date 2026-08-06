// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Rebuild a WebDAV-shaped path from a JMAP `FileNode` parent chain
 * (workplan 0031 T3).
 *
 * **This exists before the connector, and that ordering is the whole point.**
 * The 2026-08-05 spike established that a JMAP `FileNode` has no path — its
 * identity is `name` + `parentId`, a chain — while `fileNaturalKeyHash()`
 * hashes a path. So a JMAP files target cannot key anything until this
 * reconstruction exists AND is known to produce byte-identical output to what
 * the WebDAV source produces for the same file.
 *
 * If it differs by one byte, **every file re-copies on the first pass, and
 * every write succeeds while it happens** (hard rule 1). Path normalisation
 * has already caused four silent-mismatch bugs in this repo; this would be the
 * fifth and the most expensive, because it hits every file at once rather than
 * an edge case.
 *
 * ## The shape it has to match, and where that comes from
 *
 * `webdav-source.ts`'s `toRelativePath` is the authority, not a specification:
 *
 *   - root-relative — the configured base is stripped
 *   - **percent-DECODED** (`decodeURIComponent`), so `Meeting%20notes.txt`
 *     is `Meeting notes.txt`
 *   - no leading slash, no trailing slash
 *   - segments joined with `/`
 *   - **no case folding and no Unicode normalisation of any kind**
 *
 * That last one is deliberate and is the thing most likely to bite. JMAP names
 * arrive as JSON strings and WebDAV names arrive percent-decoded from a URL;
 * both are UTF-8, and neither side normalises, so an `é` stored as NFC on one
 * path and NFD on the other would hash differently. **Normalising here would
 * not fix that — it would only move which side is wrong**, because the WebDAV
 * path is not normalised either. So this does not normalise, matching
 * `toRelativePath` exactly, and `jmap-file-path.unit.test.ts` pins the
 * agreement rather than asserting a rule.
 *
 * ## What it refuses to do
 *
 * Every failure below returns a REASON rather than a best-effort path. A
 * partial or guessed path is the worst possible output here: it is a
 * well-formed string that hashes to something no other transport will ever
 * produce, so the item copies again on every single pass, forever, silently.
 * Refusing costs one item and says why.
 */

/** A JMAP FileNode, reduced to the two fields identity is built from. */
export interface FileNodeRef {
  readonly id: string;
  readonly name: string;
  /** null at the root of the account's file tree. */
  readonly parentId: string | null;
}

export type PathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/**
 * How deep a chain may go before it is treated as broken rather than deep.
 *
 * Not a performance guard — a cycle is caught by the `seen` set below, and
 * caught precisely. This is the backstop for a tree that is genuinely absurd,
 * where continuing would build a path no filesystem could hold anyway.
 */
const MAX_DEPTH = 256;

/**
 * The path for `nodeId`, or the reason there isn't one.
 *
 * @param nodesById every node needed to walk from `nodeId` to the root. The
 *   caller owns fetching them — `FileNode/get` with `ids: null` returns the
 *   account's whole tree in one call, which is how the spike read it.
 */
export function reconstructFileNodePath(
  nodeId: string,
  nodesById: ReadonlyMap<string, FileNodeRef>,
): PathResult {
  const segments: string[] = [];
  const seen = new Set<string>();

  let currentId: string | null = nodeId;
  while (currentId !== null) {
    if (seen.has(currentId)) {
      // A cycle. Impossible in a well-formed tree and therefore exactly the
      // kind of thing that happens: a rename race, a server bug, a node
      // reparented under its own descendant. Without this the walk never
      // returns and the pass hangs rather than failing.
      return {
        ok: false,
        reason:
          `the parent chain for ${nodeId} contains a cycle (revisited ${currentId}), so it has ` +
          `no path. Nothing was keyed.`,
      };
    }
    seen.add(currentId);

    const node: FileNodeRef | undefined = nodesById.get(currentId);
    if (!node) {
      // A missing ancestor means the path would be a SUFFIX of the real one —
      // well-formed, plausible, and hashing to something WebDAV will never
      // produce. Returning it would re-copy this file on every pass forever.
      return {
        ok: false,
        reason:
          `the parent chain for ${nodeId} is broken: ${currentId} was not among the nodes ` +
          `supplied, so any path built here would be a suffix of the real one and would key ` +
          `to something no other transport produces.`,
      };
    }

    if (node.name === '') {
      return { ok: false, reason: `node ${node.id} has an empty name; it cannot be a path segment.` };
    }

    if (node.name.includes('/')) {
      // A slash inside a name makes the reconstruction ambiguous against a
      // real separator: `a/b` as one segment and `a`,`b` as two produce the
      // same string and are different files. WebDAV cannot express this at all
      // (the separator is structural in a URL), so there is no agreeing answer
      // to reach for.
      return {
        ok: false,
        reason:
          `node ${node.id} has a '/' in its name (${JSON.stringify(node.name)}), which makes its ` +
          `path ambiguous against a real separator. WebDAV cannot express this, so no ` +
          `agreeing key exists.`,
      };
    }

    segments.push(node.name);
    currentId = node.parentId;

    if (segments.length > MAX_DEPTH) {
      return {
        ok: false,
        reason: `the parent chain for ${nodeId} is deeper than ${MAX_DEPTH}; treating it as broken.`,
      };
    }
  }

  // Root-first, and joined WITHOUT a leading slash — `toRelativePath` strips
  // the base and returns e.g. `Documents/Meeting notes.txt`.
  return { ok: true, path: segments.reverse().join('/') };
}

/**
 * Build the lookup `reconstructFileNodePath` needs from a `FileNode/get` list.
 *
 * Trivial, and here rather than at each call site so every caller keys the map
 * the same way. A map keyed by anything but `id` produces the "broken chain"
 * refusal above for every node, which is a confusing way to learn about a
 * typo.
 */
export function fileNodeIndex(nodes: Iterable<FileNodeRef>): Map<string, FileNodeRef> {
  const index = new Map<string, FileNodeRef>();
  for (const node of nodes) index.set(node.id, node);
  return index;
}
