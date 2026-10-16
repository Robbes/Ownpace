/**
 * A tester of the hosted Alpha who lands on GitHub's "New issue" page finds
 * their way to a person first (workplan 0144 T6 (c)).
 *
 * The issue tracker is public. A tester who opens an issue there to say
 * "my mail did not arrive" may paste addresses, mailbox contents or a
 * screenshot of their data, and nobody would answer them faster for it: the
 * Alpha's help is *Report a problem* in the app and the address in the tester
 * guide. So the chooser's FIRST contact link is for them, in English and in
 * Dutch, and points at the guide's *Hulp* section on the public site; and the
 * bug form's opening says the same to anyone who skips the chooser.
 *
 * The link is built from the site's own page names (`site/copy.mjs`), so a
 * renamed guide page fails here rather than leaving a dead link on GitHub.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The public site that publishes the Alpha's texts (0139 T10). */
const SITE = 'https://www.ownpace.eu';

interface ContactLink {
  name: string;
  url: string;
  about: string;
}

describe("GitHub's issue chooser, for a tester of the hosted Alpha (0144 T6 (c))", () => {
  const config = parse(read('.github/ISSUE_TEMPLATE/config.yml')) as {
    blank_issues_enabled: boolean;
    contact_links: ContactLink[];
  };
  const first = config.contact_links[0]!;

  it('opens with a link for the hosted Alpha, named in English and in Dutch', () => {
    expect(first.name).toMatch(/Ownpace Alpha/);
    expect(first.name, 'the name says it in Dutch too').toMatch(/Gebruikt u de Alpha van Ownpace\?/);
  });

  it("points at the tester guide's Hulp section on the public site, not at GitHub", async () => {
    // The site's own page names; imported by path, as the site's modules carry no types.
    const copyModule = '../site/copy.mjs';
    const { COPY, localeRoot } = (await import(copyModule)) as {
      COPY: Record<string, { files: Record<string, string> }>;
      localeRoot: (locale: string) => string;
    };
    const nl = COPY.nl!;
    const expected = `${SITE}${localeRoot('nl')}/${nl.files.guide}#hulp`;
    expect(first.url).toBe(expected);
    expect(new URL(first.url).hostname).not.toMatch(/github\.com$/);
    expect(read('site/pages/nl/alpha-handleiding.md'), 'the guide has no {#hulp} section').toMatch(
      /^## .*\{#hulp\}\s*$/m,
    );
  });

  it('warns, in both languages, not to open an issue and never to post their data', () => {
    const about = first.about;
    expect(about, 'English: no issue here').toMatch(/do not open an issue/i);
    expect(about, 'English: Report a problem').toMatch(/Report a problem/);
    expect(about, 'English: never post data').toMatch(/never post/i);
    expect(about, 'Dutch: no issue here').toMatch(/geen issue/i);
    expect(about, 'Dutch: Een probleem melden').toMatch(/Een probleem melden/);
    expect(about, 'Dutch: never post data').toMatch(/nooit/i);
  });

  it('keeps the security and self-host links, and the blank issue developers use (D6)', () => {
    const urls = config.contact_links.map((l) => l.url);
    expect(urls.some((u) => u.includes('/security/advisories/new'))).toBe(true);
    expect(urls.some((u) => u.includes('selfhost-quickstart'))).toBe(true);
    expect(config.blank_issues_enabled).toBe(true);
  });

  it("the bug form's opening names the hosted Alpha and where its testers go instead", () => {
    const form = parse(read('.github/ISSUE_TEMPLATE/bug_report.yml')) as {
      body: Array<{ type: string; attributes?: { value?: string } }>;
    };
    const opening = form.body.find((b) => b.type === 'markdown')?.attributes?.value ?? '';
    expect(opening).toMatch(/hosted Ownpace Alpha/);
    expect(opening).toMatch(/Report a problem/);
  });
});
