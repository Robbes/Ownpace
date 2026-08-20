// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for PGlite's contrib extensions.
 *
 * PGlite exposes these through a wildcard `exports` map (`"./contrib/*"`), and
 * this workspace compiles with `moduleResolution: "node"` (node10), which
 * predates `exports` maps and resolves by file path only. Node itself honours
 * the map at runtime — verified — so the import specifier below is correct and
 * the only thing missing is a declaration.
 *
 * Declared rather than worked around, because the alternatives are worse:
 * importing the physical `dist/contrib/pgcrypto` path would bypass the exports
 * map and break at runtime (Node refuses paths a package does not export), and
 * switching the whole workspace to `node16`/`bundler` resolution is a much
 * larger change than one extension import justifies. Delete this file if that
 * migration ever happens.
 */

declare module '@electric-sql/pglite/contrib/pgcrypto' {
  import type { Extension } from '@electric-sql/pglite';
  export const pgcrypto: Extension;
}
