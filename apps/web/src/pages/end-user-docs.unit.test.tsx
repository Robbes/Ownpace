// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The guides the app SERVES are end-user documents (owner decision, 0068).
 *
 * Workplan 0063 T5 inlined the repository's own `*-setup.md` into `/docs`, and
 * the reasoning still holds: a separately-written guide drifts from its
 * connector, and that is how somebody follows five correct steps and one that
 * stopped being true two releases ago.
 *
 * What that reasoning got wrong is the AUDIENCE. Those files were written for
 * whoever is building this, so they cite ADRs, name workplans, and explain what
 * the appliance does differently from the managed service — none of which means
 * anything to a customer, and the last of which is actively confusing to
 * somebody who will only ever see one of the two. The owner found all three in
 * the first minute of reading `box-setup.md` on a phone.
 *
 * So the anti-drift decision stands and the audience is enforced here instead:
 *
 *  1. **No internal references.** ADR numbers, workplan numbers, SAD section
 *     marks and hard-rule citations are how WE argue about the product; a
 *     customer reading "(ADR-0011)" has been handed a dead reference to a
 *     document they cannot open.
 *  2. **No edition asides.** A guide served to somebody is served to somebody
 *     running exactly one edition.
 *  3. **Every credential the connector actually needs is mentioned.** This is
 *     the drift half, and the reason these stay in-repo: if a provider gains a
 *     required field, the guide that never mentions it fails here rather than
 *     in front of a customer at step four.
 *
 * WHAT MOVED, AND WHY (workplan 0148 T1, the owner's D1). The three rules were
 * narrow, and a guide passed them while telling the reader to edit `.env`,
 * run `pnpm exec tsx` from the repository root and re-run `set-task-env.sh`.
 * The owner's answer was to split the audience rather than soften the text:
 * the customer half of each guide now lives in `docs/guides/<locale>/<slug>.md`
 * and is what `/docs` serves; `docs/*-setup.md` keep their names and are the
 * operator and self-host documents, which are not served. The patterns below
 * were widened at the same time (`OPERATOR_MATERIAL`), and a file named
 * `*-setup.md` may not appear under `docs/guides/`, so an operator document
 * cannot be served by being moved into the folder.
 *
 * The guides are read through the SAME `import.meta.glob` the page uses, so a
 * renamed or unpublished document fails here rather than 404ing for a customer.
 */
import { describe, it, expect } from 'vitest';
import {
  credentialFieldsFor,
  connectableTypes,
  MICROSOFT_DOMAIN_SCOPES,
  MICROSOFT_OFFLINE_SCOPE,
} from '@openmig/shared';
import { STRINGS, type Locale } from '../i18n/strings.ts';

/** Every served guide, `docs/guides/<locale>/<slug>.md`, as `Docs.tsx` inlines them. */
const GUIDES = import.meta.glob('../../../../docs/guides/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Every Markdown file anywhere under `docs/guides/`, by path only (not
 * loaded): the folder the page serves from, at any depth.
 */
const EVERYTHING_UNDER_GUIDES = Object.keys(import.meta.glob('../../../../docs/guides/**/*.md'));

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');
/** The folder a guide sits in: its language. */
const langOf = (path: string) => path.split('/').slice(-2)[0]!;
/** `en/box`: how a failure names a guide, since a slug exists once per language. */
const nameOf = (path: string) => `${langOf(path)}/${slugOf(path)}`;

/** Internal vocabulary, with the shape each one actually appears in. */
const INTERNAL_REFERENCE = [
  { label: 'an ADR citation', re: /\bADR[-\s]?\d{3,4}\b/i },
  { label: 'a workplan number', re: /\bworkplan\s+\d{3,4}\b/i },
  { label: 'a SAD section mark', re: /§\s?\d+/ },
  { label: 'a hard-rule citation', re: /\bhard rule\s+\d+\b/i },
];

/**
 * Edition asides. Deliberately narrow: the bare words "managed" and
 * "self-host" appear in legitimate customer sentences ("a managed European
 * platform"), so only the constructions that ADDRESS one edition are banned.
 */
const EDITION_ASIDE = [
  { label: 'a self-host aside', re: /\bself-host(ed)?\s+(edition|only|users?|operators?)\b/i },
  { label: 'a managed-edition aside', re: /\bmanaged\s+edition\b/i },
  { label: 'an appliance aside', re: /\bthe appliance\b/i },
  // The same asides in Dutch (0148 T4): the three above are English, and a
  // Dutch guide that says "op de appliance" addresses one edition just as much.
  { label: 'an appliance aside, in Dutch', re: /\bde appliance\b/i },
  { label: 'an edition aside, in Dutch', re: /\b(beheerde|managed|zelf-?gehoste)\s+(editie|versie)\b/i },
];

/**
 * Operator material (workplan 0148 T1, the owner's D1). The three rules above
 * were narrow, and what passed them was served: an "**Appliance** —
 * environment variables" heading in the Box guide, the deployment's
 * `DROPBOX_OAUTH_CLIENT_ID=` in the Dropbox guide, a `pnpm exec tsx` command
 * and a dated note in the Google guide, "Configure it (operators)" and
 * `set-task-env.sh` in the Microsoft guide, and "Managed Path" in the O365
 * guide. Each pattern carries what to write instead, because the person who
 * trips one is mid-sentence and needs the other half of the rule, not a
 * reference to it.
 *
 * The field names a person TYPES stay allowed: they are camelCase or the
 * provider's own words, and the i18n boundary already calls them findings.
 */
const OPERATOR_MATERIAL = [
  {
    label: 'an edition heading',
    re: /^\*\*(Appliance|Managed)\b/m,
    instead:
      'Write the one way this reader connects, in the wizard or on the Connections page; ' +
      'what an appliance owner sets stays in the operator document in docs/.',
  },
  {
    label: 'an edition path',
    re: /\b(Managed|Self-Host) Path\b/,
    instead: 'Describe the card the reader picked; the two editions are not two paths through one guide.',
  },
  {
    label: 'a task reference',
    re: /\b\d{4} T\d+\b/,
    instead: 'Say what the step does; the plan that decided it is ours to read, not the reader’s.',
  },
  {
    label: 'a workplan reference, in Dutch',
    re: /\bwerkplan\s+\d{3,4}\b/i,
    instead: 'Zeg wat de stap doet; het plan waarin het besloten is, is voor ons.',
  },
  {
    label: 'an owner-runbook reference',
    re: /\bowner runbook\b/i,
    instead: 'Say what is known and what is not yet; the runbook it came from is ours.',
  },
  {
    label: 'an ISO date',
    re: /\b20\d\d-\d\d-\d\d\b/,
    instead:
      'Write a date out, as "4 September 2026", and only where the reader needs it; a dated ' +
      'internal note belongs in the operator document.',
  },
  {
    label: 'a command',
    re: /\b(pnpm|docker compose|psql|curl)\b/,
    instead:
      'Name the button that does it (Test, Connect with …); a command is for whoever runs the ' +
      'service and stays in the operator document.',
  },
  {
    label: 'a repository path',
    re: /`(apps|packages|scripts|deploy)\//,
    instead: 'Say what the product does; where the code lives is not something the reader can open.',
  },
  {
    label: 'an environment file',
    re: /\.env\b/,
    instead: 'Name the field in the wizard the value goes in; the environment file is the operator’s.',
  },
  {
    label: 'the task-environment script',
    re: /\bset-task-env\b/,
    instead: 'Leave deployment steps to the operator document; the reader cannot run them.',
  },
  {
    label: 'an environment assignment',
    re: /^\s*[A-Z][A-Z0-9]*_[A-Z0-9_]+=/m,
    instead: 'Name the field in the wizard the value goes in, with the wizard’s own label.',
  },
  {
    label: 'a constant or variable in backticks',
    re: /`[A-Z][A-Z0-9]*_[A-Z0-9_]+`/,
    instead: 'Say what it holds in words ("Apple’s published addresses"), not its name in the code.',
  },
  {
    label: 'the operator',
    re: /\boperators?\b/i,
    instead:
      'Write "this service" ("deze dienst"), and "whoever runs it" where the reader needs help: a customer guide never names the operator.',
  },
];

describe('the guides the app serves are written for customers', () => {
  it('ships at least one guide, read through the page\'s own import', () => {
    // Guards the rest: a glob that silently matches nothing would pass every
    // assertion below without reading a single document.
    expect(Object.keys(GUIDES).length).toBeGreaterThan(0);
  });

  it('serves no file named *-setup.md: an operator document is not served by moving it here', () => {
    // The operator documents keep their `-setup.md` names because refusals,
    // runbooks, scripts and ci.yml cite them. So the name is the tell, and a
    // move into docs/guides/ would put one in front of customers unchanged.
    expect(EVERYTHING_UNDER_GUIDES.length, 'the folder glob matched nothing').toBeGreaterThan(0);
    expect(
      EVERYTHING_UNDER_GUIDES.filter((path) => /-setup\.md$/.test(path)),
      'a *-setup.md under docs/guides/ is an operator document in the served folder. Keep it ' +
        'in docs/, and write the customer half as docs/guides/<locale>/<slug>.md.',
    ).toEqual([]);
  });

  it('keeps every guide in a folder named after a language the app speaks', () => {
    const locales = new Set<string>(Object.keys(STRINGS) as Locale[]);
    const stray = EVERYTHING_UNDER_GUIDES.filter(
      (path) => !/\/docs\/guides\/[^/]+\/[^/]+\.md$/.test(path) || !locales.has(langOf(path)),
    );
    expect(
      stray,
      'the page serves docs/guides/<locale>/<slug>.md for the locales in strings.ts, and ' +
        'nothing else: a file anywhere else under docs/guides/ is never shown.',
    ).toEqual([]);
  });

  it.each(Object.keys(GUIDES))('%s cites nothing internal', (path) => {
    const text = GUIDES[path]!;
    for (const { label, re } of INTERNAL_REFERENCE) {
      const hit = re.exec(text);
      expect(
        hit,
        `${nameOf(path)} contains ${label} (“${hit?.[0]}”). These guides are served to ` +
          `customers at /docs, and an internal reference is a pointer to something they ` +
          `cannot open. Say the thing itself instead of citing where it was decided.`,
      ).toBeNull();
    }
  });

  it.each(Object.keys(GUIDES))('%s does not address one edition', (path) => {
    const text = GUIDES[path]!;
    for (const { label, re } of EDITION_ASIDE) {
      const hit = re.exec(text);
      expect(
        hit,
        `${nameOf(path)} contains ${label} (“${hit?.[0]}”). Whoever reads this is running ` +
          `exactly one edition and cannot tell which paragraphs are theirs.`,
      ).toBeNull();
    }
  });

  it.each(Object.keys(GUIDES))('%s carries no operator material', (path) => {
    const text = GUIDES[path]!;
    for (const { label, re, instead } of OPERATOR_MATERIAL) {
      const hit = re.exec(text);
      expect(
        hit,
        `${nameOf(path)} contains ${label} (“${hit?.[0]}”). A guide served at /docs is read by ` +
          `the person connecting an account, not by whoever runs the service. ${instead}`,
      ).toBeNull();
    }
  });
});

/**
 * Which guide covers which wizard type — the same mapping `Setup.tsx`'s
 * `guideSlug` uses, restated as data so the coverage check below can invert it.
 * One guide per family of cards (workplan 0148 T4's table): the five Google
 * cards share `google`, the three Microsoft cards share `microsoft`.
 */
function guideSlugFor(provider: string): string {
  if (provider.startsWith('google') || provider === 'gmail') return 'google';
  if (provider === 'oauth2' || provider === 'graph' || provider === 'microsoft') return 'microsoft';
  return provider;
}

describe('the guides mention what the connector actually needs', () => {
  // The synonyms below are English, so this reads the English guides. The
  // wizard's own labels, in each language, are read by the case after this
  // one (0148 T4), which covers the Dutch guides as well.
  const bySlug = new Map(
    Object.entries(GUIDES)
      .filter(([p]) => langOf(p) === 'en')
      .map(([p, t]) => [slugOf(p), t]),
  );

  /**
   * The words a guide may use for a field. A guide should speak the PROVIDER's
   * vocabulary — Dropbox says "App key" where the schema says `clientId` — so
   * this accepts either, and fails only when a required credential goes
   * completely unmentioned.
   */
  const SYNONYMS: Record<string, RegExp> = {
    clientId: /client\s*id|app\s*key|application\s*\(?client\)?\s*id/i,
    clientSecret: /client\s*secret|app\s*secret/i,
    refreshToken: /refresh\s*token/i,
    tenantId: /tenant\s*id|directory\s*\(?tenant\)?\s*id/i,
    userId: /user\s*id/i,
    serviceAccountKey: /service\s*account/i,
    username: /user\s*name|email address|mailbox|\baccount\b/i,
    password: /password/i,
    // The export archive's two fields (0116 T8). Neither is a credential, and
    // that is exactly why they need entries here: without one, a guide could
    // ship saying nothing about WHICH export or WHERE it is — the only two
    // things a person has to arrive with — and this test would pass, because
    // an unknown key is deliberately not judged.
    provider: /which export|google takeout|apple data & privacy/i,
    path: /folder|extracted/i,
  };

  const cases = connectableTypes('source')
    .map((type) => ({ type, slug: guideSlugFor(type) }))
    .filter(({ slug }) => bySlug.has(slug));

  it('covers a source type whose guide ships', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('$type — $slug names every required credential', ({ type, slug }) => {
    const text = bySlug.get(slug)!;
    const missing = credentialFieldsFor('source', type)
      .filter((f) => f.required)
      .map((f) => f.key)
      .filter((key) => {
        const re = SYNONYMS[key];
        // A field with no known synonym is not something this test can judge;
        // saying nothing is better than failing on a pattern it invented.
        return re ? !re.test(text) : false;
      });

    expect(
      missing,
      `en/${slug}.md never mentions ${missing.join(', ')}, which the wizard REQUIRES for a ` +
        `'${type}' source. Somebody following this guide reaches the form without the ` +
        `value it demands. Either the guide is out of date or the field is.`,
    ).toEqual([]);
  });
});

/**
 * THE WIZARD'S OWN LABELS, IN THE GUIDE'S OWN LANGUAGE (workplan 0148 T4).
 *
 * The synonym list above is English, so it read the English guides only, and
 * it accepts any word for a field ("App key" for `clientId`) because it was
 * written to catch a field nobody mentions. A Dutch guide needs the other
 * half: a reader following it holds a screen that says "Gebruikersnaam" and
 * "Clientgeheim", and a guide that says "Username", or a Dutch word the
 * screen does not use, sends them hunting for a box that is not there.
 *
 * Two cases, each per language, both read from `strings.ts`:
 *
 *  1. every field the wizard REQUIRES for a card is named in that card's
 *     guide by the label the wizard shows in the guide's language
 *     (`STRINGS[locale][field.labelKey]`), not by a synonym;
 *  2. a label the guide quotes in bold is the label of ITS language: a bold
 *     span that is one of the wizard's labels in the other language, and not
 *     in this one, is a label left untranslated; and a label quoted in one
 *     language's guide is named in the other's too, so the two guides send
 *     their readers to the same controls.
 *
 * "One of the wizard's labels" is a string under the keys a guide quotes
 * from — the wizard's, the Connections page's, the grant links' and the
 * navigation's — short enough to be a label rather than a sentence.
 */
describe('each guide quotes the wizard\'s labels in its own language (0148 T4)', () => {
  const LOCALES = Object.keys(STRINGS) as Locale[];
  const LABEL_KEYS = /^(wizard|connections|grantLink|nav|hub)\./;
  /** label → the keys that carry it, per language. */
  const labels = (locale: Locale) => {
    const out = new Map<string, string[]>();
    for (const [key, value] of Object.entries(STRINGS[locale])) {
      if (!LABEL_KEYS.test(key) || value.length > 50 || value.includes('{')) continue;
      out.set(value, [...(out.get(value) ?? []), key]);
    }
    return out;
  };
  const LABELS = Object.fromEntries(LOCALES.map((locale) => [locale, labels(locale)])) as Record<
    Locale,
    Map<string, string[]>
  >;
  /** A bold span's text, as a label would be compared: a trailing full stop or colon dropped. */
  const boldIn = (text: string) =>
    [...text.matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => m[1]!.trim().replace(/[.:]$/, ''));
  const guideAt = (locale: string, slug: string) =>
    Object.entries(GUIDES).find(([p]) => nameOf(p) === `${locale}/${slug}`)?.[1];

  const fieldCases = LOCALES.flatMap((locale) =>
    connectableTypes('source')
      .map((type) => ({ locale, type, slug: guideSlugFor(type) }))
      .filter(({ locale: l, slug }) => guideAt(l, slug) !== undefined),
  );

  it('reads a guide in every language the app speaks', () => {
    for (const locale of LOCALES) {
      expect(fieldCases.filter((c) => c.locale === locale).length, `no ${locale} guide to read`).toBeGreaterThan(0);
    }
  });

  // The label is QUOTED: a bold span that is the label exactly, as the guides
  // quote every control. Until 2026-09-26 this was a case-insensitive search
  // of the whole text, and a review showed what that let through: change
  // nl/microsoft's **Refresh-token** to **Vernieuwingstoken** and the case
  // still passed, because "een refresh-token" stood in plain prose two lines
  // up. A word in a sentence is not the reader's way to the box.
  it.each(fieldCases)('$locale/$slug quotes every required field of $type by the wizard\'s label', ({ locale, type, slug }) => {
    const quoted = new Set(boldIn(guideAt(locale, slug)!));
    const missing = credentialFieldsFor('source', type)
      .filter((f) => f.required)
      .map((f) => STRINGS[locale][f.labelKey as keyof (typeof STRINGS)['en']])
      .filter((label) => !quoted.has(label));

    expect(
      missing,
      `${locale}/${slug}.md never quotes ${missing.map((l) => `“**${l}**”`).join(', ')}, which is how the ` +
        `wizard labels a field it REQUIRES for a '${type}' source in this language. Quote the label in ` +
        'bold, exactly as the screen shows it, so the reader can find the box.',
    ).toEqual([]);
  });

  const guidePaths = Object.keys(GUIDES);

  it.each(guidePaths)('%s quotes no label in the other language', (path) => {
    const locale = langOf(path) as Locale;
    const untranslated = boldIn(GUIDES[path]!).filter(
      (span) =>
        !LABELS[locale].has(span) &&
        LOCALES.some(
          (other) =>
            other !== locale &&
            (LABELS[other].get(span) ?? []).some(
              (key) => STRINGS[locale][key as keyof (typeof STRINGS)['en']] !== span,
            ),
        ),
    );
    expect(
      untranslated,
      `${nameOf(path)} quotes ${untranslated.map((s) => `“${s}”`).join(', ')} in bold, which is the ` +
        'wizard’s label in another language. Quote the label this language’s screen shows ' +
        '(strings.ts has it under the same key).',
    ).toEqual([]);
  });

  it.each(guidePaths)('%s: a label it quotes is named in the guide’s other language too', (path) => {
    const locale = langOf(path) as Locale;
    const slug = slugOf(path);
    for (const other of LOCALES.filter((l) => l !== locale)) {
      const twin = guideAt(other, slug);
      if (twin === undefined) continue;
      const lower = twin.toLowerCase();
      const unmatched = boldIn(GUIDES[path]!).filter((span) => {
        const keys = LABELS[locale].get(span);
        if (keys === undefined) return false;
        return !keys.some((key) => lower.includes(STRINGS[other][key as keyof (typeof STRINGS)['en']].toLowerCase()));
      });
      expect(
        unmatched,
        `${nameOf(path)} quotes ${unmatched.map((s) => `“${s}”`).join(', ')}, and ${other}/${slug}.md ` +
          'names no twin of it. The two languages of a guide send their readers to the same controls.',
      ).toEqual([]);
    }
  });
});

/**
 * THE APPLE EXPORT'S TAG AND ITS LINE (workplan 0148 D7), in every guide that
 * sends a reader to Apple's export, in each language, in the words the
 * archive form's option uses. The owner: *"Leave the Apple-export option in
 * but be clear about it ('to be tested'-label)."* The tag alone would read as
 * an export that only needs trying; the line says it cannot be read yet.
 */
describe('the Apple export carries its to-be-tested tag and line (0148 D7)', () => {
  // Read from the form's own strings since #1176 merged them, so the guide
  // and the option cannot drift apart: the tag in bold, then the line.
  const LINE = Object.fromEntries(
    (Object.keys(STRINGS) as Locale[]).map((locale) => [
      locale,
      `**${STRINGS[locale]['wizard.archiveProvider.untested']}.** ` +
        STRINGS[locale]['wizard.archiveProvider.noReader.apple-privacy'],
    ]),
  ) as Record<Locale, string>;

  it('reads the words the form shows', () => {
    expect(LINE.en).toBe(
      '**To be tested.** We cannot read an Apple export yet. Request one only for your own records.',
    );
    expect(LINE.nl).toBe(
      '**Nog te testen.** Een Apple-export kunnen we nog niet lezen. Vraag die alleen aan voor uw eigen archief.',
    );
  });

  const cases = (Object.keys(LINE) as Locale[]).flatMap((locale) =>
    ['apple', 'archive'].map((slug) => ({ locale, slug })),
  );

  it.each(cases)('$locale/$slug', ({ locale, slug }) => {
    const guide = Object.entries(GUIDES).find(([p]) => nameOf(p) === `${locale}/${slug}`)?.[1];
    expect(guide, `docs/guides/${locale}/${slug}.md is not served`).toBeDefined();
    expect(guide).toContain(LINE[locale]);
  });
});

/**
 * The wizard has had four steps since it stopped being six — source, target,
 * migration, review — and each side's credentials sit on that side's own step.
 * The Box, Dropbox and Google guides, and three of the wizard's own about-lines
 * in both languages, went on sending people to "the credentials step", which
 * the wizard no longer has. A step named to a customer is one the wizard has.
 */
describe('the guides and the wizard name only the steps the wizard has', () => {
  const WIZARD_STEPS = new Set(['source', 'target', 'migration', 'review']);
  const NAMED_STEP = /\b(?:on|at|to|rides) the ([a-z-]+) step\b/gi;
  const stepsNamedIn = (text: string) =>
    [...text.matchAll(NAMED_STEP)].map((m) => m[1]!.toLowerCase()).filter((s) => !WIZARD_STEPS.has(s));

  it('reads a step name where one is written', () => {
    expect(stepsNamedIn('the secret rides the credentials step; the id goes on the source step')).toEqual([
      'credentials',
    ]);
  });

  it.each(Object.keys(GUIDES))('%s', (path) => {
    expect(stepsNamedIn(GUIDES[path]!)).toEqual([]);
  });

  /**
   * The Dutch guides name a step by its Dutch name, as the wizard's step bar
   * shows it ("in de stap Bron"), so the English pattern above cannot see
   * them. A step named in a Dutch guide is one of the four the bar carries.
   */
  const DUTCH_STEPS = new Set(
    (['source', 'target', 'migration', 'review'] as const).map((step) => STRINGS.nl[`wizard.step.${step}`]),
  );
  const NAMED_STEP_NL = /\b(?:in|bij|op|naar) de stap ([A-Z][\p{L}&-]*)/gu;
  const dutchStepsNamedIn = (text: string) =>
    [...text.matchAll(NAMED_STEP_NL)].map((m) => m[1]!).filter((s) => !DUTCH_STEPS.has(s));

  it('reads a Dutch step name where one is written', () => {
    expect(DUTCH_STEPS).toEqual(new Set(['Bron', 'Doel', 'Migratie', 'Controleren']));
    expect(dutchStepsNamedIn('het geheim komt in de stap Inloggegevens; het id in de stap Bron')).toEqual([
      'Inloggegevens',
    ]);
  });

  it.each(Object.keys(GUIDES).filter((path) => langOf(path) === 'nl'))('%s, by its Dutch names', (path) => {
    expect(dutchStepsNamedIn(GUIDES[path]!)).toEqual([]);
  });

  it('the wizard\'s own words, in both languages', () => {
    expect(Object.values(STRINGS.en).flatMap(stepsNamedIn)).toEqual([]);
    expect(Object.values(STRINGS.nl).filter((v) => /stap met inloggegevens/i.test(v))).toEqual([]);
  });
});

/**
 * microsoft-setup.md told the administrator to add "exactly" four `.Read`
 * permissions and offline_access, and "nothing else" — while the consent asks
 * for `Tasks.Read` whenever Tasks is ticked, and the same guide said so further
 * down. An administrator who followed the table to the letter would leave it
 * out. The list is what somebody copies, so it names every delegated
 * permission the consent can ask for. Since workplan 0148 T1 the list lives in
 * the served Microsoft guide's own-app section, one permission per bullet,
 * because the renderer has no tables yet (0148 T6 (b)).
 */
describe('the Microsoft guide lists every permission the consent asks for', () => {
  // In both languages since 0148 T4: the Dutch administrator copies the same list.
  const cases = (['en', 'nl'] as const).flatMap((locale) =>
    [...Object.values(MICROSOFT_DOMAIN_SCOPES), MICROSOFT_OFFLINE_SCOPE].map((scope) => ({ locale, scope })),
  );

  it.each(cases)('$locale: $scope', ({ locale, scope }) => {
    const guide = Object.entries(GUIDES).find(([p]) => nameOf(p) === `${locale}/microsoft`)?.[1];
    expect(guide, `docs/guides/${locale}/microsoft.md is not served`).toBeDefined();
    expect(guide).toMatch(new RegExp(`^- \`${scope.replace(/\./g, '\\.')}\` `, 'm'));
  });
});

/**
 * THE LIST THAT WAS WRONG (workplan 0148 T8). `o365-setup.md`'s
 * application-permission list for the *Via IMAP* and *Graph API* cards named
 * `IMAP.AccessAsUser.All` and `offline_access` under Microsoft Graph's
 * APPLICATION permissions. Microsoft's permissions reference lists both as
 * delegated only (no application identifier), and an app-only token carries
 * neither. When the customer half moved into `docs/guides/`, that list stayed
 * behind, and T8 wrote the recipes afresh (below). This holds that no served
 * guide names the permission that existed only in the wrong list.
 */
describe('no served guide names the delegated IMAP permission the wrong list used', () => {
  it.each(Object.keys(GUIDES))('%s', (path) => {
    expect(
      GUIDES[path]!.includes('IMAP.AccessAsUser.All'),
      `${nameOf(path)} names IMAP.AccessAsUser.All, a DELEGATED permission that o365-setup.md ` +
        'listed as an application one. The Via IMAP card takes IMAP.AccessAsApp, under Office 365 ' +
        'Exchange Online (0148 T8).',
    ).toBe(false);
  });
});

/**
 * THE TWO RECIPES (workplan 0148 T8 (a) and (b)), in both languages.
 *
 * *Via the Graph API* and *Via IMAP* take a registration of the customer's
 * own, with APPLICATION permissions and an administrator's consent: their
 * fields are a mailbox, a tenant, a client id and a secret, and no refresh
 * token (`o365Fields()`), so the pass always mints an app-only token.
 *
 *  - (a) *Via the Graph API* mints for `https://graph.microsoft.com/.default`
 *    (`mail-source-factory.ts`) and reads `/users/{mailbox}/\u2026`, which is
 *    Microsoft Graph's application `Mail.Read`. The list names it, and names
 *    neither `IMAP.AccessAsUser.All` nor `offline_access`, which have no
 *    application form at all.
 *  - (b) *Via IMAP* mints for `https://outlook.office365.com/.default`
 *    (`buildImapSourceFromCredentials`). That token carries only permissions
 *    configured on Office 365 Exchange Online, so the recipe names
 *    `IMAP.AccessAsApp` under that API, and the two Exchange Online steps
 *    Microsoft documents for app-only IMAP: registering the application's
 *    service principal (`New-ServicePrincipal`) and giving it the mailbox
 *    (`Add-MailboxPermission`).
 *
 * The recipes sit in `{#application}`, with a subsection per card, because
 * those two cards always take the customer's own registration: a fold that
 * closes where the deployment carries Microsoft's app would hide them.
 */
describe('the Microsoft guide carries both registration recipes (0148 T8)', () => {
  /** A section's lines, from its `{#id}` heading to the next heading of its level or above, fences skipped. */
  function sectionOf(text: string, id: string): string | undefined {
    const lines: string[] = [];
    let inFence = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) inFence = !inFence;
      lines.push(inFence || line.startsWith('```') ? '' : line);
    }
    const raw = text.split('\n');
    const heading = new RegExp(`^(#{1,4}) .*\\{#${id}\\}\\s*$`);
    const start = lines.findIndex((line) => heading.test(line));
    if (start === -1) return undefined;
    const level = heading.exec(lines[start]!)![1]!.length;
    const end = lines.findIndex((line, i) => i > start && /^#{1,4} /.test(line) && /^#+/.exec(line)![0].length <= level);
    return raw.slice(start, end === -1 ? undefined : end).join('\n');
  }
  /** The permissions a list names: one per bullet, in backticks at its start. */
  const listed = (section: string) => [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]!);
  const DELEGATED_ONLY = ['IMAP.AccessAsUser.All', 'offline_access'];
  /**
   * Entra's words for the kind of permission and for the consent button, as
   * its screen shows them. The Dutch guide names Entra's screens by their
   * English names until 0148 T0 reads Microsoft's Dutch screens against it,
   * and class 5 of `docs/i18n-prose-boundary.md` then wants Microsoft's own
   * Dutch, so a Dutch guide may carry either and the correct change does not
   * turn this red. The permission names, the API names and the cmdlets are
   * the same in every language and are held exactly.
   */
  const ENTRA_WORDS = {
    en: { application: /Application permissions/, consent: /Grant admin consent/ },
    nl: {
      application: /Application permissions|Toepassingsmachtigingen/,
      consent: /Grant admin consent|Beheerderstoestemming verlenen/,
    },
  } as const;

  it('reads a section to the next heading of its level, and not past it', () => {
    const doc = '### A {#a}\n- `One`\n#### B {#b}\n- `Two`\n```\n# not a heading\n```\n### C {#c}\n- `Three`\n';
    expect(listed(sectionOf(doc, 'a')!)).toEqual(['One', 'Two']);
    expect(listed(sectionOf(doc, 'b')!)).toEqual(['Two']);
    expect(sectionOf(doc, 'b')).toContain('# not a heading');
    expect(sectionOf(doc, 'missing')).toBeUndefined();
  });

  for (const locale of ['en', 'nl'] as const) {
    const guide = () => {
      const text = Object.entries(GUIDES).find(([p]) => nameOf(p) === `${locale}/microsoft`)?.[1];
      expect(text, `docs/guides/${locale}/microsoft.md is not served`).toBeDefined();
      return text!;
    };

    it(`${locale}: Via the Graph API's application permissions name Mail.Read, and no delegated-only one`, () => {
      const graph = sectionOf(guide(), 'application-graph');
      expect(graph, `${locale}/microsoft.md has no {#application-graph} section`).toBeDefined();
      expect(graph).toContain('Microsoft Graph');
      expect(graph).toMatch(ENTRA_WORDS[locale].application);
      expect(listed(graph!)).toContain('Mail.Read');
      for (const permission of DELEGATED_ONLY) {
        expect(listed(graph!), `${permission} is delegated only`).not.toContain(permission);
      }
      // Nowhere in the registration these cards need, not even in passing.
      const application = sectionOf(guide(), 'application')!;
      for (const permission of DELEGATED_ONLY) expect(application).not.toContain(permission);
      expect(application).toMatch(ENTRA_WORDS[locale].consent);
    });

    it(`${locale}: Via IMAP's recipe names IMAP.AccessAsApp under Office 365 Exchange Online, and the two Exchange steps`, () => {
      const imap = sectionOf(guide(), 'application-imap');
      expect(imap, `${locale}/microsoft.md has no {#application-imap} section`).toBeDefined();
      expect(imap).toContain('Office 365 Exchange Online');
      expect(listed(imap!)).toContain('IMAP.AccessAsApp');
      expect(imap).toMatch(ENTRA_WORDS[locale].consent);
      expect(imap).toMatch(/\bNew-ServicePrincipal\b/);
      expect(imap).toMatch(/\bAdd-MailboxPermission\b/);
      // The Via IMAP card's own subsection points at its recipe.
      expect(sectionOf(guide(), 'oauth2')).toContain('](#application-imap)');
      expect(sectionOf(guide(), 'graph')).toContain('](#application-graph)');
    });
  }
});

/**
 * The Google Drive card's about-line ended "…and ends with one read-only
 * command that proves them": a repository command, which is for whoever runs
 * the service (0148 T1). The button that checks the same three values against
 * Google is on the same screen, so the line names it, in each language by that
 * language's own label and as a button, so the label does not read as a verb.
 */
describe('the wizard names its own button, not a command', () => {
  it.each(['en', 'nl'] as const)('%s', (locale) => {
    const more = STRINGS[locale]['wizard.about.googleDrive.more'];
    const label = STRINGS[locale]['wizard.testConnections'];
    // Named as a control, so the label does not run into the verbs around it.
    expect(more).toContain(locale === 'en' ? `the ${label} button` : `de knop ${label}`);
    expect(more).not.toMatch(/command|commando/i);
  });
});
