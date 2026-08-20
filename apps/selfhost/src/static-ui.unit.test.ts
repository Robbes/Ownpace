// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The appliance's static UI server (ADR-0026).
 *
 * Two things carry the weight here. **Path traversal**, because this is the one
 * place in the appliance that turns a request string into a filesystem read, and
 * the localhost bind is not an argument for getting it wrong. And **the mount
 * boundary**, because several of the router's screen names — /deletions, /moves,
 * /failures — are also JSON endpoints on this same server: a handler that
 * answered one of those with HTML would break the runbook, the e2e gates and
 * anybody's script, all silently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { contentTypeFor, resolveWithinRoot, serveUi, UI_MOUNT } from './static-ui.ts';

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'openmig-ui-'));
  root = join(base, 'dist-selfhost');
  outside = base;
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>console</title>');
  await writeFile(join(root, 'assets', 'index-abc.js'), 'console.log(1)');
  await writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
});

afterAll(async () => {
  await rm(outside, { recursive: true, force: true });
});

/** Minimal req/res doubles — enough for a handler that only reads url/method. */
function reqres(url: string, method = 'GET') {
  const chunks: Buffer[] = [];
  let status = 0;
  let headers: Record<string, string> = {};
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      headers = h ?? {};
      return res;
    },
    end(body?: unknown) {
      if (typeof body === 'string') chunks.push(Buffer.from(body));
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return false;
    },
    write(c: Buffer | string) {
      chunks.push(Buffer.from(c as Buffer));
      return true;
    },
  } as unknown as ServerResponse;
  return {
    req: { url, method } as IncomingMessage,
    res,
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    get body() {
      return Buffer.concat(chunks).toString();
    },
  };
}

describe('resolveWithinRoot', () => {
  /**
   * The property that actually matters: whatever comes back is inside the root.
   *
   * Note the two different safe answers. A traversal does not come back as
   * `null` — `path.normalize` collapses a leading `..` at the root of an
   * absolute path, so `/../secret.txt` becomes `/secret.txt` and lands INSIDE
   * the bundle directory, where it simply does not exist and 404s. The explicit
   * containment check is then defence in depth that these inputs never reach.
   * Asserting `null` here (as this test first did) would have been asserting an
   * implementation detail that is not the security property and is not true.
   */
  function assertContained(result: string | null) {
    expect(result).not.toBeNull();
    expect(result!.startsWith(join(root) + '/') || result === join(root)).toBe(true);
    // Note what is NOT asserted: that the basename changed. `<root>/secret.txt`
    // is a perfectly good confined answer — it names a file inside the bundle
    // directory that does not exist, and 404s. Containment is the property;
    // the filename surviving the walk is not a leak.
  }

  it('resolves an ordinary asset path', () => {
    expect(resolveWithinRoot(root, '/assets/index-abc.js')).toBe(
      join(root, 'assets', 'index-abc.js'),
    );
  });

  it('confines a literal traversal to the root', () => {
    assertContained(resolveWithinRoot(root, '/../secret.txt'));
    assertContained(resolveWithinRoot(root, '/assets/../../secret.txt'));
    assertContained(resolveWithinRoot(root, '/../../../../../../etc/passwd'));
  });

  it('confines a URL-ENCODED traversal, which a literal-string check would miss', () => {
    // The decode has to happen before the containment logic, or '%2e%2e' walks
    // straight past any check written against the raw request string.
    assertContained(resolveWithinRoot(root, '/%2e%2e/secret.txt'));
    assertContained(resolveWithinRoot(root, '/%2E%2E%2Fsecret.txt'));
  });

  it('refuses a NUL byte outright', () => {
    // Not merely confined — refused. It truncates the path at the syscall
    // layer, so a name that passed a containment check could still name a
    // different file by the time it is opened.
    expect(resolveWithinRoot(root, '/index.html%00.png')).toBeNull();
  });

  it('refuses a malformed escape rather than guessing', () => {
    expect(resolveWithinRoot(root, '/%zz')).toBeNull();
  });

  it('never lets a sibling directory pass as the root', () => {
    // The containment check is `root + sep`, not `startsWith(root)`, because
    // '/srv/ui-old' starts with '/srv/ui' and is a different directory. Here
    // the traversal is confined first, so the answer stays under '/srv/ui'.
    const out = resolveWithinRoot('/srv/ui', '/../ui-old/index.html');
    expect(out).not.toBeNull();
    expect(out!.startsWith('/srv/ui/')).toBe(true);
    expect(out).not.toBe('/srv/ui-old/index.html');
  });
});

describe('the mount boundary', () => {
  it('does not answer the JSON endpoints that share a name with a screen', async () => {
    // The whole reason for the /ui prefix. If any of these returned true the
    // appliance would serve HTML where the runbook, the e2e gates and every
    // script expect JSON.
    for (const path of ['/deletions', '/moves', '/failures', '/status', '/']) {
      const c = reqres(path);
      expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(false);
    }
  });

  it('does not answer a path that merely starts with the mount name', async () => {
    const c = reqres('/uifoo');
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(false);
  });

  it('ignores non-GET methods, so POST /ui/... falls through', async () => {
    const c = reqres(`${UI_MOUNT}/deletions`, 'POST');
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(false);
  });
});

describe('serving', () => {
  it('REDIRECTS the bare mount to its trailing-slash form', async () => {
    // This test used to assert a 200 here, and in doing so it encoded the bug.
    //
    // The bundle is built with `--base=/ui/`, so React Router's basename
    // carries a trailing slash, and its `stripBasename` begins with
    // `pathname.startsWith(basename)`. `'/ui'` does not start with `'/ui/'`, so
    // no route matched and the browser got a WHITE PAGE — with a 200, and a
    // fully loaded bundle, which is why serving index.html here looked correct
    // to everything except a person.
    //
    // `/ui` is also the one URL that matters most: it is what the runbook says
    // to open and what ADR-0027's Start-menu shortcut points at. Found on
    // Windows, 2026-08-07.
    const c = reqres(UI_MOUNT);
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(true);
    expect(c.status).toBe(302);
    expect(c.headers['location']).toBe(`${UI_MOUNT}/`);
  });

  it('serves index.html at the mount root WITH the slash', async () => {
    const c = reqres(`${UI_MOUNT}/`);
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(true);
    expect(c.status).toBe(200);
    expect(c.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('falls back to index.html for a client-side route', async () => {
    // Without this, reloading the page on /ui/deletions serves nothing — the
    // router resolves that path in the browser, not here.
    const c = reqres(`${UI_MOUNT}/deletions`);
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(true);
    expect(c.status).toBe(200);
    expect(c.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('404s a MISSING ASSET instead of falling back', async () => {
    // A missing asset served as index.html is the classic SPA bug: the browser
    // gets HTML where it asked for JavaScript and reports a syntax error, which
    // says nothing about the real problem.
    const c = reqres(`${UI_MOUNT}/assets/not-there.js`);
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(true);
    expect(c.status).toBe(404);
  });

  it('caches fingerprinted assets hard and index.html not at all', async () => {
    const asset = reqres(`${UI_MOUNT}/assets/index-abc.js`);
    await serveUi(asset.req, asset.res, { rootDir: root });
    expect(asset.headers['cache-control']).toContain('immutable');

    // index.html is not fingerprinted, so caching it would leave an upgraded
    // appliance serving the old bundle until somebody clears their cache.
    // The trailing-slash form, because the bare mount is a redirect now and a
    // redirect carries no cache-control worth asserting.
    const page = reqres(`${UI_MOUNT}/`);
    await serveUi(page.req, page.res, { rootDir: root });
    expect(page.headers['cache-control']).toBe('no-cache');
  });

  it('never serves a file from outside the bundle directory', async () => {
    // The traversal is confined to the root, where secret.txt does not exist,
    // so this 404s. What matters is the body: the file one directory up is not
    // in it, whatever status code the confinement happens to produce.
    const c = reqres(`${UI_MOUNT}/../secret.txt`);
    expect(await serveUi(c.req, c.res, { rootDir: root })).toBe(true);
    expect(c.status).toBe(404);
    expect(c.body).not.toContain('TOP SECRET');
  });
});

describe('when the bundle has not been built', () => {
  it('says how to build it rather than answering a bare 404', async () => {
    // The appliance runs from source under tsx, so this is the likely state on
    // a dev checkout, and `build:selfhost` is not a command anyone would guess.
    // The slash form: `/ui` redirects here first, so this is where the message
    // actually lands. A reader following the redirect sees it either way.
    const c = reqres(`${UI_MOUNT}/`);
    expect(await serveUi(c.req, c.res, { rootDir: join(outside, 'nope') })).toBe(true);
    expect(c.status).toBe(404);
    expect(c.body).toContain('build:selfhost');
    // And it says the JSON still works, so a missing build does not read as a
    // broken appliance.
    expect(c.body).toContain('/deletions');
  });
});

describe('contentTypeFor', () => {
  it('gets the two that break the page right', () => {
    expect(contentTypeFor('/x/index-abc.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/index-abc.css')).toBe('text/css; charset=utf-8');
  });

  it('falls back to octet-stream rather than guessing html', () => {
    // A download prompt is a visible failure; a wrong text/html is an invisible
    // one.
    expect(contentTypeFor('/x/thing.weird')).toBe('application/octet-stream');
  });
});
