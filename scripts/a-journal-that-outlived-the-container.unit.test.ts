// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JOURNAL THAT OUTLIVED THE CONTAINER (the owner, 2026-09-28, ops-log-driver
 * (a): *"Docker's default, as the text says"*, with the note *"needs
 * checking"*; privacy §9, *Server logs*).
 *
 * Privacy §9 keeps server logs *"until the part of the service that wrote them
 * is replaced"*, with no fixed period. That is what Docker's default log
 * driver, `json-file`, does: it keeps a container's output with the container,
 * with no limit of age or size, and removes it with the container (`local`
 * does too, and also rotates it by size, so it can keep less, never longer).
 * `docs/managed-bring-up.md` told the operator to hand every container's
 * output to the host's journal instead (`/etc/docker/daemon.json`
 * `{"log-driver": "journald"}`, `MaxRetentionSec=1month`, workplan 0129 T3),
 * and listed *"the journald log driver"* among the owner's steps for live,
 * although 0134 open question 6 had been answered (a), no journald. The
 * journal keeps what a container wrote after the container is gone, until its
 * own retention removes it: the text would be wrong for every log on a machine
 * that followed the guide. Nothing checked which driver the machine uses.
 *
 * `site/legal/README.md`, *To build or to do*: *"Server logs until the part
 * that wrote them is replaced (privacy §9; ops-log-driver (a), the owner:
 * "needs checking"): the owner runs `docker info --format
 * '{{.LoggingDriver}}'` on the machine and undoes a journald setting if there
 * is one; the journald step comes out of `docs/managed-bring-up.md`."*
 *
 * WHAT THIS HOLDS. No guide for a managed machine, and no script in
 * `deploy/compose`, tells the operator to set journald: no sentence names
 * journald and the log driver together but the one that says how to take the
 * setting out, and none sets the journal's month (the appliance's own guide,
 * `docs/selfhost-quickstart.md`, keeps its month: `a-month-of-container-output`).
 * No managed guide reads container output from the journal either: every
 * `journalctl` it shows asks for a unit or an identifier of its own, never the
 * whole journal or a container's entries. The bring-up says what to expect
 * instead, gives the owner's check, and how to undo a journald setting, and
 * the owner's steps for live carry the check; `stand-up-live.sh` refuses a
 * machine whose driver is not Docker's default (`a-first-bring-up-of-live`).
 * The breach procedure copies container output with `docker compose logs`,
 * and the audit section points a collector at Docker's output. And no compose
 * file a managed machine runs sets another driver, which would make the
 * check's answer beside the point.
 *
 * WIDENED 2026-09-29 (review). The sweep matched three exact phrases, so
 * `sudo dockerd --log-driver=journald`, *"Set the daemon log-driver to
 * journald"* and `{"log-driver": "journald"}` in the stand-up script's closing
 * list all passed it. And it read no `journalctl`: the breach procedure's step
 * 2 and the bring-up's audit section still read container output from the
 * journal, which with Docker's default holds none of it, so a responder
 * following step 2 copied nothing and lost the evidence at the next deploy.
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

/** The guides that are the appliance's alone, which keep their month (0129 T3). */
const APPLIANCE_ONLY = new Set(['docs/selfhost-quickstart.md', 'docs/windows-appliance-runbook.md']);

/** Every top-level guide but the appliance's. */
const GUIDES = readdirSync(join(ROOT, 'docs'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => `docs/${f}`)
  .filter((p) => !APPLIANCE_ONLY.has(p));

/** Every script the managed machines run. */
const SCRIPTS = readdirSync(join(ROOT, 'deploy/compose'))
  .filter((f) => f.endsWith('.sh'))
  .map((f) => `deploy/compose/${f}`);

/**
 * A text's sentences, whitespace folded, so a guide may wrap one where it
 * likes. A blank line, a list item and a code fence end one; a script's
 * comment marks are taken off first.
 */
function sentences(path: string): string[] {
  const text = path.endsWith('.sh') ? read(path).replace(/^[ \t]*#+ ?/gm, '') : read(path);
  return text
    .split(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s)|\n\s*```[^\n]*/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z*`(["'_])/))
    .filter((s) => s !== '');
}

/** A sentence that hands containers' output to the journal: journald and the log driver together. */
const NAMES_THE_DRIVER = /log[- ]?driver/i;
/** The one such sentence allowed: how to take the setting out. */
const UNDOES_IT = /take the `?"log-driver"`? line out/;

/**
 * Every `journalctl` command a guide shows: a line of a fenced block, with its
 * continuations, or an inline code span in prose, which may wrap.
 */
function journalctlCommands(text: string): string[] {
  const out: string[] = [];
  const prose: string[] = [];
  const lines = text.split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      prose.push('');
      continue;
    }
    if (!fenced) {
      prose.push(line);
      continue;
    }
    while (/\\\s*$/.test(line) && i + 1 < lines.length) line = line.replace(/\\\s*$/, ' ') + lines[++i]!;
    if (/\bjournalctl\b/.test(line)) out.push(line.trim());
    prose.push('');
  }
  for (const m of prose.join('\n').matchAll(/`([^`]+)`/g)) {
    const span = m[1]!.replace(/\s+/g, ' ').trim();
    if (/\bjournalctl\b/.test(span)) out.push(span);
  }
  return out;
}

/**
 * Whether a `journalctl` command reads containers' output: it names a
 * container's field, or asks for no unit and no identifier of its own, which
 * is the whole journal, where a journald driver puts every container.
 */
function readsContainers(command: string): boolean {
  const args = command.slice(command.search(/\bjournalctl\b/) + 'journalctl'.length).split(/\||>|;|&&/)[0]!;
  if (/\bCONTAINER_[A-Z_]+=/.test(args)) return true;
  return !/(?:^|\s)(?:-u|-t|--unit|--user-unit|--identifier)(?=[\s=]|$)/.test(args);
}

describe('no guide for a managed machine, and no script of its, sets journald', () => {
  it('finds the guides and the scripts, so the sweep is not vacuous', () => {
    expect(GUIDES).toContain('docs/managed-bring-up.md');
    expect(GUIDES).toContain('docs/operator-runbook.md');
    expect(GUIDES).toContain('docs/breach-procedure.md');
    expect(SCRIPTS).toContain('deploy/compose/stand-up-live.sh');
    // The rule itself, on the wordings a review got past the three phrases
    // this matched before (2026-09-29), and on the one sentence it allows.
    const hit = (s: string) => /journald/i.test(s) && NAMES_THE_DRIVER.test(s) && !UNDOES_IT.test(s);
    expect(hit('{"log-driver": "journald"}')).toBe(true);
    expect(hit('sudo dockerd --log-driver=journald')).toBe(true);
    expect(hit('Set the daemon log-driver to journald with a month of retention.')).toBe(true);
    expect(hit('Hand it to the journald log driver.')).toBe(true);
    expect(hit('If it prints `journald`, take the `"log-driver"` line out of it.')).toBe(false);
  });

  it.each([...GUIDES, ...SCRIPTS])('%s', (path) => {
    const hits = sentences(path).filter(
      (s) => (/journald/i.test(s) && NAMES_THE_DRIVER.test(s) && !UNDOES_IT.test(s)) || /MaxRetentionSec/.test(s),
    );
    expect(hits).toEqual([]);
  });
});

describe('no guide for a managed machine reads container output from the journal', () => {
  it('knows a journalctl that does from one that reads a unit of its own', () => {
    expect(readsContainers('journalctl -o cat --since today | grep \'"ownpace.audit.id"\'')).toBe(true);
    expect(readsContainers('journalctl -o cat --since "<the first day that matters>" > journal.txt')).toBe(true);
    expect(readsContainers('journalctl CONTAINER_NAME=ownpace-live-api-1')).toBe(true);
    expect(readsContainers('journalctl --user -u ownpace-box-duties -n 200 --no-pager')).toBe(false);
    expect(readsContainers('sudo journalctl -t ownpace-box-duties -p err')).toBe(false);
  });

  it.each(GUIDES)('%s', (path) => {
    expect(journalctlCommands(read(path)).filter(readsContainers)).toEqual([]);
  });

  it('the breach procedure copies each service\'s output with docker compose logs, before a deploy replaces it', () => {
    const procedure = read('docs/breach-procedure.md');
    const at = procedure.indexOf('## 2. Keep the evidence');
    expect(at, "the breach procedure's step 2 moved").toBeGreaterThan(-1);
    const step = procedure.slice(at, procedure.indexOf('\n## 3.', at));
    const copies = step.split('\n').filter((l) => /^docker compose\b.*\blogs --no-color --timestamps\b/.test(l));
    expect(copies.some((l) => l.includes('deploy/compose/managed.yml'))).toBe(true);
    expect(copies.some((l) => l.includes('deploy/compose/www.yml'))).toBe(true);
  });

  it('the audit section points a collector at Docker\'s output, and shows the lines from there', () => {
    const guide = read('docs/managed-bring-up.md');
    const at = guide.indexOf('**The audit log in your own log store**');
    expect(at, 'the audit section moved').toBeGreaterThan(-1);
    const section = guide.slice(at, guide.indexOf('**Lines your log store missed**', at));
    expect(section).toMatch(/`json-file`/);
    expect(section).toMatch(/^docker compose -f deploy\/compose\/managed\.yml logs\b.*ownpace\.audit\.id/m);
  });
});

describe("the bring-up's check instead", () => {
  const guide = read('docs/managed-bring-up.md');
  const before = guide.slice(guide.indexOf('## Before you start'), guide.indexOf('**Architecture.**'));

  it("says Docker's default keeps a container's output until the container is removed, and gives the check", () => {
    expect(before).toContain(CHECK);
    expect(before).toMatch(/`json-file`/);
    expect(before).toMatch(/`local`/);
    expect(before).toMatch(/until\s+the\s+container\s+is\s+removed/);
  });

  it('names json-file as the default, and says local rotates by size', () => {
    const folded = before.replace(/\s+/g, ' ');
    expect(folded).toMatch(/Docker's default, `json-file`/);
    expect(folded).toMatch(/`local`[^.]*\brotates\b[^.]*\bsize\b/);
  });

  it('says how to undo a journald setting', () => {
    expect(before).toMatch(/\/etc\/docker\/daemon\.json/);
    expect(before).toMatch(/sudo systemctl restart docker/);
    expect(sentences('docs/managed-bring-up.md').some((s) => UNDOES_IT.test(s))).toBe(true);
  });

  it("is in the owner's steps for live", () => {
    const steps = guide.slice(guide.indexOf("### Before the script: the owner's steps"), guide.indexOf('### The script'));
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
