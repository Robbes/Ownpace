// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
 * The guides are read through the SAME `import.meta.glob` the page uses, so a
 * renamed or unpublished document fails here rather than 404ing for a customer.
 */
import { describe, it, expect } from 'vitest';
import { credentialFieldsFor, connectableTypes } from '@openmig/shared';

const GUIDES = import.meta.glob('../../../../docs/*-setup.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');

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

describe('the guides the app serves are written for customers', () => {
  it('ships at least one guide, read through the page\'s own import', () => {
    // Guards the rest: a glob that silently matches nothing would pass every
    // assertion below without reading a single document.
    expect(Object.keys(GUIDES).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(GUIDES))('%s cites nothing internal', (path) => {
    const text = GUIDES[path]!;
    for (const { label, re } of INTERNAL_REFERENCE) {
      const hit = re.exec(text);
      expect(
        hit,
        `${slugOf(path)} contains ${label} (“${hit?.[0]}”). These guides are served to ` +
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
        `${slugOf(path)} contains ${label} (“${hit?.[0]}”). Whoever reads this is running ` +
          `exactly one edition and cannot tell which paragraphs are theirs.`,
      ).toBeNull();
    }
  });
});

/**
 * Which guide covers which wizard type — the same mapping `Setup.tsx`'s
 * `guideSlug` uses, restated as data so the coverage check below can invert it.
 */
function guideSlugFor(provider: string): string {
  if (provider.startsWith('google') || provider === 'gmail') return 'google-workspace-setup';
  if (provider === 'oauth2' || provider === 'graph') return 'o365-setup';
  return `${provider}-setup`;
}

describe('the guides mention what the connector actually needs', () => {
  const bySlug = new Map(Object.entries(GUIDES).map(([p, t]) => [slugOf(p), t]));

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
      `${slug}.md never mentions ${missing.join(', ')}, which the wizard REQUIRES for a ` +
        `'${type}' source. Somebody following this guide reaches the form without the ` +
        `value it demands. Either the guide is out of date or the field is.`,
    ).toEqual([]);
  });
});
