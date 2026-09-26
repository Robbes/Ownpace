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
  followedField,
  MICROSOFT_DOMAIN_SCOPES,
  MICROSOFT_OFFLINE_SCOPE,
  type CredentialField,
} from '@openmig/shared';
import { STRINGS, LOCALES, type Locale, type StringKey } from '../i18n/strings.ts';
import { SOURCE_CARDS, TARGET_CARDS, type FrontDoorCard } from '../components/front-door-cards.ts';

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
 * Which guide covers which card: the card's own `guide`, `<slug>#<section>`,
 * in `front-door-cards.ts` (workplan 0148 T4). This file restated the map as a
 * `guideSlugFor` function, a second copy of `Setup.tsx`'s, and read source
 * types only; both pages now read the card, and so does this.
 */
const EVERY_CARD: ReadonlyArray<{ role: 'source' | 'target'; card: FrontDoorCard }> = [
  ...SOURCE_CARDS.map((card) => ({ role: 'source' as const, card })),
  ...TARGET_CARDS.map((card) => ({ role: 'target' as const, card })),
];

/** A card's guide, split at the `#`. The field is required, so a card always names one. */
function guideOf(card: FrontDoorCard): { slug: string; section: string } {
  const [slug = '', section = ''] = String((card as { guide?: string }).guide ?? '').split('#');
  return { slug, section };
}

describe('the guides mention what the connector actually needs', () => {
  // The synonyms below are English, so this reads the English guides. The
  // wizard's own labels, in each language, are the case after this one (0148
  // T4); this one stays, since it also accepts the provider's own word.
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

  // EVERY CARD, BOTH SIDES, AND NO SKIP (workplan 0148 T4). This read source
  // types only and dropped a type whose guide did not ship, so the IMAP source
  // and all seven targets were never judged: a card with no guide passed by
  // not being asked. A card now names its guide, and a guide that is not
  // served fails here by name.
  const cases = EVERY_CARD.map(({ role, card }) => ({ role, type: card.id, slug: guideOf(card).slug }));

  it('covers every source and target card', () => {
    expect(cases.length).toBe(SOURCE_CARDS.length + TARGET_CARDS.length);
    expect(cases.filter(({ role }) => role === 'target').length).toBeGreaterThan(0);
  });

  it.each(cases)('$role $type — $slug names every required credential', ({ role, type, slug }) => {
    const text = bySlug.get(slug);
    expect(text, `the ${role} card '${type}' names the guide '${slug}', and en/${slug}.md is not served`).toBeDefined();
    const missing = credentialFieldsFor(role, type)
      .filter((f) => f.required)
      .map((f) => f.key)
      .filter((key) => {
        const re = SYNONYMS[key];
        // A field with no known synonym is not something this test can judge;
        // saying nothing is better than failing on a pattern it invented.
        return re ? !re.test(text!) : false;
      });

    expect(
      missing,
      `en/${slug}.md never mentions ${missing.join(', ')}, which the wizard REQUIRES for a ` +
        `'${type}' ${role}. Somebody following this guide reaches the form without the ` +
        `value it demands. Either the guide is out of date or the field is.`,
    ).toEqual([]);
  });
});

/**
 * THE WIZARD'S OWN LABELS, IN EACH LANGUAGE (workplan 0148 T4).
 *
 * The case above reads English synonyms, so it could not read a Dutch guide,
 * and it accepts a provider's word for a field ("App key") where the wizard
 * shows another. A guide is followed with the form open beside it, so in the
 * card's own section every field the wizard REQUIRES is named as the wizard
 * labels it, in that guide's language: `STRINGS[locale][field.labelKey]` for
 * `credentialFieldsFor(side, card)`.
 *
 * `LABELS_PENDING` names the guides split out of the operator documents
 * before this case existed, whose card sections name a field in the
 * provider's words or not at all (the Dropbox section never says Username).
 * They are quoted when those guides are next written; a listed guide that
 * passes in every language it is written in fails, so the list only shrinks.
 *
 * A LABEL THAT FOLLOWS ANOTHER ANSWER is every label it can be (2026-09-26).
 * The archive's path is *Where the archive is* on a disk and *Folder in your
 * destination's files* in the destination's files (0148 T9, the descriptor's
 * `follows`), and which one a tester sees depends on the choice above it.
 * This case read the declared label only, so it asked the guide for the disk's
 * label and never for the one managed shows by default; after #1178 the guide
 * named neither and wrote *The folder*. Each answer of the followed field is
 * resolved through `followedField`, the function both doors draw the label
 * with, and the section must name the label of every answer.
 */
const LABELS_PENDING: readonly string[] = ['box', 'dropbox', 'google', 'microsoft'];

/** Every label a field is shown under: its own, or one per answer of the field it follows. */
function labelKeysOf(fields: ReadonlyArray<CredentialField>, field: CredentialField): string[] {
  const follows = field.follows;
  if (!follows) return [field.labelKey];
  const answers = fields.find((f) => f.key === follows.key)?.options?.map((o) => o.value) ?? [];
  if (answers.length === 0) return [field.labelKey];
  return [...new Set(answers.map((answer) => followedField(field, { [follows.key]: answer }).labelKey))];
}

/** A card's own section: its `{#section}` heading, to the next heading at its depth or above. */
function sectionOf(body: string, section: string): string | undefined {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^#{1,4} .*\\{#${section}\\}\\s*$`).test(line));
  if (start === -1) return undefined;
  const depth = /^#+/.exec(lines[start]!)![0].length;
  const end = lines.findIndex((line, i) => i > start && /^#{1,4} /.test(line) && /^#+/.exec(line)![0].length <= depth);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('each card\'s section names its fields as the wizard labels them, in the guide\'s language', () => {
  const guideText = (locale: Locale, slug: string) =>
    Object.entries(GUIDES).find(([p]) => nameOf(p) === `${locale}/${slug}`)?.[1];

  /** The required labels the card's section does not name, per language its guide is written in. */
  const unnamed = (role: 'source' | 'target', card: FrontDoorCard) => {
    const { slug, section } = guideOf(card);
    const out: Array<{ locale: Locale; missing: string[] }> = [];
    for (const locale of LOCALES) {
      const body = guideText(locale, slug);
      if (body === undefined) continue;
      const text = sectionOf(body, section) ?? '';
      const fields = credentialFieldsFor(role, card.id);
      const labels = fields
        .filter((f) => f.required)
        .flatMap((f) => labelKeysOf(fields, f))
        .map((key) => STRINGS[locale][key as StringKey]);
      out.push({ locale, missing: labels.filter((label) => !text.includes(label)) });
    }
    return out;
  };

  const judged = EVERY_CARD.filter(({ card }) => !LABELS_PENDING.includes(guideOf(card).slug));

  it('judges the cards of every guide not pending, targets included', () => {
    expect(judged.filter(({ role }) => role === 'target').length).toBe(TARGET_CARDS.length);
    expect(judged.some(({ role, card }) => role === 'source' && card.id === 'imap')).toBe(true);
  });

  it('judges a field whose label follows another answer by more than one label', () => {
    // Guards the resolution above: with no such field judged, it would pass on nothing.
    const following = judged.flatMap(({ role, card }) => {
      const fields = credentialFieldsFor(role, card.id);
      return fields.filter((f) => f.required && f.follows).map((f) => labelKeysOf(fields, f));
    });
    expect(following.length).toBeGreaterThan(0);
    expect(following.every((keys) => keys.length > 1)).toBe(true);
  });

  it.each(judged.map(({ role, card }) => ({ role, id: card.id, card })))('$role $id', ({ role, id, card }) => {
    const { slug, section } = guideOf(card);
    const results = unnamed(role, card);
    expect(results.length, `${slug} is written in no language`).toBeGreaterThan(0);
    for (const { locale, missing } of results) {
      expect(
        missing,
        `${locale}/${slug}.md's section {#${section}} does not name ${missing.join(', ')}, which the ` +
          `wizard asks for on the ${role} card '${id}' under exactly that label. Quote it as the ` +
          `form shows it, so the reader can find the box.`,
      ).toEqual([]);
    }
  });

  it.each(LABELS_PENDING)('%s is still pending: some card section of it misses a label', (slug) => {
    const cards = EVERY_CARD.filter(({ card }) => guideOf(card).slug === slug);
    expect(cards.length, `no card names ${slug}; drop it from LABELS_PENDING`).toBeGreaterThan(0);
    const stillMissing = cards.some(({ role, card }) => unnamed(role, card).some(({ missing }) => missing.length > 0));
    expect(stillMissing, `${slug} now names every label: take it off LABELS_PENDING`).toBe(true);
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
  const guide = Object.entries(GUIDES).find(([p]) => nameOf(p) === 'en/microsoft')?.[1];

  it.each([...Object.values(MICROSOFT_DOMAIN_SCOPES), MICROSOFT_OFFLINE_SCOPE])('%s', (scope) => {
    expect(guide, 'docs/guides/en/microsoft.md is not served').toBeDefined();
    expect(guide).toMatch(new RegExp(`^- \`${scope.replace(/\./g, '\\.')}\` `, 'm'));
  });
});

/**
 * THE RECIPE THAT IS BEING REWRITTEN (workplan 0148 T8). `o365-setup.md`'s
 * application-permission list for the *Via IMAP* and *Graph API* cards names
 * `IMAP.AccessAsUser.All` and `offline_access` under Microsoft Graph's
 * APPLICATION permissions. As Microsoft documents them, both are delegated
 * only, and an app-only token for Exchange Online carries neither. When the
 * customer half moved into `docs/guides/`, that list stayed behind on purpose:
 * the served guide says the recipe is being rewritten, and T8 writes it. This
 * holds the half that can be held today: no served guide names the permission
 * that exists only in the wrong list.
 */
describe('no served guide carries the application-permission list being rewritten', () => {
  it.each(Object.keys(GUIDES))('%s', (path) => {
    expect(
      GUIDES[path]!.includes('IMAP.AccessAsUser.All'),
      `${nameOf(path)} names IMAP.AccessAsUser.All, which only o365-setup.md's application ` +
        'list used, and that list is wrong (0148 T8). Leave the card\u2019s recipe to the rewrite.',
    ).toBe(false);
  });
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
