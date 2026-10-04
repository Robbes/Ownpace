# Workplan 0152 — A front door that shows the move

> **In one line:** The public site explains a move at a glance: old account and new home in one picture, the destinations named, the alpha said, a shorter menu, a calculator that ends in a button, monthly and yearly prices (a year costs six months), and a page per provider a person leaves.

## Status — 2026-10-04 (update this block at the end of every session)

**2026-10-04, later: D11 changes. A year is never refunded and never renews** (the owner: *"C,
nog refund of the first year"*; on credit left at the year's end, *"i, go ahead"*). ADR-0014
records it (*Amendment 2026-10-04*). A year is still credit at six months' price, and each of its
twelve months takes its own tier at half its monthly price. Nothing of it is refunded, also not
on cancelling; the right of withdrawal (terms §7) stands. What is left after the twelve months
pays the months that follow, at their monthly price, until it runs out; then the subscription
runs month to month.
- **Built:** the pricing page's year paragraph, and terms §8, in both languages, with question 27
  in the lawyer's briefing. The renewal line in `wf-pricing.svg` is now the year's line.
- **T6 (f) shrinks** to the withdrawal button: no renewal, no reminder before one, and no
  refunds to build. 0111's yearly invoice still draws the credit month by month.
- **Read, not said by the owner:** after the twelve months the credit pays the *full* monthly
  price, since C makes those months month to month. If the owner meant half price for as long as
  the credit lasts, one sentence changes on each page and in §8.
- **T0:** the new sentences are for the owner's reading, in both languages.

**2026-10-04: a new question for the owner, open question 5: which line the site shows during
the Alpha.** T1 (a) copies the app's alpha sentence to every site page. Since 0131 D4's
amendment that sentence is the owner's welcome, *"Welcome to the Alpha! Try Ownpace at your own
pace, and help others move to European alternatives more easily."*, and no longer the facts. So
every visitor would read it, invited or not. §3 T1 (a) says why; the owner decides before T1 is
built. The home wireframe's alpha line is now a placeholder (§5). Nothing here is built. On
branch `claude/ownpace-public-readiness-y7orc6-the-alpha-by-its-name`, not merged.

**2026-10-03, night: T6 (d) is built, and the price list is in force** (the owner's *"go"* on
the remaining work). One pull request changes ADR-0014's operative table, `site/prices.mjs` and
the managed code together, as the amendment asked:
- **The list:** Free (id `free`, was `tiny`) · Small €5 / €30 · Medium €12 / €72 · Large €40 /
  €240 · Extra large €80 / €480. No setup fees. `site/prices.mjs` and
  `packages/managed/src/tier-calculator.ts` are in integer cents with a yearly price; both guards
  parse the new table and now also hold *a year is six months* for every tier.
- **The cards** lead with the price a month and show the year's total under it, with *no setup
  fee* and a three-month total; the derived first month is gone. The home page says *"Free: one
  migration at a time, up to 250 GB."* A guard fails on any page that still names Tiny or quotes
  a setup fee (the legal texts aside).
- **The calculator** prices a top-up at the tier's monthly, once (the answer (b)), against the
  next tier's monthly difference, and says the break-even in days. `$csp_calc` is re-pinned.
- **The pricing page's rules:** *no setup fee*, *a year costs six months* (as credit, refunded
  when you stop), the top-up at the monthly, and *Why it is priced this way* now says *"Costs
  include our work"* (T6 (g)'s principle). The terms' §6 and §8 follow for Free and the setup fee;
  §8's paragraph on a prepaid term still says it is not refunded, which is T6 (f)'s and the
  lawyer's (0139) to rewrite.
- **The app:** the Billing and Support screens show the month and the year in cents, and the
  access form offers Free.
- **Still open:** T6 (e) (the switch and the price a month on yearly), (f) (renewal, refund,
  withdrawal), and 0111's yearly invoice. T0: every new sentence above is for the owner's reading.

**2026-10-03, later: the amendment is accepted, and a year is credit** (the owner, after *"the
pricing model doesn't have setup costs anymore"*: *"a"*). Question 2 is answered (a): a year is
credit at six months' price, and each month takes its own tier at half its monthly price. The
acceptance T6 (d)–(f) and T7 were waiting for is given; what they still wait on is 0111's yearly
invoice. The list comes into force with T6 (d)'s pull request, which changes ADR-0014's table,
`site/prices.mjs` and the managed code together.

**2026-10-03: the owner answered the amendment's top-up question: (b)** (*"Take b"*). Top-ups
stay, at the tier's monthly price, once. The year question is still open, and the amendment still
waits for acceptance; the answer is recorded in ADR-0014's *Pending* section. The rules in force
changed the same day: every step up is consented and paid for, and at the data ceiling new first
copies hold until the yes (ADR-0014, *Amendment 2026-10-03*).

**2026-09-29, morning: T6 (g)'s ADR-0014 amendment is drafted, for the owner's acceptance**
(R8 step 11's first need; the owner's answer 9, *"Yes"*, after checking it had not landed). The
amendment is appended to ADR-0014 as proposed, and the operative rules are unchanged until the
owner accepts:
- D9's list, with a yearly column and no setup fees;
- D11's year, which renews, can be stopped, and refunds;
- D12's principle, which replaces *"No profit" STANDS*.

It asks the owner two questions, each with a recommendation:
- **Top-ups**, which were paid with the setup fee: recommended, none; the tier moves up.
- **How a year meets a tier derived each month:** recommended, a year is credit at six months'
  price, and each month takes its own tier at half its monthly price.

The table changes with `site/prices.mjs` in T6 (d)'s pull request, because the price guards read
it.

**2026-09-29, morning: the owner's answers (asked by the writing session).**

- **T0 for D6 on the site's own pages:** #1339's Dutch is approved as written (*"Yes"*), as its
  own entry below says.
- **Open question 4: English at the root.** `/` stays English, and Dutch stays under `/nl/`.
- **T6 (g), the ADR-0014 amendment:** the writing session drafts it for the owner's acceptance
  (*"Yes"*, once it was checked that none had landed overnight). T6 (d)–(f) and T7 still wait on
  the amendment's acceptance and on 0111's yearly invoice.

**2026-09-28, night: D6 on the site's own pages, and T6 (a)'s guard (R8 step 2, by the writing
session at the owner's word *"continue on the rest"*).**

- **D6 is built for what the site writes.** Every form of *verhuizen* in `site/copy.mjs`,
  `site/pages/nl/` and `build.mjs`'s Dutch page titles is a form of *migratie* or *migreren*
  (52 places). Where a straight swap read worse, the sentence is rewritten:
  - *"Wie verhuist er?"* becomes *"Voor wie is het?"*, the app's *Voor wie?*;
  - *"Wat verhuist er?"* becomes *"Wat wilt u migreren?"*;
  - *"nadat ze zijn verhuisd"* becomes *"nadat ze zijn overgestapt"*.

  The owner read them and approved them as written on 2026-09-29 (*"Yes"*), *migreer uw eigen
  gegevens* in the footer and the home title included. Later that morning, asked again by session
  M, the owner chose the other wording for those two: *"'neem uw gegevens'. Rest is ok"*. The
  footer now says *neem uw gegevens mee, in uw eigen tempo* and the home page's title *Ownpace —
  neem uw gegevens mee, in uw eigen tempo*.
- **A guard** in `site/site.unit.test.ts` fails on `/verhui[sz]/i` in any Dutch page the build
  writes. The legal texts are excused by name: the privacy policy, the terms, and the Alpha
  conditions, which #1360 made a page of their own. They are 0139's, and still say *verhuizing*
  as the Alpha conditions' own word. The excuse fails when they follow D6.
- **T6 (a):** #1317 already took *"VAT is added where it applies"* off both pricing pages. The
  guard is new: no page may say both that prices include VAT and that VAT is added. #1317's
  briefing asks the lawyer whether one sentence covers both audiences, which is T6 (a)'s question
  to 0139.

**2026-09-28, evening: the owner's second answers settle every open choice but one.** Nothing is
built. The answers, quoted in §2:

- **All of it before the alpha (D5):** *"before we start Alpha i want this fixed/completed."* So
  T5 and T8 no longer wait for `WWW_LIVE`, and T6's price work no longer waits for the first
  invoice. Open question 1 is answered: *No*.
- ***Migratie*, never *verhuizing*, in Dutch (D6).** The site's *"4 verhuizingen tegelijk"*
  becomes *"4 migraties tegelijk"* (T0).
- **The price list (D9):** Free (replaces Tiny) · Small €5 a month or €30 a year · Medium €12 or
  €72 · Large €40 or €240 · Extra large €80 or €480.
  - VAT is included, and there are no setup fees.
  - The limits (migrations at the same time, data moved) are ADR-0014's, unchanged.
- **The price page (D10):** a switch that opens on yearly and shows the price per month and the
  discount against monthly. There is no strike-through, and the yearly total is always visible.
- **Renewal (D11):** a year renews by itself, the customer can stop at any time, and unused months
  are refunded.
- **The principle (D12):** *"Costs include our work"*. The price pays for the servers, the
  support and the time spent building the service, and self-hosting stays free. That replaces
  *"not to make a margin"* on the page. ADR-0014 is amended by the owner (T6 (g)).
- **The rest:**
  - the destinations the app supports are named (T4, T5);
  - a drawing now, and an app screen later (T3);
  - R builds from this session's drawings in [`docs/design/0152-0154/`](../design/0152-0154/README.md)
    (D8).

0131 T5's row for this plan is now the whole plan.

**2026-09-28: opened from the owner's request, with four answers from the owner.** The owner
asked, on 2026-09-28, for the website and the app to become more intuitive, from a UX and UI
point of view, with questions and recommendations, written up as workplans. This plan covers the
site (`site/`) and the two app pages its buttons lead to. 0153 covers the app's migrations and
the flow that creates them. 0154 covers progress and proof. The three plans were written
together, from one audit of the site and the app on `main` at `83eb73e` (§1).

| Task | Status | Notes |
|---|---|---|
| T0 The owner reads the new copy | ⏳ **Owner; before the first invitation, before each task merges. D6's *migratie* is built on the site's own pages; the legal texts are 0139's** | §3. Site copy is the owner's to approve (0144 T0). Every new sentence here is a proposal, in both languages. It includes *migratie* for *verhuizing* (D6) and the new *Why it is priced this way* (T6 (g)). |
| T1 The alpha, said on the site | 📋 **Proposed; before the first invitation**; (a)'s line waits for open question 5 (2026-10-04) | §3. The app's alpha sentence on every site page while the alpha setting is on. The unbacked *"Most people"* and *"Meest gekozen"* become a fact about the tier. *(2026-10-04: the app's sentence is now the owner's welcome (0131 D4's amendment), so copied as it is, every visitor would read the welcome. Open question 5.)* |
| T2 A shorter menu, and a header that fits a phone | 📋 **Proposed; before the first invitation** | §3. The header reads Home · How it works · Pricing · Sign in, plus the language switch. Privacy and Terms move to the footer. On a phone the menu folds into a `<details>`, which needs no script. |
| T3 The hero shows the move | 📋 **Proposed; before the first invitation** | §3. The drawing `hero-move.svg`, inlined: the old account's data, then Ownpace, then the new home, with our own icons (D4). Three facts sit under it, and a three-step strip links to *How it works*. An app screen joins it once 0153 T5 exists. |
| T4 The destinations, named | 📋 **Proposed; before the first invitation** | §3. A *Where to* section names what the app supports, from a site copy of the app's list with a guard that it matches. It says plainly that the new account is one the person opens and pays for themselves. |
| T5 A page per provider a person leaves | 📋 **Proposed; before the first invitation (D5)** | §3. *Leaving Google*, *Leaving Microsoft 365*, *Leaving iCloud*, *Leaving Dropbox*, *Leaving Box*, *Leaving another mail provider*: what moves, the limits, what the person does, the destinations it can go to, a typical cost. Built from copies of the app's own verdicts, each guarded. |
| T6 Pricing that reads in one pass | 🟡 **(a) done: the sentence by #1317, its guard beside D6's. (d) built 2026-10-03, with (g)'s principle on the page; the rest proposed, before the first invitation (D5)** | §3. (a) One VAT statement. (b) The rules as questions and answers. (c) A button to the calculator. (d) The new list, a year = six months (D9). (e) The monthly / yearly switch (D10). (f) The withdrawal button, and the year's end (D11, amended 2026-10-04). (g) The principle, the price that pays for the work (D12). |
| T7 A calculator that ends in a button | 📋 **Proposed; before the first invitation** | §3. (a) *Request access* carries the answers along. (b) *Until when?* says which payment suits it. (c) The layout faults and a live region. (d) Box as a source. |
| T8 Claims you can check | 📋 **Proposed; before the first invitation (D5)** | §3. "Open source" links the repository. Each proof point links the guard that holds it. The footer names the company once 0139 publishes it; until then that line is the one part that waits. |
| T9 One look from the site to the app | 📋 **Proposed; before the first invitation** | §3. `/request-access` and `/login` take the site's palette and logo, and link back to the site. The identity provider's own branding stays 0135 T6. |

## 1. What there is today

Every file and line below was read on `main` at `83eb73e` on 2026-09-28. The site was rendered
into a scratch folder with the CSP from `deploy/compose/www-nginx.conf` and photographed at 1280
and 390 pixels wide. `site/dist` was never written.

### The pages

`site/build.mjs` renders seven pages in each of two languages. English is at the root and Dutch
is under `/nl/`: home, how it works, pricing, estimate, privacy, terms and 404. `PAGE_KEYS`
(`build.mjs`:434) is `['home', 'how', 'pricing', 'calculator', 'privacy', 'terms']`, and the
header's menu is generated from it (`build.mjs`:473). So Privacy and Terms sit in the main menu,
and there is no *Sign in*. At 390 pixels the sticky header wraps onto three lines and takes 146
pixels.

### The home page

The home page is four blocks (`build.mjs`:605-634):

- the hero, with *"Move off Google or Microsoft. At your own pace."*;
- *What makes this different*, four cards;
- *What it will not do*, three cards;
- *What it costs*.

It has 423 words. The only image is the logo, and there is no SVG. A `.step` class is defined
(`build.mjs`:364) and never used.

The lede says where the data goes only as *"a European provider you choose"* (`copy.mjs`:63).
The site names no destination anywhere: not Soverin, not Nextcloud, not a JMAP server. Nothing
says the new account is one the person opens and pays for themselves. Target provisioning was
retracted (ADR-0008), and target providers are *"operated by somebody who is not us"*
(`docs/target-providers.md`:7).

### The alpha

The alpha is free, invite-only, Dutch, and has 10 to 20 testers (0131 D1). The site never says
so. The only sign is the button *Request access* and the build stamp in the footer. The alpha
sentence appears first on the app's `/request-access` and `/login`.

The site calls Small the choice of *"Most people"* (`copy.mjs`:99, :112), and *"Meest gekozen"*
in Dutch (:263). Nobody has chosen yet.

### Pricing

The pricing page shows ADR-0014's five tiers from `site/prices.mjs`. Each card leads with the
first month, setup included. Ten rules in bold-lead paragraphs follow (`pages/en/pricing.md`).

The page says *"All prices include VAT."* (`copy.mjs`:106) and, further down, *"VAT is added
where it applies."* (`pricing.md`:71; `prijzen.md`:73 *"Btw komt erbij waar die van toepassing
is."*). The two contradict each other on one page.

Pricing does not link the calculator. The calculator ends with a ghost button back to pricing
(`build.mjs`:867) and no way forward. *How it works* has no button at all.

There is no annual price. Billing monthly and annually is decided (0111 T9), and how far apart
the two are was decided on 2026-09-28 (§2, D3).

### The calculator

The calculator asks five questions (`copy.mjs`:136-137, `build.mjs`:816-828). Several answers
do less than the question suggests:

- **Until when?** changes only the Gmail sentence (`build.mjs`:751). The price line always says
  a three-month total.
- **Moving away from?** has no Box, which the product supports.
- **The layout at 1280 pixels.** The Calendar hint overlaps the Files label by 26 pixels.
- **The layout at 390 pixels.** The *THIS ONE DECIDES* badge covers its own heading.
- **An unrounded size.** A business on Microsoft reads *"1.3622 TB"* (`build.mjs`:668).
- **Screen readers.** The recomputed results have no live region, so a screen reader hears
  nothing when they change.

### The two app pages the buttons open

`/request-access` (`apps/web/src/pages/RequestAccess.tsx`) and `/login` (`Login.tsx`) use the
app's blue and a generic icon, with no Ownpace logo and no link back to the site. The site's teal
(`TEAL #0E4F4A`, `build.mjs`) stops at the click. The form reads `?tier=` only, so the
calculator's answers are typed again as free text.

### What must stay true

Any change here keeps these, all read in the files named:

- **One pinned script.** The site is server-rendered HTML that reads without a script (ADR-0029).
  The one script is the calculator, pinned by its sha256 in `www-nginx.conf`. Changing
  `calculator.mjs` or its glue means re-pinning `$csp_calc`, and
  `site/calculator.unit.test.ts` checks the hash.
- **The CSP:** `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action
  'none'`. Inline SVG and self-hosted images work. Web fonts, `data:` images, embeds and fetch
  do not.
- **No imports.** `site/` imports nothing from the workspace or npm (`build.mjs`:14-19). Any
  fact the app owns is copied into `site/` and guarded against its source, as `prices.mjs` is
  guarded against ADR-0014.
- **Markdown limits.** The site's Markdown renderer has no images and escapes raw HTML. New
  components are written in `build.mjs`.
- **No forms, no mailto buttons.** *Request access* stays a link to the app (0093).
- **Both languages.** Every `COPY` key exists in both (`site/site.unit.test.ts`). Translate the
  frame, never the finding (ADR-0013).
- **ADR-0014's words:**
  - "at the same time", never "concurrent";
  - "free", never "€0";
  - the calculator derives the tier and never offers it as a choice;
  - the bill-goes-down promise and its floor are said together.
- **VAT.** *"All prices include VAT."* appears on every page that shows a price, with no rate in
  the copy.
- **Fixed file names.** The legal files keep their names, because the app's link module is
  guarded against them.
- **"Read-only"** is said only beside Drive, Tasks and *Connect with Microsoft*
  (`scripts/a-read-only-claim-with-its-scope.unit.test.ts`). *How it works* is on its pending
  list for the owner's rewrite (0144 T3 (b)).
- **Two pricing paragraphs.** *Finishing lowers your bill* and *Unless you ask us to keep
  copying* stay within three paragraphs of each other
  (`scripts/a-sixth-state-added-to-only-one-list.unit.test.ts`).
- **The UI test.** `test/ui/site.ui.test.ts` finds the page by `.wrap`, `.btn-primary`, `.tier
  .price`, `nav.site a.lang`, `#what-*`, `#tier-*` and `#topup-line`. It checks that nothing
  scrolls sideways at 390 pixels.
- **Accessibility:** WCAG 2.2 AA.

## 2. The owner's decisions (2026-09-28)

The owner answered four questions in the session that wrote this plan.

- **D1 — One move per person.** The question: today a person leaving Google builds up to four
  migrations through a four-step form each. Should the app be built around one move per person,
  with the migrations set up underneath? The answer: *"as 1 (One move per person), but i think
  this is simular to the current 'Migrations' page, but just better fitting UX? One can add
  multiple migration paths (for example when one person is moving away from Google and Microsoft
  and Dropbox)."* 0153 builds it. For this plan it means the site's picture is one person's move,
  from one or more old accounts to a new home, never a copy job.
- **D2 — Before the first invitation.** The question was how this work sits against 0131 T5. The
  answer: *"Before the first invitation"*. This plan first read that as covering only what a
  tester meets, and asked (open question 1). D5 answers it: all of it.
- **D3 — A year costs six months.** The question: how many months of the monthly price should a
  year cost? The answer: *"A year = 6 months"*. So every paid band has two prices, the monthly
  and six times the monthly for a year. The page says the rule in plain words: *"Done within six
  months? Pay monthly. Longer, or not sure? A year costs the same as six months."* Nothing is
  struck through. The amounts and the page came the same evening, in D9 and D10. D10 replaces
  this line's *no percentage badge*.
- **D4 — Names and our own icons.** The question: how should Google, Microsoft, Apple, Dropbox,
  Soverin and Nextcloud appear? The answer: *"Names + our own icons"*. So no third-party logo
  file appears on the site or in the app. A provider is named in text next to our own icon: the
  initial tiles 0107 T2 built, and data-type icons for mail, contacts, calendar, files and
  photos. This settles 0107 T2's open *"real logos need the owner's go-ahead"*: there are none.
  The option the owner chose read *"our own neutral monogram tiles"*, so the tiles are neutral
  (`docs/design/0152-0154/tiles.svg`). That answers open question 3.

The owner answered the rest the same evening:

- **D5 — All of it before the alpha.** *"before we start Alpha i want this fixed/completed."*
- **D6 — *Migratie*, never *verhuizing*.** *"Yes, but dutch know 'één migratie en 4
  migraties'. So we use 'migratie' in instead of 'verhuizing'."* The site's Dutch follows (T0).
- **D7 — The destinations the app supports are named.** The owner chose *"Name what the app
  supports"*. On the homepage (T4) and on each *Leaving…* page (T5), a destination is named with
  the data types it takes, from the app's own list. The pages give no prices or ratings of
  theirs.
- **D8 — Drafted here, built by R.** *"you draft the workplans and UX/visual image elements we
  might need or explain in the workplans how/with what the other session should make those."*
  - The drawings are in `docs/design/0152-0154/`.
  - §5 says how each is built.
  - The tasks are group R8 in 0131 §6.
  - The homepage picture is *"Drawing now, app screen later"*.
- **D9 — The price list.** The owner asked for one free tier replacing Tiny and a very cheap one
  under €10 a month: *"Make it 5 euro per month, leaving it 30 euro if one pays anually. change
  the other tiers in accourdance. Do validate with me."* Validating the proposed table, the owner
  set it: *"Free · Small €5/€30 · Medium €12/€72 · Large €40/€240 · Extra large €80/€480."*
  - Setup fees: *"Drop setup fees"*.
  - VAT is included.
  - The limits stay ADR-0014's.
- **D10 — The page opens on yearly.** *"Yearly preselected, with montly/yearly switch that
  opens on yearly. It shows the monthly price (yearly divided by 12) and discount against the
  monthly price."*
- **D11 — A year renews, and stopping refunds.** The owner chose *"Auto-renew a year, refund"*.
  **Amended 2026-10-04:** *"C, nog refund of the first year"*, and on what is left at the year's
  end, *"i, go ahead"*. A year is never refunded and never renews, and what is left pays the
  months after it (ADR-0014, *Amendment 2026-10-04*).
- **D12 — The price pays for the work.** On the page's *"not to make a margin"*: *"yes, but i do
  need a pricing model that supports the efforts."* Asked how the page should say it, the owner
  chose *"Costs include our work"*.

## 3. What each task does

### T0 — the owner reads the new copy (owner; before each task merges)

Every sentence this plan adds is a proposal. 0144 T0 made the site's copy the owner's to approve,
and nothing here changes that. Each pull request carries its sentences in both languages in its
description, and merges after the owner's word on them. What this plan proposes is in the task
below it, marked *proposed wording*.

**One change is decided rather than proposed (D6): Dutch says *migratie*, never *verhuizing*.**

- Every form of *verhuizen* in `site/copy.mjs` and `site/pages/nl/` (*verhuizing*, *verhuizingen*,
  *verhuist*, *verhuisd*) becomes a form of *migratie* or *migreren*. For example,
  `copy.mjs`:258's *"verhuizing tegelijk"* becomes *"migratie tegelijk"*, and `copy.mjs`:224's
  *"Hoe een verhuizing verloopt"* becomes *"Hoe een migratie verloopt"*.
- A sentence that reads worse for it is rewritten, not patched, and the owner reads it first.
  For example, *"Het is een verhuizing, geen kopie"* becomes *"Het is een migratie, geen
  kopie"*.
- A case in `site/site.unit.test.ts` fails on `/verhui[sz]/i` anywhere in the Dutch pages, so
  *verhuist* and *verhuisd* are caught as well as *verhuizing*.

### T1 — the alpha, said on the site (before the first invitation)

(a) **The alpha sentence on every page** while the build carries the alpha setting. The setting
is the one 0144 T1 gives the site build for the tester guide. The sentence is the one the app
shows on `/login` and `/request-access`. It is copied into `copy.mjs`, and a guard compares it
with the app's string, so the two cannot drift. Proposed placement: one line under the header, in
the site's muted style, not a yellow banner.
*(2026-10-04: the app's sentence is now the owner's welcome (0131 D4's amendment): *"Welcome to
the Alpha! Try Ownpace at your own pace, and help others move to European alternatives more
easily."* Copied as proposed, every visitor of the public site would read it, invited or not.
Which line the site shows is for the owner to decide before this is built: open question 5.)*

(b) **"Most people" becomes a fact about the tier.**

- In `copy.mjs`:99 and the tier badge (:112, :263), the proposed wording is *"One person moving
  everything at once"*, and *"Eén persoon die alles tegelijk migreert"* in Dutch (D6).
- It changes back only when there is a count to base it on.
- `site/site.unit.test.ts` pins the home page's sentence and is updated in the same pull request.

### T2 — a shorter menu, and a header that fits a phone (before the first invitation)

(a) **The header** reads *Home · How it works · Pricing · Sign in*, then the language switch.

- *Estimate* leaves the menu. Its page stays, is linked from pricing (T6 (c)) and the home page,
  and keeps its place in `PAGE_KEYS` for the language switch and hreflang.
- *Privacy* and *Terms* leave the header. The footer already carries them.
- *Sign in* links `${APP_URL}/login`. It is built from `APP_URL`, never a fixed host
  (`the-test-site-sent-people-to-production`).
- T5 adds *Leaving…* when its pages exist.

(b) **On a phone** the menu folds into `<details><summary>`, which opens without a script and
passes the CSP. The header stays under 64 pixels at 390 wide.

- A new case in `test/ui/site.ui.test.ts` measures the header at 390 pixels and opens the menu
  with the keyboard.
- The 404 page stays out of the menu (`pages-that-do-not-exist`), and the status link stays in
  the footer.

### T3 — the hero shows the move (before the first invitation)

(a) **A picture beside the lede, as inline SVG:** `docs/design/0152-0154/hero-move.svg`,
*"Drawing now, app screen later"* (D8). A real screen of a person's migrations joins it once
0153 T5 exists.

- On the left, the old account: tiles for mail, contacts, calendar, files and photos.
- In the middle, Ownpace, with two arrows: *copies*, then *keeps in step*.
- On the right, the new home: the same tiles.
- Under it sit three short facts, in the site's card style. Proposed wording:
  - *"Nothing is deleted at the source."* This is the site's existing claim, not "read-only",
    which T0 keeps within 0144 T3's scope.
  - *"Kept in step until you switch."*
  - *"A list of what arrived, item by item."*
- The drawing uses the site's palette, works in dark mode, carries a `<title>` and an
  `aria-label` in the page's language, and scales down on a phone. On a phone it sits below
  the buttons, so the buttons stay in the first screen.

(b) **A three-step strip after the hero.** It is the five steps of *How it works* folded into
three, using the `.step` class `build.mjs` already defines:

1. *Connect the account you are leaving.*
2. *We copy, then keep copying.*
3. *Switch when you are ready.*

The strip links to the full page.

(c) ***How it works* gains a button at the end.** It is *Request access*, with *See what it
costs* beside it. It also gains one sentence that says what "switching" is for a person: their
mail app points at the new provider, and a person with their own domain changes where its mail
is delivered. Proposed wording goes to T0. The page's "read-only" rewrite stays 0144 T3 (b)'s.

### T4 — the destinations, named (before the first invitation)

(a) **A *Where to* section on the home page**, after the three steps.

- **What it says.** Proposed wording: *"Your new home is an account you open with a European
  provider, paid to them. Ownpace moves your data into it and keeps it in step."*
- **What it names:**
  - **Soverin**: mail, calendar, contacts and tasks.
  - **Nextcloud**: files, calendar, contacts and tasks.
  - **A JMAP server** such as Stalwart: mail, contacts and files.
  - **Any provider that speaks IMAP, CalDAV, CardDAV or WebDAV**, each for what its protocol
    carries.

  These are `TARGET_TYPE_DOMAINS` in `packages/shared/src/target-domains.ts` on 2026-09-28. The
  page takes them from the guarded copy (b), never from this list.
- **Each destination** shows the data types it takes, as T3's icons with their names.

(b) **The list is a copy with a guard.** `site/` cannot import `packages/shared`. So the
destinations and their data types are copied into a site module (`site/destinations.mjs`).

- A guard reads the app's target list (`packages/shared/src/target-domains.ts` and the cards in
  `credential-fields.ts`) and fails when the two disagree. This is the same pattern as
  `prices.mjs` against ADR-0014.
- A destination the app drops disappears from the site in the same pull request, or the guard
  fails.

(c) **No third-party claim beyond what the app proves.** The section says which data types a
destination takes. It does not say what the provider costs, where it is hosted or how good it is.
`docs/target-providers.md` keeps that, with its dates.

### T5 — a page per provider a person leaves (before the first invitation, D5)

(a) **Six pages in each language:** Google, Microsoft 365, Apple iCloud, Dropbox, Box, and
another mail provider. Each has the same five parts, all generated. The destinations each data
type can go to are named in the first part (D7), from the same guarded list as T4.

1. **What moves.** One row per data type, with *moves*, *moves with a limit* or *does not move*.
   The verdicts come from the same source as the app's cards and the scope manifest
   (`SOURCE_PROOFS` and the front-door cards in `packages/shared`). They are copied and guarded
   as in T4 (b). An *experimental* card says so, as it does in the app (0131 T2).
2. **Limits you should know.** These are the provider facts the product already states and tests:
   - Gmail's 2.5 GB a day, from `calculator.mjs`;
   - Google Photos only through Takeout (0112, 0116);
   - Apple's export (0115);
   - Dropbox Paper (0150);
   - Microsoft's app registration (0114).

   Each links its customer guide section (0148). A limit is never softened.
3. **What you will do.** Which steps are a button (a consent) and which need a password the person
   creates at their provider. This comes from the card's credential descriptor, so a step the
   wizard does not have is never written.
4. **A typical cost.** The calculator's profile for one person with that source, run through
   `deriveTier`, and a link to the calculator with the source already chosen (`?from=`).
5. **The next step.** *Request access*, carrying the source.

(b) **In the menu.** *Leaving…* joins the header as a `<details>` list of the six. The home
page's hero gets a row of the six names under the buttons. Each is text with its initial tile
(D4), not a logo.

(c) **Search.** The pages carry canonical URLs, hreflang with absolute URLs, and a line each in
`llms.txt` (ADR-0029's operative rule, not built yet). They are built before the alpha with the
rest (D5), and take effect once `WWW_LIVE` makes the site indexable.

(d) **Where this meets 0151.** 0151 T1, parked, would render `docs/guides` on the site. The pages
here link the app's guide sections today, and link the site's own help section when 0151
unparks. Neither copies the other's text.

### T6 — pricing that reads in one pass (before the first invitation, D5)

(a) **One statement about VAT.** The sentences *"VAT is added where it applies."*
(`pricing.md`:71) and *"Btw komt erbij waar die van toepassing is."* (`prijzen.md`:73) go.
*"All prices include VAT."* stays.

- A new case in `site/site.unit.test.ts` fails on any page that says prices include VAT and also
  says VAT is added.
- The same pull request asks 0139 whether the terms say the same.

(b) **The rules as questions and answers.** The ten bold-lead paragraphs become questions, each
answered in the paragraph that is there now. Proposed questions:

- *Is there a free way?*
- *Does the bill go down when I finish?*
- *Does pausing lower it?*
- *What if I keep copying after I switch?*
- …

Each is a `<details>` written by `build.mjs`, because the Markdown renderer escapes raw HTML. The
two paragraphs `a-sixth-state-added-to-only-one-list` holds together stay within three answers of
each other. The guard's comment is updated to say answers rather than paragraphs.

(c) **A button to the calculator.** *Work out what yours costs* sits under the tier cards and
links `estimate.html`. The home page's *What it costs* block gets the same button.

(d) **The new list (D9)**, drawn in `wf-pricing.svg`.

- **`site/prices.mjs` becomes:**

  | Tier | Id | Monthly | A year |
  |---|---|---|---|
  | Free | `free`, replaces `tiny` | free | free |
  | Small | | €5 | €30 |
  | Medium | | €12 | €72 |
  | Large | | €40 | €240 |
  | Extra large | | €80 | €480 |

  Each tier keeps its limits (at the same time, data moved). The `setup` field goes, because no
  tier has one. `annual` joins it.
- **ADR-0014's operative table is amended by the owner.** The tier name, the two prices, no
  setup column. `site/site.unit.test.ts` keeps reading the table and checks `prices.mjs`
  against it, and now also that every annual price is six times its monthly. A tier that
  breaks either fails the build.
- **The derived first month goes.** Setup plus monthly was the card's headline. The cards now
  lead with the price per month (e).
- **Every place that names Tiny follows**, in the same pull request:
  - the guarded home sentence *"Tiny is free: one migration at a time, up to 250 GB."* becomes
    *"Free: one migration at a time, up to 250 GB."*;
  - the calculator's derived tier;
  - `packages/managed/src/tier-calculator.ts`, which its own test holds equal to
    `site/calculator.mjs`.
- **ADR-0014's wording rules stand:** *free*, never *€0*, and *at the same time*.
- **Invoices follow in 0111:** no setup line, and a yearly line. The page never offers a price
  0111 cannot bill.

(e) **The monthly / yearly switch (D10).**

- **The switch.** Above the cards sits a two-option switch, *Yearly · Monthly* / *Per jaar ·
  Per maand*, opening on *Yearly*.
  - It is built without a script: two radio inputs and `:checked` sibling selectors in the
    inline style. The CSP needs nothing new, the site's no-`<form>` rule holds, and it works
    with JavaScript off.
  - It is a real radio group with a visible label, so a keyboard and a screen reader can use it.
- **On yearly, each paid tier shows:**
  - the price per month, the year divided by twelve: €2.50, €6, €20, €40;
  - the year's total, in bold on the line under it and never in small print: *"€30 a year"*;
  - the comparison: *"half the monthly price"* / *"de helft van de maandprijs"*.
- **On monthly,** each paid tier shows its monthly price.
- **Free** shows *Free* in both views.
- **Cents.** €2.50 needs them. So `prices.mjs` moves to integer cents, and its formatter learns
  cents. `prices.mjs`'s own header asks for exactly this (*"change this to integer cents and fix
  the formatter — do not introduce a float"*).
- **The guardrails, from the Dutch rules on price comparisons:**
  - no price is struck through;
  - no price is called a former or "was" price;
  - the discount compares two prices on sale now, never a price cut;
  - the yearly total is always visible;
  - VAT is included;
  - there is no countdown or "limited time".

  The owner's lawyer confirms the wording (0139). Two cases in `site/site.unit.test.ts` hold the
  guardrails: no `<s>`, `<del>` or `line-through` on the pricing page, and every per-month yearly
  figure has its yearly total in the same card.
- **Under the switch,** the plain sentence can stay for anyone who wants the reason: *"Done
  within six months? Pay monthly. Longer, or not sure? A year costs the same as six months."*
  Its Dutch is in D3. It stays if the owner keeps it in T0.
- **`test/ui/site.ui.test.ts`:**
  - the page opens on yearly;
  - switching shows the monthly prices, with a click and with the keyboard;
  - nothing scrolls sideways at 390 pixels.

(f) **The withdrawal button, and the year's end (D11, amended 2026-10-04).**

- **Amended 2026-10-04.** A year is never refunded and never renews (ADR-0014, *Amendment
  2026-10-04*). The renewal, its reminder 30 days before, and refunds of unused months are gone
  from this task.
- **What the page says** is built, in the pricing page's year paragraph, in both languages: *"…
  Apart from the 14 days the law gives you to change your mind, the credit is not refunded, not
  even when you stop. What is left after the year is not lost: it pays for the months that
  follow, at their monthly price, until it runs out. Then you pay month by month. A year never
  renews by itself."* For T0 and the lawyer. The old *"Cancel whenever. No minimum term…"* keeps
  its truth for monthly.
- **The law behind it.** After the year, the subscription runs month to month, and stopping takes
  at most a month's notice (art. 6:236 sub j BW).
- **Proposed, for the owner: a notice before the credit runs out.** With no renewal there is no
  reminder before one. A month before the credit runs out, an email says when billing month by
  month starts and what a month on the current tier costs, in 0030's email channel and in both
  languages. It is what *we do not take money from inattention* asks, once the credit stops
  paying.
- **The withdrawal button.** A contract made online has needed a clearly labelled function to
  withdraw during the withdrawal period since 19 June 2026: Directive (EU) 2023/2673, which adds
  article 11a to the Consumer Rights Directive.
  - It takes two steps, and the confirmation arrives on a durable medium (an email).
  - It goes on the app's Billing page (`Billing.tsx`), with the label the Dutch law uses, which
    the lawyer confirms.
  - Terms §7 says it is there, beside the email route (0139).
- **A withdrawal is refunded by credit note.** 0111 builds them. A year has no other refund.

(g) **The principle: the price pays for the work (D12).**

- ***Why it is priced this way* is rewritten.** Proposed wording, for T0:
  - English: *"Ownpace is priced to pay for what it takes to run and build it: the servers, the
    support, and the time spent building and improving the software. There are no investors to
    answer to. Running it yourself is free, and always will be."*
  - Dutch: *"Ownpace is zo geprijsd dat het betaalt wat nodig is om het te laten draaien en te
    bouwen: de servers, de ondersteuning en de tijd voor het bouwen en verbeteren van de
    software. Er zijn geen investeerders om verantwoording aan af te leggen. Zelf draaien is
    gratis, en blijft dat."*
- ***"The larger tiers are priced above their own cost on purpose"*** goes with the old
  principle.
- **ADR-0014 is amended by the owner.** Its *cost-recovery* framing becomes this principle, and
  its operative rules are regenerated into `OPERATIVE.md`. The architecture document's §16 line
  *"Billing is cost-recovery, not for profit"* gets a dated note in the same pull request. This
  task drafts both and waits for the owner's word.

### T7 — a calculator that ends in a button (before the first invitation, D5)

(a) ***Request access* at the end, with the answers carried along.**

- **The link.** The result card ends with *Request access* to `/request-access`, with the answers
  as query parameters: `?tier=`, `from=`, `what=`, `who=`.
- **The form.** `RequestAccess.tsx` reads them and fills *"What are you moving?"* with a sentence
  built from them, which the person can edit.
- **Nothing else.** No new field is stored and the free-text field keeps its limits. The rate
  limit and the identical response (0093) do not change.
- **The CSP.** The link is built by the pinned script, so the hash is re-pinned in the same pull
  request.

(b) ***Until when?* says which payment suits it** (D9, D10).

- *1 month* or *3 months* leads to *"Paying monthly suits this: €M a month."*
- *6 months* or *When I am ready* leads to *"A year suits this: €6M, which is half the monthly
  price."*
- This is a sentence under the result, not a choice, so the tier stays derived (ADR-0014). The
  three-month total line gives way to the answer the person chose.

(c) **The layout faults and a live region.**

- The Calendar and Files overlap at 1280 pixels.
- The *THIS ONE DECIDES* badge covers its heading at 390 pixels.
- Sizes above 1 TB round to one decimal.
- The result card, `#paths-line` and `#tier-card` sit in one `aria-live="polite"` region, so a
  screen reader hears the new tier.
- A case in `test/ui/site.ui.test.ts` asserts no overlap at both widths.

(d) **Box as a source.** *Moving away from?* gains *Box*, with a profile row in
`profiles.mjs` and its provenance (`profiles.unit.test.ts` requires one).

### T8 — claims you can check (before the first invitation, D5)

(a) **"Open source" links the repository.** The phrase in `copy.mjs`:45, :81 and :83 links
`https://github.com/Robbes/Ownpace`. The footer's *"Run it yourself"* links the self-host
quickstart there.

(b) **Each proof point links its guard.**

- *"The software has no way to delete from a source"* links
  `scripts/a-source-that-only-reads.unit.test.ts` on GitHub.
- *"Nothing is deleted at the source"* links the same guard.
- *"Whatever cannot be moved is reported to you"* links the scope manifest's source.

A guard fails when a linked file no longer exists in the tree, so a claim cannot outlive its
proof.

(c) **The company in the footer.** The name, KvK number and address come once 0139 publishes
them. A `--public` build already refuses the placeholders, so this is wording only.

### T9 — one look from the site to the app (before the first invitation)

(a) **The two pages take the site's look.** `/request-access` and `/login` use the site's palette
(`TEAL`, `MINT`) and the logo from `site/brand/`, served by the web build. Each carries a link
back to the site, *"← ownpace.eu"*, built from the deployment's own site address. It is never a
fixed host.

(b) **The rest of the app** keeps its colours until 0153, which reviews the palette with its
layout. The identity provider's pages stay 0135 T6.

## 4. Order

1. **T0**, the owner's reading. It runs alongside everything else and blocks merges, not work.
2. **All of it before the first invitation (D5), in this order:**
   1. T6 (a), the VAT sentence. It is the smallest, and it matters under consumer law.
   2. T1.
   3. T2.
   4. T9.
   5. T3.
   6. T4.
   7. T7 (a), (c) and (d).
   8. T6 (c).
   9. T5.
   10. T8.
   11. T6 (b).
   12. T6 (d) and T7 (b) together, then T6 (e), then T6 (f) and (g).

**What only someone else can unblock.** None of it moves a task later (D5). It is:

- **The owner's ADR-0014 amendment:** the list, no setup, and the principle. This comes before
  T6 (d) and (g).
- **0111's yearly invoicing,** which draws a year's credit month by month (since 2026-10-04 there
  are no refunds and no renewal reminder to build). It comes before T6 (d) to (f) show a price a
  customer could pay. The alpha is free (0131 D1), so the pages can show the list
  while nothing is billed. The Billing page and the terms say so.
- **The lawyer's check of the discount, no-refund and withdrawal wording** (0139; the terms'
  briefing, question 27), before T6 (e) and (f) merge.
- **The company's details from 0139,** for T8 (c).

**Who builds it (D8).** Session R, as group R8 in 0131 §6, from the drawings in
`docs/design/0152-0154/` and §5.

The site is one folder, and 0144 T3 (b) and T1 are changing it in 0131's group R5. Each task here
is built on top of R5's merged state, or waits for it. The pull request says which (0131 §6,
*Out of turn*).

## 5. The drawings, and how R builds from them (D8)

They are in [`docs/design/0152-0154/`](../design/0152-0154/README.md), drafted in this session.
They are references for layout, order and wording, not specifications to the pixel.

| Drawing | For | How to build it |
|---|---|---|
| `hero-move.svg` | T3 | It is inlined by `build.mjs`, never linked, so it needs no image request and nothing new in the CSP. A function returns it with its `<title>` and labels in the page's language. Its colours are the site's CSS custom properties (the palette `build.mjs` declares), so dark mode needs no second file. `role="img"` and an `aria-label` say what it shows in one sentence. On a phone it sits below the buttons. |
| `icons.svg` | T3, T4, T5 | Six data-type icons (mail, calendar, contacts, files, photos, tasks), each a `<symbol>` in one inline sprite, used with `<use href="#…">`. The stroke is `currentColor`. They are the same drawings 0153 builds as React components, so the site and the app draw the same six. |
| `tiles.svg` | T4, T5 | The neutral provider and destination tiles (D4): the initial on the site's teal, with the name written beside it. The same table of initials as 0153 §5. |
| `wf-site-home.svg` | T1–T5, T6 (c) | The home page's order: the alpha line; the hero with its drawing, and the six *Leaving…* names under its buttons (T5 (b)); three facts; the three steps; *Where to*; the sections that stay; and one price line with its buttons. *(2026-10-04: the alpha line drew the app's note as it read before 2026-09-29, with *"nothing is backed up"*. It is now a placeholder until the owner answers open question 5.)* |
| `wf-pricing.svg` | T6 | The labelled switch opening on yearly; the five cards on yearly (per month, the year's total in bold under it, *half the monthly price*); the calculator's button; one card on monthly; the year's line (renewal until 2026-10-04); the questions and answers; and the principle. |

## Lessons that apply

- **`the-test-site-sent-people-to-production`.** Every link to the app comes from `APP_URL`.
  *Sign in* (T2) and the calculator's link (T7) are the two new ones.
- **`a-read-only-claim-with-its-scope`.** T3's facts do not say "read-only".
- **`a-sixth-state-added-to-only-one-list`.** T6 (b) keeps its two paragraphs together.
- **The pinned calculator hash.** Any change to `calculator.mjs` re-pins `$csp_calc` in
  `www-nginx.conf`, in the same pull request (T7).

## Not in this plan

- **The app's migrations, the new-move flow and its words** are 0153.
- **The progress view and the report of what arrived** are 0154.
- **A help center** is 0151, parked.
- **Analytics.** The CSP forbids fetch, and nothing here needs a count.
- **Testimonials.** There are none to show during the alpha.
- **Third-party logos.** D4 decides against them.
- **The destination providers' prices, hosting or quality.** `docs/target-providers.md` keeps
  those, dated.

## Open questions

1. ~~**The split of D2.**~~ **Answered 2026-09-28 (D5):** no split. All of it comes before the
   alpha.
2. ~~**T4's list of destinations.**~~ **Answered 2026-09-28 (D7):** *"Name what the app
   supports"*. The site names what the app's own list names, through the guarded copy (T4 (b)).
   mosa.cloud and openDesk appear by name when that list names them, and as *a JMAP server* or
   *an IMAP/DAV provider* until then.
3. ~~**Colours of the initial tiles (D4).**~~ **Answered by D4's own wording,** *"our own neutral
   monogram tiles"*: neutral, in the site's palette (`tiles.svg`).
4. ~~**The Dutch site at the root.**~~ **Answered 2026-09-29: English at the root** (*"English at
   root"*). `/` keeps serving English and Dutch stays under `/nl/`, so no URL moves; T2 makes the
   language switch more visible on phones.
5. **Which line does the site show during the Alpha: the welcome, or another line?** (2026-10-04)
   T1 (a) copies the app's alpha sentence. Since 0131 D4's amendment that is the owner's welcome,
   *"Welcome to the Alpha! Try Ownpace at your own pace, and help others move to European
   alternatives more easily."* On the site, every visitor would read it, invited or not. The
   owner decides before T1 is built.
