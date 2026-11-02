// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLICKHOUSE WITHOUT THE FILES ITS PIN NEEDS (workplan 0119 §3 item 9,
 * option 2; the review of 2026-11-02).
 *
 * `deploy/compose/managed.yml` pins ClickHouse 26.8.36.3-lts, ahead of the
 * 26.2.19.43 Trigger.dev v4.8.3 pins, for CVE-2026-116366. 26.8 changed
 * defaults Trigger.dev's schema and writes meet, and two files mounted with
 * the pin put 26.2's back:
 *
 *  - `clickhouse-merge-tree.xml`, into `config.d`, sets
 *    `allow_dimensions_outside_sorting_key` to 1. The setting is new in 26.7,
 *    off by default, and with it off an `AggregatingMergeTree` with a column
 *    outside its `ORDER BY` is refused at `CREATE` (BAD_ARGUMENTS).
 *    Trigger.dev's migration 022 (`errors_v1`) has three, so on an empty
 *    volume goose stops there and `trigger-api`, whose entrypoint runs it
 *    under `set -e`, crash-loops: the v4.5.12 failure
 *    (`docs/managed-bring-up.md`, *Upgrading Trigger.dev*) from the other
 *    side. The same file sets `auto_statistics_types` empty, so no part gets
 *    the column statistics 26.4 started writing by default.
 *  - `clickhouse-users-profile.xml`, into `users.d` as that one file, keeps
 *    26.2's date parsing on insert in the default profile:
 *    `date_time_input_format` and `cast_string_to_date_time_mode` `basic`
 *    (best_effort from 26.5) and
 *    `input_format_read_datetime_number_as_raw_value` 1 (new in 26.8).
 *
 * THE REVIEW DELETED BOTH MOUNTS, AND EVERY CLICKHOUSE TEST PASSED: fifteen
 * files, 1,030 tests. Nothing held the files to the pin, and nothing runs
 * the empty-volume migration in CI. The reverse had no check either: a 26.2
 * or 26.3 server does not start with `clickhouse-merge-tree.xml` mounted (an
 * unknown key under `<merge_tree>` is UNKNOWN_SETTING at startup), and moving
 * the pin back is how the way back is taken.
 *
 * So the files travel with the pin, read from `managed.yml` and the files it
 * mounts. For the line the `clickhouse` service pins:
 *
 *  - from 26.4, a file mounted into `config.d` or `conf.d` sets
 *    `<merge_tree><auto_statistics_types>` empty;
 *  - from 26.7, one sets `<merge_tree><allow_dimensions_outside_sorting_key>`
 *    to 1, and before 26.7 none names it;
 *  - from 26.5, a file mounted into `users.d` sets `date_time_input_format`
 *    and `cast_string_to_date_time_mode` to `basic` under
 *    `<profiles><default>`;
 *  - from 26.8, one sets `input_format_read_datetime_number_as_raw_value` to 1
 *    there, and before 26.8 none names it.
 *
 * Each key is set by exactly one file, in XML (a second file would leave the
 * answer to the merge order), and outside a comment. `users.d` is mounted a
 * file at a time, never as the directory: the image's entrypoint writes
 * `users.d/default-user.xml` at every start. A file this cannot read (a
 * named volume, a `${VAR}` path, a whole directory into `config.d`) is a
 * problem rather than something skipped.
 *
 * WHAT THIS DOES NOT HOLD: that 26.8.36.3 creates the schema with the files,
 * or stops at 022 without them. That is a run, owed before the merge (0119
 * §3 item 9); this holds the files to the pin once that run has said so.
 * Each rule is broken on purpose below, on a copy, and must fail.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';
const managedYml = readFileSync(join(REPO_ROOT, MANAGED), 'utf8');

/** The directories ClickHouse merges over `config.xml`, and the one it merges over `users.xml`. */
const CONFIG_DIRS = ['/etc/clickhouse-server/config.d', '/etc/clickhouse-server/conf.d'] as const;
const USERS_DIR = '/etc/clickhouse-server/users.d';

type Where = 'merge_tree' | 'profile';
interface Rule {
  /** The first ClickHouse line, [major, minor], whose default this puts back. */
  readonly from: readonly [number, number];
  readonly where: Where;
  readonly key: string;
  /** The value 26.2 behaves as. */
  readonly value: string;
  /** The key is new at `from`: an older server does not know it, so it must not be set there. */
  readonly newAtFrom?: true;
  readonly why: string;
}

/** What travels with the pin, and from which line (0119 §3 item 9; SettingsChangesHistory.cpp at v26.8.34.13-lts). */
export const TRAVELS_WITH_THE_PIN: readonly Rule[] = Object.freeze([
  {
    from: [26, 4],
    where: 'merge_tree',
    key: 'auto_statistics_types',
    value: '',
    why: 'from 26.4 every new part gets column statistics that 26.2 and 26.3 do not read and Trigger.dev v4.8.3 never ran with',
  },
  {
    from: [26, 7],
    where: 'merge_tree',
    key: 'allow_dimensions_outside_sorting_key',
    value: '1',
    newAtFrom: true,
    why: "from 26.7 migration 022's errors_v1 is refused at CREATE, so an empty volume stops at 022 and trigger-api crash-loops",
  },
  {
    from: [26, 5],
    where: 'profile',
    key: 'date_time_input_format',
    value: 'basic',
    why: 'from 26.5 a JSON string that looks like a date is stored as a DateTime64, not a String (metrics_v1.attributes)',
  },
  {
    from: [26, 5],
    where: 'profile',
    key: 'cast_string_to_date_time_mode',
    value: 'basic',
    why: 'best_effort from 26.5, with date_time_input_format',
  },
  {
    from: [26, 8],
    where: 'profile',
    key: 'input_format_read_datetime_number_as_raw_value',
    value: '1',
    newAtFrom: true,
    why: "from 26.8 a bare number for a DateTime64 is read as seconds, and Trigger.dev's replication sends milliseconds",
  },
]);

interface Mounted {
  /** Where it is in the checkout, from the repository root. */
  readonly path: string;
  readonly text: string;
  readonly into: 'config' | 'users';
}

/** Reads a file of the checkout by its path from the repository root; undefined when it is not a regular file. */
export type Reader = (path: string) => string | undefined;

export const readFromCheckout: Reader = (path) => {
  const abs = join(REPO_ROOT, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) return undefined;
  return readFileSync(abs, 'utf8');
};

const lineOf = (tag: string): [number, number] | undefined => {
  const m = /^(\d+)\.(\d+)\./.exec(tag);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};
const atLeast = (line: readonly [number, number], from: readonly [number, number]): boolean =>
  line[0] !== from[0] ? line[0] > from[0] : line[1] >= from[1];

/** A short-form mount split at its colons, a `${VAR:-default}` kept whole. */
function splitMount(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '$' && s[i + 1] === '{') {
      depth++;
      current += '${';
      i++;
    } else if (c === '}' && depth > 0) {
      depth--;
      current += c;
    } else if (c === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts;
}

/** A mount's source and target, from Compose's short or long form. */
function mountsOf(volumes: unknown): Array<{ source: string; target: string }> {
  if (!Array.isArray(volumes)) return [];
  return volumes.map((v) => {
    if (v && typeof v === 'object') {
      const o = v as { source?: unknown; target?: unknown };
      return { source: String(o.source ?? ''), target: String(o.target ?? '') };
    }
    const [source = '', target = ''] = splitMount(String(v));
    return { source, target };
  });
}

/** The values a set of files gives one key, comments removed: under `<merge_tree>`, or under `<profiles><default>`. */
export function valuesOf(files: readonly Mounted[], where: Where, key: string): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  const keyRe = new RegExp(`<${key}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${key}>)`, 'g');
  for (const f of files) {
    if (f.into !== (where === 'merge_tree' ? 'config' : 'users')) continue;
    const bare = f.text.replace(/<!--[\s\S]*?-->/g, '');
    const blocks =
      where === 'merge_tree'
        ? [...bare.matchAll(/<merge_tree(?:\s[^>]*)?>([\s\S]*?)<\/merge_tree>/g)].map((m) => m[1]!)
        : [...bare.matchAll(/<profiles(?:\s[^>]*)?>([\s\S]*?)<\/profiles>/g)].flatMap((p) =>
            [...p[1]!.matchAll(/<default(?:\s[^>]*)?>([\s\S]*?)<\/default>/g)].map((m) => m[1]!),
          );
    for (const block of blocks) {
      for (const m of block.matchAll(keyRe)) out.push({ path: f.path, value: (m[1] ?? '').trim() });
    }
  }
  return out;
}

/** What is wrong between the ClickHouse pin of a managed.yml and the files it mounts; empty when nothing is. */
export function filesForThePinProblems(composeText: string, read: Reader = readFromCheckout, composeFile = MANAGED): string[] {
  const compose = parseYaml(composeText) as { services?: Record<string, { image?: string; volumes?: unknown } | null> } | null;
  const svc = compose?.services?.clickhouse;
  if (!svc) return [`${composeFile} has no clickhouse service`];
  const tag = /^clickhouse\/clickhouse-server:([^@\s]+)/.exec(svc.image ?? '')?.[1];
  const line = tag === undefined ? undefined : lineOf(tag);
  if (tag === undefined || line === undefined) {
    return [`the clickhouse service's image is ${svc.image ?? 'missing'}, not clickhouse/clickhouse-server:<major>.<minor>.…, so its line cannot be read`];
  }

  const problems: string[] = [];
  const files: Mounted[] = [];
  for (const { source, target: raw } of mountsOf(svc.volumes)) {
    const target = raw.replace(/\/+$/, '');
    if (USERS_DIR === target || USERS_DIR.startsWith(`${target}/`)) {
      problems.push(
        `${source} is mounted over ${target}, which holds users.d: mount the profile as one file, ` +
          "never the directory, since the image's entrypoint writes users.d/default-user.xml at every start",
      );
      continue;
    }
    const configDir = CONFIG_DIRS.find((d) => target === d || target.startsWith(`${d}/`) || d.startsWith(`${target}/`));
    const into = configDir !== undefined ? 'config' : target.startsWith(`${USERS_DIR}/`) ? 'users' : undefined;
    if (into === undefined) continue;
    if (into === 'config' && target !== configDir && !target.startsWith(`${configDir}/`)) {
      problems.push(`${source} is mounted over ${target}, which holds ${configDir}: this reads the files mounted into it, one at a time`);
      continue;
    }
    if (into === 'config' && target === configDir) {
      problems.push(`${source} is mounted as the whole of ${configDir}: mount each file into it, so this can read what ClickHouse merges`);
      continue;
    }
    const slash = target.lastIndexOf('/');
    const name = target.slice(slash + 1);
    // A file in a subdirectory, or a name ClickHouse skips, is nothing it merges
    // (getConfigMergeFiles: .xml, .conf, .yaml or .yml, and no leading dot).
    if (target.slice(0, slash) !== (into === 'config' ? configDir : USERS_DIR)) continue;
    if (!/\.(xml|conf|ya?ml)$/i.test(name) || name.startsWith('.')) continue;
    if (!/^\.\.?\//.test(source) || source.includes('$')) {
      problems.push(`${source}:${raw} is not a path beside the compose file, so this cannot read what ClickHouse merges from it`);
      continue;
    }
    const path = normalize(join(dirname(composeFile), source));
    const text = read(path);
    if (text === undefined) {
      problems.push(`${path} is mounted into ${into === 'config' ? configDir : USERS_DIR} and is not a file in the checkout`);
      continue;
    }
    if (/\.ya?ml$/i.test(name)) {
      const named = TRAVELS_WITH_THE_PIN.filter((r) => new RegExp(`\\b${r.key}\\b`).test(text.replace(/#.*$/gm, '')));
      if (named.length > 0) problems.push(`${path} names ${named.map((r) => r.key).join(', ')} in YAML; say it in XML, where this reads it`);
      continue;
    }
    files.push({ path, text, into });
  }

  const shown = `${line[0]}.${line[1]}`;
  for (const rule of TRAVELS_WITH_THE_PIN) {
    const found = valuesOf(files, rule.where, rule.key);
    const place = rule.where === 'merge_tree' ? `<merge_tree> of a file in config.d` : `<profiles><default> of a file in users.d`;
    const from = `${rule.from[0]}.${rule.from[1]}`;
    if (atLeast(line, rule.from)) {
      if (found.length === 0) {
        problems.push(`the pin is ${tag} (${shown}), and no ${place} sets ${rule.key} to "${rule.value}": ${rule.why}`);
      } else if (found.length > 1) {
        problems.push(`${found.map((f) => f.path).join(' and ')} each set ${rule.key}; one file says it, so the merge order cannot decide it`);
      } else if (found[0]!.value !== rule.value) {
        problems.push(`${found[0]!.path} sets ${rule.key} to "${found[0]!.value}"; with the pin at ${tag} it must be "${rule.value}": ${rule.why}`);
      }
    } else if (rule.newAtFrom && found.length > 0) {
      problems.push(
        `the pin is ${tag} (${shown}), older than ${from}, and ${found.map((f) => f.path).join(' and ')} sets ${rule.key}, ` +
          `which ${from} introduced: an older server does not know it` +
          (rule.where === 'merge_tree' ? ' and does not start (UNKNOWN_SETTING under <merge_tree>)' : '') +
          ', so the file moves back with the pin',
      );
    }
  }
  return problems;
}

/** A reader over the checkout with some files replaced (a string) or taken away (null). */
const overlay =
  (changes: Record<string, string | null>): Reader =>
  (path) =>
    path in changes ? (changes[path] ?? undefined) : readFromCheckout(path);

const MERGE_TREE_MOUNT = '      - ./clickhouse-merge-tree.xml:/etc/clickhouse-server/config.d/merge-tree.xml:ro\n';
const PROFILE_MOUNT = '      - ./clickhouse-users-profile.xml:/etc/clickhouse-server/users.d/profile.xml:ro\n';
const MERGE_TREE = 'deploy/compose/clickhouse-merge-tree.xml';
const PROFILE = 'deploy/compose/clickhouse-users-profile.xml';

/** managed.yml with each [from, to] replaced, failing when one is not there (a mutation that changes nothing proves nothing). */
function mutate(...edits: Array<[string, string]>): string {
  let yml = managedYml;
  for (const [from, to] of edits) {
    expect(yml.includes(from), `managed.yml no longer contains ${JSON.stringify(from)}; rewrite this case for its new shape`).toBe(true);
    yml = yml.replace(from, to);
  }
  return yml;
}
const pinnedRef = /clickhouse\/clickhouse-server:[0-9.]+@sha256:[0-9a-f]{64}/.exec(managedYml)?.[0] ?? 'the pin is not where this looks';
const repinned = (tag: string): [string, string] => [pinnedRef, `clickhouse/clickhouse-server:${tag}@sha256:${'0'.repeat(64)}`];

describe("managed.yml's ClickHouse pin and the files that travel with it", () => {
  it('reads the pin, and holds for the files the checkout has', () => {
    expect(pinnedRef).toMatch(/^clickhouse\/clickhouse-server:26\.8\./);
    expect(filesForThePinProblems(managedYml)).toEqual([]);
  });

  it('reads each value the two files give, and nothing from a comment', () => {
    const merged = [
      { path: MERGE_TREE, text: readFromCheckout(MERGE_TREE)!, into: 'config' as const },
      { path: PROFILE, text: readFromCheckout(PROFILE)!, into: 'users' as const },
    ];
    for (const rule of TRAVELS_WITH_THE_PIN) {
      expect(valuesOf(merged, rule.where, rule.key), rule.key).toEqual([{ path: rule.where === 'merge_tree' ? MERGE_TREE : PROFILE, value: rule.value }]);
    }
    // Both files say every key's name in their comments too; none of that is read.
    expect(readFromCheckout(MERGE_TREE)).toMatch(/<!--[\s\S]*allow_dimensions_outside_sorting_key[\s\S]*-->/);
    expect(valuesOf([{ path: 'x.xml', text: '<!-- <merge_tree><auto_statistics_types></auto_statistics_types></merge_tree> -->', into: 'config' }], 'merge_tree', 'auto_statistics_types')).toEqual([]);
    expect(valuesOf([{ path: 'x.xml', text: '<clickhouse><merge_tree><auto_statistics_types/></merge_tree></clickhouse>', into: 'config' }], 'merge_tree', 'auto_statistics_types')).toEqual([{ path: 'x.xml', value: '' }]);
  });

  describe('fails when the 26.8 pin goes without them', () => {
    it('without clickhouse-merge-tree.xml: the empty volume stops at 022, and statistics are written', () => {
      const p = filesForThePinProblems(mutate([MERGE_TREE_MOUNT, '']));
      expect(p).toHaveLength(2);
      expect(p.join('\n')).toMatch(/allow_dimensions_outside_sorting_key[\s\S]*022/);
      expect(p.join('\n')).toMatch(/auto_statistics_types/);
    });

    it("without clickhouse-users-profile.xml: 26.8's date parsing on insert", () => {
      const p = filesForThePinProblems(mutate([PROFILE_MOUNT, '']));
      expect(p).toHaveLength(3);
      for (const key of ['date_time_input_format', 'cast_string_to_date_time_mode', 'input_format_read_datetime_number_as_raw_value']) {
        expect(p.join('\n')).toContain(key);
      }
    });

    it('without either: the review that deleted both mounts', () => {
      expect(filesForThePinProblems(mutate([MERGE_TREE_MOUNT, ''], [PROFILE_MOUNT, '']))).toHaveLength(5);
    });

    it('with a file mounted that is not in the checkout', () => {
      expect(filesForThePinProblems(managedYml, overlay({ [MERGE_TREE]: null })).join('\n')).toMatch(/clickhouse-merge-tree\.xml is mounted into \/etc\/clickhouse-server\/config\.d and is not a file/);
    });

    it('with a value other than 26.2 behaves as', () => {
      const text = readFromCheckout(MERGE_TREE)!;
      const zero = text.replace('<allow_dimensions_outside_sorting_key>1<', '<allow_dimensions_outside_sorting_key>0<');
      const stats = text.replace('<auto_statistics_types></auto_statistics_types>', '<auto_statistics_types>basic</auto_statistics_types>');
      expect(zero).not.toBe(text);
      expect(stats).not.toBe(text);
      expect(filesForThePinProblems(managedYml, overlay({ [MERGE_TREE]: zero }))).toEqual([expect.stringMatching(/sets allow_dimensions_outside_sorting_key to "0"/)]);
      expect(filesForThePinProblems(managedYml, overlay({ [MERGE_TREE]: stats }))).toEqual([expect.stringMatching(/sets auto_statistics_types to "basic"/)]);
      const profile = readFromCheckout(PROFILE)!;
      const best = profile.replace('<date_time_input_format>basic<', '<date_time_input_format>best_effort<');
      expect(best).not.toBe(profile);
      expect(filesForThePinProblems(managedYml, overlay({ [PROFILE]: best }))).toEqual([expect.stringMatching(/date_time_input_format to "best_effort"/)]);
    });

    it('with the settings left only in a comment, or under a profile other than default', () => {
      const text = readFromCheckout(MERGE_TREE)!;
      // The header names <merge_tree> in prose too, so the block is the last one.
      const at = text.lastIndexOf('<merge_tree>');
      const end = text.lastIndexOf('</merge_tree>') + '</merge_tree>'.length;
      const commented = `${text.slice(0, at)}<!-- ${text.slice(at, end)} -->${text.slice(end)}`;
      expect(at).toBeGreaterThan(text.lastIndexOf('-->'));
      expect(filesForThePinProblems(managedYml, overlay({ [MERGE_TREE]: commented }))).toHaveLength(2);
      const profile = readFromCheckout(PROFILE)!;
      const readonly = profile.replace(/<(\/?)default>/g, '<$1readonly>');
      expect(readonly).not.toBe(profile);
      expect(filesForThePinProblems(managedYml, overlay({ [PROFILE]: readonly }))).toHaveLength(3);
    });

    it('with each file mounted into the other directory', () => {
      const swapped = mutate(
        [MERGE_TREE_MOUNT, MERGE_TREE_MOUNT.replace('/config.d/', '/users.d/')],
        [PROFILE_MOUNT, PROFILE_MOUNT.replace('/users.d/', '/config.d/')],
      );
      expect(filesForThePinProblems(swapped)).toHaveLength(5);
    });

    it('with a second file setting the same key, so the merge order would decide', () => {
      const yml = mutate([MERGE_TREE_MOUNT, `${MERGE_TREE_MOUNT}${MERGE_TREE_MOUNT.replace('merge-tree.xml:ro', 'zz-merge-tree.xml:ro')}`]);
      const p = filesForThePinProblems(yml);
      expect(p).toHaveLength(2);
      expect(p.every((s) => /each set/.test(s))).toBe(true);
    });

    it('with users.d mounted as a directory, which the entrypoint writes into', () => {
      const yml = mutate([PROFILE_MOUNT, '      - ./clickhouse-users.d:/etc/clickhouse-server/users.d:ro\n']);
      const p = filesForThePinProblems(yml);
      expect(p[0]).toMatch(/mounted over \/etc\/clickhouse-server\/users\.d[\s\S]*never the directory/);
      expect(p).toHaveLength(4);
    });

    it('with a mount it cannot read, rather than reading past it', () => {
      expect(filesForThePinProblems(mutate([MERGE_TREE_MOUNT, '      - chconf:/etc/clickhouse-server/config.d/merge-tree.xml:ro\n'])).join('\n')).toMatch(/not a path beside the compose file/);
      expect(filesForThePinProblems(mutate([MERGE_TREE_MOUNT, '      - ${CH_MT:-./clickhouse-merge-tree.xml}:/etc/clickhouse-server/config.d/merge-tree.xml:ro\n'])).join('\n')).toMatch(/not a path beside the compose file/);
      expect(filesForThePinProblems(mutate([MERGE_TREE_MOUNT, '      - ./chconf:/etc/clickhouse-server/config.d:ro\n'])).join('\n')).toMatch(/whole of \/etc\/clickhouse-server\/config\.d/);
    });
  });

  describe('fails when the pin moves back with the files still mounted', () => {
    it('to 26.2.19.43, which does not start on a <merge_tree> key it does not know', () => {
      const p = filesForThePinProblems(mutate(repinned('26.2.19.43')));
      expect(p).toHaveLength(2);
      expect(p.join('\n')).toMatch(/allow_dimensions_outside_sorting_key, which 26\.7 introduced[\s\S]*does not start/);
      expect(p.join('\n')).toMatch(/input_format_read_datetime_number_as_raw_value, which 26\.8 introduced/);
    });

    it('to 26.3.62.3, option 1, the same', () => {
      expect(filesForThePinProblems(mutate(repinned('26.3.62.3')))).toHaveLength(2);
    });

    it('to 26.7, which knows the MergeTree key and not the 26.8 profile one', () => {
      const p = filesForThePinProblems(mutate(repinned('26.7.37.6')));
      expect(p).toEqual([expect.stringMatching(/input_format_read_datetime_number_as_raw_value, which 26\.8 introduced/)]);
    });
  });

  it('holds for 26.2.19.43 with neither file mounted: the way back, as main had it', () => {
    expect(filesForThePinProblems(mutate(repinned('26.2.19.43'), [MERGE_TREE_MOUNT, ''], [PROFILE_MOUNT, '']))).toEqual([]);
  });

  it('holds for a newer line with the same files: nothing here names a ceiling', () => {
    expect(filesForThePinProblems(mutate(repinned('26.10.3.7')))).toEqual([]);
    expect(filesForThePinProblems(mutate(repinned('27.1.1.1')))).toEqual([]);
  });
});
