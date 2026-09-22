// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADDRESS THAT WAS NOT AN EXAMPLE.
 *
 * The operator asked for their NetBird peer address to come out of
 * `managed.env.example`. It was in `managed.env.example`. It was also in
 * `managed.yml`, in `bootstrap-managed.sh`, in four `docs/*.md` guides, in two
 * workplans, and in six test files as a fixture — thirty-two occurrences
 * across fifteen files, and **this repository is public**.
 *
 * NOBODY PUT IT THERE ON PURPOSE. Each one arrived the same honest way: a
 * setting was proven on the box, and the line that proved it was pasted into
 * the file that documents it. That is how a worked example should be written.
 * The address just came along, and the next writer copied the example rather
 * than the shape, so one paste became fifteen files over four months.
 *
 * WHAT IT COSTS, stated plainly so this is not theatre. A `100.64.0.0/10`
 * address routes nowhere off the mesh — you cannot reach the box with it, and
 * nothing here is a credential. What it does publish is mesh topology tied to
 * a named person: which of their machines is which, and a stable identifier to
 * correlate against everything else they write. That is the operator's to give
 * away, not this repository's, and they did not.
 *
 * THE SECOND COST IS DOCUMENTATION. An address that is real for exactly one
 * reader is worse than a placeholder for all the others: `MAILPIT_BIND=` on
 * someone else's box, copied faithfully from the guide, binds to nothing and
 * fails with a message about Mailpit. The guides now say the shape and say it
 * is a shape.
 *
 * SO THE RULE IS THE RANGE, NOT THE ADDRESS. Both meshes anybody here runs —
 * NetBird, Tailscale — allocate peers out of `100.64.0.0/10`, so a literal in
 * that range is either the documented placeholder or somebody's actual box,
 * and there is no third case. Keying on the range rather than on the one
 * address that got cleaned up is the whole point: the next box the operator
 * builds gets a different address, and a guard that only knew the old one
 * would watch it arrive.
 *
 * RUN IT AGAINST THE INDEX, NOT YOUR WORKING COPY. `git grep` reads TRACKED
 * files, so while this guard was still untracked it swept everything except
 * itself and went green on a machine where CI would go red — which is exactly
 * what happened on its own first pull request. A guard that sweeps what git
 * knows about has to be `git add`ed before its local run means anything.
 *
 * A KNOWN GAP, so its absence is not read as coverage. The sweep includes
 * `docs/workplans/**` and `docs/adr/**`, but CI's changed-file filter
 * deliberately does not select them — a prose-only pull request skips the
 * suite, by a decision recorded in `ci.yml`. An address that lands in a
 * workplan is therefore caught at the next change that touches code, not at
 * its own. Late is not never, and widening the filter to close it would buy a
 * nine-minute test run for every prose commit.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * This file, as git spells it. It is the one place in the repository that
 * holds in-range addresses on purpose — the fixtures below that prove the rule
 * is not vacuous are, by construction, exactly what the rule forbids — so it
 * is excluded from its own sweep. `a-count-in-a-sentence-the-table-outgrew`
 * makes the same trade for the same reason, and it costs the same thing: an
 * address hidden in THIS file would not be caught. Derived rather than typed
 * so a rename cannot quietly empty the exclusion and re-break the build.
 */
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

/**
 * The one address this repository may print: the first of the range, which
 * reaches nothing and reads as an exemplar rather than as somebody's box.
 */
export const PLACEHOLDER = '100.64.0.1';

/** `100.64.0.0/10` — what NetBird and Tailscale hand a peer. */
export const MESH =
  /\b100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(?:[0-9]{1,3})\.(?:[0-9]{1,3})\b/g;

export interface Sighting {
  readonly file: string;
  readonly line: number;
  readonly address: string;
}

/** `git grep` output (`file:line:text`) reduced to the addresses that break the rule. */
export function sightings(grepOutput: string): Sighting[] {
  const found: Sighting[] = [];
  for (const row of grepOutput.split('\n').filter(Boolean)) {
    // A path may not contain `:` here, and the line number is digits, so the
    // first two colons split it unambiguously.
    const m = /^([^:]+):(\d+):(.*)$/.exec(row);
    if (!m) continue;
    const text = m[3]!;
    MESH.lastIndex = 0;
    for (const hit of text.matchAll(MESH)) {
      if (hit[0] === PLACEHOLDER) continue;
      // `100.64.0.0/10` NAMES the range. Prose that explains the rule has to
      // be able to write the rule down, and a CIDR is nobody's peer.
      if (/^\/\d/.test(text.slice(hit.index + hit[0].length))) continue;
      found.push({ file: m[1]!, line: Number(m[2]), address: hit[0]! });
    }
  }
  return found;
}

/**
 * Every tracked line carrying something in the range. `-I` drops binaries,
 * `--no-index`-free so ignored and untracked files stay out: a build artifact
 * under `dist-selfhost/` is nobody's publication.
 */
function trackedMeshLines(): string {
  try {
    return execFileSync(
      'git',
      [
        'grep',
        '-I',
        '-n',
        '-E',
        '(^|[^0-9.])100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.',
        '--',
        `:!${SELF}`,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch (e) {
    // `git grep` exits 1 for "no matches", which is the passing case.
    const status = (e as { status?: number }).status;
    if (status === 1) return '';
    throw e;
  }
}

describe('an address that was not an example', () => {
  it('publishes no mesh address but the documented placeholder', () => {
    const wrong = sightings(trackedMeshLines());
    const named = wrong.map((w) => `${w.file}:${w.line} — ${w.address}`).join('\n  ');
    expect(
      wrong,
      wrong.length === 0
        ? ''
        : `A 100.64.0.0/10 address that is not the placeholder \`${PLACEHOLDER}\`:\n  ${named}\n\n` +
            'That range is what NetBird and Tailscale give a peer, so this is somebody\'s\n' +
            'actual machine, and this repository is public. Write the shape instead: use\n' +
            `\`${PLACEHOLDER}\` and say in the surrounding prose that it is an example.`,
    ).toEqual([]);
  });

  it('recognises an address in the range, so the rule is not vacuous', () => {
    // Without this, a regex that matched nothing would pass the sweep above
    // and protect nothing at all. Both ends of the range, and the middle.
    for (const real of ['100.64.9.2', '100.97.1.4', '100.127.255.254']) {
      expect(sightings(`docs/x.md:1:reach it at ${real} from the mesh`), real).toHaveLength(1);
    }
  });

  it('leaves the placeholder, and addresses outside the range, alone', () => {
    for (const fine of [
      `deploy/compose/managed.env.example:137:#   MAILPIT_BIND=${PLACEHOLDER}`,
      'docs/x.md:1:the container answers on 127.0.0.1:3127',
      'docs/x.md:2:a LAN box at 192.168.1.10 and a VPC at 10.0.0.4',
      // 100.63.x and 100.128.x are OUTSIDE 100.64.0.0/10 — public space, and
      // not ours to police.
      'docs/x.md:3:100.63.0.1 and 100.128.0.1 are not mesh addresses',
      // Naming the range is how the rule gets explained.
      'docs/x.md:4:both meshes allocate out of 100.64.0.0/10',
    ]) {
      expect(sightings(fine), fine).toEqual([]);
    }
  });

  it('excludes itself, and only itself, from the sweep', () => {
    // The exclusion is the one hole in the rule, so it is asserted rather than
    // left to a reader to confirm: a second path added here silently would be
    // a place to hide an address.
    expect(SELF).toBe('scripts/an-address-that-was-not-an-example.unit.test.ts');
  });

  it('names every address on a line, not just the first', () => {
    const both = sightings('docs/x.md:7:NEXTCLOUD_TRUSTED_DOMAINS="100.70.0.2 100.80.0.3"');
    expect(both.map((s) => s.address)).toEqual(['100.70.0.2', '100.80.0.3']);
  });
});
