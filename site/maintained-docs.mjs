// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MAINTAINED DOCUMENTATION `llms.txt` LINKS (ADR-0029; workplan 0152 T5 (c)).
 *
 * ADR-0029 says the site ships an `llms.txt` "curated from the existing
 * documentation rather than written fresh": the ADRs, workplans and runbooks
 * are already the honest account of what this product does, so the curation
 * job is selection, not composition, and the file lists them rather than
 * restating them. This is that selection, for an assistant asked to explain
 * the product: what it is, how data moves, the security and privacy model,
 * self-hosting, and the Alpha. `llmsTxt` in `build.mjs` writes one section per
 * topic, after the site's own pages, and one line per document:
 *
 *   - [its own first heading](its Markdown on main)
 *
 * with no notes after the link. The topic names are the only words here
 * written for `llms.txt`; each title is the document's own `# ` heading,
 * copied, because the build reads nothing outside `site/` (below), and
 * `scripts/llms-docs.mjs` holds the copy to the heading.
 *
 * ON `main`, NOT A RELEASE TAG, for three reasons:
 *
 *  1. The check can only vouch for the tree it runs in, and that tree is what
 *     lands on `main`. A link at a tag names a file as it stood at the tag,
 *     which no check of today's tree sees: a document added after the tag
 *     would be a line the check passed and GitHub answers 404.
 *  2. These are the MAINTAINED documents, and `main` is where they are
 *     maintained. At a tag, a workplan's Status block reads as it did on the
 *     day of the release, for as long as the tag stands.
 *  3. The site's other links into the repository are on `main` too
 *     (`proof.mjs`, and security.txt's policy in `security-txt.mjs`).
 *
 * What that costs, said so it is not found later: live's site is built from a
 * release tag and links `main`, so a document renamed on `main` after the tag
 * is a dead link on www.ownpace.eu until the next release's deploy rebuilds
 * the site. The check makes the rename change this list in the same pull
 * request, so `main`, and the OTA site that follows it every night, have the
 * new link at once. Workplans and ADRs stay where they are by policy
 * (`docs/workplans/README.md`; AGENTS.md hard rule 7), and they are most of
 * this list.
 *
 * THE MARKDOWN ITSELF, NOT GITHUB'S PAGE FOR IT. `github.com/…/blob/main/…`
 * is a page whose text sits in a JSON payload for its script to render: for
 * `SECURITY.md` on 2026-10-31, 214,016 bytes of HTML against the 7,293 bytes
 * of the file at `raw.githubusercontent.com`, served as `text/plain;
 * charset=utf-8`. ADR-0029's first rule is content readable without running
 * JavaScript, and llmstxt.org links Markdown. The address is the
 * repository's own (`REPOSITORY_URL`, held to the one the README clones by
 * `scripts/claims-you-can-check.unit.test.ts`) on GitHub's host for raw files,
 * and a relative link inside a document resolves there to the next one.
 *
 * WHY THE CHECK IS NOT IN `build.mjs`. Live's deploy test-builds the site
 * before anything moves from `git archive <tag> site package.json`
 * (`site_test_build` in `deploy/compose/deploy-live.sh`), and the tests build
 * copies of `site/` alone: a build that read `../docs` would refuse every
 * deploy, and one that skipped the check when the documents were absent would
 * be a check that passes by not looking. So the build reads this list and
 * nothing else, and `node scripts/llms-docs.mjs --check` runs in CI's
 * `docs-hygiene` on every change, docs-only ones included: a document renamed,
 * removed or retitled fails the pull request that does it, not the link.
 * `scripts/a-doc-an-assistant-is-sent-to.unit.test.ts` holds both.
 */

import { REPOSITORY_URL } from './proof.mjs';

/** The repository on GitHub's host for raw files: `https://raw.githubusercontent.com/<owner>/<name>`. */
export const RAW_REPOSITORY_URL = REPOSITORY_URL.replace(/^https:\/\/github\.com\//, 'https://raw.githubusercontent.com/');

/** A document in the repository, by its path in the tree, as `llms.txt` links it: its Markdown on `main`. */
export const docUrl = (path) => `${RAW_REPOSITORY_URL}/main/${path}`;

/**
 * The selection, by topic, in the order `llms.txt` lists it. `title` is the
 * document's own first `# ` heading, word for word.
 */
export const MAINTAINED_DOCS = [
  {
    topic: 'What it is',
    docs: [
      // The repository's front page: the two editions, the status, and how
      // the code is written.
      { path: 'README.md', title: 'Ownpace' },
      // What migrates, per object type, and what does not, mirrored from the code.
      { path: 'docs/feature-matrix.md', title: 'Feature matrix — what migrates, per object type, and what does not (yet)' },
      // Every decision in force, generated from the ADRs themselves (ADR-0038).
      { path: 'docs/adr/OPERATIVE.md', title: 'ADR operative rules — what holds NOW' },
    ],
  },
  {
    topic: 'How data moves',
    docs: [
      // The source of truth: domains and idempotency, shadow-running and cutover.
      { path: 'docs/architecture/solution-architecture.md', title: 'Solution Architecture — Ownpace' },
      // What a rollback does, and what it does not do.
      { path: 'docs/rollback-mechanisms.md', title: 'Rollback Mechanisms' },
    ],
  },
  {
    topic: 'Security and privacy',
    docs: [
      { path: 'SECURITY.md', title: 'Security Policy' },
      // Where row security holds between organisations, and where it does not.
      { path: 'docs/rls-guide.md', title: 'Row-Level Security (RLS) Guide' },
      { path: 'docs/breach-procedure.md', title: 'When personal data may have leaked' },
    ],
  },
  {
    topic: 'Self-hosting',
    docs: [
      { path: 'docs/selfhost-quickstart.md', title: 'Self-host quickstart (NAS / mini-PC / Raspberry Pi / Windows-WSL2)' },
      {
        path: 'docs/windows-appliance-runbook.md',
        title: 'Running the self-host appliance on Windows — a runbook for the owner',
      },
      { path: 'docs/selfhost-ending-the-service.md', title: 'Ending the service on the appliance' },
    ],
  },
  {
    topic: 'The Alpha',
    docs: [
      // Its decisions: free, by invitation, Dutch first, no backups.
      { path: 'docs/workplans/0131-the-alpha-and-who-is-let-in.md', title: 'Workplan 0131 — The alpha, and who is let in' },
      {
        path: 'docs/workplans/0134-no-backups-during-the-alpha-said-truthfully.md',
        title: 'Workplan 0134 — No backups during the alpha, said truthfully',
      },
      // What each Alpha release changed.
      { path: 'CHANGELOG.md', title: 'Changelog' },
    ],
  },
];
