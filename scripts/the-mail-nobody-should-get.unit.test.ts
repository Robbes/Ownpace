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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('keeps the operator switches documented with the live-server caveat (T4)', () => {
    const doc = readFileSync(join(COMPOSE, '..', '..', 'docs', 'dav-sync.md'), 'utf8');
    expect(doc, 'dav-sync.md no longer names the Nextcloud invitation switch').toContain(
      'sendInvitations',
    );
    expect(
      doc,
      'the live-server caveat is gone: both switches are instance-wide, and\n' +
        'without the warning an operator silences a customer’s real users to\n' +
        'quiet a migration.',
    ).toMatch(/instance-wide[\s\S]{0,300}LIVE server/);
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

  it('the pipe is proved before the silence is believed (0104 T2, first stage)', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the positive mail-pipe control is gone. Until it existed, no run had\n' +
        'ever shown a mail LEAVING the target and ARRIVING at the catcher —\n' +
        'E2E #89’s silence rode an unproven pipe (the owner’s question,\n' +
        '2026-08-26), one SMTP typo away from silence-by-inability.',
    ).toMatch(/openmig-mailproof-\$\{BALANCE_TAG\}@example\.invalid/);
    expect(
      smoke,
      'the control creates the share but never asserts the mail ARRIVED —\n' +
        'sending is the target’s claim, arrival is the catcher’s evidence.',
    ).toMatch(/query=\$\{mailproof_addr\}[\s\S]{0,400}-ge 1/);
    const pipe = smoke.indexOf('openmig-mailproof-');
    const silence = smoke.indexOf('query=openmig-attendee-');
    expect(
      pipe >= 0 && silence >= 0 && pipe < silence,
      'the pipe control must run BEFORE the canary silence assertions: a\n' +
        'silence believed first and a broken pipe found later is a pass that\n' +
        'proved nothing, in the order a reader trusts it.',
    ).toBe(true);
  });

  it('the pipe control takes back what it made', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the mailproof share is never deleted — every run would leave one more\n' +
        'share on the demo target, a measurement changing the thing it\n' +
        'measures (the --fresh lesson, again).',
    ).toMatch(/DELETE[\s\S]{0,200}\/shares\/\$\{share_id\}/);
    expect(
      smoke,
      'the mailproof file is never deleted — same leak, DAV side.',
    ).toMatch(/-X DELETE[\s\S]{0,200}files\/\$\{TARGET_DAV_USER\}\/\$\{mailproof_file\}/);
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
  // (list what was stored, so the script's own verification stays honest);
  // ocs()'s share POST (record the fields, answer the ok envelope).
  const STUB = `#!/usr/bin/env bash
set -u
CAP="\${SEED_STUB_DIR:?}"
shift                                  # 'exec'
if [ "$1" = "-i" ]; then shift; fi
shift                                  # container name
case "$1" in
  true) exit 0 ;;
  # \`sh -c\` is how the seeder generates the large fixture and reads its
  # digest back (0120 T6). Both bodies end in \`sha256sum\`, and both callers
  # compare what they get — so a stub that stayed silent would have them
  # comparing "" to "", which passes while proving nothing. A fixed digest
  # makes the write and the read-back agree for the right reason.
  sh) case "\${2:-}" in *sha256sum*) printf '%s' "$FAKE_DIGEST" ;; esac; exit 0 ;;
  # The fixture is deleted from the container after its PUT.
  rm) exit 0 ;;
  curl) shift ;;
  *) echo "stub docker: unexpected command $1" >&2; exit 64 ;;
esac
method=""; wantscode=0; hasbody=0; url=""; fields=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -w) wantscode=1; shift 2 ;;
    --data-binary) hasbody=1; shift 2 ;;
    # curl infers PUT from --upload-file; there is no -X. The body is a path
    # INSIDE the container, so there is nothing on this side to read — the
    # stub records that the PUT happened and how big it claimed to be.
    --upload-file) method="PUT"; hasbody=2; shift 2 ;;
    --data-urlencode) fields="$fields $2"; shift 2 ;;
    -H|-u|-o) shift 2 ;;
    -sS|-s|-S) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="\${url#http://localhost/remote.php/dav/}"
case "$method" in
  PUT)
    case "$hasbody" in
      1) mkdir -p "$CAP/puts"
         cat > "$CAP/puts/$(printf '%s' "$path" | tr '/' '_')" ;;
      2) mkdir -p "$CAP/puts"
         printf 'uploaded from a container path' > "$CAP/puts/$(printf '%s' "$path" | tr '/' '_')" ;;
      *) echo "stub docker: PUT with neither --data-binary nor --upload-file" >&2; exit 64 ;;
    esac
    printf '%s\\n' "$path" >> "$CAP/manifest.txt"
    printf 201 ;;
  POST)
    printf '%s%s\\n' "$url" "$fields" >> "$CAP/ocs-posts.txt"
    printf '{"ocs":{"meta":{"status":"ok","statuscode":200}}}' ;;
  # MKCOL, for the shared folder the fold is about (2026-09-19). 201 is
  # "created"; the seeder also accepts 405 ("already there"), but a stub
  # answering 405 would be standing in for a server where a previous run had
  # left the collection behind — not the story these fixtures tell.
  MKCOL)
    printf '%s\\n' "$path" >> "$CAP/mkcols.txt"
    printf 201 ;;
  DELETE) printf 204 ;;
  PROPFIND)
    if [ "$wantscode" = 1 ]; then printf 207; else cat "$CAP/manifest.txt" 2>/dev/null || true; fi ;;
  *) echo "stub docker: unexpected method '$method'" >&2; exit 64 ;;
esac
`;

  /**
   * One digest for both `sha256sum` calls the seeder makes: the one over the
   * generated fixture and the one over what it reads back. The seeder compares
   * them and refuses a mismatch, so they have to agree here — what this stub
   * is standing in for is a file that survived the round trip, not one that
   * did not.
   */
  const FAKE_DIGEST = 'f'.repeat(64);

  function runSeed(args: string[]): { dir: string; stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), 'seedbytes-'));
    writeFileSync(join(dir, 'docker'), STUB, { mode: 0o755 });
    const stdout = execFileSync('bash', [SEED, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        SEED_STUB_DIR: dir,
        FAKE_DIGEST,
      },
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
      const ocsPosts = readFileSync(join(dir, 'ocs-posts.txt'), 'utf8');
      expect(
        ocsPosts,
        'the tagged seed no longer shares its file BY MAIL with the tag-addressed\n' +
          'outsider — the inventory then has nothing to find and the press (0104 T2)\n' +
          'has nothing to press.',
      ).toContain('shareType=4');
      expect(ocsPosts).toContain(`openmig-grantee-${tag}@example.invalid`);
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
      expect(
        existsSync(join(dir, 'ocs-posts.txt')),
        'an untagged seed created a share — the fixed fixture must stay share-free\n' +
          '(and share-by-mail from the seed would mail a CONSTANT address).',
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * THE DRAIN REACHES THE JOBS THAT CAN MAIL (workplan 0150; the owner,
 * 2026-10-04).
 *
 * The CANCEL side believed its silence after `cron.php`, and a bare
 * `cron.php` is not a drain: Nextcloud 34 stops asking for jobs once 14
 * minutes have passed. E2E (managed) #232 and #233 both stopped there, 841 s
 * in, so neither could say the queue was drained. The smoke now names the jobs
 * that can mail, runs only those for the check, makes sure each name is a job
 * that exists (a renamed one drains nothing and still exits 0), and starts the
 * rest of the queue afterwards, detached: it is also this demo's only
 * housekeeping. These run that block exactly as the script has it, with a
 * stub `docker` and `curl` that write down every call.
 */
describe('the drain reaches the jobs that can mail (0150)', () => {
  const SMOKE_TEXT = readFileSync(join(COMPOSE, 'smoke-managed.sh'), 'utf8');
  const start = SMOKE_TEXT.indexOf('NC_MAIL_JOBS=(');
  const end = SMOKE_TEXT.indexOf('\nnote "the status page"', start);
  const block = start < 0 || end < 0 ? '' : SMOKE_TEXT.slice(start, end);
  const failAt = (() => {
    const s = SMOKE_TEXT.indexOf('fail_at() {');
    const e = SMOKE_TEXT.indexOf('\n}\n', s);
    if (s < 0 || e < 0) throw new Error('fail_at() is no longer defined in smoke-managed.sh');
    return SMOKE_TEXT.slice(s, e + 3);
  })();

  /** The five Nextcloud 34 jobs that can send mail, as the smoke must name them. */
  const MAIL_JOBS = [
    'OCA\\DAV\\BackgroundJob\\EventReminderJob',
    'OCA\\Activity\\BackgroundJob\\EmailNotification',
    'OCA\\Activity\\BackgroundJob\\DigestMail',
    'OCA\\Notifications\\BackgroundJob\\SendNotificationMails',
    'OCA\\Files_Sharing\\SharesReminderJob',
  ];

  // Answers the three ways the block calls docker: occ's job listing (one
  // job, or `[]` for a name in MISSING_JOBS), the named drain (a verbose
  // "Starting job" per name not in NOT_DUE, then CRON_EXIT), and the detached
  // full run (DETACH_EXIT). Every call, docker's and curl's, goes to one log in
  // the order made, so the order is asserted and not assumed.
  const DOCKER = `#!/usr/bin/env bash
set -u
{ printf 'docker'; printf ' [%s]' "$@"; printf '\\n'; } >> "\${DRAIN_STUB_DIR:?}/calls.log"
[ "$1" = exec ] || { echo "stub docker: unexpected $1" >&2; exit 64; }
shift
detached=0
while [ $# -gt 0 ]; do
  case "$1" in
    -d) detached=1; shift ;;
    -u) shift 2 ;;
    *) break ;;
  esac
done
shift                                  # the container
if [ "$detached" = 1 ]; then exit "\${DETACH_EXIT:-0}"; fi
case "$*" in
  "php /var/www/html/occ background-job:list "*)
    cls="\${4#--class=}"
    case " \${MISSING_JOBS:-} " in
      *" $cls "*) echo '[]' ;;
      *) echo '[{"id":"7","class":"listed","last_run":"1970-01-01T00:00:00+00:00","argument":"null"}]' ;;
    esac ;;
  "php -f /var/www/html/cron.php -- --verbose "*)
    shift 5
    for cls in "$@"; do
      case " \${NOT_DUE:-} " in *" $cls "*) continue ;; esac
      echo "Starting job $cls (id: 7, arguments: null)"
      echo "Job $cls (id: 7, arguments: null) done in 0.00 seconds"
    done
    if [ "\${CRON_EXIT:-0}" != 0 ]; then echo "PHP Fatal error: the stub was told to fail"; exit "$CRON_EXIT"; fi ;;
  *) echo "stub docker: unexpected exec $*" >&2; exit 64 ;;
esac
`;
  const CURL = `#!/usr/bin/env bash
{ printf 'curl'; printf ' [%s]' "$@"; printf '\\n'; } >> "\${DRAIN_STUB_DIR:?}/calls.log"
printf '{"messages_count":%s}' "\${MAILPIT_COUNT:-0}"
`;

  type Run = { out: string; fail: string; reasons: string; calls: string[] };

  function drain(env: Record<string, string> = {}): Run {
    const dir = mkdtempSync(join(tmpdir(), 'maildrain-'));
    try {
      writeFileSync(join(dir, 'docker'), DOCKER, { mode: 0o755 });
      writeFileSync(join(dir, 'curl'), CURL, { mode: 0o755 });
      writeFileSync(
        join(dir, 'run.sh'),
        `set -uo pipefail\nfail=0\nSECTION=test\nFAIL_REASONS=""\n${failAt}\n${block}\n` +
          `echo "FAIL=$fail"\nprintf 'REASONS:%s' "$FAIL_REASONS"\n`,
      );
      const out = execFileSync('bash', [join(dir, 'run.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          DRAIN_STUB_DIR: dir,
          BALANCE_TAG: 'drain-t1',
          NEXTCLOUD_CONTAINER: 'nc-under-test',
          COMPOSE_PROJECT: 'unused',
          MAILPIT: 'http://mailpit.test',
          ...env,
        },
      });
      const calls = existsSync(join(dir, 'calls.log'))
        ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n')
        : [];
      return {
        out,
        fail: /FAIL=(\d)/.exec(out)?.[1] ?? '?',
        reasons: out.slice(out.indexOf('REASONS:') + 'REASONS:'.length),
        calls,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const bracketed = (...args: string[]): string => args.map((a) => ` [${a}]`).join('');
  const NAMED_DRAIN =
    'docker' +
    bracketed('exec', '-u', 'www-data', 'nc-under-test', 'php', '-f', '/var/www/html/cron.php', '--', '--verbose', ...MAIL_JOBS);
  const FULL_DETACHED =
    'docker' + bracketed('exec', '-d', '-u', 'www-data', 'nc-under-test', 'php', '-f', '/var/www/html/cron.php');

  it('is extractable — the block still exists to test', () => {
    expect(block, 'NC_MAIL_JOBS=( … up to the status page is gone from smoke-managed.sh').toMatch(
      /cron\.php[\s\S]*openmig-attendee-\$\{BALANCE_TAG\}/,
    );
  });

  it('names exactly the jobs that can mail in Nextcloud 34, each as its own word', () => {
    const run = drain();
    expect(
      run.calls,
      'the check drains the five jobs that can mail, by name, verbose, and nothing\n' +
        'else: a bare cron.php stops at 14 minutes with the queue unemptied (E2E #232, #233).',
    ).toContain(NAMED_DRAIN);
    expect(run.out).toContain('drained the jobs that can mail in ');
    expect(run.out).toContain(': 5 of 5 ran');
    expect(run.out).toContain('and nothing after the take-back either — no CANCEL fan-out');
    expect(run.fail).toBe('0');
  });

  it('asks Nextcloud that every named job exists before trusting the drain', () => {
    const run = drain();
    for (const job of MAIL_JOBS) {
      expect(run.calls).toContain(
        'docker' +
          bracketed('exec', '-u', 'www-data', 'nc-under-test', 'php', '/var/www/html/occ', 'background-job:list', `--class=${job}`, '--output=json'),
      );
    }
  });

  it('fails on a name this Nextcloud has no job for, and says which', () => {
    const missing = 'OCA\\Activity\\BackgroundJob\\DigestMail';
    const run = drain({ MISSING_JOBS: missing });
    expect(
      run.fail,
      'a renamed job drains nothing and cron.php still exits 0, so a name Nextcloud\n' +
        'does not have must fail the gate, not pass it on a drain that never ran.',
    ).toBe('1');
    expect(run.reasons).toContain(`the drain names a job this Nextcloud does not have: ${missing}`);
    expect(run.calls, 'the rest still runs, so the log shows what the drain did').toContain(NAMED_DRAIN);
  });

  it('a job whose interval has not passed is not a failure', () => {
    const run = drain({
      NOT_DUE: 'OCA\\DAV\\BackgroundJob\\EventReminderJob OCA\\Activity\\BackgroundJob\\DigestMail OCA\\Files_Sharing\\SharesReminderJob',
    });
    expect(run.out).toContain(': 2 of 5 ran');
    expect(
      run.fail,
      'Nextcloud skips a timed job whose interval has not passed since its last\n' +
        'run (JobList::getNext), named or not. That is not a broken drain.',
    ).toBe('0');
  });

  it('a drain that fails says so, with its last lines, and fails', () => {
    const run = drain({ CRON_EXIT: '255' });
    expect(run.fail).toBe('1');
    expect(run.out).toContain('the queue drain itself failed');
    expect(run.out).toContain('    PHP Fatal error: the stub was told to fail');
  });

  it('a mail to the canary after the take-back fails the check', () => {
    const run = drain({ MAILPIT_COUNT: '1' });
    expect(run.fail).toBe('1');
    expect(run.out).toContain('THE TAKE-BACK SENT MAIL: 1 message(s)');
  });

  it('drains before it searches, and starts the rest of the queue detached, after', () => {
    const run = drain({ MAILPIT_COUNT: '1' });
    const drained = run.calls.indexOf(NAMED_DRAIN);
    const searched = run.calls.findIndex((c) => c.startsWith('curl') && c.includes('query=openmig-attendee-drain-t1'));
    const rest = run.calls.indexOf(FULL_DETACHED);
    expect(drained, 'the named drain ran').toBeGreaterThanOrEqual(0);
    expect(searched, 'the catcher was searched for the canary').toBeGreaterThan(drained);
    expect(
      rest,
      'the full cron.php is this demo’s only housekeeping (the owner, 2026-10-04): it\n' +
        'runs after the check, whatever the check found, detached so the gate does not wait.',
    ).toBeGreaterThan(searched);
    expect(run.out).toContain('the rest of the demo Nextcloud');
  });

  it('a rest of the queue that cannot start fails, as a drain that could not run did', () => {
    const run = drain({ DETACH_EXIT: '1' });
    expect(run.fail).toBe('1');
    expect(run.out).toContain('could not start the rest of the demo Nextcloud');
  });

  it('stands down with no tag: no canary, so nothing to drain for', () => {
    const run = drain({ BALANCE_TAG: '' });
    expect(run.calls).toEqual([]);
    expect(run.fail).toBe('0');
  });
});
