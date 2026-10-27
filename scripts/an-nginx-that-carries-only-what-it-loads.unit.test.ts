// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN NGINX THAT CARRIES ONLY WHAT IT LOADS (workplan 0146 T12a).
 *
 * The web image's runtime (`apps/web/Dockerfile`) and the public site
 * (`deploy/compose/www.yml`) ran `nginx:<version>-alpine` until 2026-10-25.
 * That image is `-alpine-slim` plus one layer: curl, the njs, xslt, geoip,
 * image-filter and acme modules, and the 51 packages they bring. Nothing here
 * used any of them, and the image scan counted them: 1.31.8-alpine read one
 * high finding (brotli-libs, CVE-2026-111497), 1.31.8-alpine-slim none. 1.31.7's
 * two highs, libexpat and libx11, were in that layer too. So both run
 * `-alpine-slim` now.
 *
 * What the move costs is curl. The health checks ask with busybox's `wget`,
 * which slim keeps, and a check rewritten to `curl` would fail on every run.
 * On the web image the managed gate would see it. On `www.yml` nothing would:
 * no workflow brings that file up, and the site's health check once failed
 * for five days before anybody looked
 * (`a-healthcheck-that-asked-the-wrong-address`). So this reads every health
 * check of a container that runs this nginx, and the incident runbook's look
 * from inside the web container, and refuses curl in them.
 *
 * And it holds the reason for the move: neither config names a directive of
 * the modules slim does not have. Dependabot keeps the variant when it moves
 * the Dockerfile's tag (it compares tags shaped alike), and the pin watch says
 * when `www.yml` differs from it, so this names the variant and not a version.
 * Going back to `-alpine` is a decision, made here, with a reason that
 * outweighs what the scan counts.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { parseNginx, type NginxNode } from './nginx-config.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const DOCKERFILE_PATH = 'apps/web/Dockerfile';
const DOCKERFILE = read(DOCKERFILE_PATH);
const RUNTIME = DOCKERFILE.slice(Math.max(0, DOCKERFILE.search(/^FROM \S+ AS runtime$/m)));

/** The variant, by exact tag and index digest (a-float-nothing-ever-pulled). */
const SLIM = /^nginx:\d+\.\d+\.\d+-alpine-slim@sha256:[0-9a-f]{64}$/;

/** Directives of the dynamic modules -alpine adds and slim does not have. */
const DROPPED = /^(?:load_module|js_\w+|xslt_\w+|geoip_\w+|geoip2|image_filter\w*|acme_\w+)$/;

function everywhere(nodes: readonly NginxNode[]): NginxNode[] {
  return nodes.flatMap((n) => [n, ...everywhere(n.children ?? [])]);
}

type Service = {
  image?: string;
  build?: string | { dockerfile?: string };
  healthcheck?: { test?: string[] | string };
};

/** Every service in deploy/compose that runs this nginx: by image, or built from the web image. */
const services = readdirSync(join(ROOT, 'deploy/compose'))
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) => {
    const doc = parseYaml(read(`deploy/compose/${f}`)) as { services?: Record<string, Service> } | null;
    return Object.entries(doc?.services ?? {}).map(([name, s]) => ({ where: `deploy/compose/${f} → ${name}`, s }));
  })
  .filter(({ s }) =>
    /^nginx:/.test(s.image ?? '') ||
    (typeof s.build === 'object' && s.build?.dockerfile === DOCKERFILE_PATH),
  );

describe('an nginx that carries only what it loads', () => {
  it("the web image's runtime is -alpine-slim, by tag and digest", () => {
    const from = /^FROM (\S+) AS runtime$/m.exec(DOCKERFILE)?.[1];
    expect(from, `${DOCKERFILE_PATH} has no runtime stage`).toBeDefined();
    expect(from).toMatch(SLIM);
  });

  it("www.yml's nginx is -alpine-slim, by tag and digest", () => {
    const www = services.filter(({ where }) => where.startsWith('deploy/compose/www.yml'));
    expect(www.map(({ where }) => where)).toEqual(['deploy/compose/www.yml → www']);
    expect(www[0]!.s.image).toMatch(SLIM);
  });

  it('neither config names a directive of the modules slim does not have', () => {
    for (const path of ['apps/web/nginx.conf.template', 'deploy/compose/www-nginx.conf']) {
      const named = everywhere(parseNginx(read(path), path)).map((n) => n.name).filter((n) => DROPPED.test(n));
      expect(named, `${path} needs a module only nginx:*-alpine carries`).toEqual([]);
    }
  });

  it("the web image's health check asks with busybox's wget, which slim keeps", () => {
    // HEALTHCHECK's options and its CMD, continuation lines joined.
    const check = /^HEALTHCHECK\b((?:[^\n]*\\\n)*[^\n]*)/m.exec(RUNTIME)?.[1]?.replace(/\\\n\s*/g, ' ');
    expect(check, `${DOCKERFILE_PATH}'s runtime has no HEALTHCHECK`).toBeDefined();
    expect(check).toMatch(/\bCMD wget\b/);
    expect(check).not.toMatch(/\bcurl\b/);
  });

  it('no compose health check of a container that runs it asks with curl', () => {
    // Both are found, so this cannot pass on an empty list: managed.yml's web
    // keeps the image's own check, www.yml's has its own.
    expect(services.map(({ where }) => where)).toEqual(
      expect.arrayContaining(['deploy/compose/managed.yml → web', 'deploy/compose/www.yml → www']),
    );
    for (const { where, s } of services) {
      const test = s.healthcheck?.test;
      if (!test) continue;
      const text = Array.isArray(test) ? test.join(' ') : String(test);
      expect(text, `${where}: slim has no curl`).not.toMatch(/\bcurl\b/);
    }
  });

  it("the runbooks' look from inside the web or www container needs no curl", () => {
    const docs = readdirSync(join(ROOT, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/${f}`)
      .concat('apps/web/README.md');
    const looks = docs.flatMap((path) =>
      [...read(path).matchAll(/`([^`\n]+)`/g)]
        .map((m) => m[1]!)
        .filter((span) => /\bexec\s+(?:-\S+\s+)*(?:web|www|ownpace-www)\s/.test(span))
        .map((span) => ({ path, span })),
    );
    expect(looks.map(({ path }) => path)).toContain('docs/incident-runbook.md');
    for (const { path, span } of looks) {
      expect(span, `${path}: slim has no curl; busybox's wget is there`).not.toMatch(/\bcurl\b/);
    }
  });
});
