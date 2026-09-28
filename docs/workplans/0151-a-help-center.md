# Workplan 0151 — A help center, from the text the app already ships

> **In one line:** Self-service help beyond the in-app setup guides: a help section on `www.ownpace.eu` rendered by `site/build.mjs` from the same `docs/guides` markdown `Docs.tsx` serves, FAQ and troubleshooting pages fed by support reports, and later Zammad's Knowledge Base for broad articles.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: opened from the owner's question, and parked whole at the owner's word.** The
owner asked: *"Also reason on Zammad: can it evanually offer a complete self-service-portal for
people to find all kind of instructions instead of the 'setup guides'-app section?"*

The answer given in chat: yes. It said Zammad's Knowledge Base offers a public help center:
categories, answers per language (Dutch and English), search, images, attachments and video, a
visibility per answer (draft, internal, public), an address of its own such as `help.ownpace.eu`,
agents who insert an answer into a reply, and customers who see their own reports. These are what
the chat answer said of Zammad's Knowledge Base, from general knowledge. None was read in Zammad's
documentation, which this session could not reach, and none was tried against a running Zammad
(§1, *Zammad, upstream, to check*). The advice was two layers, in two steps:

- **Keep the short, step-bound instructions in the app.** They are checked against the code by
  guards, versioned with the release, and read offline on the appliance (§1).
- **Put the broader self-service in a portal:** FAQ, troubleshooting, "how do I move from X to
  Y", provider screens with screenshots.
  - **Now, the cheapest:** a help section on `www.ownpace.eu`, built from the same
    `docs/guides` markdown. One source, versioned, bilingual, indexable, and no extra service.
  - **After the alpha,** when Zammad runs for reports anyway, its Knowledge Base for broad
    articles. It is worth it when people outside the repository write articles, or when tickets
    are answered with a link to an article.

The owner answered: *"yes, write the help center workplan. But we do park that for later."* So
every task is 🅿️ parked, with the trigger in §5. Nothing is built. Nothing here is in 0131 T5's
go/no-go list for the first invitation. 0148's Status block points here as its parked follow-up.

| Task | Status | Notes |
|---|---|---|
| T1 A help section on `www.ownpace.eu`, rendered from `docs/guides` | 🅿️ **Parked (trigger, any of §5's three: the alpha's end is planned with Zammad for reports after it; the owner asks; the same question reaches support from three people)** | §3. Both languages from the one source. The site's renderer learns what the guides use. A guard holds that every card's guide has a page carrying the card's section, and one module gives the page's address per card for screens outside sign-in and for mail. |
| T2 The app's text and the page stay one text | 🅿️ **Parked (trigger: with T1)** | §3. No copy is written: both builds read the same files. A guard compares what the two renderers make of every guide. The site is rebuilt from the release tag live runs, so the page describes the release a tester uses. |
| T3 FAQ and troubleshooting pages from what support sees | 🅿️ **Parked (trigger: T1 done, and §5's third trigger: the same question from three people)** | §3. Written as guides, where open question 1 puts them, under the same lint. Fed by problem reports: by mail during the alpha, Zammad after. They link 0144 T2's known-limitations page and never copy it. |
| T4 Zammad's Knowledge Base for broad articles | 🅿️ **Parked (trigger: Zammad runs for problem reports, and somebody outside the repository writes articles or tickets are answered with an article link)** | §3. A decision on what moves and what stays in git, how the site and the Knowledge Base link each other, and whether git feeds it through Zammad's API (to check upstream). |
| T5 The appliance: bundled, with at most one link | 🅿️ **Parked (trigger: with T1)** | §3. The appliance keeps the guides in its bundle and reads them with no network. It has no Zammad and no report route. At most one line on its `/docs` index to the help section. |

## 1. What there is today

Every file and line below was read on `main` at `93958ac3` on 2026-09-28.

### The setup guides in the app

- **The text.** `docs/guides/en/` and `docs/guides/nl/` hold the same eleven guides: `apple`,
  `archive`, `box`, `dav`, `dropbox`, `google`, `imap`, `jmap`, `microsoft`, `nextcloud` and
  `soverin`. They are written for the person who connects an account (0148 T1, D1). The
  operator and self-host material stays in `docs/*-setup.md`, which is not served.
- **How the app shows them.** `apps/web/src/pages/Docs.tsx` inlines every
  `docs/guides/*/*.md` at build time (`import.meta.glob(…, { query: '?raw', eager: true })`,
  :56). Its header gives the reason: *"a setup doc that can drift from its connector is how a
  customer follows five correct steps and one that stopped being true two releases ago"*.
  `/docs/<slug>` opens the guide in the reader's language, or the other one under a notice
  (`pickGuide`, :97). The `{#own-app}` section folds where `/api/provider-clients` says the
  deployment carries that provider's app (:318, :538). The renderer takes headings with ids,
  lists, numbered steps, fenced code and links. Tables and blockquotes are 0148 T6 (b), after
  the first invitation. It renders no image, and the page has no search. The app calls the
  section *Setup guides*, and *Handleidingen* in the Dutch sidebar (`nav.docs`).
- **A guide per card.** Each card in `apps/web/src/components/front-door-cards.ts` carries
  `guide: '<slug>#<section>'` (:45). `cardGuideHref` (:186) turns it into
  `/docs/<slug>#<section>`. The setup checklist and the wizard link it as *Read the full setup
  guide* (`Setup.tsx`:135, :302; `CreateMapping.tsx`:98-102), and the wizard's link opens a new
  tab.
- **The guards that check the guides' facts.**
  - `apps/web/src/pages/a-guide-for-every-card.unit.test.tsx`: all twenty cards name a served
    guide and a section of their own under `{#connect}`, in every language the guide is written
    in. Both languages carry the same section ids in the same order. The `/docs` index lists
    every guide a card names, and the checklist and the wizard link the card's section.
  - `apps/web/src/pages/end-user-docs.unit.test.tsx`: no internal references (ADR or workplan
    numbers), no edition asides, no operator material. Every credential the connector needs is
    mentioned. Each card's section names its fields as the wizard labels them, in the guide's
    language, and only the steps the wizard has. The Microsoft guide lists every permission the
    consent asks for and carries both registration recipes. The Apple export carries its tag.
    No `*-setup.md` sits under `docs/guides/`, and every guide sits in a folder named after a
    language the app speaks.
  - `apps/web/src/pages/Docs.unit.test.tsx`: the renderer's shape, the language fallback, the
    own-app fold, and `TRANSLATION_PENDING` (:703), empty today.
  - `apps/web/src/pages/a-checklist-that-says-what-comes-first.unit.test.tsx`: each checklist
    step names what the card's guide section names, in the same language.

  CI runs these on a change to a guide alone: `.github/workflows/ci.yml` names `docs/guides/**`
  in its path filter (0148 T1), and `scripts/a-doc-a-test-reads-that-ci-skipped.unit.test.ts`
  keeps that true.
- **Who can reach them.** On managed, `/docs` sits under the `/` route, which is wrapped in
  `ProtectedRoute` (`apps/web/src/AppRoutes.tsx`:81, :209-214, :338-339), so a guide is read only
  after sign-in. The pages open to somebody without an account are the request page and the grant
  and progress links (`/request-access`, `/grant/:link`, `/view/:link`), besides sign-in
  (`/login`, `/auth/callback`) and the 404 page (:140-190, :507). None of them links a guide. The
  person who follows a grant link *"will never have an Ownpace account"* (the route's comment), so
  they cannot open one. On the appliance, `ProtectedRoute` lets everything through: it is
  *"single-user, bound to localhost"* (:85).
- **The appliance.** It runs its own build of the same app, in selfhost mode
  (`apps/web/src/appliance-bundle.unit.test.ts`:49-72), which inlines the same guides, so it reads
  them with no network. Its `/docs` index adds one line to the operator documents on GitHub
  (`OPERATOR_DOCS_URL`, :112; 0148 D9).

### The public site

- **The build.** `site/build.mjs` writes `site/dist/`: per language, a landing page, how it
  works, pricing, the estimate, the privacy policy and the terms (`PAGE_KEYS`, :430; `SOURCE`,
  :881), and a 404 page. English is at the root and Dutch under `/nl/` (`site/copy.mjs`). It
  imports no workspace package, so that the public pages can move to a deploy of their own
  (0086 T7; the file's header). It already reads one file outside `site/`, the root
  `package.json`, for its build stamp (`BUILD`, :449), and its comment says why that is no
  dependency.
- **`--public`** (:69) makes the site indexable. Without it every page is noindex, and
  `robots.txt` disallows everything. A `--public` build refuses to write while a placeholder is
  left in a legal page (:1034), and refuses a test app address.
- **Its renderer** (`markdown()`, :154) takes what the legal and prose pages use: headings,
  paragraphs, flat lists, tables, blockquotes, rules and inline spans. Held by
  `site/site.unit.test.ts` (:231, *"leaves no Markdown unrendered in any built page"*). What the
  guides use and it does not:
  - a heading's `{#id}`: it takes the id from a slug of the whole heading (:182), so
    `## Connecting {#connect}` would show the braces and get the id `connecting-connect`;
  - fenced code: the Microsoft guide has four fenced blocks in each language;
  - a link to another guide by its file name, such as `nextcloud.md`;
  - the own-app fold.

  No guide nests one list in another today. If one does, the app shows the indented bullets as a
  list of their own between the steps and carries the step count on after them
  (`Docs.tsx`:200-201, :266-268; the fixture in `Docs.unit.test.tsx`:159), where this renderer
  folds them into the parent list. The site would need the app's behaviour then, not before.
- **What it may run.** Its nginx serves every page under `csp_strict`
  (`deploy/compose/www-nginx.conf`:23): no script, images from the site itself only. The
  calculator pages are the one exception, one inline script pinned by hash (:34). A static
  page therefore cannot ask the app whether the deployment carries a provider's app. Addresses
  are served as written, with no `.html` added (`try_files $uri $uri/ =404`, :53).
- **Where it runs.** It is built by hand from a checkout (`docs/managed-bring-up.md`, *The
  public site is a separate stack*) and served by `deploy/compose/www.yml`. During the alpha the
  reference machine serves `www.ownpace.eu` (0139 T0 fact 6, supplied 2026-09-28). A second copy
  of the site beside the OTA test site, from live's checkout, is 0139 T10 (b), built on branch
  `claude/ownpace-public-readiness-y7orc6-a-site-named-by-its-project`, not merged. Live's
  checkout is always a release tag (`deploy/compose/deploy-live.sh`, header), and that script
  does not build the site.
- **How the app links it.** `apps/web/src/services/legal-links.ts` (0139 T10 (a)) turns one
  build setting, `VITE_LEGAL_SITE_URL` (default `https://www.ownpace.eu`, :56), into an address
  per page and per language. `scripts/a-policy-link-that-answers.unit.test.ts` runs the site
  build and fails when an address is not a file it writes. That is the pattern T1 follows.
- **Pages already planned for the site.** 0144 T1, a tester guide, only in an alpha build, so it
  leaves the site when the alpha ends. 0144 T2, a known-limitations page that the feature matrix
  keeps true, in every build. Both are proposed. Neither is a help section, and both stay 0144's.

### Problem reports

- **Built (0130 T1 to T3, 2026-09-23).** On managed, *Report a problem* files a ticket on the
  owner's Zammad through `POST /api/problem-reports`, with the reporter as the ticket's customer,
  so a reply reaches them by mail. The grant and progress links have *Report this link* on the
  same helpdesk (0108 T8 (d)).
- **Built (0130 T5, 2026-09-28): by mail when there is no Zammad.** The owner chose that during
  the alpha a report goes by mail to `support@ownpace.eu`, and Zammad stays the long-term plan.
  `apps/api/src/services/report-channel.ts` still prefers a Zammad when `ZAMMAD_URL` and
  `ZAMMAD_TOKEN` are both set, and otherwise, when the API's mail is set up, sends one mail per
  report through the API's relay to `REPORT_MAIL_TO`. Its header quotes the owner's answer. So
  the form and *Report this link* show when either way is set up, not only with a Zammad. No
  Zammad runs for `ownpace-live` during the alpha (0139 T0's fact 3), so there a report is a mail.
  0130's Status block records the choice and what was built.
- **The appliance** has no report route and no Zammad. It sends nothing until its owner points
  it at a helpdesk of their own (0130's Status block; 0129 D5).

### Zammad, upstream, to check

Everything in this subsection is what the chat answer said of Zammad's Knowledge Base, from
general knowledge. None of it was read in Zammad's documentation, which the session that wrote
this plan could not reach. None of it is in this repository, and none was tried against a running
Zammad. What T4 would rely on is marked *to check*.

- Categories and answers, each answer in one or more languages. *To check:* how a Dutch and an
  English answer are tied together, and what a reader sees when one is missing.
- A visibility per answer: draft, internal (agents only) or public. *To check:* whether a customer
  ever sees an internal answer, through search, a link or a reply.
- A public help center at an address of its own, such as `help.ownpace.eu`. *To check:* what a
  custom address needs of the reverse proxy and of TLS.
- Search over the public answers. *To check:* whether a reader who is not signed in can search,
  and whether a search in one language finds the answers in that language only.
- Images and attachments in an answer, and embedded video. *To check:* whether an embed loads a
  third party's player in the reader's browser, which is a privacy question.
- Agents insert an answer, or a link to it, into a reply. *To check:* whether an internal answer
  can be inserted into a reply to a customer, and what the customer then receives: the answer's
  text, or a link they cannot open. T4's sync option rests on this.
- Customers see their own tickets. *To check:* whether a person whose ticket 0130's form created
  can sign in to see it, how they get a password, and whether that sign-in can be the identity
  provider's.
- An API. *To check:* whether Knowledge Base answers can be created and updated through it.
  That decides whether git can feed the Knowledge Base (T4).

## 2. The owner's question, the answer, and the decision (2026-09-28)

The question and the answer are in the Status block, verbatim where they are quoted.

- **D1, the plan is written and parked whole:** *"yes, write the help center workplan. But we do
  park that for later."* No task starts before §5's trigger.

Why two layers, as the answer gave them:

- **The in-app guide is the source, and it stays one.** It is checked by the guards above against
  the code of the same commit, it ships in the same build, and the appliance reads it with no
  network. A help section that wrote its own copy would lose all three, and Docs.tsx's header
  names that as the defect the in-app guide exists to prevent.
- **The broad questions do not belong to a card.** "How do I move from Google to Nextcloud",
  "why did my first mail pass take days", or a provider screen that changed: none of them is one
  card's steps. The in-app `/docs` index lists the eleven served guides, sorted by slug and titled
  by each guide's first heading (`GuideList`, `Docs.tsx`:506-519). The twenty cards share them,
  and a card links its own section. The broad questions need a page of their own, reachable
  before sign-in and by search engines.
- **Two steps, because Zammad is not running for reports yet.** During the alpha a report goes
  by mail (§1). A Knowledge Base on a Zammad that holds no tickets would be a second service run
  for its help pages alone. The site already exists, is served for the alpha, and needs no new
  name.

## 3. What each task does

### T1 — a help section on `www.ownpace.eu`, rendered from `docs/guides` (parked)

- **Pages.** One page per guide per language, and one index per language. Working addresses:
  `/help/<slug>.html` and `/help/index.html`, `/nl/hulp/<slug>.html` and `/nl/hulp/index.html`.
  The file names follow the guide's slug, so a card's `guide` field gives the address with no
  table in between. Open question 3 decides between a path on `www` and a host of its own.
- **One source.** `site/build.mjs` reads `docs/guides/<locale>/*.md` as files, as it reads the
  root `package.json`: nothing is imported, and nothing is copied into `site/` (open question 6).
- **The renderer learns the guides' grammar,** the list in §1: `{#id}` for a heading's id, fenced
  code, and links to another guide by file name, which become that guide's page with the same
  section. `site.unit.test.ts`'s *no Markdown left unrendered* then covers the help pages, once
  they are in `rendered`.
- **The own-app section, without a script.** In the app it folds, and `OwnAppFold` opens it with
  React state whenever the address names the `#own-app` heading or a heading inside the fold
  (`Docs.tsx`:376-410, :445). The heading itself sits outside the fold. The site runs no script
  under `csp_strict` (§1), and it cannot ask what the deployment carries, so it cannot do the
  same. Two shapes, chosen in T1:
  - (a) The section open, as a plain section whose first sentence says it is only for somebody
    who uses an app of their own. Nothing depends on the browser. *Recommended.*
  - (b) A closed `<details>` with that sentence as its summary. It would rely on the browser
    opening a closed `<details>` when the address names an element inside it. *To check,* per
    browser. It would never open for `#own-app` itself, which sits outside the fold.

  Either way, T2's guard treats the fold as a known difference between the two renderers: the
  app's summary comes from its own strings (`docs.ownAppFold`), the site's sentence from
  `site/copy.mjs`, and neither is in the guide.
- **In the nav.** One entry, *Help* and *Hulp*, in `PAGE_KEYS`, with its titles in `META` and its
  file names in `site/copy.mjs`. `site.unit.test.ts`'s *both locales are complete* holds that
  both languages carry its keys.
- **Indexable only under `--public`,** as every other page already is.
- **Links from the app to the page, per card.** A module beside `legal-links.ts`, working name
  `help-links.ts`, on the same setting: the site's address of a card's section, per language,
  from the card's `guide` field. It is used where a reader is not signed in, and in mail. Screens
  inside the app keep linking `/docs` (open question 4).

**Guards.** Each fails on `main` today, where the site writes no help page:

- A case beside `a-policy-link-that-answers`, working name
  `scripts/a-help-page-for-every-card.unit.test.ts`. It runs the site build and fails unless
  every card's guide has a page in each language, the page carries an element with the card's
  section id, and every address `help-links.ts` gives is a file the build writes. Like its model,
  it reads the list from the build, never from a list typed in the test.
- In `site/site.unit.test.ts`: a guide with a `{#id}` heading, a fenced block and a link to
  another guide renders each as the app does, not as text.

### T2 — the app's text and the page stay one text (parked; with T1)

- **The same files.** Both builds read `docs/guides/`. No second copy exists to drift, and every
  guard in §1 holds for the page as it does for the app.
- **The same shape.** The site cannot import `Docs.tsx`: the site imports nothing, and the
  renderer is React. So there are two renderers, and a guard holds them to the same result. For
  every guide in both languages it compares the heading ids in order, the resolved link targets,
  and each section's visible text, whitespace normalised. It renders the app's side through
  `GuideArticle` and runs the site's build in a child process, as `a-policy-link-that-answers`
  does. It fails when a guide uses a construct the two renderers render differently. The first
  likely case is a table or a blockquote, once 0148 T6 (b) lets guides use them, if the app's
  shape differs from the site's: the site renders both already (`site/build.mjs`:186-218).
- **The same release.** The in-app guide is the running release's. The site describes whatever
  checkout it was built from. Since live's checkout is a release tag (`deploy-live.sh`), the help
  pages are rebuilt from that tag when live is deployed. That is a step in `deploy-live.sh`, or a
  line in the bring-up if the site's copy is not live's (0139 T10 (b)). The site's footer
  already carries the build stamp, version and commit (`BUILD`), and the help index says which
  release it describes.

**Guard.** The comparison above, which fails today because the site renders no guide. And a case
in the T1 guard: no `.md` under `site/` carries a guide's first heading, so nobody copies one
into the site "for now".

### T3 — FAQ and troubleshooting pages from what support sees (parked)

- **What goes in.** A question that reaches support more than once, whose answer is not one
  card's steps. Examples: the order of work for a common move ("from Google to Nextcloud",
  linking the two cards' sections); why a first mail pass takes days; what the Failures page
  asks of you; a provider screen that looks different from the guide.
- **Where from.** Problem reports: by mail to `support@ownpace.eu` during the alpha, as tickets
  once Zammad takes them (§1). The owner keeps a short list of the questions and a count per
  question. That count is §5's third trigger. No report's content goes into a page: only the
  question, rewritten.
- **Where the text lives.** Open question 1. Recommended: beside the card guides, in
  `docs/guides/<locale>/`, so the app serves them, the appliance bundles them and the lint holds
  them. `end-user-docs.unit.test.tsx` already refuses a subfolder there.
- **Not a workaround for a defect.** When the answer to a question is a bug, the bug gets a plan
  and the page says nothing until it is fixed, or says what 0144 T2's known-limitations page
  says. T3's pages link that page and never repeat its entries.
- **Screenshots of provider screens.** Neither renderer shows an image today, and a screenshot
  goes stale when the provider changes its console. Text first. An image only once both renderers
  show one, a guard holds that every image a page names exists, and no image shows a real
  account's data. The site's policy already allows images from its own origin
  (`img-src 'self'`).

**Guard.** Each entry has a stable id, so a reply can link `#id`. Both languages carry the same
ids in the same order, as `a-guide-for-every-card` holds for the card guides. It fails today,
because no such page exists.

### T4 — Zammad's Knowledge Base for broad articles (parked; its own trigger)

- **When.** Zammad runs for problem reports, after the alpha, as 0130 intends, and one of two
  things holds: somebody outside the repository writes articles, or tickets are being answered
  with a link to an article. Before that, T3's pages in git do the same with less to run.
- **What moves, decided first.** Recommended split: the card guides stay in git. They are
  checked against the code and versioned with the release, and a Knowledge Base can do neither.
  T3's broad articles may move when their writer is not in the repository. Each moved article
  leaves the site's help index as a link to its new address. Its old pages, `/help/<x>.html` and
  `/nl/hulp/<x>.html`, each get a permanent redirect in `deploy/compose/www-nginx.conf`
  (`location = /help/<x>.html { return 301 … }`), which restates `csp_strict` as
  `site/calculator.unit.test.ts` requires of a location that sets its own headers. Without it the
  site's nginx answers 404 (`try_files $uri $uri/ =404`, :53), and a reply that linked the old
  page breaks.
- **How the two link.** The site's help index links the Knowledge Base, and every Knowledge Base
  answer that is about a card links that card's page on the site, not a copy of its steps. A
  `help.ownpace.eu` for the Knowledge Base is open question 3's option (b).
- **Git into the Knowledge Base, or links only.** *To check upstream:* whether the API writes
  answers, and whether an internal answer can go into a reply to a customer (§1). If both hold, a
  one-way sync from git could put the card guides into the Knowledge Base as internal answers
  that agents insert into replies. Recommended: links only, unless agents
  need a guide's text inside the Knowledge Base itself. A sync is a second copy, with the drift
  the in-app guide exists to prevent.
- **What it needs besides.** A name routed to it (0132 T1e routes three), where TLS ends and who
  runs it (0139 T0 facts 1 and 3), a place in the exposure check's allowed list (0132 T3,
  `exposure-check.sh`), a row on the status page (`deploy/compose/gatus.yaml`), the privacy
  policy's word on it (0130 T4), and the upstream checks above.

**Guard.** One module gives every address the app makes into the Knowledge Base, as
`legal-links.ts` does for the texts, and the status page watches the Knowledge Base's address.
And every retired help address redirects: a case in T1's guard reads the list of retired
addresses, one file beside `help-links.ts` that grows when an article moves, and fails unless
each is a `return 301` location in `www-nginx.conf`, so no moved article leaves a 404 behind.
All three are written when T4 is decided. Nothing can fail today, because nothing links the
Knowledge Base and no help address exists yet.

### T5 — the appliance: bundled, with at most one link (parked; with T1)

- **Bundled, as now.** The appliance reads its guides from its own bundle, in the language its
  owner reads, for the release it runs, with no network. T3's pages, if they live in
  `docs/guides/` (open question 1), are bundled the same way.
- **At most one link.** One line on the appliance's `/docs` index, under the operator documents'
  line (0148 D9): the help section on the site, for questions beyond the guides, marked as
  written for the current release. No link to T4's Knowledge Base: its articles are not held to
  the guides' rule against edition asides, and may describe the managed service only.
- **No Zammad and no reports.** Nothing changes here: the appliance keeps no report route
  (0130's Status block, 2026-09-23 entry; the route's comment in `AppRoutes.tsx`:340-342,
  *"The appliance has no report route"*), and it sends nothing until its owner points it
  somewhere (0129 D5). This plan gives it no route.

**Guard.** `apps/web/src/appliance-bundle.unit.test.ts` already builds both editions in memory. A
case there fails unless every guide's title is in the appliance's bundle, so that a change moving
the guides behind a network fetch fails. It should pass today. It is written with T1, which is
when the site first offers a reason to move them.

## 4. Order

All parked. When §5's trigger fires: T1 and T2 in one pull request, since T2's guard is what
makes T1's pages safe to publish. T5's line goes with them. T3 follows once questions exist to
answer. T4 waits for its own trigger, whichever trigger unparked the plan. None of it is before
the first invitation.

## 5. When it unparks

**The trigger: any one of these.**

1. **The alpha's end is planned, and Zammad with it.** The owner plans the end of the alpha
   (0131 T4, decided 2026-09-28: everything carries on under new conditions) and plans Zammad for
   problem reports after it. That is 0130's long-term plan, after the owner chose mail to
   `support@ownpace.eu` for the alpha on 2026-09-28.
2. **The owner asks for it.**
3. **The same question reaches support from three different people** (open question 5),
   counted by the owner as in T3. A question from somebody who could not reach a guide because
   they were not signed in, such as a grant link's holder, counts the same.

**What unparking starts with.**

1. Read §1 again against `main`. The paths, 0130's report channel, 0139 T10's site and 0144 T1
   and T2 will have moved, and this plan's facts are the date's.
2. Ask the owner open questions 1, 3 and 4, and 6 if the site has moved to its own deploy by then.
3. Write T1's guard first and show it failing on `main`: no help page for any card.

Whichever trigger fires, the work starts with T1. T4 is decided under its own trigger (§3).

## Lessons that apply

Grep `docs/LESSONS.md` for each file before editing it (`AGENTS.md`, session protocol). On
2026-09-28 it lists eight guards for `site/build.mjs`. These bear on this plan:

- `a-doc-a-test-reads-that-ci-skipped`: a test that reads a guide must run on a guide-only
  change. The filter already names `docs/guides/**`; a new guard in `site/` or `scripts/` that
  reads the guides needs nothing added, and a new folder of help text outside `docs/guides/`
  would.
- `a-policy-link-that-answers`: every address the app makes on the site is a file the build
  writes. T1's guard is its twin.
- `a-mount-that-went-blind`: the build empties `dist` and never replaces it.
- `pages-that-do-not-exist`: a wrong address gets the 404 page, in its language, with a 404
  status.
- `the-test-site-sent-people-to-production` and `what-build-is-this`: the site is told which
  environment it is for, and says which build it is.

One more is not in the index, because it sits in `site/` rather than `scripts/`:
`site/calculator.unit.test.ts` refuses a location in `deploy/compose/www-nginx.conf` that sets
its own headers without restating the policy. A help location that needs a header of its own
states `csp_strict`.

## Not in this plan

- The card guides themselves, their text and their guards: 0148. This plan renders them where
  more people can read them. It changes none of them.
- The tester guide and the known-limitations page on the site: 0144 T1 and T2.
- How a report travels, the Zammad installation, and the privacy policy's word on reports: 0130,
  and the mail transport on its branch (§1).
- Publishing `www.ownpace.eu` for the alpha and the site's second copy: 0139 T10.
- The operator and self-host documents, `docs/*-setup.md`. They stay in the repository, linked
  from the appliance (0148 D9), and are not part of the help section.
- The marketing pages (how it works, pricing, the estimate).
- A language beyond Dutch and English.

## Open questions

1. **Where do FAQ and troubleshooting texts live (T3)?**
   - (a) In `docs/guides/<locale>/`, beside the card guides. The app serves them, the site
     renders them, the appliance bundles them, and the lint holds them. *Recommended.* They also
     join the in-app `/docs` index, which lists every served guide sorted by slug (`GuideList`),
     so FAQ pages sit among the provider guides there unless the index learns to group them.
   - (b) In `site/pages/<locale>/`: on the site only, not in the app or on the appliance.
   - (c) In Zammad's Knowledge Base from the start. It needs a Zammad, and during the alpha none
     takes reports.
2. **Who may write them?**
   - (a) Only through a pull request to this repository, by the owner or an agent working for
     them, under the same guards as code. *Recommended* until T4's trigger.
   - (b) Also people outside the repository. That is T4's trigger, and Zammad's roles decide who
     (to check upstream).
3. **The address.**
   - (a) A path on `www.ownpace.eu`: `/help/` and `/nl/hulp/`. *Recommended.* No new name,
     route or TLS end, the same nginx and policy, and the same build.
   - (b) `help.ownpace.eu`: a new name to route (0132 T1e routes three), a TLS end (0139 T0 fact
     1), and something to serve it. It becomes the right choice if T4 puts the Knowledge Base
     there, and then `/help/` links to it.
4. **Where do the app's own guide links point?**
   - (a) Inside the app to `/docs`, as now: the running release's text, reachable on the
     appliance, no network. The site's page is linked only from places outside sign-in and from
     mail. *Recommended.*
   - (b) Everywhere to the site. One place to read, but the page may describe another release
     than the app, and the appliance would need the network for its own guides.
5. **The count in the third trigger.** *Recommended:* three different people with the same
   question. One is an anecdote, and waiting for ten leaves seven people without an answer.
6. **Reading `docs/guides/` from `site/build.mjs` (T1, T2).**
   - (a) Read the files in place, as the root `package.json` is read. *Recommended.* If the site
     moves to a deploy of its own (0086 T7), its build still runs from a checkout of this
     repository.
   - (b) Copy the guides into `site/` with a guard that they match. It keeps `site/`
     self-contained, and it is the second copy T2 exists to prevent.
7. **Search on the site (T1).**
   - (a) None on the site: an index per language grouped by card and topic, and pages indexable
     under `--public`, so a search engine finds them. *Recommended.* The site runs no script under
     `csp_strict`, and a search script would be a second exception pinned by hash, like the
     calculator's.
   - (b) A search script on the help pages, pinned by hash. Zammad's Knowledge Base brings its
     own search (to check upstream, §1), which is one more reason to leave search to T4.
