// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The API image carried the whole development tree, and ran none of it.
 *
 * `apps/api/Dockerfile` ran `pnpm install --frozen-lockfile --filter
 * @openmig/api...` in a build stage and copied that stage's `/app` into the
 * runtime stage. The filter follows WORKSPACE dependencies, not the dependency
 * kind, so every devDependency of the API, of its workspace packages and of the
 * workspace root went into the image: drizzle-kit and its esbuild 0.25.12,
 * TypeScript 7's native compiler, vitest, eslint, testcontainers. Nothing runs
 * them there. CMD is `node apps/api/src/index.ts`, Node erases the types
 * itself (`runs-without-a-transpiler`), the HEALTHCHECK and the smoke gate's
 * `docker exec … node -e` probes use Node's own `fetch`, and the operator
 * scripts and the demo seed run on the HOST, from the checkout
 * (`deploy/compose/operator.sh`, `deploy/compose/seed-managed.sh`). The
 * migrations are the API's own start-up code. But the image scan counts what
 * is there: on 2026-10-23 the `edge` image had 3 critical and 125 high
 * findings, its base `node:24.22.1-slim` 1 and 60, and the rest were Go
 * binaries inside node_modules, esbuild's (built with Go 1.23.12, counted
 * twice: `esbuild/bin` and `@esbuild/linux-*`) and
 * `@typescript/typescript-linux-*`'s (Go 1.26.4).
 *
 * The runtime stage now installs `--prod`, selected with `--filter-prod`. Two
 * things have to hold for that, and this file holds both.
 *
 * ## 1. No stage the runtime takes files from installed devDependencies
 *
 * Read from the Dockerfile's stages: the runtime stage, every stage it is
 * built FROM, and every stage it copies from (`COPY --from`), transitively,
 * may run a package install only with `--prod`, and something among them
 * must install. A `COPY --from=build /app /app` out of a full install is
 * exactly the defect, and it reads like an ordinary multi-stage build.
 *
 * And an install among them that selects with a filter selects along
 * production edges: `--filter-prod x...`, not `--filter x...`. pnpm's `...`
 * under `--filter` follows every workspace edge, devDependencies included,
 * and `--prod` then installs each selected package's own production
 * dependencies. `@openmig/core` lists four workspace packages among its
 * devDependencies and `@openmig/ledger` one; they are in the production
 * closure anyway, so on 2026-10-25 both filters selected the same 9 of 14
 * projects and the same 250 packages. But with `@openmig/testing` added as a
 * devDependency of core, `--filter @openmig/api...` selected it and
 * `--filter-prod` did not: that is a test's dependencies in the image, past a
 * `--prod` that reads as if it kept them out.
 *
 * `pnpm deploy --prod` is the other way pnpm 11 documents, and it does not work
 * here: it copies each workspace package INTO node_modules (as a `file:`
 * dependency), and Node refuses to strip the types of a file under a
 * node_modules path. Measured on 2026-10-23, the deployed tree's first import
 * failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on
 * `node_modules/.pnpm/@openmig+ledger@file+…/src/index.ts`. A plain install
 * keeps `apps/api/node_modules/@openmig/*` as symlinks into `packages/`, whose
 * real paths are outside node_modules.
 *
 * ## 2. What the runtime loads, its package declares in `dependencies`
 *
 * `--prod` installs each package's `dependencies` and the root's, and nothing
 * else. A runtime file that loads a package its own package.json does not
 * declare there resolved, until then, through the root's devDependencies, which
 * Node finds by walking up to `/app/node_modules`. With those gone it does not
 * resolve at all, and the API dies at start: the first import of
 * `apps/api/src/index.ts` from a `--prod` install said
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'drizzle-orm' imported from
 * apps/api/src/routes/tenants/index.ts`. `apps/api` loaded drizzle-orm from 37
 * files and declared it nowhere; `packages/orchestration` loaded drizzle-orm and
 * pg the same way. Both now declare them (`catalog:`, the versions the ledger
 * already had).
 *
 * So every file in the `src` of the API and of each workspace package it
 * depends on, tests apart, is read with TypeScript's parser, and every package
 * it loads at run time — a static import or re-export that is not `import
 * type`, a dynamic `import()`, a `require()` — must be in that package's own
 * `dependencies` or `optionalDependencies`. `scripts/workspace-deps.unit.test.ts`
 * asks the same of `@openmig/*` specifiers, and accepts a devDependency, which
 * is right for a test and wrong for this image. A dynamic import of a computed
 * name cannot be read, and is refused rather than passed.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'apps/api/Dockerfile';

// ---------------------------------------------------------------- 1. stages

/** `devEdges`: the install selects with `--filter x...`, which follows devDependencies too. */
type Install = { command: string; prod: boolean; frozen: boolean; devEdges: boolean };
type Stage = { name: string; base: string; installs: Install[]; copiesFrom: string[] };

/**
 * The Dockerfile's stages, in order. Comment lines go first, as Docker drops
 * them before it joins continued lines.
 */
function readStages(text: string): Stage[] {
  const logical = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out: Stage[] = [];
  for (const line of logical) {
    const [, keyword = '', rest = ''] = /^(\S+)\s*(.*)$/.exec(line) ?? [];
    const op = keyword.toUpperCase();
    if (op === 'FROM') {
      const words = rest.split(/\s+/).filter((w) => !w.startsWith('--'));
      const as = words.findIndex((w) => w.toUpperCase() === 'AS');
      out.push({ name: as >= 0 ? words[as + 1]! : String(out.length), base: words[0]!, installs: [], copiesFrom: [] });
      continue;
    }
    const stage = out.at(-1);
    if (!stage) continue;
    if (op === 'RUN') stage.installs.push(...installsIn(rest));
    if (op === 'COPY' || op === 'ADD') {
      const from = /--from=(\S+)/.exec(rest)?.[1];
      if (from) stage.copiesFrom.push(from);
    }
  }
  return out;
}

/** The package installs one RUN line makes: pnpm install/i/deploy, npm install/i/ci. */
function installsIn(run: string): Install[] {
  const out: Install[] = [];
  for (const command of run.split(/&&|\|\||;|\|/)) {
    const words = command.trim().split(/\s+/);
    const at = words.findIndex((w) => w === 'pnpm' || w === 'npm');
    if (at < 0) continue;
    const args = words.slice(at + 1);
    const verb = args.find((w) => !w.startsWith('-') && !/^[@.\w/-]+\.\.\.$/.test(w) && !isFlagValue(args, w));
    const pnpm = words[at] === 'pnpm';
    const installs = pnpm ? ['install', 'i', 'deploy'] : ['install', 'i', 'ci'];
    if (!verb || !installs.includes(verb)) continue;
    const prod = pnpm
      ? args.includes('--prod') || args.includes('-P')
      : args.includes('--omit=dev') || args.includes('--production');
    // `x...` and `^x...` select x's dependencies: along every edge under
    // `--filter`/`-F`, along production edges only under `--filter-prod`.
    const devEdges = pnpm && filterValues(args, ['--filter', '-F']).some((value) => value.endsWith('...'));
    out.push({
      command: words.slice(at).join(' '),
      prod,
      frozen: !pnpm || args.includes('--frozen-lockfile') || verb === 'deploy',
      devEdges,
    });
  }
  return out;
}

/** `pnpm --filter x install`: `x` is the filter's value, not the sub-command. */
function isFlagValue(args: string[], word: string): boolean {
  const i = args.indexOf(word);
  return i > 0 && ['--filter', '--filter-prod', '-F', '--dir', '-C'].includes(args[i - 1]!);
}

/** The values the named flags take, as `--flag value` or `--flag=value`. */
function filterValues(args: string[], names: string[]): string[] {
  return args.flatMap((word, i) => {
    if (names.includes(word)) return args[i + 1] === undefined ? [] : [args[i + 1]!];
    const long = names.find((name) => name.startsWith('--') && word.startsWith(`${name}=`));
    return long ? [word.slice(long.length + 1)] : [];
  });
}

/**
 * What the image built from `target` would carry: the installs of every stage
 * its files come from, each with the stage it ran in.
 */
function installsBehind(stages: Stage[], target: string): Array<Install & { stage: string }> {
  const byName = new Map(stages.map((s) => [s.name, s] as const));
  stages.forEach((s, i) => byName.set(String(i), s));
  const seen = new Set<string>();
  const out: Array<Install & { stage: string }> = [];
  const visit = (name: string) => {
    const stage = byName.get(name);
    if (!stage || seen.has(stage.name)) return;
    seen.add(stage.name);
    visit(stage.base);
    for (const from of stage.copiesFrom) visit(from);
    out.push(...stage.installs.map((install) => ({ ...install, stage: stage.name })));
  };
  visit(target);
  return out;
}

/** Why an image built from the last stage would carry devDependencies, or nothing. */
function devDependencyRefusals(text: string): string[] {
  const stages = readStages(text);
  const runtime = stages.at(-1);
  if (!runtime) return ['no stage found'];
  const installs = installsBehind(stages, runtime.name);
  const refusals = installs
    .filter((i) => !i.prod)
    .map((i) => `stage "${i.stage}" installs devDependencies, and "${runtime.name}" takes its files: ${i.command}`);
  for (const i of installs.filter((x) => x.prod && !x.frozen)) {
    refusals.push(`stage "${i.stage}" installs without --frozen-lockfile, so the image is not the lockfile: ${i.command}`);
  }
  for (const i of installs.filter((x) => x.prod && x.devEdges)) {
    refusals.push(
      `stage "${i.stage}" selects with --filter, whose "..." follows devDependencies too, so a workspace package only a test reaches brings its production dependencies; select with --filter-prod: ${i.command}`,
    );
  }
  if (installs.length === 0) refusals.push(`nothing that "${runtime.name}" takes its files from installs a dependency`);
  return refusals;
}

describe('the API image carries production dependencies only', () => {
  const dockerfile = readFileSync(join(ROOT, DOCKERFILE), 'utf8');

  it('reads the stages it is about', () => {
    // Vacuity guard: a Dockerfile rewritten past this reader must fail here,
    // not pass below on an empty list.
    const stages = readStages(dockerfile);
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(stages.at(-1)!.name).toBe('runtime');
    expect(installsBehind(stages, 'runtime').length).toBeGreaterThan(0);
  });

  it('installs with --prod, --frozen-lockfile and --filter-prod in every stage the runtime takes files from', () => {
    expect(devDependencyRefusals(dockerfile), `${DOCKERFILE}: the runtime image would carry devDependencies`).toEqual([]);
  });

  it('refuses the shape main had, and the ways back to it', () => {
    const base = 'FROM node:24-slim@sha256:0 AS base\nRUN corepack enable\nWORKDIR /app\n';
    const install = (flags: string, filter = '--filter') =>
      `RUN --mount=type=cache,id=pnpm,target=/pnpm/store \\\n    pnpm install --frozen-lockfile ${flags}${filter} @openmig/api...\n`;
    const main = `${base}FROM base AS build\nCOPY . .\n${install('')}FROM base AS runtime\nCOPY --from=build /app /app\nCMD ["node", "apps/api/src/index.ts"]\n`;
    expect(devDependencyRefusals(main)).toEqual([
      'stage "build" installs devDependencies, and "runtime" takes its files: pnpm install --frozen-lockfile --filter @openmig/api...',
    ]);
    const prod = main.replace(install(''), install('--prod ', '--filter-prod'));
    expect(devDependencyRefusals(prod)).toEqual([]);
    // `--prod` alone still selects along devDependency edges.
    expect(devDependencyRefusals(main.replace(install(''), install('--prod ')))).toEqual([
      'stage "build" selects with --filter, whose "..." follows devDependencies too, so a workspace package only a test reaches brings its production dependencies; select with --filter-prod: pnpm install --frozen-lockfile --prod --filter @openmig/api...',
    ]);
    expect(installsIn('pnpm install --prod -F @openmig/api...')).toMatchObject([{ devEdges: true }]);
    expect(installsIn('pnpm install --prod --filter=^@openmig/api...')).toMatchObject([{ devEdges: true }]);
    expect(installsIn('pnpm install --prod --filter-prod=@openmig/api...')).toMatchObject([{ devEdges: false }]);
    expect(installsIn('pnpm --filter-prod @openmig/api... install --prod')).toMatchObject([{ prod: true, devEdges: false }]);
    // The package alone, without its dependencies, follows no edge.
    expect(installsIn('pnpm install --prod --filter @openmig/api')).toMatchObject([{ devEdges: false }]);
    // Built FROM the full install rather than copied out of it.
    expect(devDependencyRefusals(`${main.split('FROM base AS runtime')[0]}FROM build AS runtime\nCMD ["node"]\n`)).toHaveLength(1);
    // A prod install beside a copy out of a full one still carries the full one.
    expect(
      devDependencyRefusals(`${main.replace('FROM base AS runtime\n', `FROM base AS runtime\nCOPY . .\n${install('--prod ', '--filter-prod')}`)}`),
    ).toHaveLength(1);
    // By stage index, and through a stage in between.
    expect(devDependencyRefusals(main.replace('--from=build', '--from=1'))).toHaveLength(1);
    expect(devDependencyRefusals(main.replace('FROM base AS runtime', 'FROM build AS mid\nFROM base AS runtime').replace('--from=build', '--from=mid'))).toHaveLength(1);
    // pnpm deploy and npm count, and so does an unfrozen install.
    expect(installsIn('pnpm --filter @openmig/api deploy /out')).toMatchObject([{ prod: false }]);
    expect(installsIn('pnpm --filter=@openmig/api --prod deploy /out')).toMatchObject([{ prod: true }]);
    expect(installsIn('npm ci && npm ci --omit=dev')).toMatchObject([{ prod: false }, { prod: true }]);
    expect(devDependencyRefusals(prod.replace('--frozen-lockfile ', ''))).toHaveLength(1);
    // And an image that installs nothing is not proof of anything.
    expect(devDependencyRefusals(`${base}FROM base AS runtime\nCOPY . .\n`)).toHaveLength(1);
  });
});

// ------------------------------------------------- 2. declared where loaded

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Every workspace package, by name. */
function workspace(): Map<string, { dir: string; manifest: Manifest }> {
  const out = new Map<string, { dir: string; manifest: Manifest }>();
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(ROOT, group))) {
      const file = join(ROOT, group, entry, 'package.json');
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
      out.set(manifest.name, { dir: join(group, entry), manifest });
    }
  }
  return out;
}

/**
 * The API and every workspace package it reaches along production edges: what
 * `--filter-prod @openmig/api...` selects. pnpm's graph for it has each
 * package's `dependencies`, `optionalDependencies` and `peerDependencies`, and
 * leaves out `devDependencies`.
 */
function apiClosure(): Array<{ dir: string; manifest: Manifest }> {
  const all = workspace();
  const seen = new Map<string, { dir: string; manifest: Manifest }>();
  const visit = (name: string) => {
    const pkg = all.get(name);
    if (!pkg || seen.has(name)) return;
    seen.set(name, pkg);
    const { dependencies, optionalDependencies, peerDependencies } = pkg.manifest;
    for (const [dep, spec] of Object.entries({ ...peerDependencies, ...optionalDependencies, ...dependencies })) {
      if (spec.startsWith('workspace:')) visit(dep);
    }
  };
  visit('@openmig/api');
  return [...seen.values()];
}

const isTest = (path: string) => /\.test\.[cm]?[jt]sx?$/.test(path) || path.split('/').includes('__tests__');

function runtimeSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) runtimeSources(path, acc);
    else if (/\.[cm]?[jt]s$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !isTest(path)) acc.push(path);
  }
  return acc;
}

/** Every specifier a file loads at run time; `null` for an `import()` whose argument is not a string. */
function runtimeSpecifiers(file: string, text: string): Array<string | null> {
  const out: Array<string | null> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isImport || isRequire) out.push(first && ts.isStringLiteralLike(first) ? first.text : null);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return out;
}

const BUILTINS = new Set(builtinModules);
/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`; null for what no package.json declares. */
function packageOf(specifier: string): string | null {
  if (/^(\.|\/|#|node:)/.test(specifier)) return null;
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
  return BUILTINS.has(name) ? null : name;
}

describe('what the API image loads is declared where it is loaded', () => {
  const closure = apiClosure();

  it('walks the packages the image installs', () => {
    // Named, so a closure that stops following `workspace:` fails here.
    expect(closure.map((p) => p.manifest.name).sort()).toEqual(
      expect.arrayContaining(['@openmig/api', '@openmig/core', '@openmig/ledger', '@openmig/managed', '@openmig/orchestration']),
    );
    // And it starts where the Dockerfile's filter starts, along the edges that filter follows.
    const commands = installsBehind(readStages(readFileSync(join(ROOT, DOCKERFILE), 'utf8')), 'runtime').map((i) => i.command);
    expect(
      commands.some((command) => /--filter-prod[ =]@openmig\/api\.\.\.(\s|$)/.test(command)),
      `${DOCKERFILE}: this walks what --filter-prod @openmig/api... selects, and the image installs ${commands.join(' | ')}`,
    ).toBe(true);
  });

  for (const { dir, manifest } of closure) {
    it(`${manifest.name} declares in "dependencies" every package its runtime source loads`, () => {
      const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
      const files = runtimeSources(`${dir}/src`);
      expect(files.length, `${dir}/src has no runtime source to read`).toBeGreaterThan(0);
      const missing: string[] = [];
      for (const file of files) {
        for (const specifier of runtimeSpecifiers(file, readFileSync(join(ROOT, file), 'utf8'))) {
          if (specifier === null) {
            missing.push(`${file}: an import() of a computed name, which this cannot check`);
            continue;
          }
          const name = packageOf(specifier);
          if (name && name !== manifest.name && !declared.has(name)) missing.push(`${name} (${relative(dir, file)})`);
        }
      }
      expect(
        [...new Set(missing)],
        `${dir}/package.json: the image installs --prod, so these resolve only through another package's tree, or not at all`,
      ).toEqual([]);
    });
  }

  it('reads what a file loads, and leaves out what Node erases', () => {
    const text = [
      "import type { A } from 'erased';",
      "export type { B } from 'erased-too';",
      "import { type C, d } from 'kept';",
      "import 'side-effect';",
      "export { e } from '@scope/re-export/sub';",
      "const f = await import('lazy');",
      "const g = require('required');",
      'const h = await import(name);',
      "import { i } from './relative.ts';",
      "import { j } from 'node:fs';",
    ].join('\n');
    const specifiers = runtimeSpecifiers('x.ts', text);
    expect(specifiers).toEqual(['kept', 'side-effect', '@scope/re-export/sub', 'lazy', 'required', null, './relative.ts', 'node:fs']);
    expect(specifiers.map((s) => (s === null ? null : packageOf(s)))).toEqual([
      'kept', 'side-effect', '@scope/re-export', 'lazy', 'required', null, null, null,
    ]);
    expect(packageOf('fs/promises')).toBeNull();
  });
});
