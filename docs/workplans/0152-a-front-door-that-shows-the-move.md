# Workplan 0152 — A front door that shows the move

> **In one line:** The public site explains a move at a glance: old account and new home in one picture, the destinations named, the alpha said, a shorter menu, a calculator that ends in a button, monthly and yearly prices (a year costs six months), and a page per provider a person leaves.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: opened from the owner's request, with four answers from the owner. Nothing is
built.** The owner asked, on 2026-09-28, for the website and the app to become more intuitive.
They asked for this to be done from a UX and UI point of view, with questions and
recommendations, written up as workplans. This plan covers the site (`site/`) and the two app
pages its buttons lead to. 0153 covers the app's migrations and the flow that creates them. 0154
covers progress and proof. The three plans were written together, from one audit of the site and
the app on `main` at `83eb73e` (§1).

The owner answered four questions the same day (§2):

- **The model, D1:** one move per person. This is mostly 0153's, but it is the picture this site
  draws.
- **The timing, D2:** before the first invitation.
- **Payment, D3:** a year costs six months of the monthly price.
- **Provider marks, D4:** names and our own icons, no third-party logos.

D2 puts this plan's minimum on 0131 T5's go/no-go list. It adds one row there (0131's Status
block, 2026-09-28). What a tester meets is in the minimum. What a search engine meets waits for
the public site, which stays off until the legal texts are final (0139 T10, `WWW_LIVE`).

| Task | Status | Notes |
|---|---|---|
| T0 The owner reads the new copy | ⏳ **Owner; before the first invitation, before T1–T4 merge** | §3. Site copy is the owner's to approve (0144 T0). Every new sentence here is a proposal, in both languages. |
| T1 The alpha, said on the site | 📋 **Proposed; before the first invitation** | §3. The app's alpha sentence on every site page while the alpha setting is on. The unbacked *"Most people"* and *"Meest gekozen"* become a fact about the tier. |
| T2 A shorter menu, and a header that fits a phone | 📋 **Proposed; before the first invitation** | §3. The header reads Home · How it works · Pricing · Sign in, plus the language switch. Privacy and Terms move to the footer. On a phone the menu folds into a `<details>`, which needs no script. |
| T3 The hero shows the move | 📋 **Proposed; before the first invitation** | §3. An inline SVG: the old account's data, then Ownpace, then the new home, with our own icons (D4). Three facts sit under it. A three-step strip links to *How it works*. |
| T4 The destinations, named | 📋 **Proposed; before the first invitation** | §3. A *Where to* section names the destinations the app supports, from a site copy of the app's list with a guard that it matches. It says plainly that the new account is one the person opens and pays for themselves. |
| T5 A page per provider a person leaves | 📋 **Proposed; before `WWW_LIVE` goes on** | §3. *Leaving Google*, *Leaving Microsoft 365*, *Leaving iCloud*, *Leaving Dropbox*, *Leaving Box*, *Leaving another mail provider*: what moves, the limits, what the person does, a typical cost. Built from copies of the app's own verdicts, each guarded. |
| T6 Pricing that reads in one pass | 🟡 **Proposed: (a) and (c) before the first invitation; (b), (d) and (e) before the first paid invoice** | §3. (a) One VAT statement. (b) The rules as questions and answers. (c) A button to the calculator. (d) Both cadences, a year = six months (D3), with no strike-through and no percentage. (e) What cancelling means for each cadence. |
| T7 A calculator that ends in a button | 🟡 **Proposed: (a), (c) and (d) before the first invitation; (b) with T6 (d)** | §3. (a) *Request access* carries the answers along. (b) *Until when?* suggests a cadence. (c) The layout faults and a live region. (d) Box as a source. |
| T8 Claims you can check | 📋 **Proposed; before `WWW_LIVE` goes on** | §3. "Open source" links the repository. Each proof point links the guard that holds it. The footer names the company once 0139 publishes it. |
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
  answer: *"Before the first invitation"*. This plan reads it as follows. What a tester meets
  before they are in (T1–T4, T6 (a) and (c), T7 (a), (c) and (d), T9) is in the minimum. What
  only a search engine or a paying customer meets (T5, T6 (b), (d) and (e), T7 (b), T8) waits for
  the public site or the first invoice. The alpha is free (0131 D1), and the site is not public
  until `WWW_LIVE` goes on. Open question 1 asks the owner to confirm the split.
- **D3 — A year costs six months.** The question: how many months of the monthly price should a
  year cost? The answer: *"A year = 6 months"*. So every paid band has two prices, the monthly
  and six times the monthly for a year. The page says the rule in plain words: *"Done within six
  months? Pay monthly. Longer, or not sure? A year costs the same as six months."* Nothing is
  struck through and there is no percentage badge. The amounts are not decided here. They
  follow 0109's bands, and ADR-0014's table gains an annual column when they land.
- **D4 — Names and our own icons.** The question: how should Google, Microsoft, Apple, Dropbox,
  Soverin and Nextcloud appear? The answer: *"Names + our own icons"*. So no third-party logo
  file appears on the site or in the app. A provider is named in text next to our own icon: the
  initial tiles 0107 T2 built, and data-type icons for mail, contacts, calendar, files and
  photos. This settles 0107 T2's open *"real logos need the owner's go-ahead"*: there are none.

## 3. What each task does

### T0 — the owner reads the new copy (owner; before T1–T4 merge)

Every sentence this plan adds is a proposal. 0144 T0 made the site's copy the owner's to approve,
and nothing here changes that. Each pull request of T1–T4 carries its sentences in both languages
in its description. It merges after the owner's word on them. What this plan proposes is in the
task below it, marked *proposed wording*.

### T1 — the alpha, said on the site (before the first invitation)

(a) **The alpha sentence on every page** while the build carries the alpha setting. The setting
is the one 0144 T1 gives the site build for the tester guide. The sentence is the one the app
shows on `/login` and `/request-access`. It is copied into `copy.mjs`, and a guard compares it
with the app's string, so the two cannot drift. Proposed placement: one line under the header, in
the site's muted style, not a yellow banner.

(b) **"Most people" becomes a fact about the tier.**

- In `copy.mjs`:99 and the tier badge (:112, :263), the proposed wording is *"One person moving
  everything at once"*, and *"Eén persoon die alles tegelijk verhuist"* in Dutch.
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

(a) **A picture beside the lede, as inline SVG.**

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
  - **Soverin**: mail, calendar and contacts.
  - **Nextcloud**: files, calendar and contacts.
  - **A JMAP server** such as Stalwart.
  - **Any provider that speaks IMAP, CalDAV, CardDAV or WebDAV.**
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

### T5 — a page per provider a person leaves (before `WWW_LIVE` goes on)

(a) **Six pages in each language:** Google, Microsoft 365, Apple iCloud, Dropbox, Box, and
another mail provider. Each has the same five parts, all generated:

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
`llms.txt` (ADR-0029's operative rule, not built yet). This waits for `WWW_LIVE`, because a
`noindex` site gains nothing from it.

(d) **Where this meets 0151.** 0151 T1, parked, would render `docs/guides` on the site. The pages
here link the app's guide sections today, and link the site's own help section when 0151
unparks. Neither copies the other's text.

### T6 — pricing that reads in one pass (a, c before the invitation; b, d, e before the first paid invoice)

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

(d) **Both payment rhythms (D3).**

- **Each paid tier card shows two prices:** *"€M a month"* and *"or €6M a year"*.
- **Under the cards, one sentence** does the comparing, in plain words: *"Done within six months?
  Pay monthly. Longer, or not sure? A year costs the same as six months."* In Dutch: *"Binnen zes
  maanden klaar? Betaal per maand. Langer, of weet u het nog niet? Een jaar kost hetzelfde als
  zes maanden."*
- **What the page never shows:**
  - a struck-through price;
  - a percentage;
  - a "was" price;
  - a preselected rhythm.
- **Tiny stays free**, with no invoice.
- **Where the numbers come from.** They come from `prices.mjs`, which gains an `annual` field per
  tier. `site/site.unit.test.ts` checks that it matches ADR-0014's table, which gains the column
  when 0109 draws the bands, and that it is six times the monthly. A tier whose annual is not
  six times the monthly fails the build.
- **What it waits for.** The ADR-0014 amendment carrying the annual column is the owner's. This
  task waits for it.

(e) **What stopping means for each rhythm.** The rule *"Cancel whenever. No minimum term, no
notice period, no cancellation fee."* is true of monthly and not, as written, of a year paid in
advance. The page says what happens to a year when the person stops. This task waits for 0111's
decision on how a year renews. A Dutch consumer must be able to cancel with at most a month's
notice once the first term is over (art. 6:236 sub j BW). It also waits for the terms' refund
wording (0139). Until both are decided, the annual price is not shown.

### T7 — a calculator that ends in a button (a, c, d before the invitation; b with T6 d)

(a) ***Request access* at the end, with the answers carried along.**

- **The link.** The result card ends with *Request access* to `/request-access`, with the answers
  as query parameters: `?tier=`, `from=`, `what=`, `who=`.
- **The form.** `RequestAccess.tsx` reads them and fills *"What are you moving?"* with a sentence
  built from them, which the person can edit.
- **Nothing else.** No new field is stored and the free-text field keeps its limits. The rate
  limit and the identical response (0093) do not change.
- **The CSP.** The link is built by the pinned script, so the hash is re-pinned in the same pull
  request.

(b) ***Until when?* suggests a rhythm, once T6 (d) is shown.**

- *1 month* or *3 months* leads to *"Pay monthly: €M a month."*
- *6 months* or *When I am ready* leads to *"A year costs the same as six months: €6M."*
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

### T8 — claims you can check (before `WWW_LIVE` goes on)

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
2. **Before the first invitation:**
   - T6 (a), the VAT sentence. It is the smallest, and it matters under consumer law.
   - T1.
   - T2.
   - T9.
   - T3.
   - T4.
   - T7 (a), (c) and (d).
   - T6 (c).
3. **Before `WWW_LIVE` goes on:** T5, then T8.
4. **Before the first paid invoice:** T6 (b), then T6 (d) and T7 (b) together, then T6 (e). These
   wait for 0109's bands, the ADR-0014 column, 0111's renewal decision and the terms.

The site is one folder, and 0144 T3 (b) and T1 are changing it in 0131's group R5. Each task here
is built on top of R5's merged state, or waits for it. The pull request says which (0131 §6,
*Out of turn*).

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

1. **The split of D2.** This plan reads *"before the first invitation"* as follows: what a
   tester meets is before, and the pages only a search engine or a paying customer meets (T5,
   T6 (b), (d) and (e), T7 (b), T8) wait for `WWW_LIVE` or the first invoice. Is that the
   owner's intent, or should T5 come before the first invitation too?
2. **T4's list of destinations.** It names Soverin, Nextcloud, a JMAP server such as Stalwart,
   and any IMAP, CalDAV, CardDAV or WebDAV provider. Should mosa.cloud and openDesk be named
   too? The app supports them as a JMAP target and through IMAP/DAV.
3. **Colours of the initial tiles (D4).** 0107 T2 drew them in each provider's colour. Do they
   keep those colours, or move to the site's palette? The recommendation is to keep them: a
   coloured letter is not a logo, and the colour helps a person find their provider.
4. **The Dutch site at the root.** The alpha is Dutch (0131 D1), and `/` serves English. Should
   the alpha build serve Dutch at `/`, with English under `/en/`? That moves every URL. The
   recommendation is not now: keep `/` and make the language switch more visible on phones (T2).
