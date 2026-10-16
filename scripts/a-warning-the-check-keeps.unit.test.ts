// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WARNING THAT PROMISED A CHECK MAIL NEVER HAD (workplan 0144 T4, 0149 T6).
 *
 * `APPLY_FLAG_WARNING` is the sentence a tester reads in front of the switch
 * that turns on *apply deletions*, the one thing in Ownpace that removes
 * anything, and testers may turn it on during the Alpha (0149 D1). Among the
 * gates it said every removal passes was *"never a copy somebody has since
 * edited"*, and the Dutch said the same. For mail that was never so. The JMAP
 * mail writer takes the recorded version and ignores it: JMAP gives a message
 * no version, so none is recorded. The IMAP target compares the mailbox's
 * UIDVALIDITY, which tells a recreated mailbox, not an edited message. The
 * tester guide said it right (*"With mail it does not check that"*), and the
 * warning beside the switch said the opposite.
 *
 * Nothing tied the sentence to the code, so it stayed true for as long as
 * nobody changed either. This reads what the code does, per data type, and
 * holds the warning to it in both languages:
 *
 * - every class in `packages/connectors/src` and `packages/engines/src` with a
 *   `removeItem` is found on its own, and its data type is read from the
 *   target port it implements;
 * - a writer REFUSES AN EDITED COPY when its `removeItem` answers
 *   `conflicted: true` itself, or hands the recorded version to
 *   `removeDavResource`, where the server decides from `If-Match`;
 * - it REFUSES WHAT IT CANNOT CHECK when it answers `unversioned: true`
 *   itself, or goes through `removeDavResource`, which does;
 * - a data type is protected when every writer for it refuses an edited copy.
 *   The warning names exactly the protected types in its sentence that says a
 *   changed copy is not removed, and exactly the others in its sentence that
 *   says they are not checked. A change to a writer's protection fails here
 *   until the sentence says it, in English and in Dutch.
 *
 * The writers on 2026-10-16: `packages/connectors/src/jmap-target.ts` and
 * `packages/connectors/src/imapflow-dav-target.ts` (mail, not checked);
 * `packages/engines/src/caldav-target-writer.ts` (calendar);
 * `packages/engines/src/carddav-target-writer.ts` and
 * `packages/connectors/src/jmap-contact-target.ts` (contacts);
 * `packages/engines/src/webdav-target-writer.ts` and
 * `packages/connectors/src/jmap-file-target.ts` (files). The warning is in
 * `packages/shared/src/operating-contract.ts`, shown by
 * `apps/web/src/components/queues/ApplyDeletionsPanel.tsx`.
 *
 * PARSED, not searched, for `a-source-that-only-reads`'s reason: a comment is
 * prose about code, and the IMAP writer's comment names `conflicted` in the
 * very place it explains why it does not answer it. The warning is imported:
 * it is what the panel shows.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { APPLY_FLAG_WARNING, APPLY_FLAG_WARNING_NL } from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..');
const WRITER_DIRS = ['packages/connectors/src', 'packages/engines/src'];
const DAV_REMOVE = 'packages/engines/src/dav-remove.ts';

type Domain = 'mail' | 'calendar' | 'contacts' | 'files';
const DOMAINS: readonly Domain[] = ['files', 'calendar', 'contacts', 'mail'];

/** The target port a writer implements says which data type it writes. */
const PORT_DOMAIN: Readonly<Record<string, Domain>> = {
  TargetWriter: 'mail',
  CalendarTargetWriter: 'calendar',
  ContactTargetWriter: 'contacts',
  FileTargetWriter: 'files',
};

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, readFileSync(join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Every node under one, depth first. */
function nodes(root: ts.Node): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return all;
}

/** Does any object literal under this node say `name: true`? */
function saysTrue(root: ts.Node, name: string): boolean {
  return nodes(root).some(
    (n) =>
      ts.isPropertyAssignment(n) &&
      n.name.getText() === name &&
      n.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

/** Calls to a function of this name under a node, as a bare call. */
function callsTo(root: ts.Node, name: string): ts.CallExpression[] {
  return nodes(root).filter(
    (n): n is ts.CallExpression =>
      ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name,
  );
}

interface Remover {
  readonly where: string;
  readonly domain: Domain | undefined;
  readonly refusesEdited: boolean;
  readonly refusesUnchecked: boolean;
}

/** What `removeDavResource` does with a version, read from its own body. */
function davRemove(): { readonly refusesEdited: boolean; readonly refusesUnchecked: boolean } {
  const fn = nodes(parse(DAV_REMOVE)).find(
    (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'removeDavResource',
  );
  if (!fn?.body) throw new Error(`${DAV_REMOVE} no longer declares removeDavResource; this guard reads it`);
  const sendsIfMatch = nodes(fn.body).some(
    (n) => ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name) && n.name.text === 'If-Match',
  );
  return {
    refusesEdited: sendsIfMatch && saysTrue(fn.body, 'conflicted'),
    refusesUnchecked: saysTrue(fn.body, 'unversioned'),
  };
}

/** Every class with a `removeItem`, and what that method does with a version. */
function removers(): Remover[] {
  const dav = davRemove();
  const found: Remover[] = [];
  for (const dir of WRITER_DIRS) {
    for (const file of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const rel = `${dir}/${file}`;
      for (const cls of nodes(parse(rel)).filter(ts.isClassDeclaration)) {
        const method = cls.members.find(
          (m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.name.getText() === 'removeItem',
        );
        if (!method?.body) continue;
        const ports = (cls.heritageClauses ?? [])
          .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
          .flatMap((h) => h.types.map((t) => t.expression.getText()));
        const domain = ports.map((p) => PORT_DOMAIN[p]).find((d) => d !== undefined);
        const viaDav = callsTo(method.body, 'removeDavResource');
        const passesVersion = viaDav.some((call) =>
          call.arguments.some((arg) =>
            nodes(arg).some((n) => ts.isIdentifier(n) && n.text === 'expectedTargetVersion'),
          ),
        );
        found.push({
          where: `${cls.name?.text ?? '(anonymous)'} in ${rel}`,
          domain,
          refusesEdited: saysTrue(method.body, 'conflicted') || (passesVersion && dav.refusesEdited),
          refusesUnchecked: saysTrue(method.body, 'unversioned') || (viaDav.length > 0 && dav.refusesUnchecked),
        });
      }
    }
  }
  return found;
}

/** How each language names each data type, and the two sentences that carry the claim. */
const LANGUAGES = {
  en: {
    warning: APPLY_FLAG_WARNING,
    nouns: {
      files: /\bfiles?\b/i,
      calendar: /\bcalendar entr(?:y|ies)\b/i,
      contacts: /\bcontacts?\b/i,
      mail: /\b(?:e-?mails?|mail)\b/i,
    },
    gates: 'has to pass every gate',
    refused: 'is also not removed if someone has changed it',
    unchecked: 'or when that cannot be checked',
    notChecked: 'is not checked for changes',
    anEdit: /edit|chang/i,
    holds: [
      'positive evidence only',
      'only items this tool wrote',
      'the mass-deletion breaker',
      'While this is off, nothing can be removed',
    ],
  },
  nl: {
    warning: APPLY_FLAG_WARNING_NL,
    nouns: {
      files: /\bbestand(?:en)?\b/i,
      calendar: /\bagenda-items?\b/i,
      contacts: /\bcontact(?:en)?\b/i,
      mail: /\be-mails?\b/i,
    },
    gates: 'moet nog steeds elke controle doorstaan',
    refused: 'wordt bovendien niet verwijderd als iemand het',
    unchecked: 'of als dat niet kan worden gecontroleerd',
    notChecked: 'wordt daar niet op gecontroleerd',
    anEdit: /bewerk|gewijzigd|wijzig/i,
    holds: [
      'uitsluitend positief bewijs',
      'alleen items die dit programma zelf schreef',
      'de massaverwijderings-stroomonderbreker',
      'Zolang dit uit staat, kan er niets worden verwijderd',
    ],
  },
} as const;

type Language = keyof typeof LANGUAGES;

const sentences = (text: string): string[] => text.split(/(?<=\.)\s+/);

function named(sentence: string, language: Language): Domain[] {
  return DOMAINS.filter((d) => LANGUAGES[language].nouns[d].test(sentence));
}

const REWRITE =
  'Rewrite APPLY_FLAG_WARNING and APPLY_FLAG_WARNING_NL (packages/shared/src/operating-contract.ts) ' +
  'to say what the writers do now, and then this guard\'s sentence markers if the words changed.';

describe('a warning the check keeps', () => {
  const all = removers();
  const byDomain = (d: Domain) => all.filter((r) => r.domain === d);
  const protectedDomains = DOMAINS.filter((d) => byDomain(d).every((r) => r.refusesEdited));
  const uncheckedDomains = DOMAINS.filter((d) => !protectedDomains.includes(d));

  it('finds every writer that removes, and knows its data type', () => {
    // Seven on 2026-10-16: JMAP and IMAP mail, CalDAV, CardDAV and JMAP
    // contacts, WebDAV and JMAP files. Fewer means the search stopped finding
    // them, and every check below would pass on nothing.
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(all.filter((r) => r.domain === undefined).map((r) => r.where), 'a remover of no known data type').toEqual([]);
    for (const d of DOMAINS) expect(byDomain(d).length, `no writer removes ${d}`).toBeGreaterThan(0);
  });

  it('reads one answer per data type, so one sentence can say it', () => {
    // If one target of a data type refuses an edited copy and another does
    // not, "a file is not removed if someone changed it" is false on one of
    // them. The warning would have to name the target, which it does not.
    for (const d of DOMAINS) {
      const answers = new Set(byDomain(d).map((r) => r.refusesEdited));
      expect(
        answers.size,
        `${d}: ${byDomain(d)
          .map((r) => `${r.where} ${r.refusesEdited ? 'refuses' : 'does not refuse'} an edited copy`)
          .join('; ')}. ${REWRITE}`,
      ).toBe(1);
    }
  });

  it('every protected data type also refuses a copy it cannot check', () => {
    // The warning says "or when that cannot be checked" (0149 T3: no version,
    // no removal). A writer that removes without a version breaks that half.
    const open = protectedDomains.flatMap((d) => byDomain(d).filter((r) => !r.refusesUnchecked).map((r) => r.where));
    expect(open, `these remove a copy with no recorded version. ${REWRITE}`).toEqual([]);
  });

  for (const language of Object.keys(LANGUAGES) as Language[]) {
    const words = LANGUAGES[language];
    const said = sentences(words.warning);

    it(`${language}: no gate that every removal passes is an edit check, while a data type has none`, () => {
      const gates = said.find((s) => s.includes(words.gates));
      expect(gates, `the sentence listing the gates, "${words.gates}"`).toBeDefined();
      if (uncheckedDomains.length > 0) {
        expect(
          words.anEdit.test(gates ?? ''),
          `"${gates}" promises every removal an edit check, and ${uncheckedDomains.join(', ')} ` +
            `has none. ${REWRITE}`,
        ).toBe(false);
      }
    });

    it(`${language}: names exactly the data types whose changed copy is refused`, () => {
      const refused = said.filter((s) => s.includes(words.refused));
      if (protectedDomains.length === 0) {
        expect(refused, `no writer refuses an edited copy. ${REWRITE}`).toEqual([]);
        return;
      }
      expect(refused, `one sentence, "${words.refused} …". ${REWRITE}`).toHaveLength(1);
      expect(named(refused[0]!, language), `"${refused[0]}". ${REWRITE}`).toEqual(protectedDomains);
      expect(refused[0], `the fail-closed half, "${words.unchecked}". ${REWRITE}`).toContain(words.unchecked);
    });

    it(`${language}: names exactly the data types that are not checked`, () => {
      const notChecked = said.filter((s) => s.includes(words.notChecked));
      if (uncheckedDomains.length === 0) {
        expect(notChecked, `every data type refuses an edited copy now. ${REWRITE}`).toEqual([]);
        return;
      }
      expect(notChecked, `one sentence, "… ${words.notChecked}". ${REWRITE}`).toHaveLength(1);
      expect(named(notChecked[0]!, language), `"${notChecked[0]}". ${REWRITE}`).toEqual(uncheckedDomains);
    });

    it(`${language}: keeps what holds for every removal, and that nothing is removed while it is off`, () => {
      for (const holds of words.holds) expect(words.warning).toContain(holds);
    });
  }
});
