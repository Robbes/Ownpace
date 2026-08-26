// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MAIL NOBODY SHOULD GET (workplan 0103 T2, ADR-0043).
 *
 * The managed gate now proves a migration's silence instead of assuming it,
 * and this file keeps the three pieces of that proof from drifting apart —
 * because each is useless without the others:
 *
 *   - the demo target's SMTP points at the catcher (ARMED: silence is
 *     falsifiable, not true by inability),
 *   - the fresh fixture carries a tag-addressed ATTENDEE canary (there is
 *     something a regression WOULD mail),
 *   - the smoke asserts the target copy's bytes are neutralised and the
 *     catcher stayed empty, after sync AND after take-back (the CANCEL side).
 *
 * Before this, no fixture in the repository contained a single ATTENDEE line:
 * every green run was silent about invitation fan-out by blindness. The 0103
 * research is the account; run #6's apply-half is the precedent shape.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const COMPOSE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');
const strip = (path: string): string =>
  readFileSync(join(COMPOSE, path), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

describe('the mail nobody should get — the gate stays armed and asserting', () => {
  it('points the demo target’s SMTP at the catcher, so silence can fail', () => {
    const compose = parse(readFileSync(join(COMPOSE, 'managed.yml'), 'utf8')) as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    const env = compose.services.nextcloud?.environment ?? {};
    expect(
      env.SMTP_HOST,
      'the demo Nextcloud has no SMTP_HOST, so it CANNOT send mail and the\n' +
        'scheduling-silence assertions are true by inability — the exact\n' +
        'silence-by-blindness 0103 exists to end. Point it at the catcher.',
    ).toBe('mailpit');
    expect(env.SMTP_PORT, 'mailpit listens for SMTP on 1025').toBe('1025');
  });

  it('seeds a canary attendee on fresh event 1, tag-addressed', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(
      seed,
      'seed-demo-dav-content.sh no longer seeds an ATTENDEE canary. Without\n' +
        'one there is nothing a regression toward mailing WOULD mail, and the\n' +
        'gate is silent by blindness again.',
    ).toMatch(/ATTENDEE[^\n]*openmig-attendee-\$\{TAG\}@example\.invalid/);
    expect(
      seed,
      'the canary lost its third-party ORGANIZER. Most of a migrated mailbox\n' +
        'is other people’s meetings, and the organiser property is what makes\n' +
        'a DELETE fan out CANCEL — the take-back half needs it present.',
    ).toMatch(/ORGANIZER[^\n]*openmig-organizer-\$\{TAG\}@example\.invalid/);
    expect(
      seed,
      'the canary is no longer confined to tagged (fresh) seeds. The fixed\n' +
        'demo fixture belongs to the demo UI; an untagged canary would also\n' +
        'search Mailpit for a constant address, which a previous run could\n' +
        'answer for.',
    ).toMatch(/\[ -n "\$TAG" \][\s\S]{0,200}openmig-organizer/);
  });

  it('asserts the neutralised bytes on the target’s own copy', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the smoke no longer reads the canary copy back off the target. The\n' +
        'byte half is what proves the writer neutralised in a real run —\n' +
        'without it, only unit fakes ever see the transform.',
    ).toMatch(/openmig-demo-event-\$\{BALANCE_TAG\}-1\.ics/);
    expect(
      smoke,
      'the smoke reads the copy but no longer requires SCHEDULE-AGENT=CLIENT\n' +
        'in it — an RFC 6638 target without that parameter MAILS the attendees.',
    ).toMatch(/grep -q "SCHEDULE-AGENT=CLIENT"/);
  });

  it('asserts catcher silence twice — after sync and after take-back', () => {
    const smoke = strip('smoke-managed.sh');
    const searches = smoke.match(/query=openmig-attendee-\$\{BALANCE_TAG\}/g) ?? [];
    expect(
      searches.length,
      `the smoke searches the catcher for the canary ${searches.length} time(s);\n` +
        'it takes two — once after sync (invitation fan-out) and once after the\n' +
        'take-back (CANCEL fan-out). Deleting an organiser copy is a scheduling\n' +
        'write under RFC 6638, so removal needs its own assertion.',
    ).toBe(2);
  });

  it('take-back DELETEs carry Schedule-Reply: F (0103 T5)', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(
      seed,
      'seed-demo-dav-content.sh DELETEs without Schedule-Reply: F. The\n' +
        'take-back removes organiser copies that can carry attendees — the\n' +
        'canary above does — and on a scheduling server a bare DELETE fans\n' +
        'out CANCEL to all of them.',
    ).toMatch(/"\$method" = "DELETE"[^\n]*Schedule-Reply: F/);
  });

  it('measures the target instead of trusting it (0103 T3)', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the smoke no longer asks the target whether it auto-schedules. One\n' +
        'OPTIONS request, API-only, no side effects — without it, whether the\n' +
        'neutralising is load-bearing on this target is a guess again.',
    ).toMatch(/OPTIONS[\s\S]{0,400}calendar-auto-schedule/);
    expect(
      smoke,
      'the measurement lost its unmeasured state. A target that answers no\n' +
        'DAV header is UNKNOWN — reporting it as anything else is the run-#6\n' +
        'shape: a check that could not run counted as one that passed.',
    ).toMatch(/UNKNOWN[^\n]*unmeasured/);
  });

  it('the apply half can never spend the canary (E2E #88)', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'CANARY_RE is gone or reshaped. The byte-check reads fresh event 1 off\n' +
        'the target AFTER the apply half runs; E2E #88 applied a real deletion\n' +
        'to exactly that item four seconds before the read, and the gate\n' +
        'reported its own deletion as an unproven byte-check.',
    ).toMatch(/CANARY_RE="openmig-demo-event-\.\+-1\[\.\]ics\$"/);
    expect(
      smoke,
      'pick_disposable no longer excludes the canary. The prepare wait loop\n' +
        'polls pick_disposable itself, so this one predicate is what keeps the\n' +
        'apply half off the byte-check’s fixture — in the wait and the pick\n' +
        'both, by construction.',
    ).toMatch(/pick_disposable\(\)[\s\S]{0,600}!~ '\$CANARY_RE'/);
  });
});

/**
 * THE BYTES THE SEED ACTUALLY PUTS (E2E managed #87).
 *
 * Every rule above greps the script's TEXT, and text is not what a server
 * parses. The canary shipped with `$(printf '%s' "$SCHED_PROPS")END:VEVENT`,
 * command substitution stripped the trailing newline, END:VEVENT fused onto
 * the ATTENDEE line, and the first live run answered 415 to its own fixture —
 * the fresh seed died, the apply half had no item, and the gate went red on a
 * body no test had ever rendered. So this suite RUNS the real script with a
 * stub `docker` on PATH that records what curl would have sent, and asserts
 * on the captured bytes. No live server: what a server would parse, not what
 * it would answer.
 */
describe('the bytes the seed actually puts', () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const SEED = join(REPO_ROOT, 'deploy', 'compose', 'seed-demo-dav-content.sh');

  // The stub answers exactly the calls seed-demo-dav-content.sh makes:
  // the two exec probes; discover()'s Depth:0 PROPFIND (207); dav() PUTs
  // (record stdin, 201) and DELETEs (204); count()'s Depth:1 PROPFIND
  // (list what was stored, so the script's own verification stays honest).
  const STUB = `#!/usr/bin/env bash
set -u
CAP="\${SEED_STUB_DIR:?}"
shift                                  # 'exec'
if [ "$1" = "-i" ]; then shift; fi
shift                                  # container name
case "$1" in
  true) exit 0 ;;
  sh) exit 0 ;;
  curl) shift ;;
  *) echo "stub docker: unexpected command $1" >&2; exit 64 ;;
esac
method=""; wantscode=0; hasbody=0; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -w) wantscode=1; shift 2 ;;
    --data-binary) hasbody=1; shift 2 ;;
    -H|-u|-o) shift 2 ;;
    -sS|-s|-S) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="\${url#http://localhost/remote.php/dav/}"
case "$method" in
  PUT)
    [ "$hasbody" = 1 ] || { echo "stub docker: PUT without --data-binary" >&2; exit 64; }
    mkdir -p "$CAP/puts"
    cat > "$CAP/puts/$(printf '%s' "$path" | tr '/' '_')"
    printf '%s\\n' "$path" >> "$CAP/manifest.txt"
    printf 201 ;;
  DELETE) printf 204 ;;
  PROPFIND)
    if [ "$wantscode" = 1 ]; then printf 207; else cat "$CAP/manifest.txt" 2>/dev/null || true; fi ;;
  *) echo "stub docker: unexpected method '$method'" >&2; exit 64 ;;
esac
`;

  function runSeed(args: string[]): { dir: string; stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), 'seedbytes-'));
    writeFileSync(join(dir, 'docker'), STUB, { mode: 0o755 });
    const stdout = execFileSync('bash', [SEED, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, SEED_STUB_DIR: dir },
    });
    return { dir, stdout };
  }

  const put = (dir: string, name: string): string =>
    readFileSync(join(dir, 'puts', name), 'utf8');

  it('a tagged seed renders the canary AND a closed VEVENT — the #87 regression', () => {
    const tag = 't415guard';
    const { dir, stdout } = runSeed(['--fresh', tag]);
    try {
      expect(stdout).toContain(`[seed-dav] event ${tag}-1: HTTP 201`);
      const event1 = put(dir, `calendars_tenant-b-source_personal_openmig-demo-event-${tag}-1.ics`);
      expect(
        event1,
        'the exact #87 failure: command substitution stripped the newline after\n' +
          'the canary and fused END:VEVENT onto the ATTENDEE line. Sabre answers\n' +
          '415 to this body and the whole fresh seed dies.',
      ).not.toMatch(/invalidEND:VEVENT/);
      expect(
        event1,
        'END:VEVENT must sit on its own line — an unterminated VEVENT is not\n' +
          'iCalendar, whatever the surrounding text greps like.',
      ).toMatch(/\nEND:VEVENT\r?\n/);
      expect(event1).toMatch(
        new RegExp(`\\nORGANIZER;CN=Someone Else:mailto:openmig-organizer-${tag}@example\\.invalid\\r?\\n`),
      );
      expect(event1).toMatch(
        new RegExp(
          `\\nATTENDEE;CN=Migration Canary;PARTSTAT=NEEDS-ACTION:mailto:openmig-attendee-${tag}@example\\.invalid\\r?\\n`,
        ),
      );
      const event2 = put(dir, `calendars_tenant-b-source_personal_openmig-demo-event-${tag}-2.ics`);
      expect(event2, 'the canary rides event 1 only').not.toMatch(/ATTENDEE|ORGANIZER/);
      expect(event2).toMatch(/\nEND:VEVENT\r?\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an untagged seed stays canary-free, in the bytes and not just the text', () => {
    const { dir } = runSeed([]);
    try {
      const event1 = put(dir, 'calendars_tenant-b-source_personal_openmig-demo-event-1.ics');
      expect(
        event1,
        'the fixed demo fixture belongs to the demo UI; a canary here would\n' +
          'also give the smoke a constant address a previous run could answer for.',
      ).not.toMatch(/ATTENDEE|ORGANIZER/);
      expect(event1).toMatch(/\nEND:VEVENT\r?\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
