// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL THAT LINKS ITS GUIDE (workplan 0148 T7, the second half).
 *
 * The create route, the source factories and a provider's hints said where to
 * read on by FILE NAME: *"Where each comes from is docs/box-setup.md."* That is
 * a step for somebody with the repository checked out. A customer in a browser
 * cannot open it, and since 0148 T1 those `docs/*-setup.md` files are the
 * operator documents, not the guides the app serves. Three of the names
 * (`o365-application-access.md`, `shared-mailboxes.md`, `o365-setup.md`) are
 * served nowhere at all.
 *
 * So a refusal now keeps its words, in English as written (the i18n prose
 * boundary), and carries a guide handle beside them, such as
 * `guide: 'dropbox#own-app'`: in the create route's Zod issues as `params`, in
 * a `BilingualRefusal`, and on a probe's refusal. The web app draws the link
 * from it, *Guide: {title}* / *Handleiding: {title}*, in the reader's language.
 *
 * WHAT THIS FAILS ON:
 *
 * - a string literal in `apps/api/src` or `packages/<name>/src` that names
 *   `docs/<name>.md`. Comments are not read and neither are tests: this reads
 *   the TypeScript syntax tree, and only its string and template literals. A
 *   sentence only an operator reads (a mapping file on the appliance, a worker
 *   log, the CLI, an environment variable, the operator's own page) keeps
 *   naming the operator document. It is on `ALLOWED` below, by file and by
 *   document, with the reason;
 * - an entry on `ALLOWED` that matches nothing, so the list cannot outlive
 *   its sentences;
 * - a guide handle in those sources that names a guide not served in both
 *   languages, or a section either language's guide does not have. A heading's
 *   id is its trailing `{#id}`, or else GitHub's slug, as `Docs.tsx` draws it;
 * - `SERVED_GUIDES` in shared, which the handle's type is built from, naming a
 *   different set of guides than `docs/guides/en` and `docs/guides/nl` hold.
 *
 * On origin/main (2026-10-12, 910e192e) the first case failed with 33
 * literals in 14 files that named a document and were on no list, eleven of
 * them in `routes/migrations/index.ts`; the handle cases failed with none to
 * find and no `SERVED_GUIDES`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SERVED_GUIDES } from '@openmig/shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES_A_DOCUMENT = /docs\/[A-Za-z0-9_./-]+\.md/g;
/** `slug#section`, the whole literal: how a handle is written. */
const HANDLE = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)#([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__']);
const LOCALES = ['en', 'nl'] as const;

/**
 * The sentences that keep naming an operator document, and why. By file and
 * document: every literal in that file naming that document is allowed.
 */
const ALLOWED: ReadonlyArray<{ file: string; doc: string; reason: string }> = [
  {
    file: 'apps/api/src/middleware/auth.ts',
    doc: 'docs/managed-bring-up.md',
    reason:
      'Said at start-up and at the door when JWT_ISSUER is set without JWT_AUDIENCE: two ' +
      'settings of the deployment, which only whoever runs it can change.',
  },
  {
    file: 'packages/connectors/src/directory-availability.ts',
    doc: 'docs/o365-application-access.md',
    reason:
      "Names OAUTH2_REFRESH_TOKEN, OAUTH2_CLIENT_ID and OAUTH2_CLIENT_SECRET, the worker's " +
      "and the appliance's environment. The detectors log it; the permission report " +
      'replaces it for every Microsoft source (`O365_NOT_READ_WITH_ITS_OWN_REGISTRATION`, ' +
      '`MICROSOFT_ACCOUNT_IS_DELEGATED`), so no customer reads it.',
  },
  {
    file: 'packages/connectors/src/drive-sharing-availability.ts',
    doc: 'docs/o365-application-access.md',
    reason:
      'The document qualifies GRAPH_FILES_READ_CONSENTED=true, a switch of the deployment ' +
      'only whoever runs it can set, and the decision behind it (*Two scopes, one granted*).',
  },
  {
    file: 'packages/connectors/src/graph-access-check.ts',
    doc: 'docs/o365-application-access.md',
    reason: "The worker CLI's console summary (`renderAccessCheck`), read by the operator who ran it.",
  },
  {
    file: 'packages/connectors/src/graph-directory.ts',
    doc: 'docs/o365-application-access.md',
    reason:
      "A detector's reason: new-mailbox detection logs it every run (`runNewMailboxDetection`). Every " +
      'caller passes application permissions, so only a library caller that does not meets it.',
  },
  {
    file: 'packages/connectors/src/graph-groups.ts',
    doc: 'docs/o365-application-access.md',
    reason:
      "A detector's reason: group discovery logs it every run (`runGroupDiscovery`). Every " +
      'caller passes application permissions, so only a library caller that does not meets it.',
  },
  {
    file: 'packages/core/src/mapping-pattern.ts',
    doc: 'docs/shared-mailboxes.md',
    reason:
      "Refuses a mapping file on the appliance at start-up (`assertMappingPattern`, called by " +
      '`apps/selfhost` alone), naming its `source.mailbox` key: the owner of the appliance edits it.',
  },
  {
    file: 'packages/shared/src/dropbox-deployment-client.ts',
    doc: 'docs/dropbox-setup.md',
    reason:
      "The document qualifies the deployment's DROPBOX_OAUTH_* settings, which only whoever " +
      'runs it can set. A screen never asks without a pair where the deployment has no app ' +
      "(`ProviderConsent`'s `pairMissing`), so a customer does not meet the sentence there.",
  },
  {
    file: 'packages/shared/src/google-deployment-client.ts',
    doc: 'docs/google-workspace-setup.md',
    reason:
      "The document qualifies the deployment's GOOGLE_OAUTH_* settings, which only whoever " +
      'runs it can set. A screen never asks without a pair where the deployment has no app ' +
      "(`ProviderConsent`'s `pairMissing`), so a customer does not meet the sentence there.",
  },
  {
    file: 'packages/shared/src/microsoft-deployment-client.ts',
    doc: 'docs/microsoft-setup.md',
    reason:
      "The document qualifies the deployment's MICROSOFT_OAUTH_* settings, which only whoever " +
      'runs it can set. A screen never asks without a pair where the deployment has no app ' +
      "(`ProviderConsent`'s `pairMissing`), so a customer does not meet the sentence there.",
  },
  {
    file: 'packages/shared/src/redirect-uris.ts',
    doc: 'docs/microsoft-setup.md',
    reason:
      "The Redirect URIs page, the operator's (`useOperatorT`): the addresses whoever runs " +
      "the deployment registers on its own applications, with API_URL and MICROSOFT_OAUTH_TENANT.",
  },
];

/** Every source file under `dir`, tests left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) out.push(...sources(path));
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !name.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

/** `apps/api/src` and the `src` of every package: where a refusal is written. */
function refusalSources(): string[] {
  const out = sources(join(ROOT, 'apps', 'api', 'src'));
  for (const name of readdirSync(join(ROOT, 'packages'))) {
    const src = join(ROOT, 'packages', name, 'src');
    if (existsSync(src) && statSync(src).isDirectory()) out.push(...sources(src));
  }
  return out;
}

interface Literal {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Every string and template literal's text in a file, comments never read. */
function literalsIn(path: string): Literal[] {
  const file = relative(ROOT, path);
  const source = ts.createSourceFile(file, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: Literal[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      out.push({ file, line, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const LITERALS = refusalSources().flatMap(literalsIn);

/** GitHub's heading slug, as `Docs.tsx`'s `slugOfHeading` draws it. */
function slugOfHeading(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** A served guide's section ids: each heading's `{#id}`, or its slug. Code fences are not headings. */
function sectionIds(body: string): Set<string> {
  const ids = new Set<string>();
  let fenced = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const explicit = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/.exec(heading[1]!);
    ids.add(explicit ? explicit[1]! : slugOfHeading(heading[1]!));
  }
  return ids;
}

/** Each language's guides, by slug, with the ids of their sections. */
const GUIDES = Object.fromEntries(
  LOCALES.map((locale) => {
    const dir = join(ROOT, 'docs', 'guides', locale);
    return [
      locale,
      new Map(
        readdirSync(dir)
          .filter((name) => name.endsWith('.md'))
          .map((name) => [name.replace(/\.md$/, ''), sectionIds(readFileSync(join(dir, name), 'utf8'))]),
      ),
    ];
  }),
) as Record<(typeof LOCALES)[number], Map<string, Set<string>>>;

describe('a refusal names its guide by handle, never by file (0148 T7)', () => {
  it('names no docs/<name>.md in a string a customer reads', () => {
    const unlisted: string[] = [];
    for (const literal of LITERALS) {
      for (const [doc] of literal.text.matchAll(NAMES_A_DOCUMENT)) {
        const allowed = ALLOWED.some((a) => a.file === literal.file && a.doc === doc);
        if (!allowed) unlisted.push(`${literal.file}:${literal.line} names ${doc}`);
      }
    }
    expect(
      unlisted,
      'A sentence a customer reads carries a guide handle beside its words, and names no file. ' +
        'One only an operator reads goes on ALLOWED, with the reason.',
    ).toEqual([]);
  });

  it('allows nothing that is no longer said', () => {
    const stale = ALLOWED.filter(
      (a) => !LITERALS.some((literal) => literal.file === a.file && literal.text.includes(a.doc)),
    ).map((a) => `${a.file}: ${a.doc}`);
    expect(stale).toEqual([]);
  });

  it('gives every allowed sentence its reason', () => {
    expect(ALLOWED.filter((a) => a.reason.trim().length < 40).map((a) => a.file)).toEqual([]);
  });
});

describe('every guide handle names a served guide and a section it has (0148 T7)', () => {
  const handles = LITERALS.filter((literal) => HANDLE.test(literal.text));

  it('finds the handles the refusals carry', () => {
    // Not vacuous: the create route alone carries a handle on every refusal
    // that named a document.
    expect(handles.length).toBeGreaterThanOrEqual(10);
    expect(handles.some((h) => h.file === 'apps/api/src/routes/migrations/index.ts')).toBe(true);
  });

  it('resolves each in both languages', () => {
    const broken: string[] = [];
    for (const handle of handles) {
      const [, slug, section] = HANDLE.exec(handle.text)!;
      for (const locale of LOCALES) {
        const ids = GUIDES[locale].get(slug!);
        if (!ids) broken.push(`${handle.file}:${handle.line} '${handle.text}': no ${locale} guide '${slug}'`);
        else if (!ids.has(section!)) {
          broken.push(`${handle.file}:${handle.line} '${handle.text}': the ${locale} guide has no #${section}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("builds the handle's type from the guides that are served, in both languages", () => {
    for (const locale of LOCALES) {
      expect([...GUIDES[locale].keys()].sort(), locale).toEqual([...SERVED_GUIDES].sort());
    }
  });
});
