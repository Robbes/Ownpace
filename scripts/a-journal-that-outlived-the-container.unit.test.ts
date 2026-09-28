// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JOURNAL THAT OUTLIVED THE CONTAINER (the owner, 2026-09-28, ops-log-driver
 * (a): *"Docker's default, as the text says"*, with the note *"needs
 * checking"*; privacy §9, *Server logs*).
 *
 * Privacy §9 keeps server logs *"until the part of the service that wrote them
 * is replaced"*, with no fixed period. That is what Docker's default log driver
 * does: `json-file` (and `local`) keep a container's output with the container,
 * and remove it with the container. `docs/managed-bring-up.md` told the operator
 * to hand every container's output to the host's journal instead
 * (`/etc/docker/daemon.json` `{"log-driver": "journald"}`, `MaxRetentionSec=1month`,
 * workplan 0129 T3), and listed *"the journald log driver"* among the owner's
 * steps for live, although 0134 open question 6 had been answered (a), no
 * journald. The journal keeps what a container wrote after the container is
 * gone, until its own retention removes it: the text would be wrong for every
 * log on a machine that followed the guide. Nothing checked which driver the
 * machine uses.
 *
 * `site/legal/README.md`, *To build or to do*: *"Server logs until the part
 * that wrote them is replaced (privacy §9; ops-log-driver (a), the owner:
 * "needs checking"): the owner runs `docker info --format
 * '{{.LoggingDriver}}'` on the machine and undoes a journald setting if there
 * is one; the journald step comes out of `docs/managed-bring-up.md`."*
 *
 * WHAT THIS HOLDS. No guide for a managed machine tells the operator to set
 * journald (the appliance's own guide, `docs/selfhost-quickstart.md`, keeps its
 * month: `a-month-of-container-output`). The bring-up says what to expect
 * instead, gives the owner's check, and how to undo a journald setting, and
 * the owner's steps for live carry the check. And no compose file a managed
 * machine runs sets another driver, which would make the check's answer beside
 * the point.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** The owner's check, as the text quotes it. */
const CHECK = "docker info --format '{{.LoggingDriver}}'";

/**
 * What sets journald for the daemon, or the journal's month for it. Matched
 * across line breaks: a guide wraps *"the journald log driver"* where it likes.
 */
const SETS_JOURNALD = /"log-driver"\s*:\s*"journald"|MaxRetentionSec|the\s+journald\s+log\s+driver/g;

/** The guides that are the appliance's alone, which keep their month (0129 T3). */
const APPLIANCE_ONLY = new Set(['docs/selfhost-quickstart.md', 'docs/windows-appliance-runbook.md']);

describe('no guide for a managed machine sets journald', () => {
  const guides = readdirSync(join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`)
    .filter((p) => !APPLIANCE_ONLY.has(p));

  it('finds the guides, so the sweep is not vacuous', () => {
    expect(guides).toContain('docs/managed-bring-up.md');
    expect(guides).toContain('docs/operator-runbook.md');
  });

  it.each(guides)('%s', (path) => {
    const text = read(path);
    const hits = [...text.matchAll(SETS_JOURNALD)].map(
      (m) => `${path}:${text.slice(0, m.index).split('\n').length}: ${m[0].replace(/\s+/g, ' ')}`,
    );
    expect(hits).toEqual([]);
  });
});

describe("the bring-up's check instead", () => {
  const guide = read('docs/managed-bring-up.md');

  it('says Docker\'s default keeps a container\'s output until the container is removed, and gives the check', () => {
    const before = guide.slice(guide.indexOf('## Before you start'), guide.indexOf('**Architecture.**'));
    expect(before).toContain(CHECK);
    expect(before).toMatch(/`json-file`/);
    expect(before).toMatch(/`local`/);
    expect(before).toMatch(/until\s+the\s+container\s+is\s+removed/);
  });

  it('says how to undo a journald setting', () => {
    const before = guide.slice(guide.indexOf('## Before you start'), guide.indexOf('**Architecture.**'));
    expect(before).toMatch(/\/etc\/docker\/daemon\.json/);
    expect(before).toMatch(/sudo systemctl restart docker/);
  });

  it("is in the owner's steps for live", () => {
    const steps = guide.slice(
      guide.indexOf("### Before the script: the owner's steps"),
      guide.indexOf('### The script'),
    );
    expect(steps.length).toBeGreaterThan(0);
    expect(steps).toContain(CHECK);
  });
});

describe('no compose file a managed machine runs sets another driver', () => {
  interface Service {
    readonly logging?: { readonly driver?: string };
  }
  it.each(['deploy/compose/managed.yml', 'deploy/compose/www.yml'])('%s', (path) => {
    const services =
      (parse(read(path), { merge: true, logLevel: 'error' }) as { services?: Record<string, Service> }).services ?? {};
    expect(Object.keys(services).length).toBeGreaterThan(0);
    for (const [name, service] of Object.entries(services)) {
      const driver = service.logging?.driver;
      expect(driver === undefined || driver === 'json-file' || driver === 'local', `${path}: ${name} logs to ${driver}`).toBe(true);
    }
  });
});
