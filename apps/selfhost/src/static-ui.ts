// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Serves the operating UI bundle from the appliance (ADR-0026).
 *
 * The appliance is the edition that gets INSTALLED — workplan 0015's whole
 * point is a Windows user who never opens a terminal — so the React screens
 * have to come off the same process that answers the JSON. No CDN, no second
 * container, no separate web server: one binary, one port.
 *
 * **Mounted under `/ui`, and that is not cosmetic.** This server already
 * answers `GET /deletions`, `/moves` and `/failures` with JSON, and the React
 * router wants exactly those paths for its own screens. Serving the SPA at the
 * root would mean deciding between the two by sniffing `Accept` headers, which
 * fails differently for a browser, `curl` and a script. A prefix makes the
 * collision impossible instead of arbitrating it, and the API paths — which the
 * runbook documents and the e2e gates use — do not move.
 *
 * Resolution is path-traversal safe, which matters here more than the localhost
 * bind suggests: this is the one part of the appliance that turns a request
 * string into a filesystem read.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The path the UI is mounted at. Kept here so the router basename and the confirm page's link agree with the server. */
export const UI_MOUNT = '/ui';

/**
 * Content types for what a Vite build actually emits.
 *
 * A short explicit table rather than a dependency: getting this wrong on
 * `.js` or `.css` breaks the page, and everything else here is either a font or
 * an image that browsers sniff correctly anyway. Unknown extensions fall back to
 * `application/octet-stream` — a download prompt is a visible failure, where
 * guessing `text/html` would be an invisible one.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Turn a request URL into a file inside `rootDir`, or `null` if it escapes.
 *
 * Exported for its own tests. The check is on the RESOLVED path, not on the
 * request string: rejecting literal `..` is not enough once URL-encoding
 * (`%2e%2e`), backslashes and doubled separators are in play, and a
 * `startsWith(rootDir)` test on unresolved input passes for a sibling directory
 * whose name merely begins with the root's (`/srv/ui-old` against `/srv/ui`).
 * Resolving first and then requiring the root plus a separator answers all of
 * those the same way.
 */
export function resolveWithinRoot(rootDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // A malformed escape is not a path we should guess at.
    return null;
  }
  // A NUL byte truncates the path at the syscall layer, so a name that passes
  // this check can name a different file by the time it is opened.
  if (decoded.includes('\0')) return null;

  const root = resolve(rootDir);
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

export interface StaticUiOptions {
  /** Directory holding the built bundle (`apps/web` → `build:selfhost`). */
  readonly rootDir: string;
}

/**
 * Handle a request under {@link UI_MOUNT}.
 *
 * Returns `true` if it answered, `false` if the caller should carry on — so the
 * JSON routes stay in charge of everything outside the mount and this cannot
 * shadow them by accident.
 */
export async function serveUi(
  req: IncomingMessage,
  res: ServerResponse,
  options: StaticUiOptions,
): Promise<boolean> {
  const url = req.url ?? '';
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  // `/ui` exactly, `/ui/`, or `/ui/<anything>` — but never `/uifoo`.
  const path = url.split('?')[0] ?? '';
  if (path !== UI_MOUNT && !path.startsWith(`${UI_MOUNT}/`)) return false;

  // `/ui` -> `/ui/`, and this is not cosmetic.
  //
  // The bundle is built with `--base=/ui/`, so `import.meta.env.BASE_URL` — and
  // therefore React Router's `basename` — carries a TRAILING SLASH. Router's
  // `stripBasename` starts with `pathname.startsWith(basename)`, and `'/ui'`
  // does not start with `'/ui/'`. It returns null, no route matches, and the
  // browser shows a WHITE PAGE with a 200 and a fully loaded bundle.
  //
  // `/ui/` and `/ui/confirm` both match, which is why this hid for so long: the
  // one URL nobody types is the one the runbook and the Start-menu shortcut
  // point at. Found on Windows, 2026-08-07.
  //
  // Fixed here rather than in the router because a directory URL without its
  // trailing slash is a SERVER convention — every static server does this — and
  // fixing it here also covers anything else that assumes the canonical form.
  if (path === UI_MOUNT) {
    res.writeHead(302, { location: `${UI_MOUNT}/` });
    res.end();
    return true;
  }

  const rel = path.slice(UI_MOUNT.length) || '/';
  const file = resolveWithinRoot(options.rootDir, rel);
  if (file === null) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad path');
    return true;
  }

  const index = join(resolve(options.rootDir), 'index.html');

  // An asset that is missing is a 404. A ROUTE that is missing is index.html —
  // the router resolves it client-side, and without this a reload of
  // /ui/deletions serves nothing. Distinguished by whether the request looks
  // like a file: anything under /assets/, or anything with an extension.
  const looksLikeAsset = rel.startsWith('/assets/') || extname(rel) !== '';
  const target = (await isFile(file)) ? file : looksLikeAsset ? null : index;

  if (target === null || !(await isFile(target))) {
    // The bundle being absent is the likely cause on a dev checkout, and it is
    // worth saying so rather than answering a bare 404: the appliance runs from
    // source under tsx, and `pnpm --filter @openmig/web build:selfhost` is not
    // something anyone would guess (hard rule 9 — do not let a missing build
    // look like a missing feature).
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      (await isFile(index))
        ? 'Not found'
        : `The operating UI has not been built. Run: pnpm --filter @openmig/web build:selfhost\n` +
            `Expected it at: ${resolve(options.rootDir)}\n` +
            `The JSON endpoints (/status, /deletions, /moves, /failures) work regardless.\n`,
    );
    return true;
  }

  const headers: Record<string, string> = { 'content-type': contentTypeFor(target) };
  // Vite fingerprints asset filenames, so those are safe to cache hard. index.html
  // is not fingerprinted and must not be, or an upgraded appliance keeps serving
  // the old bundle until somebody clears their browser cache.
  headers['cache-control'] =
    target === index ? 'no-cache' : 'public, max-age=31536000, immutable';

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise<void>((resolveDone, reject) => {
    const stream = createReadStream(target);
    stream.on('error', reject);
    stream.on('end', resolveDone);
    stream.pipe(res);
  });
  return true;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
