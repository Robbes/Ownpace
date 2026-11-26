# Workplan 0176 — A person's own pages: in steps, in plain words, on one link

> **In one line:** The two pages a person opens from a link, with no account of their own: the permission asked in short steps, with Google's screens told before they come; one link for the whole journey; a stop that can be taken back; and *je* or *u* as the organisation chooses (the owner, 2026-11-26).

## Status — 2026-11-26 (update this block at the end of every session)

**2026-11-26, the owner's read of #2189's Dutch:** *"#2189: ok"*. Every drafted sentence
stands, and *Everything on one page* stays without the password card, as advised.

**2026-11-26: step B, the two parts beside the main line that are not the informal Dutch,
built as one draft pull request** (`claude/ownpace-public-readiness-y7orc6-a21-person-pages-step-b-beside`),
on §23.2's rows for D15 (a) and D16 (a), branched from step A's head. No migration, and no file
of the main line's: `Grant.tsx` and `PersonGrant.tsx` are not opened.

- **Everything on one page (D15 (a)):** `pages/PersonGrantOnePage.tsx`, at `/grant/<link>/all`
  (`ONE_PAGE_ROUTE`, `onePagePath`). It says what the steps say, in their order and with their
  own keys, and prints; it reads and does nothing, and leads back to the steps. Its words are
  `strings/one-page.ts`: a title, *Print this page*, *Back to the steps*, the link's own
  *Read everything on one page*, and `grant.person.whatMany` without its *next screen*.
  `everything-a-link-says-on-one-page.unit.test.tsx` walks every step of four links in both
  languages and finds each of their sentences on the one page, but for what it leaves out by
  name: buttons, the password card, *Step n of m*, and the line about the provider's button. The
  managed UI smoke opens it at 390 and 320 pixels in both languages, measures it as §13 asks,
  prints it, and holds it to the link's own two requests.
- **Where the service runs (D16 (a)):** one setting, `OWNPACE_COUNTRY`, a two-letter code, empty
  in `managed.env.example`. The web build takes it as `VITE_OWNPACE_COUNTRY` (`managed.yml`, the
  web Dockerfile) and refuses one that is no country (`vite.config.ts`, by
  `services/where-it-runs.ts`); every site build takes the stack's own (`deploy-live.sh` for
  live's, and the OTA site's three documented builds). `components/WhereItRuns.tsx` says
  *Ownpace runs in {country}.* with the name from `Intl.DisplayNames` in the reader's language,
  and nothing when unset or on the appliance. The home page's sentence takes the same value
  (`site/country.mjs`, `site/copy.mjs`); unset, it says only that the software is open source.
  The site's build refuses a country the privacy policy's §7 does not name, where
  `site/site.unit.test.ts` held the hand-written country to it before.
  `scripts/a-country-both-builds-know-about.unit.test.ts` holds both halves, and the two copies
  of the rule to one answer for every code.
- **What the main line places, from this part:** `<WhereItRuns />` under `grant.person.ownpace`
  on the first screen, and `<LinkToOnePage link={link} />` on the steps (D15 (a): *on each a
  link to the same sentences on one page*). The keys exist; the main line writes no words for
  either. A sentence it adds to a step fails the one page's test until the one page says it too.
- **Still the owner's:** set `OWNPACE_COUNTRY` in each stack's `.env` before its next deploy,
  and rebuild the web image: unset, live's home page names no country from then on.

**2026-11-26, the owner's read of the twins:** *"#2188: ok, account: yes"*. The twins stand, and the two failure lines say *account* for *omgeving*, the owner's word, in both voices (`view.failure.sourceRefused`, `view.failure.formatRefused`).

**2026-11-26: step B's informal Dutch, as a draft** (§23.2, *Beside it: the informal Dutch*;
branch `claude/ownpace-public-readiness-y7orc6-a21-person-pages-step-b-informal`, one draft pull
request). The *je* twin of step A's Dutch, which the owner read (*"Step A (#2180): ok"*). A
person's two pages say 289 keys. 124 of them say *u* or *uw* to the reader, and each has its twin
in `apps/web/src/i18n/informal.ts`. The other 165 need none.

- **Nothing reads the layer yet.** T7's main line stores the register, sends it with the link's
  answer, and reads the layer first (`index.tsx`, and `active-locale.ts` for the answers a
  report can meet).
- **The guard,** `apps/web/src/i18n/every-u-has-its-je.unit.test.ts`, reads the keys from the
  code that draws the two pages. A new sentence there needs its twin at once. It holds each twin
  to its sentence with only the pronouns turned, so a twin cannot go stale.
- **The glossary's *Register*** says where *je* holds, and how a twin is made.
- **Not here, as §23.2 says:** T3's and T8's new sentences, and the server's own (the endings, and
  the refusals a person's link meets), which the main line twins in its own files.

The owner reads the twins in the pull request. Still the owner's: T0 and T12.

**2026-11-26, the owner's read of the block for families, and one word.** The owner: *"Families
blot: ok. Use familielid (gezinslid is to limited to one household)"*. The block stands as built.
Step A's new Dutch says *familielid*: the tester guide's part, now *Als een familielid een link
krijgt* with the id `familielid-link`, its sentence under *Als Google opnieuw vraagt*, step A's
changelog line, and §22.3's draft. So do the guide's two older sentences, under *Voordat u begint*
and *Wat wij wissen*. The legal texts (`site/legal/privacy.nl.md`, `alpha.nl.md`, `terms.nl.md`)
keep *gezinslid* until their next version, with the lawyer (`GLOSSARY.md`).

**2026-11-26: step A, built as one draft pull request**
(`claude/ownpace-public-readiness-y7orc6-a21-person-pages-step-a`), on §21.4's scope with the
answers to D12 to D14. Part 4 of §23.1, the website and documents with the accessibility
statement (T15, T9.9), was built beside it and merged in at the meet. E2E ran on `26c0573`
and is green: managed, and self-host on Postgres and on PGlite.

- **T1:** a person's link asks one thing per screen (`PersonGrant.tsx`): who asks, with the
  question and *No, not yet*; the accounts, where there is more than one; *Have this ready*;
  *What you will see at {provider}*, with D12 (a)'s warning in our own words during the Alpha;
  and *No, rather not*. Each step is a history entry with its own `h1`, focus, tab title and
  *Step n of m*. The answer is kept for the tab, under the link's id. A migration's own link
  is unchanged.
- **T2:** *kopiëren* on a person's two pages (D1), in the server's ending after a sign-in and in
  the refusals a person's link meets; each names the provider signed in to. D14 (a) through
  `persons-page.tsx`: the member's screens keep their words.
- **T5 and T6, first halves:** *Stop copying* opens its question as a screen, with two answers of
  one size, then what the provider answered, per provider. The progress page says first whether
  anything is needed, shows no price, and refreshes once a minute.
- **T9:** the UI smoke measures text size, contrast and targets at 390 and 320 pixels.
- **D13 (a):** the line where the link is made, and thirty days first.

- **At the meet:** part 4 merged in; `scripts/a-site-that-says-what-a-persons-page-says.unit.test.ts`
  holds the tester guide's three sentences equal to the link page's, and refuses what T15 took
  out; `docs/grant-links.md` was read against the pages and corrected where it differed.

Each test §21.4 names was written first and seen failing on `main`; the pull request records
it, with one table of the new Dutch sentences, both parts', for the owner's read (§6). The
owner read it and answered *"Step A (#2180): ok"*: every sentence stands, and the five open
questions went as advised. By the fifth, the line after a report names no provider any more
(`linkReport.next.grant`). D17 (b)'s block for families on the home page joins the same pull
request, and the owner reads its Dutch before it is marked ready. Still the owner's: T0 and T12.

**2026-11-26, the owner's answers to the website's decisions (T16).** Put to the owner as P16 to
P18, and answered the same day: *"P16: a"*, *"P17: b, …"* and *"P18: keep now"*. Two went as
advised; D17 did not (§18).

- **D16 (a), as advised.** One setting holds the country, and the web build and the site build
  both read it. A person's link page says *Ownpace runs in {country}.* under its first line,
  and the home page takes its sentence from the same setting. Unset, nothing is said. It is
  built in step B, beside its main line (§23.2).
- **D17 (b).** A short block for families on the home page travels with step A (§22.3). It says
  only what is true with step A: not *one link* (step C), not a sender by name (step B), and no
  picture of a screen that is not built. The rest of §22.7 waits for the site's own plan, once
  step A is on a stack.
- **D18 (a), as advised (*"keep now"*).** Step A leaves *By continuing you accept how your data
  is handled:* as it is. The owner puts the question to the lawyer with D6's, with (b)'s
  sentence as the draft.

Still the owner's: T0 and T12.

**2026-11-26, the owner's answers to the sweep's decisions (T14).** On D12 to D15 the owner
answered: *"D12: a / D13: a / D14: yes / D15: a"*. All four went as advised (§18):

- **D12 (a):** until T0 the warning step says what is known and ours, and quotes nothing of
  Google's. The fourth step is shown, without a quote.
- **D13 (a):** step A adds the one line where a person's link is made, and offers thirty days
  first there.
- **D14 (a):** the rows of a person's progress page get their own words.
- **D15 (a):** *Print a sheet for {name}* and *Read everything on one page*, in step B.

Step A's scope in §21.4 reads with these answers. D16 to D18 are answered too (the entry
above).

**And on how to build it:** *"When the plan is done, build it efficient, fan out in seperate
sessions if needed."* §23 says which parts can be built side by side, which files each part
owns, and what waits for what.

**2026-11-26, the final sweep before step A: the public website.** The owner, the same day:
*"Does the sweep session include the public website? Please include if not yet."* It did not:
§19 left the site out. It is in now. Read at `b5431b8`: `site/` in both languages, the legal
texts it renders, and the app's help guides, which the site links. A copy of the site, built
for the Alpha, was measured in a browser. §22 holds it. Nothing is built.

- **Five things on the website travel with step A** (T15, §22.3). The tester guide tells a
  member nothing about a family member's link: not to tell them first, not what they will see,
  not what to do when Google asks again for an account that is not the member's own. The
  Google help guide says not to *sit beside them while they sign in*, where the link page says
  to do that step together. Then the accessibility statement, the site's sentence about a
  link, and the English pages at 320 pixels.
- **Nothing on the site contradicts D1.** The site speaks to the member, and keeps *migreren*
  and *overstappen*. Its first sentence already says *kopieert*. One draft of §15 now takes
  the guide's verb, *beschrijft*.
- **D3's open part has a shape** (§22.5, D16): one setting that the app and the site both
  read, so that no sentence names a country.
- **The page says *accept*, and the terms say *no party*** (§22.6, D18). For the lawyer.
- **A story for families on the site is worth doing, in a plan of its own** (§22.7, D17).
- **The site holds AA where it was measured, with one fault:** every English page scrolls
  sideways at 320 pixels. The three pages of the site that a person can reach from their own
  pages are smaller and paler than those pages will be (§22.8).
- **Three more decisions, D16 to D18** (T16, §18). None stops step A.

**Is step A still ready to build? Yes,** with T15's part for step A added to it (§21.4).

**2026-11-26, the final sweep before step A.** The owner asked for it: *"step A can be built
once #2175 is in. But first do a final sweep of if we need to add/change anything."* #2175 is
in: `main` is at `b5431b8`, and its tree is the tree of `d60bbb2`, that branch's last head.
Every claim below that names a file and a line was read again there. Nothing is built. §21
holds what the sweep found and what step A needs.

- **Most claims hold. §21.1 lists the ones that did not.** The gravest: this plan said the
  progress page has no total. It has one, since 0154 (§3.2). T6 no longer adds it.
- **Two faults on the pages as they are today.** A person's progress page, and the ending
  after a sign-in, say *Google* about a Microsoft or a Dropbox account (§3.2, §5.5). And a
  price, with *the Billing page*, can reach a person's progress page (§3.2). Step A mends both.
- **D1 reaches further than three sentences.** 23 Dutch sentences of the two pages say a form
  of *migr-*. Ten more come from parts the member's screens share, and the server writes a few
  itself. §21.3 lists them, with the tests that pin today's words.
- **Nothing of #2175 is undone.** §21.2 says which of its sentences step A changes, on which
  answer of the owner's, and which it leaves as the owner read them.
- **Some of §15 was not yet true in step A.** The stop's question promised ten minutes, which
  step C builds. §15 now says which step each sentence ships in, and what step A says instead.
- **Missing, and added:** what a stop says of the provider's answer; the texts a person
  accepts, before any redirect; where from and where to, before any button; a way on after
  *Back* at the provider; a reader who does not know the password; the words for the five
  states; no price on a person's page.
- **Four new decisions for the owner, D12 to D15** (T14, §18). Each has advice, and says what
  the builder does until it is answered. None stops step A from starting. (Answered the same
  day, all as advised: the entry at the top.)

**Is step A ready to build? Yes.** On `main` at `b5431b8` or later, from §21.4, with D12 to D15
as the owner answered them. Two things stay the owner's before step A merges:
the read of its Dutch, as for #2175, and T0 if Google's own words are wanted in it.

**2026-11-26, the owner's answers (T13).** On D1 to D11 the owner answered: *"D1 to D11: ok on
the advised."* So the advice stands for every decision (§18):

- **D1 (a):** *kopiëren* on a person's two pages. The member's app keeps *migreren*, and the
  glossary row at `:106` gains the exception.
- **D2 (a):** the stop says *Stop copying* / *Kopiëren stoppen*.
- **D3:** the page says *the service that makes the copy* now. Where it is run waits for the
  site's next pass.
- **D4 (a):** the one link asks again by itself when a connection stopped by itself, and at a
  member's press after the person's own stop.
- **D5 (a):** one choice when a link is made, how long it asks, 30 days first. The page lives
  90 days, and a member can extend it.
- **D6 (a):** the ten-minute window on a stop goes ahead. The lawyer reads it before anybody
  outside the Alpha gets it; putting it to the lawyer is the owner's.
- **D7 (a), D8 (a), D11 (a):** a fixed list for the relation; *je* or *u* per person; the
  member's own number where given, else the organisation's.
- **D9: yes.** A person's link page tells Google's screens in steps of its own. Until T0 it
  quotes nothing of Google's.
- **D10:** the order below, and step A in the next alpha.

No task waits on a decision any more. T0 (Google's own words, read off a real phone) and T12
(the first test with three people) are still the owner's.

**2026-11-26: planned, written for the owner's review; nothing is built.** Every claim about the
code below was read at `2a16fab`, the head of the open draft pull request #2175
(`claude/ownpace-public-readiness-y7orc6-a21-family-words`), with file and line. That branch was
cut one commit behind `main` at `e0c271a`; the commit it lacks (#2174) changes
`grant-server-domain.ts` only. #2175's own changes are this plan's ground, and are not repeated
here (§3.7). **Build on #2175 once it is merged**, or on its branch. (The sweep above read
everything again at `b5431b8`, where #2175 is merged. Build on `main`.)

**Where the design comes from, and how far to trust it.** From the owner's answers of 2026-11-26
(§1), and from a desk review: drawn screens, read by seven simulated readers. A language model
played each: two older people (one who taps nothing, with poor eyesight and a tremor; one who
reads every word), an adult who organises, a teenager who is being moved, a volunteer who
teaches older people at a library, an accessibility and plain-language reviewer, and a privacy
reviewer. A desk review finds problems. It proves nothing about real people. T12 is the first
test with people, and what it finds outranks this plan's words.

**What is not known, and is the owner's to measure (T0).** Google's own words on its screens, in
Dutch and in English. The tester guide leaves them out *until proven*
(`site/pages/nl/alpha-handleiding.md:30-33`), and this plan follows that rule: §5.4 gives the
step's shape, and T0 fills in Google's words from a real phone.

**The order (D10).** Three steps, each one mergeable by itself.
- **Step A, words and layout, no schema:** T1, T2, T9, and the first halves of T5 and T6. And
  one line of T8 (D13 (a)).
- **Step B, a small schema:** T3, T7, T8, and what T6 adds to the server's answer: who can open
  the copy, and the sender.
- **Step C, the mechanism:** T4, and the second half of T5.

T10 and T11 travel with each step, and so does T15, the website. T0 is the owner's and blocks
only what it names. T13 and T14 are answered. T16 holds the website's three decisions.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's hand test: Google's own screens, word for word, in Dutch and English | owner | ⏳ **Owner** | §5.4, §15. The warning, its two buttons, the tick boxes and whether they open ticked, what the warning offers besides going on and where that leads, and *Access blocked*. Blocks only the quoted words of T1's fourth screen. |
| T1 The link page in steps: who asks, the accounts, what to have ready, what Google shows | builder | 📋 Planned | §5, §21.4. No schema. L. Every rule today's page keeps stays (§5.7). |
| T2 The words, EN and NL, and the glossary rows they change | builder | 📋 Planned | §6, §15, §21.3. D1 and D2 are answered: *kopiëren*, and *Stop copying*. L, where it was M: 23 sentences, ten shared ones, and the tests that pin them. |
| T3 Who asks: a name, a relation, and a number to check | builder | 📋 Planned | §7. A managed migration. M. D7 and D11 are answered. |
| T4 One link: it asks, and afterwards it is the person's page | builder | 📋 Planned | §8. ADR-0035 amended first. A managed migration. L. D4 and D5 are answered. |
| T5 Stopping: its own screen, two equal answers, and ten minutes to take it back | builder | 📋 Planned | §9. First half (the screen) in step A; second half (the window) needs a ledger migration. L. D2 and D6 are answered; the lawyer reads the window before anybody outside the Alpha gets it. |
| T6 The progress page: nothing to do, how far, how long | builder | 📋 Planned | §10, §21.4. The total is there since 0154. Step A: the first line, the words, no price, the refresh. Step B: who can open the copy and the sender, two additions to the server's answer. M. |
| T7 *Je* or *u*, and the page's language, chosen per person | builder | 📋 Planned | §11. After T2, so each sentence is written once. A managed migration. L. D8 is answered: per person. |
| T8 Making the link: tell first, a message to send, 30 days | builder | 📋 Planned | §12. M. |
| T9 Size, contrast and targets on the two pages | builder | 📋 Planned | §13. No schema. M. |
| T10 What follows: the guides, the privacy text, ADR-0035, the glossary | builder | 📋 Planned | §14. With each step. M. The website's share is T15. |
| T11 Proofs: unit, the managed UI smoke, integration | builder | 📋 Planned | §16. With each step. |
| T12 A first test with three people | owner | ⏳ **Owner** | §17. After step A is on a stack the owner can reach. |
| T13 The owner's decisions | owner | ✅ Answered 2026-11-26 | §18. D1 to D11, all as advised. |
| T14 The sweep's decisions, D12 to D15 | owner | ✅ Answered 2026-11-26 | §18. *"D12: a / D13: a / D14: yes / D15: a"*: all four as advised. |
| T15 The public website: what travels with each step | builder | 📋 Planned | §22, §21.4. With step A: the tester guide, the Google help guide, the accessibility statement, one sentence of the Leaving pages, the English pages at 320 pixels, and a block for families on the home page (D17 (b)). M. |
| T16 The website's decisions, D16 to D18 | owner | ✅ Answered 2026-11-26 | §18. *"P16: a"*, *"P17: b, …"*, *"P18: keep now"*: D16 (a) in step B; D17 (b), a block on the home page with step A; D18 (a), for the lawyer. |

## 1. The owner's words

All of 2026-11-26. The question is restated; the answer is the owner's own.

| The question | The owner | What it means here |
|---|---|---|
| May the page show a phone number for whoever asks? | *"yes"*, and on showing it as something to check: *"Yes, good idea. And we can store/show the phone number."* | T3. The number is shown beside *"or the number you already have"*. |
| May the page name the member who asks, a name asked once? | *"Yes"* | T3. |
| Does Ownpace ever mail the person being migrated? | *"Keep the rule."* | Unchanged: the member sends everything (ADR-0035 decision 2, ADR-0043). T8 gives them the message. |
| Thirty days for a person's link, where it was seven? | *"Ok"* | T4, T8. |
| The person's two pages a level plainer than the app? | *"Yes."* | T2. CEFR A2 is the aim; the rules are in §6. |
| Say on the page who else can open the copy? | *"Yes, but what was agreed upon between the persons is outside Ownpace."* | Built in #2175. T1 keeps it on the first screen. The page states the fact and no more. |
| During the Alpha, the Google step together? | *"Yes, preferably"* | Built in #2175 as one line. T1 moves it to the screen before Google. Advice, never a condition. |
| A word agreed by voice, which the page then asks for? | *"No"* | Not built. |
| One link for the whole journey? | *"Yes, we work with one link."* | T4. |
| A way back after an accidental stop? | *"Yes"* | T5. |
| *Je* or *u* on the person's pages, as the member chooses? | *"Yes"* | T7. |
| A route with no link at all: an address and a code, typed by hand? | *"Yes, but first reason more on this."* | Not in this plan (§19). |

The owner's order for the work: the quick changes first, and of those only the ones the desk
review also advised. That is step A.

On this plan's own decisions, later the same day: *"D1 to D11: ok on the advised."* (§18).

And on when to build: *"step A can be built once #2175 is in. But first do a final sweep of if
we need to add/change anything."* That sweep is §21.

## 2. Who reads these pages

A person with no account, who did not ask for this, and who is often older. They have been taught
three things, by a bank, by the police, or by a child: never tap a link in a message, never give
a code to anybody, and stop at a warning. Our flow asks them to tap a link, to sign in, to tap
through Google's warning, and to leave ticked a box that says *permanently delete*.

So the page cannot ask for trust. It has to give something to check. Ten rules follow, and each
task below cites the ones it serves.

- **R1. Google's own words come before the button**, in a step of their own. A warning nobody
  announced reads as the trap they were warned about.
- **R2. No sentence shaped like a fraud.** Not *this is normal*, not *asks for your help*, no
  greeting written as if the page were the sender.
- **R3. Every reassurance is literally true.** One screen later Google says *read, send and
  permanently delete*. A page that said *read-only* just before has lied, in the reader's eyes.
- **R4. Say who can open the copy.**
- **R5. Say what Ownpace is,** in one line.
- **R6. The page does not vouch for the sender.** It asks whether the sender told them, and
  *not yet* is an answer as good as *yes*.
- **R7. Say what to have ready** before the page is left: the address, the password, the phone.
- **R8. One word for one thing** on these two pages, and an icon only beside its word.
- **R9. Stopping is never a trap:** its own screen, two equal answers, a way back.
- **R10. Progress says three things:** whether anything is needed, how far, how long.

## 3. What exists

Read at `2a16fab`, and again at `b5431b8`: `main` with #2175, the same tree as that branch's
last head, `d60bbb2`. The lines below are that tree's. Grant links are managed-only: the
appliance moves one implicit person and issues none
(`packages/managed/src/person-link-store.ts:29-30`).

### 3.1 The link page

`apps/web/src/pages/Grant.tsx` (927 lines). A person's link renders `PersonGrant` (`:353`); a
single migration's own link renders inside `Grant` (`:682`) and is not in this plan (§19).

`PersonGrant` is one long page. In order: one sentence, `grant.person.asking` (`:582`); a box of
facts, *Company*, *Asked by*, *Phone* (`:583-611`); a warning when a password is asked and there
is no phone (`:614-618`); `grant.check` (`:619`); *Report this link* (`:623`); the note about a
page opened inside a chat app (`:627`); then the accounts, sources first (`:629` on), one card
each. A card holds its state, its migrations, who can open the copy (`:479`), the read-only box,
the permission in words with the scope behind a fold, the *do it together* line and the button.
Below the cards: *every account is connected* (`:638`), the progress link once a password was
stored (`:644`), and the date the link works until (`:656`).

Four more things stand on it, which §5 has to place (found by the sweep):

- **The page's one `h1`** is `grant.title`, drawn by `Grant` (`:750`). It also names the
  browser's tab (`:712-715`).
- **The texts a person accepts:** `grant.disclosure` and the links to the privacy policy and
  the terms (`:657-666`), *before any redirect* (the header, `:73-78`). Then where each
  provider's permission is taken back (`:669-673`), the accessibility statement (`:675-677`),
  and the build stamp (`:920-922`).
- **The person's new address**, with a button *Yes, that is right* / *Ja, dat klopt*
  (`YourNewAddress`, `:771-773`; `addresses.grant.yes`,
  `apps/web/src/i18n/strings/addresses.ts:154` / `:284`).
- **A button that stays pressed.** A press sets `starting` (`:359`, `:369`), which disables
  every button (`:510`, `:553`), and the page leaves for the provider. Shown again from the
  browser's back cache it is still set. The sign-in page clears its own on `pageshow`
  (`apps/web/src/pages/Login.tsx:196-198`); this page does not.

The words, in `apps/web/src/i18n/strings/grant.ts` (EN / NL):

| Key | EN | NL |
|---|---|---|
| `grant.title` (`:45` / `:280`) | *Connect your account* | *Verbind uw account* |
| `grant.askedBy` (`:63` / `:292`) | *Asked by* | *Gevraagd door* |
| `grant.check` (`:68` / `:297`) | *Only continue if you know who asked and the destination is yours or your organisation's.* | *Ga alleen verder als u de aanvrager kent en de bestemming van u of uw organisatie is.* |
| `grant.scope.mail` (`:82` / `:303`) | *Gmail: read, send and permanently delete all your email.* | *Gmail: al uw e-mail lezen, verzenden en definitief verwijderen.* |
| `grant.person.connect` | *Continue with Google as {account}* | *Doorgaan met Google als {account}* |
| `grant.person.theyOpenIt` (`:112` / `:323`) | *{who} can open the copy at {destination} too.* | *{who} kan de kopie bij {destination} ook openen.* |
| `grant.together` (`:117` / `:324`) | *Google shows a warning screen next, because this service is new. You can do this step together with {who}: on the phone, or at the table.* | *Google toont straks een waarschuwing, omdat deze dienst nieuw is. U kunt deze stap samen met {who} doen: aan de telefoon, of aan tafel.* |

**About Google's warning the page says one line and a link.** `AlphaGoogleLine`
(`apps/web/src/components/AlphaGoogleLine.tsx`) stands above the first Google button
(`Grant.tsx:446`): *Connecting Google during the Alpha? Read this first:* and a link to the
tester guide. The owner chose that on 2026-10-18, as the lighter of two options. The guide's own
section says, in Dutch, *Dat hoort zo tijdens de Alpha*
(`site/pages/nl/alpha-handleiding.md:115-116`), and leaves Google's words out until they are
seen (`:30-33`). During the Alpha Google lets in only addresses on its list of test users; any
other ends on Google's *Access blocked* page (`AlphaGoogleLine.tsx`, the header).

### 3.2 The progress page, and stopping

`apps/web/src/pages/View.tsx` (783 lines); the words are in
`apps/web/src/i18n/strings/migrations.ts`.

- **It says a state, a stage and a count against a total.** *Your things are being migrated
  across now.* / *De migratie is actief.* (`view.state.active`, `:192` / `:632`). Then each
  data type's stage and a line under it: *Copying* / *Wordt gemigreerd*, *4,211 of ~5,000*
  (`View.tsx:164-169`, `:185-193`; `state.stage.copying`, `:291` / `:720`). **Corrected by the
  sweep:** this plan said there is no total. There is one since 0154: a row carries
  `itemsFound` and `bytesFound` (`packages/shared/src/migration-view.ts:79`, `:81`), and the UI
  smoke reads *4.211 van ~5.000* on a person's page (`test/ui/managed-ui.ui.test.ts:1950`).
  *{count} migrated* (`view.copied.one`, `:200` / `:640`) is said only for a row with no stage.
- **Its rows are worded by parts the member's screens share, on purpose:** *somebody who phones
  the person who sent them the link should be reading the same sentence they are*
  (`View.tsx:25-28`). The stage (`StateChip`), the line (`useLineSentence`,
  `apps/web/src/components/MigrationLines.tsx:109-144`: *laatste ronde*), how long
  (`timeLeft.*`: *volgens de laatste 3 rondes*) and why it waits (`PausedBecause`). D14 is about
  this.
- **It says *Google* about every account.** An account that a link can connect is grouped
  whatever its provider (`isGrantableSourceKind`,
  `apps/api/src/routes/migrations/grant-link-readiness.ts:102`: Google, Microsoft, Dropbox).
  The page heads each group *Your Google account* (`View.tsx:583-587`;
  `view.person.account.only`, `:260` / `:692`) and says of each that Google withdraws, that
  Google confirmed, and where Google lists its apps (`view.grant.wholeApp`, `:245`;
  `view.withdrawn.*`, `:251-255`; `view.person.grant.body`, `:265`; `View.tsx:236-248`). The
  link page has each provider's words; this page has none. A fault since 0171, and step A's to
  mend (T2, T5).
- **A price can reach it.** A pause at the data ceiling says *Move up to {tier}: €{monthly} a
  month* and, under *Why?*, *Choose on the Billing page* (`View.tsx:226`;
  `apps/web/src/components/PausedBecause.tsx:62-78`; `pause.dataCeiling.moveUp`, `:439` /
  `:784`). The reader has no account and no Billing page. Step A's to mend (T6).
- **It carries no address and no sender.** The answer holds the organisation's name, counts,
  states and each provider's kind (`PersonView`, `migration-view.ts:406`). An account is named
  by an opaque `ref`, *never by the address: a progress link lives up to 180 days and may be
  forwarded* (`apps/api/src/routes/person-progress.ts:17-18`).
- **It is also a migration's own page.** A link made before 2026-10-03 for one migration opens
  the same component (`View.tsx:703-759`), on the appliance too, and lives at most 180 days.
- **It says how long.** `HowLong` (`View.tsx:479`, used at `:551` and `:739`).
- **It does not refresh.** No query on the page has a `refetchInterval`, and the app sets
  `refetchOnWindowFocus: false` (`apps/web/src/App.tsx:13`).
- **The stop is a small red-edged button** (`View.tsx:346`, `:437`: `px-3 py-1.5 text-sm`):
  *Withdraw access* / *Toegang intrekken* (`view.grant.withdraw`, `:246` / `:677`). The question
  opens in place, with a red filled *Yes, withdraw it* beside a grey *Keep it* (`View.tsx:358`,
  `:366`, `:449`).
- **Afterwards the page says** *Migrating stopped: on {date} you withdrew the access you gave.*
  (`view.state.withdrawn`, `:236` / `:670`), and *To resume later, ask for a new link.*
  (`view.withdrawn.since`, `:254` / `:686`).
- **On the server a stop is final at once.** The token is revoked at Google, then deleted here,
  and `grant_withdrawn_at` is set in the same transaction; while it is set nothing reads the
  account, and *a new grant clears it* (`apps/api/src/routes/withdraw-grant.ts:21-41`). That
  file is a migration's own link's. A person's page stops an account through
  `withdrawPersonGrant` (`apps/api/src/routes/person-progress.ts:603`), by the same rules:
  each of the account's tokens, on every migration that holds one.
- **The page says what the provider answered.** *Done. Google confirmed…*, or *Deleted here…
  Google did not confirm*, with where to remove the app by hand (`View.tsx:293-312`;
  `view.withdrawn.revoked`, `:251` / `:682`). The owner asked for it on 2026-09-23
  (`withdraw-grant.ts:4-7`).

### 3.3 The links themselves

- **A person has two links:** *one grant link and one progress link for all their migrations*
  (`docs/adr/0035-who-signs-in-and-who-gets-a-link.md:108-109`). One mechanism with two jobs
  (`:82`), on different lifetimes *because they carry different risk* (`:91`).
- **The token** is `p.<id>.<secret>` for both (`person-link-store.ts:22`), told apart by the
  row's `purpose`. The secret is 32 random bytes, hashed at rest
  (`packages/ledger/src/mapping-link-store.ts:164`). It is shown once, at issue.
- **A grant link** works 1, 7 or 30 days, 7 unless chosen (`mapping-link-store.ts:54-55`), and
  is refused once it is spent (`person-link-store.ts:165`). **A progress link** works 30, 90 or
  180 days, 90 unless chosen (`mapping-link-store.ts:73-74`).
- **A link can ask again.** A grant link made while every account is connected asks each of
  them again (`asksAgain`, `person-link-store.ts:32-42`;
  `apps/api/src/routes/person-link-routes.ts:203-215`). It is a new link, made by a member.
- **After the last sign-in** the ending shows the person their progress link, and the grant link
  is spent. They now hold two links, one of them dead, usually in one chat thread.
- **During the Alpha a Google connection stops after about seven days**
  (`site/pages/nl/alpha-handleiding.md:120-125`). A copy that is kept in step until the switch
  runs longer than that, so many people will be asked more than once.

### 3.4 Who the page says is asking

- *Asked by* is the sign-in address of the member who made the link
  (`readPersonLinkAskedBy`, `apps/api/src/routes/migrations/person-grant-subject.ts:603-618`). A
  member has no name on record: `tenant_member` holds an address, a role and a status
  (`packages/managed/src/schema-managed.ts:264-295`).
- *Phone* is the organisation's one number, optional, typed on Team
  (`readTenantContactPhone`, `packages/shared/src/tenant-contact.ts:65`; `tenants.org.phone`,
  `apps/web/src/i18n/strings/organisation.ts:222`). It is shown as a fact, with a `tel:` link.
- Nothing says how the reader knows the sender.

### 3.5 The words: the glossary and its guards

`apps/web/src/i18n/GLOSSARY.md` records the owner's words. Four rows bind this plan.

- **Never any form of *verhuizen*** (`:59`; the owner, 2026-09-28). Two guards refuse it:
  `apps/web/src/i18n/i18n.unit.test.tsx:48` and `scripts/a-word-the-owner-retired.unit.test.ts`.
- **The verb for the migration's copying is *migreren*** (`:106`; the owner, 2026-10-10:
  *gemigreerd* where it was *gekopieerd*; *kopie* stays the noun). **The page does not follow
  that row today.** Since 0174 and #2175 a person's pages say *worden gekopieerd*
  (`grant.group.from`), *de kopie* (`grant.person.theyOpenIt`) and *het kopiëren wacht*
  (`view.state.destinationRemoved`), beside *gemigreerd* in the counts. D1 settled it:
  *kopiëren* on a person's two pages. Three more rows are said on a person's progress page:
  the line under a stage (`:107`), how long (`:109-110`) and the stages' own words (`:120`).
  §21.3 has every sentence D1 touches.
- ***Leest alleen* is the software's promise; *alleen-lezen* is a permission the provider
  enforces.** Two facts, never one word (`:112`).
- **NL is formal: *u*, never *je*** (`:132`). No guard reads the dictionary for it; one reads
  the sign-in service's mails (`scripts/a-sign-in-page-in-our-own-words.unit.test.ts:357`). The
  dictionary's form is *u hebt*, 14 times, against *u heeft* once; the owner's read of
  2026-11-26 wrote *U hebt uw toestemming…* too.

Also binding: *aanbieder*, never *provider* (`:98`); *stoppen* / *hervatten* is one data type no
longer following its source (`:93`), which is not what a person's stop does (D2); and the
guards `one-dutch-for-a-grant-link`, `a-word-nobody-says`, `words-that-fit-on-one-line` and
`hardcoded-text` in `apps/web/src/i18n/`. One more pins whole sentences as literals, so that *a
word changed without the owner is seen*: `the-owners-words-at-the-door.unit.test.ts`. Three of
its lines hold sentences D1 changes (§21.3).

### 3.6 Making the link

On a person's page in the app, under *For {name}* (`apps/web/src/pages/Person.tsx:532-553`):
one section makes the grant link and one the progress link
(`apps/web/src/components/MappingLinksPanel.tsx:400`, `:413`). The member picks a lifetime, the
link is shown once, and the page says *Send it yourself; it cannot be shown again*
(`grantLink.issued.youSend`, `grant.ts:27-28`). Nothing asks whether the person was told, and
there is no message to send.

### 3.7 What #2175 already does

Four changes, recorded in 0174's Status of 2026-11-26. A destination's password removed is not
the source's access taken back. Wording fixes, among them the ending that told a person with a
second account that *this link will not work again*. *Who can open the copy*. *Do it together,
during the Alpha*. This plan moves the last two to the screens where they are read, and changes
neither their rule nor who they name.

Merged on 2026-11-26 as `b5431b8`. Its last commit is the owner's read of its Dutch: *"ok on
all 10, including your edits."* §21.2 holds each of those sentences against this plan: which
step A changes, on which answer, and which it leaves as read.

## 4. The design in one page

1. **One link** (T4). The person is sent one address. It asks for permission while there is
   something to ask. Afterwards the same address is their page.
2. **The permission is asked in steps** (T1). One thing per screen: who asks and for what, which
   accounts, what to have ready, what Google will show. Then Google.
3. **The first screen asks one question** (T1): *Did {who} tell you about this link themselves?*
   *Not yet* leads to a calm screen that says: ask first, the page can wait.
4. **The sender is a person** (T3): a name, how the reader knows them, and a number shown as
   something to check, never as proof.
5. **Google's screens are told beforehand, in Google's own words** (T1, T0): the sign-in, the
   warning and its buttons, the tick boxes. The page says the warning is right.
6. **Progress opens with what the person wants to know** (T6): *You do not have to do anything
   now. You may close this page.* Then how far, of how much, and how long.
7. **Stopping has its own screen** (T5), with two answers of equal weight. For ten minutes a
   stop can be taken back; in those minutes nothing is read.
8. **The page speaks as the member would** (T7): Dutch with *u*, Dutch with *je*, or English,
   chosen per person.
9. **The member tells first** (T8), and is given a message to send, in the same voice.
10. **The two pages are large and plain** (T2, T9): short sentences, 18-pixel text, 60-pixel
    buttons.

## 5. The link page in steps (T1)

Serves R1 to R8. No schema: the page shows what the server sends today, on more screens.

### 5.1 The first screen: who asks, and for what

Shown while no account on the link is connected and the reader has not answered yet.
*Connected* is what a card's state says today (`stateOf`, `Grant.tsx:426-427`): an account
that is asked again counts as waiting. So a link that asks again opens with this screen too,
and says in one line why it asks again (`grant.person.again`, in §15's words).

- One line saying what Ownpace is (R5; D3).
- The title: *{who} asks for your permission*. `{who}` is who the page names today (`askedBy`,
  else the organisation); T3 makes it a name.
- The sender's facts, as §7 has them once T3 is built. Until then, today's box, under the
  label *Sender* (step A changes the label; the name, the relation and the number are T3's).
- **What is asked, in one sentence**, when everything on the link is copied from one account
  to one provider: *{who} wants to copy your {what} from {source} to {destination}.* `{what}`
  is the data types in their short names, joined as the language joins a list. Otherwise:
  *{who} wants to copy your {what}. The next screen shows from where and to where.* The
  sentence may stand beside the two providers' tiles and an arrow, as the member's own lines
  draw them (`apps/web/src/components/MigrationLines.tsx:147-162`): the arrow is hidden from a
  screen reader, which hears *to*.
- Up to four facts, each a line: everything also stays in {source}; Ownpace only reads there
  (*leest alleen*, §3.5); who can open the copy, where it is true (`theOrganisationOpensIt`,
  from #2175); there is no hurry, with the date.
- **Who can open the copy** stands here when the sentence above names one destination and the
  organisation connected it. Otherwise it stands beside its migration on the accounts screen,
  as #2175 placed it. The page says nothing where the person connects the destination
  themselves, as today. It never says *only you can open the copy*: the page cannot know who
  else holds that account's password (R3).
- **The question** (R6): *Did {who} tell you about this link themselves?* Two buttons of equal
  size: *Yes, that is right* and *No, not yet*. The buttons hold no name, so they fit a narrow
  screen whatever the sender is called.

The answer is not sent and not stored on the server. It opens the next screen. The page
remembers it for the tab only (session storage, read and written inside try and catch), so a
return from Google does not ask again. The key names the link by its id, never by its secret;
the value is one word.

`grant.check` leaves a person's link: the question replaces it. *Report this link* stands on
the *not yet* screen as a button, where it answers something. On every other screen it stands
at the foot, in one place, as a quiet link: a reader who said *yes* and doubts at the third
screen can still report it (0108 T8 (d); criterion 3.2.6 asks for one place).

**The person's new address does not stand on this screen** (`YourNewAddress`, §3.1). Its
button says *Yes, that is right* / *Ja, dat klopt*, word for word this screen's answer. Two
buttons with one name on one screen cannot be told apart by a screen reader or by voice. It
stands on the accounts screen (§5.3).

### 5.2 Not yet

A calm screen, with no blame (R6): ask {who} first, in a way you trust; the page can wait, with
the date; if you do not know {who}, close the page, or report the link. One button: *Back*.

### 5.3 The accounts

Shown when the link holds more than one account, or one that is already connected, or a new
address for the person to confirm. With a single waiting account and no such address the page
goes straight on.

Sources first, then destinations, as today (`Grant.tsx:629`). Each line: the account, its
provider, what is copied from or to it, and its state in today's words (*Connected*; *Waiting*,
in Dutch *Nog niet verbonden*; *Locked on this link*: `grant.state.*`, `grant.ts:188-190` /
`:382-384`). A destination is named by its account and its provider, and by its server where
the provider has no name of its own, as today (`grant.toWhere`): it is one of the two facts
only the reader can check (0108 T8a). One button per waiting account. Under the list: the
person's new address, where there is one (`YourNewAddress`). When every account is connected
the page says so; after T4 it then shows the progress.

### 5.4 Per account: what to have ready, then what the provider shows

**A sign-in account (Google, Microsoft, Dropbox, Cirrux Drive): two screens.**

*Have this ready* (R7): the address; the password of that account; the phone, because the
provider may send a code to it; and *Give that code to nobody. Not to {who} either.* During the
Alpha, for Google: *Do this together with {who} if you can: on the phone, or at the table.* The
note about a page opened inside a chat app stands here (`grant.inAppBrowser`), because here it
can still be acted on.

Two lines the sweep adds here. **Where the password is typed, and who sees it:** *You type it
only on {provider}'s own page. Ownpace never sees it. {who} does not either.* Today's box says
this (`grant.readsOnly`, `grant.ts:75-76`), and the steps would otherwise lose it. **A reader
who does not know the password:** *Do you not know the password? Then stop here, and do this
together with {who}.* The page sends nobody to a provider's own way of making a new password:
that is where people lock themselves out.

*What you will see at {provider}* (R1, R3), as a numbered list:

1. **The sign-in.** *Sign in as {account}* (`grant.signInAs`, kept).
2. **The warning** (Google, and only while `isAlpha()`). *Google has not checked Ownpace yet.
   That is why Google warns, and Google is right to.* Then Google's own sentence, quoted, and
   the two things to tap, quoted (T0). Then: *Do this only here, because {who} told you about
   it themselves. At any other warning, stop.*
3. **What Google asks.** Today's lines (`grant.scope.*`), unchanged: they are Google's meaning,
   and the fold with the scope stays (ADR-0041 decision 4). Then, where the permission also
   allows changes: *Google's words are broader than what Ownpace does. Ownpace only reads. It
   sends nothing and deletes nothing.* Where the provider holds the permission to reading
   (`readOnlyAtProvider`: Drive and Tasks alone, Microsoft, Dropbox), the page says *read-only*
   as today, and not that the words are broader (0144 T3 (c)). Then the tester guide's own
   instruction, which the owner has read: *Make sure everything Ownpace asks for is ticked*
   (`site/pages/en/alpha-guide.md:83`). **Corrected by the sweep:** this said *Leave the ticks
   on*, which states from memory how Google's screen opens. A box left empty matters: the
   server stores nothing when Google granted less than was asked
   (`scripts/a-grant-stored-with-less-than-was-asked.unit.test.ts`). T0 records how the boxes
   open.
4. ***Access blocked*** (Google, and only while `isAlpha()`). *Does Google say «…»? Then this
   address is not on Google's list yet. Close the page and tell {who}. You did nothing wrong.*
   The quoted words are T0's.

Then one line: *You can stop this at any time, on this page* (after T4; until then, *on the page
you get afterwards*, as today). Then the texts a person accepts, with their two links
(`grant.disclosure`), on this screen and no earlier: they belong *before any redirect*, where
the reader can still walk away. And two buttons: *Sign in with Google* and *No, rather not*.
*No, rather not* ends calmly: nothing has happened, and the link works until its date.

For Microsoft, Dropbox and Cirrux Drive the same two screens carry their own words, which exist
(`PROVIDER_WORDS`, `Grant.tsx:176`; Cirrux Drive's are `grant.cirrux.*`). They have no warning
step.

**An account connected with the person's own password** (0174): one screen, *Have this ready*,
then the password card as it is. Its lines stay: where the password is checked, the tries left,
that nobody can see it again, and that Ownpace never asks for a password by mail or phone. The
texts a person accepts stand on this screen too, before the box.

**Until T0 is done** the warning step quotes nothing. No word of Google's is written from
memory. **The sweep found this plan saying two things here.** T0's row says it blocks *only the
quoted words*. D9 said the step *says only what #2175 says*. They differ by three sentences
that quote nothing: that Google has not checked Ownpace, that the warning is right, and that it
is right only here. D12 put it to the owner, who answered **(a)** on 2026-11-26. So until T0 the
step says those three sentences, with the tester guide's *Go on to Ownpace there* between them,
and the fourth step says without a quote what to do when Google does not allow the connection
(§15).

**This replaces the owner's choice of 2026-10-18** on a person's link page only: there the
steps stand where the one line and its link to the guide stood. The member's own screens keep
`AlphaGoogleLine`. The owner confirmed it (D9).

### 5.5 Coming back from Google

The ending is the server's own page (`apps/api/src/routes/migrations/google-consent.ts`,
`person-grant-ending.ts`). Since #2175 it says how many accounts are left and offers *Back to the
link*. Back on the link the first screen is passed over, and the accounts show the new state.
The endings take T2's words and T9's sizes.

What the sweep adds:

- **One ending serves every provider, in Google's words.** `grantResultPage`
  (`google-consent.ts:901`) is drawn after a Microsoft, a Dropbox and a Cirrux sign-in too, and
  its last sentence sends each of them to *your Google account's security settings*
  (`GRANT_ENDING`, `:1086` / `:1129`). A fault, and step A's to mend (T2): the sentence names
  the provider that was signed in to, and first the person's own page, which is where a stop is
  easiest.
- **Its Dutch says *migratie* four times, in three sentences** (`:1103-1116`). D1 reaches the
  endings (§21.3).
- ***This link will not work again* stays true until T4**, for the last account. Step A keeps
  it.
- **Its sizes are its own:** an inline style, with no size for its text, and a 44-pixel link
  (`:659-660`, `BACK_LINK_STYLE`). T9 gives it 18-pixel sentences and a 60-pixel button, under
  the policy the page is served with (`callbackPageHeaders`: inline styles only).
- **Back at the provider, without finishing.** The browser has *Back*, and the provider's own
  pages may offer a way out (T0 records what Google's warning offers, and where it leads).
  Either returns the reader to the step they left. It must then work: its buttons can be
  pressed again (§3.1, the last point), and nothing was stored.

### 5.6 Steps, as a browser and a screen reader meet them

- Each step is a history entry, so the browser's Back goes one step back and never off the page.
- Each step has one `h1`. Focus moves to it when the step opens.
- The step is told in words: *Step 2 of 4*. Never by colour or by dots alone.

The app has this rule already, for *Start a migration* (0145 T3 (a); the test
`apps/web/src/pages/a-step-that-starts-at-the-top.unit.test.tsx` says it in full). The link
page takes the same one, and the sweep spells out what that means here:

- Next and Back put the page at its top and focus on the new `h1`. The first render moves
  nothing. The scroll is smooth only when the reader has no preference about motion, and
  instant otherwise (`apps/web/src/pages/StartMigration.tsx:398`). No other motion is added.
- The browser's tab is named after the step (criterion 2.4.2), and gets its old name back when
  the page is left, as today (`Grant.tsx:705-715`).
- The last number of *Step n of total* is the provider's own page, so the count does not end
  where the hard part starts. A password account has no such page. The number is never past
  the total.
- A step opened first, with no answer in the tab, shows the first screen: a step is a place in
  the page, not an address to send.
- The link's secret goes nowhere new. The page asks the API for its own link, that link's
  report and the build stamp, as the UI smoke holds it to (`test/ui/managed-ui.ui.test.ts`),
  and a step asks for nothing more.

### 5.7 The rules today's page keeps

Each of these holds today. Most are pinned by a test under `apps/web/src/pages/` whose name
says the rule. The tests move with the screens; none is deleted.

- The page is in one language (`a-grant-page-in-one-language`).
- A real browser is named before the button (`a-grant-page-that-names-a-real-browser`).
- The button goes only to the provider's own page (`a-grant-button-that-goes-only-to-google`).
- A link can be reported (`a-link-that-can-be-reported`).
- A password card per kind, and a Drive card where there is one (`a-password-card-per-kind`,
  `a-drive-card-on-the-grant-page`).
- The person's new address is shown where it is known (`your-new-address-on-the-link-pages`).
- The company checked in the VAT register stays, for an organisation that has one.

Six more hold today, and the sweep adds them, because steps are where each could be lost:

- **The texts a person accepts stand before any redirect,** in the reader's language
  (`Grant.unit.test.tsx:122`, `:136`; `scripts/a-policy-link-that-answers.unit.test.ts:502`
  reads `Grant.tsx` for the module they come from). Google's verification asks for it.
- **Where from and where to stand before any button** (0108 T8a; `Grant.unit.test.tsx:164`,
  `:425`). Whoever sets up a migration into a server of their own can send a link whose every
  screen is genuine: the account read and the destination written are what only the reader can
  check.
- **The account is a condition, said before the button** (0108 T8 (b); `:227`).
- **Read-only is said only where the provider holds it** (0144 T3 (c); `:96`).
- **Never a token on the page,** and never a message to another window (`Grant.tsx:87-92`).
- **The accessibility statement and the build stamp** are at the foot of every screen
  (0145 T9 (b)).

`AlphaGoogleLine` is the one rule that goes, on a person's link only (D9). Its cases for a
person's link (`apps/web/src/components/AlphaGoogleLine.unit.test.tsx:291-355`) turn round:
they hold that the line is not there, and that the steps are. A migration's own link keeps the
line (`:280`).

## 6. The words (T2)

Serves R2, R3, R5, R8. §15 holds every new sentence, for the owner to read.

**Rules for the two pages and their endings.**

- A sentence has one idea and at most fifteen words. The aim is CEFR A2 (the owner, §1).
- A word a reader would have to look up is replaced or explained: *aanbieder* gets the company's
  name beside it; *toegang intrekken* becomes what it stops (D2).
- Nothing is promised that the next screen contradicts (R3). *Leest alleen* is said of what
  Ownpace does, never of what Google allows (§3.5).
- No *Dat hoort zo* and no *vraagt uw hulp* (R2). A warning is called right, and then explained.
- The page never speaks as the sender. It names the sender and says what they ask.
- An icon stands only beside its word, and is hidden from a screen reader (R8).

**The glossary changes first** (`GLOSSARY.md`: *change a word, change it here first*). T2 edits
the row at `:106` as D1 decided, adds a row for a person's stop as D2 decided, and adds the
sender's label. T7 edits *Register*. The rows at `:107`, `:109-110` and `:120` gain a person's
page's words too (D14 (a)).

**Keys that leave are removed**, with their Dutch, so `a-word-nobody-says` stays green.

**What the sweep adds to these rules.**

- **D1 is every sentence, not three.** §21.3 lists each Dutch sentence the two pages and their
  endings can say that holds a form of *migr-*, where it comes from, and what happens to it.
  The noun goes with the verb: *uw migraties* tells the same reader the same thing.
- **A sentence that only an old link's page says stays.** A link made for one migration before
  2026-10-03 still opens the old pages. They share the parts and most sentences, and take the
  new words and sizes with them. What only they say stays as it is: `grant.asking`, which the
  owner read on 2026-11-26, `view.who`, `view.title` and `view.notStarted.why`.
- ***Whoever set this up* stays until T3.** The owner read `view.state.destinationRemoved` on
  2026-11-26. It names nobody, and it is true. T3 gives the pages a name to say instead; step
  A does not word it twice.
- ***Omgeving* is *account*** on these pages: *uw oude account*, *uw nieuwe account*.
- **The provider is named right** (§3.2, §5.5): Google's words for a Google account, and each
  other provider's for its own.
- **A sentence that needs no *u* gets none,** where it stays plain: *Leg dit klaar*, *Er is
  geen haast*. It then needs no second form in T7.
- **The Dutch is *u hebt*,** as the dictionary and the owner's read say it (§3.5).
- **A key is named by its shape.** `words-that-fit-on-one-line` gives a `.title` eight words,
  a `.hint` twelve in one sentence and an `.intro` fifteen. A longer sentence takes another
  name.
- **The owner reads the Dutch before the step merges,** as for #2175: the pull request lists
  every new or changed Dutch sentence in one table.

## 7. Who asks: a name, a relation, and a number to check (T3)

Serves R6. A managed migration.

- **A member's name, as the people they send links to know them.** Asked once, where the first
  link is made, and editable on Team. Stored on the member (`tenant_member`). Beside the field:
  *Shown on the page {name} opens.*
- **How the reader knows the sender.** Chosen by the member about themselves, from a fixed list,
  per link: *your daughter, your son, your child, your granddaughter, your grandson, your
  grandchild, your partner, your brother, your sister, your father, your mother, family,
  someone you know, your colleague*, or nothing. A fixed list, because free text under
  Ownpace's name is where an impersonator would write *your bank* (D7). The member picks their
  own word; the page infers nothing about anybody.
- **A number, shown as something to check.** *{who}'s number: {phone}. Or use the number you
  already have for {who}.* The page never says the number proves anything: a false page would
  print a number too. The number is the member's own where they gave one, else the
  organisation's (D11).
- **The label** is *Sender* / *Afzender*, where it was *Asked by* / *Gevraagd door*. The
  member's sign-in address is still shown, under the name.
- **The server sends** `askedBy` as an object: name, relation, phone, address. A link made
  before T3 has no relation and says none. A member with no name is named by their address, as
  today.

## 8. One link (T4)

The owner: *"Yes, we work with one link."* This amends ADR-0035 decision 2 and OPERATIVE's
*One link per person* line (`docs/adr/OPERATIVE.md:314-317`). **The amendment is written first**
(T10), and the code follows it.

### 8.1 What the person sees

One address. While something waits for them it shows the steps of §5. Once every account is
connected it shows the progress of §10. It never says *this link will not work again* about the
link they were sent.

### 8.2 What stays true of ADR-0035

- **Giving permission still ends.** The link asks until its *ask date*: 30 days from issue,
  or 1 or 7 if the member chose so (D5). An account that is connected has no button.
- **The page still lives longer**, 90 days, and shows counts and states, no content. A member
  can extend its date. A link never extends itself.
- **Still signed, expiring, revocable**, hashed at rest, shown once. A lost link is replaced by
  a new one, and the old one is revoked.
- **Still bound to the account:** a sign-in through the link is accepted only from the address
  the page named (`login_hint`, the verified address).
- **Still sent by the member, never by Ownpace.**

What a stranger holding the link can do does not grow. Before the ask date: read the page, and
give permission only by signing in as that very account. After it: read counts, and press stop,
which T5 lets the person take back.

**What a stranger holding the link can read does grow, and the sweep says so.** Today the page
that lives long holds no address and no sender (§3.2); the page that holds them lives at most
30 days and is spent once used. On one link the asking half shows the account's address and,
after T3, the sender's name, relation and number. Under D4 (a) it shows them again whenever a
connection stopped by itself, for as long as the page lives: 90 days, and longer when a member
extends it. That is the cost of *one link*, which the owner chose. ADR-0035's amendment states
it, T10's privacy text says it, and it is part of what the lawyer reads (§14). The page shows
an address only while it asks for that account.

### 8.3 The shape, as advice to the builder

- `person_link` gains `asks_until`. A link made by this plan is one row: the page's purpose and
  long life, with an ask date. `usedAt` and `asksAgain` keep their meaning for the asking half.
- The grant routes accept a person's token of purpose `grant`, as today, **or** a one-link
  token whose `asks_until` is in the future and which is not revoked. The progress routes
  accept purpose `view`, old and new.
- **One address in the browser.** Which one is the builder's choice; the constraint is that an
  old `/grant/…` and an old `/view/…` link keep working until they expire, as ADR-0035 already
  honoured the per-migration links.
- The limit on live links per person (`issuePersonLinkWithinTheLimit`) counts a one-link row
  once.

### 8.4 Asking again, on the same link (D4)

During the Alpha this decides how the product feels: a Google connection stops after about
seven days (§3.3).

- **When a connection stopped by itself**, the person's page says so and offers the same steps
  again for that account. Nobody has to make or send anything. The member still tells the
  person to look: Ownpace mails nobody.
- **When the person stopped it**, the page asks nothing. A member presses *Ask again* in the
  app, which opens the asking on the same link for 30 days. The person's own stop is never
  undone by a page that asks by itself.

This widens ADR-0035: an account connected through the link can be connected again through it
for as long as the page lives, by the same account, into the same destinations. D4 had a
narrower option; the owner chose this one.

## 9. Stopping, and taking a stop back (T5)

Serves R9. The owner: *"Yes"* to a way back.

### 9.1 The screen (step A, no schema)

- **The button says what it stops** (D2), full width, 60 pixels high, outlined. Not small, and
  not red.
- **The question has its own screen**, never a row that opens under the button. It says, per
  account: Ownpace stops reading this account; what is already copied stays at {destination};
  nothing is deleted at {provider}. For Google, today's sentence that Google withdraws it for
  the whole app (`view.grant.wholeApp`).
- **Two answers of equal size and weight**: *No, do not stop*, then *Yes, stop*. Neither is
  filled red. A reader with a tremor must not land on *yes* because it is the larger target.
- **Afterwards the page blames nobody**: *Copying has stopped*, not *you withdrew*. Then:
  *You do not have to do anything. Stopping is allowed.* And: *Want to continue later? Ask
  {who}.*

Both places that hold the button change (`View.tsx:346-368`, and `:437` on). A destination's
*Remove my password* gets the same two equal answers and no window: a stored password is deleted
when its owner says so.

What the sweep adds, for step A:

- **Step A has no window, so its words promise none.** A stop is final at once, as today. The
  question says so: *Continuing later needs a new link from {who}.* The ten minutes of §15 are
  step C's.
- **What the provider answered is still said,** as the owner asked on 2026-09-23 (§3.2). When
  the provider confirmed: that it did. When it did not: that the permission is deleted here,
  that the provider did not confirm, and where to remove Ownpace by hand, as a link on a line
  of its own. *You do not have to do anything* is said only in the first case. In the second
  there is something left to do, and saying otherwise would be untrue (R3).
- **Nothing was deleted, and the copy so far stays:** said again after the stop, where the
  reader looks for it, and not only in the question.
- **Since when:** *Copying stopped on {date}.* The date is today's, without the blame.
- **`{account}` is not an address here.** The page carries none (§3.2). It is the page's own
  name for the account: *your Google account*, or *Google account 2*, with the provider's own
  name, which the page reads from the account's migrations (`from`).
- **An account can feed more than one destination.** *What is already copied stays at
  {destination}* names each of them, or says *where it was copied to*.
- **The part is shared.** `TheAccessTheyGave` also serves a migration's own page
  (`View.tsx:741`), which takes the same screen.
- **A border can be seen.** An outlined button's edge is 3 to 1 against the page or better
  (criterion 1.4.11). Today's is `gray-300`, 1.5 to 1 on the paper (§13).

### 9.2 Ten minutes to take it back (step C)

- **On *Yes, stop*:** `grant_withdrawn_at` is set at once, as today, so nothing reads the
  account from that moment (`withdraw-grant.ts:36-41`). The token is **not** yet revoked at the
  provider and **not** yet deleted. A new column holds when the stop becomes final: ten minutes
  later (D6).
- **In those minutes** the page says: *By accident? Until {time} you can take this back*, with
  one button, *Continue copying after all*. It also says what is kept: *Until then Ownpace
  keeps your permission, unused. After {time} it is withdrawn at {provider} and deleted here.*
  And one link ends the wait: *Withdraw it at {provider} right now*.
- **Taking it back** clears `grant_withdrawn_at`, only while the window is open and only for the
  token it was set on, by the rule the delete follows today (`withdraw-grant.ts:43-49`).
  Copying goes on at the next pass.
- **When the window closes** the stop is made final exactly as today: revoked at the provider,
  deleted here, the provider's answer recorded. A job does it, so it never waits for the page
  to be open.
- **The record says all of it:** the stop asked, the stop taken back, the stop made final, each
  an `audit_log` row by `progress-link`.
- **The member's screens** say, in those minutes, that the person stopped and can still take it
  back until {time}, so nobody reacts to a slip.

ADR-0035's line becomes: nothing reads the account from the moment of the press; for ten
minutes the press can be taken back; then the grant is revoked at the provider and deleted
here. Whether that is *withdrawn as easily as it was given* is for the lawyer (D6): the owner
puts it to the lawyer before anybody outside the Alpha gets the window.

Three notes from the sweep, for whoever builds step C:

- A person's page stops an account in `withdrawPersonGrant`
  (`apps/api/src/routes/person-progress.ts:603`), not in `withdraw-grant.ts`: one press can
  hold several tokens across several migrations. The window is per press, over all of them.
- The page says a time: *until {time}*. A reader who cannot extend a time limit is what
  criterion 2.2.1 guards against. Here the limit is the point: a longer one keeps a permission
  the person asked to end. The ADR's amendment says so, and the lawyer's answer sets the
  length.
- *Withdraw it at {provider} right now* is a button of the same size as *Continue copying
  after all*. The way to end the wait is never the smaller one.

## 10. The progress page (T6)

Serves R10.

- **First, whether anything is needed.** While copying runs: *You do not have to do anything
  now. You may close this page.* When something does wait, that comes first instead: an account
  to connect, or a connection that stopped (§8.4).
- **How far, of how much.** *{count} of ~{total}*, in the glossary's form (`GLOSSARY.md:106`),
  with *total not known* where discovery has no count. **Corrected by the sweep:** the page
  says this today (§3.2). Nothing joins the server's answer for it. What T6 changes is the
  words around the numbers (D1, D14).
- **How long.** `HowLong`, as it is, in the person's words (D14 (a)).
- **The numbers refresh by themselves**, once a minute while something is copying. Focus does
  not move and nothing is read out again. One line says when: *Last updated at {time}.*
- **Who can open the copy** is said here too, where it is true. The page's answer does not
  carry that today. Step B adds it, one yes or no per migration, by the rule the link page's
  answer uses (`isTheOrganisationsDestination`,
  `apps/api/src/routes/migrations/person-grant-subject.ts:382`). It is a state, not content.
- **The date** the page works until stays (`view.until`).

What the sweep adds, for step A:

- **The first line, by rule.** The first of these that holds:
  1. A connection needs renewing (a row's last failure is `auth_expired`): the page says so
     first, and who can send a new link. It does not say *you do not have to do anything*.
  2. Every migration on the page is held by a stop: the stopped words of §9.1.
  3. Otherwise: *You do not have to do anything now. You may close this page.* That is true
     while a migration waits for the member's Start, too.
- **No price on a person's page.** A pause at the data ceiling says that copying waits for a
  choice by {who}, and that nothing is lost. No plan's name, no amount, and no *Billing page*:
  the reader can open none (§3.2). The member's screens keep their sentence.
- **`{who}` is the organisation here until T3.** The page's answer carries no sender (§3.2),
  and step A adds no field.
- **The refresh, exactly.** Once a minute, while the page is visible and a migration on it can
  still change; it stops when every one is done or held. The scroll, the focus and an open
  question stay where they are. The numbers are in no live region. A refresh that cannot reach
  the server keeps what the page showed, and says when that was. A link that was refused
  meanwhile shows its refusal, as today. Criterion 2.2.2 asks that a reader can stop what
  updates by itself: nothing here moves, and the refresh is the page's purpose. T12 watches
  whether anybody is thrown by it.
- **The title and the five states** take D1's words (§15): no *migratie* in the `h1`, and one
  sentence per state.

## 11. *Je* or *u*, and the page's language (T7)

The owner: *"Yes"*. This amends the glossary's *Register* (`GLOSSARY.md:130-133`).

- **Chosen per person** (D8), by the member, where the link is made: *Dutch, with u*; *Dutch,
  with je*; *English*. Stored on the person. A mother may be *je* and a grandfather *u* in one
  family. Unset means *u*, and the browser's language, as today.
- **Where it holds:** a person's link page, their progress page, the server's endings, and the
  message of §12. Nowhere else. The member's own app stays *u*.
- **How:** the server's answer for a link carries the language and the register. The Dutch
  dictionary gains an informal layer holding only the keys those pages say, and the page reads
  it first when the register is informal. English has one *you* and no layer.
- **The page's language** is the one chosen for the person, until the reader picks another with
  the switch, which then wins, as today.
- **Guards:** every Dutch sentence the two pages say that holds *u* or *uw* has an informal
  twin; no informal sentence holds *u* or *uw*; no formal one holds *je*, *jij* or *jouw*.
- **After T2**, so that each sentence is written once in each voice.

The cost is real: about a hundred Dutch sentences get a second form. Of the 186 `grant.*` and
`view.*` keys, 102 hold *u* or *uw* today, and the server's endings come on top. §15 gives the
pattern.

**The sweep counted again at `b5431b8`: 186 and 102 hold. The dictionary is not all the Dutch
these pages say.** Three more homes, each with *u* in it:

- **Parts the pages share with the member's screens:** how long (`timeLeft.*`), why it waits
  (`pause.*`), the new address (`addresses.grant.*`), *Report this link* (`linkReport.*`).
- **Sentences the server writes in both languages,** which the page shows a half of: a refused
  link (`packages/shared/src/link-holder-refusals.ts`), a refused stop
  (`apps/api/src/routes/person-progress.ts:583-596`, `withdraw-grant.ts`), and why an account
  cannot be asked yet (a card's `notReady`).
- **The endings** (`google-consent.ts:1095-1136`).

A server sentence has two halves today, English and Dutch. T7 gives the Dutch a second form,
or sends the register with the request so the server writes one. Either way the guard of this
section reads all three homes: a guard on the dictionary alone would pass with a *u* on a *je*
page.

## 12. Making the link (T8)

Serves R6. On a person's page in the app, the two sections of §3.6 become one, once T4 is built:
*A link for {name}*.

- **A tick before the button:** *I have told {name} that a link is coming: by phone, or in
  person.* It cannot be checked. It is a prompt, at the one moment it can still be acted on.
- **The form asks** how the page speaks to them (T7) and who the member is to them (T3).
- **During the Alpha, for a Google account:** one line that the address must be on Google's
  list of test users first, with the link `AlphaGoogleLine` already carries.
- **Thirty days** is the lifetime offered first (the owner, §1).
- **With the link, a message to send**, in the person's language and register, which the member
  may change before sending. It has no greeting written for them and no urgency (R2), and it
  names what was said aloud: *This is the link I told you about.* The member sends it, through
  a channel the person already trusts (ADR-0035).
- **One line for the member:** do the Google step together if you can.

What the sweep adds:

- **Tell first, already in step A (D13 (a), answered 2026-11-26).** Step A's first screen
  asks the person whether the sender told them. Until T8 is built nothing else tells the
  member that it will. So step A adds §15's one line where a person's link is made, and offers
  thirty days first there. §21.4 says what done means.
- **A child under 16.** The privacy text says a link for a child under 16 is completed by the
  parent together with the child (`site/legal/privacy.md`, §12). Where the member chooses
  *Dutch, with je*, the form says so in one line. The page asks nobody's age.
- **A printed sheet, and everything on one page, in step B (D15 (a), answered 2026-11-26).**
  The steps are gone once the person is at the provider; paper is still on the table. T8 gains
  *Print a sheet for {name}*, and the person's page gains *Read everything on one page*, which
  prints. The same sentences, written once.

## 13. Size, contrast and targets (T9)

On a person's link page, their progress page and the endings. Today the two pages hold 84
lines that set `text-sm` or `text-xs`, and the language switch is `text-xs`
(`apps/web/src/components/LanguageSwitch.tsx:33`).

- **Text:** 18 pixels for sentences. Nothing under 16.
- **Buttons:** a main button is at least 60 pixels high and as wide as the column on a phone.
  Two answers to one question are the same size. Every other target is at least 44 by 44. That
  is past WCAG 2.2 AA (24 by 24, criterion 2.5.8), on purpose.
- **Contrast:** sentences at 7 to 1 or better. With Tailwind's default greys, `gray-500` on
  white is 4.83 to 1 and `gray-600` is 7.56 to 1, so nothing lighter than `gray-600` carries a
  sentence. The builder checks the app's own palette first.
  **Corrected by the sweep, from the app's own palette** (`apps/web/src/index.css:88-107`, and
  the installed Tailwind's amber, green and red), on the paper these pages sit on (`gray-50`):

  | Colour | On the paper | On a white card |
  |---|---|---|
  | `gray-500` | 5.08 | 5.35 |
  | `gray-600` | 6.70 | 7.05 |
  | `gray-700` | 9.62 | 10.13 |
  | `gray-900` | 15.03 | 15.83 |
  | `blue-700`, a link | 8.92 | 9.39 |
  | `amber-800`, today's warnings | 6.77 | 7.13 |
  | `amber-900` | 8.63 | 9.09 |
  | `green-800`, today's *Connected* | 6.73 | 7.09 |
  | `green-900` | 8.61 | 9.07 |
  | `red-800` | 7.95 | 8.37 |
  | White on `blue-600`, today's button | 6.36 | |
  | White on `blue-700` | 9.39 | |

  So `gray-600` does not carry a sentence on the paper. A sentence is `gray-700` or darker; a
  warning `amber-900`; *Connected* `green-900`; a main button's words white on `blue-700`.
  An outlined button's edge, and a field's, is `gray-500` or darker: 3 to 1 against the paper
  (criterion 1.4.11), where `gray-300` is 1.50 and `gray-400` 2.41.
- **Focus** shows as an outline two pixels wide that can be seen on white and on a button.
- **Zoom and width:** at 200% zoom and at 320 pixels wide nothing scrolls sideways and nothing
  is cut off (criteria 1.4.4 and 1.4.10).
- **The language switch** is a target like any other, in full words.
- **The accessibility statement** (`site/pages/en/accessibility.md` and its Dutch) is read
  against the result, and changed where it says less or more than is now true.

What the sweep adds:

- **The two pages hold 84 small lines, and the parts they draw hold about 40 more:** the
  password card 14, *Report this link* 10, the new address 6, and one or two each in the stage
  chip, the pause, the hint, how long, the language switch and the build stamp. Most of those
  parts are the member's screens' too. They grow on a person's pages only: the member's
  screens do not change.
- **Measured, not read off a class name.** The proof asks the browser what it drew: the
  computed size of every visible text, the box of every target, the two colours of every
  sentence (§16). A class can say `text-sm` and draw 18 pixels, or the other way round.
- **A target that stands alone is 44 by 44, with 8 pixels to its neighbour:** the language
  switch, *Report this link*, the three links at the foot, a fold's summary, the number to
  call, *Copy link*. A link inside a sentence is exempt, as criterion 2.5.8 exempts it.
- **A label wraps, and is never cut.** A button's height is a least height: a long Dutch label
  may take two lines at 320 pixels.
- **Focus** is an outline of 2 pixels in `blue-700`, 2 pixels off its target, so the paper
  shows between it and a filled button. No `focus:outline-none` without a ring in its place.
- **The language switch** says *English* and *Nederlands* on these pages. The sidebar keeps
  *EN* and *NL* (`apps/web/src/components/LanguageSwitch.tsx:33`; the UI smoke pins them,
  `test/ui/managed-ui.ui.test.ts:1796`).
- **The password box keeps taking a paste and a password manager's fill** (criterion 3.3.8).
- **What the statement says today, and what changes:** its known gap, *a new screen is not
  announced*, names *Start a migration* as the one exception; the link page's steps become a
  second. It says nothing was checked at 200% zoom; these two pages now are, at 320 pixels
  wide. Its date moves.

## 14. What follows: the guides, the privacy text, the records (T10)

- **ADR-0035**, amended 2026-11-26: one link for both jobs (§8.2), asking again (§8.4), and the
  window on a stop (§9.2). Then `node scripts/adr-operative.mjs --write`. Written before T4 and
  before the second half of T5.
- **The glossary:** the rows of §6 and §11.
- **`docs/grant-links.md`** and the guides that describe two links or the ending.
- **The tester guide**, both languages: *Dat hoort zo tijdens de Alpha* and *That is expected
  during the Alpha* (`site/pages/en/alpha-guide.md:82`) become the sentence of §5.4 (R2), and
  Google's own words go in once T0 has them, which is what the guide's comment waits for.
- **The privacy text** (`site/legal/privacy.md` and its Dutch): a member's name, relation and
  number are shown to the people they send a link to; a person's language and register are
  kept with the person; a stop's ten minutes. Changed in place under 1.0, as the owner decided
  for 0174 (D8 there: *"terms or the privacy policy: no one but me accepted then, so change
  them and stay on 1.0"*). T10 asks the owner whether that still holds before it changes them.
- **`CHANGELOG.md`**, per step.

What the sweep adds:

- **With step A:** the glossary's rows (§6); `docs/grant-links.md`, whose *What the other
  person sees* (`:111` on), *If they doubt it* (`:308`) and *When the person takes their access
  back* (`:375`) describe today's one long page; the tester guide's sentence in both languages
  (its comment about Google's words stays until T0); the accessibility statement (§13); and
  `CHANGELOG.md`.
- **The privacy text does not change with step A.** Step A stores nothing new on the server
  and shows nothing the pages do not show today. The answer the tab remembers is covered by
  the sentence that the app *remembers your language and a few choices* in the browser's own
  storage (`site/legal/privacy.md:1200-1202`). The sentence about a family member's page,
  *a page that says who asked, from which account and to where* (`:1143-1145`), stays true.
- **With step B it does:** a member's name, relation and number on the pages of the people
  they send a link to; who can open the copy, on the progress page; a person's language and
  register, kept with the person. **With step C:** what one link shows, and for how long
  (§8.2), and a stop's ten minutes.
- **The lawyer reads two things before anybody outside the Alpha gets these pages:** the
  window on a stop (D6), and the privacy text for the new places a person's data is shown.
  Putting both to the lawyer is the owner's. D18 adds a third question (§22.6).
- **The website, with each step, is T15** (§22): what the site, the legal texts it renders and
  the app's help guides say about these pages, and what changes with which step.

## 15. The words this plan introduces (for the owner to read)

`{who}` is the sender as the page names them; `{name}`, on the member's side, is the person
the link is for. Dutch is given with *u*; T7 adds the *je* form of each. The verb follows D1 (a)
and the stop's word D2 (a), as the owner answered (§18). `«…»` stands for Google's own words,
which T0 supplies.

**What the sweep adds to this legend.**

- `{account}` is the address on the link page. The progress page carries no address (§3.2):
  there it is the page's own name for the account, *your Google account* or *Google account 2*,
  with the provider's own name.
- `{source}` and `{destination}` are the provider's name, with the account where the page
  knows it, and the server where a provider has no name of its own.
- `{who}` on the progress page is the organisation until T3.
- The Dutch below says *u hebt*, where three sentences said *u heeft* (§3.5). One sentence ran
  to 25 words against §6's fifteen, and is now three.

**Which step a sentence ships in.** Step A, unless it is named here:

- **T0:** the row that quotes, *Google's screen says: «…»*, and the quoted half of *Google 4*.
  D12 (a) says what the two steps say until then: the two rows *until T0*, below.
- **Step B (T3):** *The number*. The label *Sender* is step A's.
- **Step B (T8, T7):** *The member's side* and *The message the member sends*, but for one
  line, which is step A's (D13 (a)).
- **Step C (T4):** *You can stop this at any time, on this page*; and *A Google connection
  that stopped, Alpha*.
- **Step C (the window):** *Pressed by accident? You can take it back for 10 minutes*, and the
  three rows *In the window*.

**What step A says in their place** is in the tables the sweep adds at the end of this section.

**The link page.**

| Where | EN | NL |
|---|---|---|
| Above the title | *This page is from Ownpace, the service that makes the copy.* | *Deze pagina is van Ownpace, de dienst die de kopie maakt.* |
| Title | *{who} asks for your permission* | *{who} vraagt uw toestemming* |
| Label | *Sender* | *Afzender* |
| The number | *{who}'s number: {phone}. Or use the number you already have for {who}.* | *Nummer van {who}: {phone}. Of gebruik het nummer dat u al van {who} hebt.* |
| What is asked | *{who} wants to copy your {what} from {source} to {destination}.* | *{who} wil uw {what} kopiëren van {source} naar {destination}.* |
| Fact | *Everything also stays in {source}.* | *Alles blijft ook in {source} staan.* |
| Fact | *Ownpace only reads there. It deletes nothing and changes nothing.* | *Ownpace leest daar alleen. Het verwijdert niets en wijzigt niets.* |
| Fact | *There is no hurry. You can do this until {date}.* | *Er is geen haast. Dit kan tot {date}.* |
| The question | *Did {who} tell you about this link themselves?* | *Heeft {who} u zelf over deze link verteld?* |
| Answers | *Yes, that is right* · *No, not yet* | *Ja, dat klopt* · *Nee, nog niet* |
| Not yet, title | *Then wait a moment* | *Wacht dan even* |
| Not yet | *Ask {who} first, in a way you trust. Call the number you already have. Or ask when you see each other.* | *Vraag het eerst aan {who}, op een manier die u vertrouwt. Bel het nummer dat u al hebt. Of vraag het als u elkaar ziet.* |
| Not yet | *This page can wait. The link works until {date}.* | *Deze pagina kan wachten. De link werkt tot {date}.* |
| Not yet | *Do you not know {who}? Then close this page. You can also report this link.* | *Kent u {who} niet? Sluit dan deze pagina. U kunt deze link ook melden.* |
| Accounts, button | *Connect {account}* | *{account} verbinden* |
| Ready, title | *Have this ready* | *Leg dit klaar* |
| Ready | *The address {account}.* | *Het adres {account}.* |
| Ready | *The password of your {provider} account.* | *Het wachtwoord van uw {provider}-account.* |
| Ready | *Your phone. {provider} may send a code to it.* | *Uw telefoon. {provider} kan daar een code naartoe sturen.* |
| Ready | *Give that code to nobody. Not to {who} either.* | *Geef die code aan niemand. Ook niet aan {who}.* |
| Ready, Alpha | *Do this together with {who} if you can: on the phone, or at the table.* | *Doe dit het liefst samen met {who}: aan de telefoon, of aan tafel.* |
| Google, title | *What you will see at Google* | *Dit ziet u straks bij Google* |
| Google 1 | *Google asks you to sign in. Sign in as {account}.* | *Google vraagt u in te loggen. Log in als {account}.* |
| Google 2, Alpha | *Google has not checked Ownpace yet. That is why Google warns, and Google is right to.* | *Google heeft Ownpace nog niet gecontroleerd. Daarom waarschuwt Google, en dat is terecht.* |
| Google 2, Alpha | *Google's screen says: «…». To go on, tap «…», then «…».* | *Op het scherm van Google staat: «…». Wilt u verder? Tik dan op «…», en daarna op «…».* |
| Google 2, Alpha | *Do this only here, because {who} told you about it themselves. At any other warning, stop.* | *Doe dit alleen hier, omdat {who} het u zelf heeft verteld. Bij elke andere waarschuwing stopt u.* |
| Google 3 | *Google's words are broader than what Ownpace does. Ownpace only reads. It sends nothing and deletes nothing. Make sure everything Ownpace asks for is ticked.* | *Google beschrijft het ruimer dan wat Ownpace doet. Ownpace leest alleen. Het verzendt niets en verwijdert niets. Zorg dat alles wat Ownpace vraagt een vinkje heeft.* |
| Google 4, Alpha | *Does Google say «…»? Then this address is not on Google's list yet. Close the page and tell {who}. You did nothing wrong.* | *Zegt Google «…»? Dan staat dit adres nog niet op de lijst van Google. Sluit de pagina en vertel het {who}. U hebt niets fout gedaan.* |
| Before the buttons | *You can stop this at any time, on this page.* | *U kunt dit altijd weer stoppen, op deze pagina.* |
| Buttons | *Sign in with Google* · *No, rather not* | *Inloggen met Google* · *Nee, liever niet* |
| Under the buttons | *The next step is on Google's own page.* | *De volgende stap doet u op de pagina van Google zelf.* |
| No, rather not | *That is fine. Nothing has happened. You can close this page, or come back later: the link works until {date}.* | *Dat mag. Er is niets gebeurd. U kunt deze pagina sluiten, of later terugkomen: de link werkt tot {date}.* |
| Steps | *Step {n} of {total}* · *Next* · *Back* | *Stap {n} van {total}* · *Verder* · *Terug* |

**The progress page.**

| Where | EN | NL |
|---|---|---|
| While copying | *Copying is in progress* | *Het kopiëren is bezig* |
| While copying | *You do not have to do anything now. You may close this page.* | *U hoeft nu niets te doen. U mag deze pagina sluiten.* |
| How far | *{count} of ~{total} copied* | *{count} van ~{total} gekopieerd* |
| Refresh | *Last updated at {time}. This page refreshes by itself.* | *Bijgewerkt om {time}. Deze pagina ververst vanzelf.* |
| The stop | *Stop copying* | *Kopiëren stoppen* |
| The question | *Stop copying from {account}?* | *Kopiëren uit {account} stoppen?* |
| The question | *Ownpace then stops reading this account. What is already copied stays at {destination}. Nothing is deleted at {provider}.* | *Ownpace leest dit account dan niet meer. Wat al gekopieerd is, blijft bij {destination} staan. Bij {provider} wordt niets verwijderd.* |
| The question | *Pressed by accident? You can take it back for 10 minutes.* | *Per ongeluk? U kunt het daarna nog 10 minuten terugdraaien.* |
| Answers | *No, do not stop* · *Yes, stop* | *Nee, niet stoppen* · *Ja, stoppen* |
| Stopped | *Copying has stopped* | *Het kopiëren is gestopt* |
| Stopped | *Ownpace reads nothing from {account} any more.* | *Ownpace leest niets meer uit {account}.* |
| In the window | *By accident? Until {time} you can take this back.* · *Continue copying after all* | *Per ongeluk? Tot {time} kunt u dit terugdraaien.* · *Toch doorgaan met kopiëren* |
| In the window | *Until then Ownpace keeps your permission, unused. After {time} it is withdrawn at {provider} and deleted here.* | *Tot dan bewaart Ownpace uw toestemming, zonder die te gebruiken. Na {time} wordt die bij {provider} ingetrokken en hier verwijderd.* |
| In the window | *Withdraw it at {provider} right now* | *Nu meteen intrekken bij {provider}* |
| Afterwards | *You do not have to do anything. Stopping is allowed.* | *U hoeft niets te doen. Stoppen mag.* |
| Afterwards | *Want to continue later? Ask {who}.* | *Later toch verder? Vraag het {who}.* |
| A Google connection that stopped, Alpha | *Google asks for your permission again. During the Alpha that happens about once a week.* | *Google vraagt opnieuw om uw toestemming. Tijdens de Alpha gebeurt dat ongeveer één keer per week.* |

**The member's side.**

| Where | EN | NL |
|---|---|---|
| Section | *A link for {name}* | *Een link voor {name}* |
| The tick | *I have told {name} that a link is coming: by phone, or in person.* | *Ik heb {name} verteld dat er een link komt: aan de telefoon, of persoonlijk.* |
| The voice | *How does the page speak to {name}?* · *Dutch, with u* · *Dutch, with je* · *English* | *Hoe spreekt de pagina {name} aan?* · *Nederlands, met u* · *Nederlands, met je* · *Engels* |
| The relation | *Who are you to {name}?* | *Wie bent u voor {name}?* |
| The name | *Your name, as {name} knows you* · *Shown on the page {name} opens.* | *Uw naam, zoals {name} u kent* · *Staat op de pagina die {name} opent.* |
| Together | *Do the Google step together if you can. Google shows a warning during the Alpha.* | *Doe de stap bij Google het liefst samen. Google toont tijdens de Alpha een waarschuwing.* |
| Ask again | *Ask again* · *{name}'s own link asks again, for 30 days. Tell {name} to open it.* | *Opnieuw vragen* · *De eigen link van {name} vraagt het opnieuw, 30 dagen lang. Vertel {name} dat de link weer open moet.* |

**The message the member sends.**

- EN: *This is the link I told you about. It opens a page of Ownpace. There you give permission
  to copy your email to {destination}. There is no hurry: the link works until {date}. Shall we
  do it together? Call me when you want to start.*
- NL, *u*: *Dit is de link waarover ik u vertelde. U komt op een pagina van Ownpace. Daar geeft
  u toestemming om uw e-mail te kopiëren naar {destination}. Er is geen haast: de link werkt
  tot {date}. Zullen we het samen doen? Bel mij als u wilt beginnen.*
- NL, *je*: *Dit is de link waarover ik je vertelde. Je komt op een pagina van Ownpace. Daar
  geef je toestemming om je e-mail te kopiëren naar {destination}. Er is geen haast: de link
  werkt tot {date}. Zullen we het samen doen? Bel me als je wilt beginnen.*

**The pattern for *je*:** *Voor dit account hoeft u niets meer te doen* becomes *Voor dit
account hoef je niets meer te doen*; *uw* becomes *je*, and *jouw* only where it carries stress.

**What the sweep adds, all for step A, all for the owner to read.** Each is a draft, as the
rows above are.

*The link page.*

| Where | EN | NL |
|---|---|---|
| What is asked, where more than one account or provider is involved | *{who} wants to copy your {what}. The next screen shows from where and to where.* | *{who} wil uw {what} kopiëren. Op het volgende scherm staat waarvandaan en waarnaartoe.* |
| A link that asks again | *This account was connected before. {who} asks you to connect it again.* | *Dit account was al verbonden. {who} vraagt u het opnieuw te verbinden.* |
| A link that asks again, Google, Alpha | *During the Alpha, Google asks again about once a week.* | *Tijdens de Alpha vraagt Google dit ongeveer één keer per week opnieuw.* |
| Ready | *You type it only on {provider}'s own page. Ownpace never sees it. {who} does not either.* | *U typt het alleen op de pagina van {provider} zelf. Ownpace ziet het nooit. {who} ook niet.* |
| Ready | *Do you not know the password? Then stop here, and do this together with {who}.* | *Weet u het wachtwoord niet? Stop dan hier, en doe dit samen met {who}.* |
| Before the buttons, until T4 | *You can stop this at any time, on the page you get afterwards.* | *U kunt dit altijd weer stoppen, op de pagina die u hierna krijgt.* |
| Google 2, until T0 (D12 (a)) | *Go on to Ownpace there.* (after *Google is right to*, before *Do this only here*) | *Ga daar verder naar Ownpace.* |
| Google 4, until T0 (D12 (a)) | *Does Google not allow the connection? Then this address is not on Google's list yet. Close the page and tell {who}. You did nothing wrong.* | *Laat Google de verbinding niet toe? Dan staat dit adres nog niet op de lijst van Google. Sluit de pagina en vertel het {who}. U hebt niets fout gedaan.* |
| The language switch | *English* · *Nederlands* | *English* · *Nederlands* |

The button says *Sign in with Google* / *Inloggen met Google*. The desk review's readers leaned
to *Inloggen bij Google*: the person signs in at Google, and not to Ownpace with Google. Where
the button carries Google's mark, Google sets its words (§20). For the owner's read.

**Corrected by the sweep of the website:** *Google 3* said *omschrijft* in its Dutch. The app,
the tester guide and the site say *beschrijft* of this one fact
(`apps/web/src/i18n/strings/connect.ts:839`, `site/pages/nl/alpha-handleiding.md:117`,
`site/copy.mjs:629`). One verb for one thing (R8).

*The progress page.*

| Where | EN | NL |
|---|---|---|
| Title | *How far is the copying?* | *Hoe ver is het kopiëren?* |
| Who | *{who} copies your email, calendar and files to a new provider. This page shows how far that is.* | *{who} kopieert uw e-mail, agenda en bestanden naar een nieuwe aanbieder. Op deze pagina ziet u hoe ver dat is.* |
| An account's heading | *Your {provider} account* · *{provider} account {n}* | *Uw {provider}-account* · *{provider}-account {n}* |
| State: not started | *Nothing has been copied yet.* | *Er is nog niets gekopieerd.* |
| State: on hold | *Copying is on hold at the moment.* | *Het kopiëren ligt op dit moment stil.* |
| State: switched | *Your new account is now the one in use.* | *U gebruikt nu uw nieuwe account.* |
| State: done | *The copy is complete.* | *De kopie is klaar.* |
| State: kept in step | *Anything new on your old account is still copied.* | *Wat nieuw binnenkomt op uw oude account, wordt ook nog gekopieerd.* |
| First line, a connection that needs renewing | *The connection to your {provider} account has stopped. {who} can send you a new link.* | *De verbinding met uw {provider}-account is gestopt. {who} kan u een nieuwe link sturen.* |
| A pause at the data ceiling | *Copying waits for a choice by {who}. Nothing is lost.* | *Het kopiëren wacht op een keuze van {who}. Er gaat niets verloren.* |
| The question, step A | *Continuing later needs a new link from {who}.* | *Later verder kan alleen met een nieuwe link van {who}.* |
| The question, Google | *Google ends everything you allowed Ownpace. All copying from this account then stops.* | *Google beëindigt alles wat u Ownpace toestond. Al het kopiëren uit dit account stopt dan.* |
| Stopped | *Copying stopped on {date}.* | *Het kopiëren is op {date} gestopt.* |
| Stopped, the provider confirmed | *{provider} confirmed it. Ownpace can no longer reach this account.* | *{provider} heeft het bevestigd. Ownpace kan niet meer bij dit account.* |
| Stopped, the provider did not confirm | *The permission is deleted here, so Ownpace cannot use it. {provider} did not confirm. To be sure, remove Ownpace yourself from the list of apps at {provider}:* | *De toestemming is hier verwijderd, dus Ownpace kan die niet gebruiken. {provider} heeft het niet bevestigd. Verwijder Ownpace voor de zekerheid zelf uit de lijst van apps bij {provider}:* |
| Stopped | *Nothing was deleted at {provider}. What was copied is still at {destination}.* | *Bij {provider} is niets verwijderd. Wat gekopieerd is, staat nog bij {destination}.* |
| A refresh that did not get through | *Last updated at {time}. Refreshing did not work just now.* | *Bijgewerkt om {time}. Verversen lukte zojuist niet.* |

*You do not have to do anything. Stopping is allowed.* follows only where the provider
confirmed (§9.1).

*A row of the progress page (D14 (a)).* The member's screens keep theirs.

| Stage | EN, a person's page | NL, a person's page | NL, the member's screens |
|---|---|---|---|
| Not started | *Not started yet* | *Nog niet begonnen* | *Nog niet gestart* |
| Paused | *On hold* | *Ligt stil* | *Gepauzeerd* |
| Copying | *Being copied* | *Wordt gekopieerd* | *Wordt gemigreerd* |
| Kept in step | *Copied, and kept up to date* | *Gekopieerd, en wordt bijgehouden* | *Wordt bijgehouden* |
| Ready to switch | *Copied, ready for the switch* | *Gekopieerd, klaar voor de overstap* | *Klaar om over te stappen* |
| Switching | *Switching over* | *Bezig met overstappen* | *Bezig met overstappen* |
| Done | *Done* | *Klaar* | *Afgerond* |

| The line under a stage | EN, a person's page | NL, a person's page |
|---|---|---|
| The count with no total | *{done} copied · total not known* | *{done} gekopieerd · totaal niet bekend* |
| A counted zero | *none found to copy* | *niets gevonden om te kopiëren* |
| When it last ran | *last copied {when}* | *laatst gekopieerd {when}* |
| How long, from the last rounds | *About {low} to {high} days more.* | *Ongeveer nog {low} tot {high} dagen.* |
| How long, not known yet | *How long is not known yet. We will know after a few rounds of copying.* | *Hoe lang nog, is nog niet bekend. Na een paar keer kopiëren weten we meer.* |
| A provider's daily limit | *{provider} reached its daily download limit. Copying continues after {resets}.* | *{provider} heeft de daglimiet voor downloaden bereikt. Het kopiëren gaat verder na {resets}.* |

The numbers do not change: *4,211 of ~5,000* is said the same on both. *The check passed
{when}* keeps the member's word, *verificatie*: it is the name of a step, and no form of
*migreren*.

*The ending after a sign-in.*

| Where | EN | NL |
|---|---|---|
| Connected, the last account | *Your account is now connected, and Ownpace can read from it. You do not have to do anything else, and this link will not work again.* | *Uw account is nu verbonden, en Ownpace kan eruit lezen. U hoeft verder niets te doen, en deze link werkt niet meer.* |
| Your page | *Here is your own page. Keep this one. It shows how far the copying is, and nothing from inside your account:* | *Hier is uw eigen pagina. Bewaar deze. Die laat zien hoe ver het kopiëren is, en niets uit uw account:* |
| How long | *It works for the next 90 days, and whoever sent you the link can turn it off at any time.* | *Hij werkt de komende 90 dagen, en wie u de link stuurde, kan hem op elk moment uitzetten.* |
| Stopping, by provider | *You can stop this at any time on your own page, above. Or at {provider}, in the list of apps that have access to your account.* | *U kunt dit altijd weer stoppen op uw eigen pagina, hierboven. Of bij {provider}, in de lijst van apps die toegang hebben tot uw account.* |

*The member's side, in step A (D13 (a)).*

| Where | EN | NL |
|---|---|---|
| Where a person's link is made | *Tell {name} first, by phone or in person. The page asks whether you did.* | *Vertel het {name} eerst, aan de telefoon of persoonlijk. De pagina vraagt of u dat hebt gedaan.* |

## 16. Proofs (T11)

Each written to fail on the tree before the change, and named as the rule it keeps.

- **A link page that asks one thing at a time:** each screen of §5 has one heading and one main
  action; *not yet* sends nothing; a return from Google does not ask the question again.
- **Google's words are never ours:** the warning step quotes only what T0 recorded, and with no
  record it quotes nothing.
- **A reassurance the next screen keeps:** no sentence on the link page says *read-only* of a
  Gmail, Calendar or Contacts permission.
- **One link that asks and then shows** (integration): a link made by T4 connects two accounts
  and is then the progress page; an old grant link and an old progress link still answer; past
  the ask date the same link shows progress and asks nothing; revoked, it refuses both.
- **A stop that can be taken back** (integration): after *Yes, stop* no pass starts; taken back
  inside the window, the next pass runs with the same token; left alone, the token is revoked
  and deleted when the window closes, with nobody on the page; a second press inside the window
  makes it final at once.
- **Two equal answers:** the two buttons of a stop render the same size and neither is filled.
- **Nothing small on a person's pages:** no class under 16 pixels in the components those pages
  render; no sentence in a grey lighter than `gray-600`.
- **Every *u* has its *je*** (§11's guards).
- **The managed UI smoke** (`test/ui/managed-ui.ui.test.ts`) walks a person's link from the
  first screen to the progress page, at 390 pixels wide and at 200% zoom.

E2E against a real Google account is the maintainer's to dispatch.

**What the sweep adds.** §21.4 names, for each task of step A, the tests to write first and
the ones that exist and move. Four things hold for all of them:

- **The smoke already has a table of these pages** (`test/ui/managed-ui.ui.test.ts:1798`): for
  each, what it says, its buttons in order, its links, its rows, and what it asks the API for,
  in both languages, then on a phone. A person's two entries (`:1845`, `:1916`) are rewritten
  as walks. A migration's two (`:1800`, `:1880`) change only where a shared sentence does.
- **200% zoom is measured as a width.** The smoke's phone is 390 pixels wide (`:691`, `:703`).
  A second pass at 320 pixels is what 200% on a 640-pixel window lays out, and what criterion
  1.4.10 names.
- **The Google steps exist in the Alpha's build only** (`isAlpha()`). The unit tests switch it
  on as the Alpha note's do (`vi.stubEnv`), and the smoke's Alpha pass (`:2317`) walks a
  person's link too.
- **Sizes, targets and contrast are asked of the browser** (§13): the computed size of each
  visible text, each target's box, each sentence's two colours.

## 17. A first test with three people (T12)

The owner's. After step A is on a stack the owner can reach.

- **Who:** three people of the age these pages are for, on their own phone or tablet, with the
  person who would organise it beside them or on the phone.
- **What to watch, and write down:** do they tap the link at all; which screen they stop at,
  and what they say there; whether they read the warning step before Google; whether they find
  *stop*, and what they expect it to do; whether they can say afterwards who can read the copy.
- **What comes back to this plan:** sentences to change, a screen to add or drop. No name of
  anybody, and nothing they typed.
- **Added by the sweep, to watch too:** whether they answer *No, not yet*, and what they do
  next; whether they press *Back* at Google's warning, and whether the page then still works;
  whether a page that refreshes by itself throws them; whether anybody asks for it all on one
  page, or on paper (D15); a phone that offers to make up a password in the password box. And
  once each: the largest text setting, a screen reader in Dutch, and a tablet that cannot
  call, where a number can be read and not tapped.

## 18. The owner's decisions (T13)

**Answered on 2026-11-26:** *"D1 to D11: ok on the advised."* Every decision below went as
advised. The options stay, as the record of what was put.

- **D1. The verb on a person's two pages.** (a) *Kopiëren*, *gekopieerd*, *de kopie*, with the
  glossary's row at `:106` gaining the exception: a person's own pages say *kopiëren*, the
  member's app says *migreren*. A reader with no account hears in *migreren* that their mail
  goes away; *kopiëren* says the original stays, which is the fact they most need. The page
  half says it already (§3.5). (b) *Migreren* everywhere, as the row of 2026-10-10 says, and
  the three sentences that say *kopiëren* change back. **Advice: (a). Answered: (a).**
- **D2. The word on the stop.** (a) *Stop copying* / *Kopiëren stoppen*, with a glossary row
  beside *stoppen* / *hervatten* (`:93`) saying a person's stop ends the reading of their
  account. (b) *Withdraw access* / *Toegang intrekken*, as today, on the larger button.
  **Advice: (a):** it names what the person sees stop. **Answered: (a).**
- **D3. What the page says Ownpace is.** (a) *The service that makes the copy.* (b) The same,
  and where it is run, read from the deployment's configuration as the legal links are, never
  written into a sentence. **Advice: (a) now, (b) with the site's next pass. Answered: as
  advised.**
- **D4. Asking again on the same link.** (a) As §8.4: by itself when a connection stopped by
  itself; by a member's press after the person's own stop. (b) Only by a member's press, always.
  **Advice: (a).** Under (b) every person whose copy runs longer than a week waits on the
  member each time, during the Alpha. **Answered: (a).**
- **D5. Lifetimes of the one link.** (a) The member makes one choice: how long the link asks,
  30 days first, 1 or 7 as today. The page lives 90 days, and a member can extend it. (b) Two
  choices, as today's two links have: 1, 7 or 30 days to ask, and 30, 90 or 180 for the page.
  **Advice: (a):** one question fewer at the moment a link is made. **Answered: (a).**
- **D6. The window on a stop.** (a) Ten minutes, with the sentence of §9.2 that says what is
  kept, and the link that ends it at once. The lawyer reads it in the next pass. (b) No window
  until the lawyer has read it; the screen of §9.1 only. **Advice: (a) built, and (b)'s
  question put to the lawyer before it ships to anybody outside the Alpha. Answered: as
  advised.** Putting it to the lawyer is the owner's.
- **D7. The relation.** (a) A fixed list (§7). (b) Free text. **Advice: (a). Answered: (a).**
- **D8. *Je* or *u*: per person or per organisation.** (a) Per person. (b) One choice for the
  organisation. **Advice: (a):** a family says *je* to one parent and *u* to another.
  **Answered: (a).**
- **D9. Google's screens told on the link page.** This replaces, on a person's link page only,
  the choice of 2026-10-18 for one line and a link to the guide. **Advice: yes;** it is what
  all seven simulated readers asked for. **Answered: yes.** Until T0 the warning step still
  says only what #2175 says, because Google's own words are not known yet.
- **D10. The order,** and which alpha takes step A. **Advice: the order of the Status block;
  step A in the next alpha. Answered: as advised.**
- **D11. Whose number.** (a) The member's own where given, else the organisation's. (b) The
  organisation's only, as today. **Advice: (a):** with two members, the organisation's number
  may not be the sender's. **Answered: (a).**

**Four more, from the final sweep of 2026-11-26 (T14). Answered the same day:** *"D12: a /
D13: a / D14: yes / D15: a"*. All four went as advised. The options stay, as the record of what
was put.

- **D12. What the warning step says until T0.** This plan said two things (§5.4). (a) The step
  says what is known and is ours, and quotes nothing: *Google has not checked Ownpace yet. That
  is why Google warns, and Google is right to.* Then the tester guide's own instruction, which
  the owner has read: *Go on to Ownpace there.* Then: *Do this only here, because {who} told
  you about it themselves. At any other warning, stop.* The fourth step says, without a quote,
  what to do when Google does not allow the connection (§15). (b) Only #2175's sentence,
  *Google shows a warning screen next, because this service is new*, and no fourth step, until
  T0. **Advice: (a).** The guide says in public that Google has not checked the app
  (`site/pages/nl/alpha-handleiding.md:115`), so the page states nothing new. Under (b) the
  page leaves out the two things the desk review's readers asked for most: that the warning is
  right, and that it is right only here. **Answered: (a).**
- **D13. Tell first, where the link is made, already in step A.** Step A's first screen asks
  the person whether the sender told them. Nothing tells the member that it will: T8 is in
  step B. (a) Step A adds one line where a person's link is made (§15), and offers thirty days
  first for a person's link, which the owner answered *"Ok"* (§1). The choices stay 1, 7 and
  30. The tick, the message, the voice and the relation stay in step B. (b) Nothing of T8
  before step B. **Advice: (a).** Without it a member sends the link cold, and the honest
  answer on the page is *No, not yet*. It is also the owner's own rule for step A: quick, and
  advised by the desk review. **Answered: (a).**
- **D14. The rows of a person's progress page.** Each data type's row is worded by parts the
  member's screens share, on purpose, so that the two read the same sentence on the phone
  (§3.2). Its stage says *Wordt gemigreerd*, its line *laatste ronde*. D1 names the count on
  that row (`GLOSSARY.md:106`). It did not say what becomes of the stage and the line. (a) A
  person's page gets its own words for both (§15). The two then read the same numbers, in
  different words. (b) The rows stay the member's. The page then says *kopiëren* in its
  sentences and *Wordt gemigreerd* in its rows. **Advice: (a).** The stage is the largest word
  on a row, and one word for one thing is R8. **Answered: yes, (a).** The owner's read of
  step A's Dutch can still turn a word.
- **D15. Everything on one page, and on paper.** The desk review settled a disagreement about
  length with a second way to read: the short screens, and on each a link to the same
  sentences on one page. It also counted a printed sheet as part of the design: the steps are
  gone once the person is at the provider, and paper is not. Neither is in this plan. (a) Step
  B: T8 gains *Print a sheet for {name}*, and the person's page gains *Read everything on one
  page*, which prints. The same sentences, written once. (b) Step A already. (c) Not in this
  plan: with the route without a link (§19), whose sheet carries an address and a code.
  **Advice: (a).** Step A stays what the owner set it to be, and T12 shows first whether
  anybody misses it. **Answered: (a).**

**Three more, from the website (T16). Answered on 2026-11-26,** put to the owner as P16 to
P18: *"P16: a"*, *"P17: b, …"* and *"P18: keep now"*. D16 and D18 went as advised; D17 did
not. The options stay, as the record of what was put.

- **D16. Where the service is run, said on a person's page (D3's open part).** D3 was answered
  as advised: *the service that makes the copy* now, and where it is run with the site's next
  pass, read from the deployment's configuration and never written into a sentence. Today the
  site says it by hand in two places: the home page (*Ownpace runs in the Netherlands, in the
  EU*, `site/copy.mjs:277` / `:663`) and the privacy text (*on a machine we administer
  ourselves, in the Netherlands*, `site/legal/privacy.md:1247`). The app has no setting for
  it. (a) One setting holds the country as a two-letter code. The web build and the site build
  both read it, as both read the stage. A person's link page then says one fixed sentence
  under its first line, *Ownpace runs in {country}.* / *Ownpace draait in {country}.*, with
  the country's name in the reader's language, from the browser's own list. Unset, the page
  says nothing, which is what somebody else's deployment gets. The home page's sentence takes
  its country from the same setting. (b) No setting. Under the first line stands a link, *Who
  runs Ownpace, and where*, to the part of the privacy text that says it, made as the legal
  links are. (c) Nothing on the page; the site goes on saying it. **Advice: (a), in step B.**
  It is a setting on every stack and a guard, which is more than step A's words and layout.
  (b) sends a reader who wanted one fact to a long legal page. The sentence says where the
  service runs and no more: the copy goes to the provider the page names, wherever that is,
  so the page never says the data *stays* anywhere (R3). **Answered: (a),** in step B.
- **D17. A story for families on the website.** The site has none. A family appears as a
  choice in the estimate (*My household (4 people)*, `site/copy.mjs:384` / `:750`), as the
  fourth tier's *A household, or a small business* (`:350` / `:724`), and in two sentences
  about a link (`:152`, `:262`). The desk review advised four things for the member who
  arranges this for a family member: a block on the home page, and a page, that say who does
  what; a price example for a family; a getting-started guide in plain Dutch; and the proof
  under *Nothing is deleted at the source* said for people before it is said for engineers.
  (a) A plan of its own for the site, written once step A is on a stack. (b) A short block on
  the home page with step A, and the rest in that plan. (c) Not now. **Advice: (a).** Nobody
  in the desk review read a page of the site, and the owner's rule for the quick changes was
  *only the ones the desk review also advised* (§1). Three of the block's sentences are not
  true until later: *one link* is step C, a sender *by name* is step B, and a picture of the
  first screen needs step A built. A price example has to be worked out by the build from
  `site/prices.mjs`, as *A typical cost* on the Leaving pages is, and not typed. §22.7 lists
  what that plan should hold, and what the glossary already settles for it. **Answered: (b).**
  The block says only what is true with step A; the rest waits for the site's own plan.
- **D18. What a person is said to accept before the provider's button.** The link page says
  *By continuing you accept how your data is handled:* and links the privacy policy and the
  terms (`grant.disclosure`, `apps/web/src/i18n/strings/grant.ts:180` / `:376`;
  `Grant.tsx:657-666`). The page's own header calls it a disclosure, the one Google's
  verification asks for (`Grant.tsx:73-78`). The terms say that somebody who only follows a
  progress link, or gives access through a link a customer sent, *does not become a party to
  these terms* (`site/legal/terms.md:627-628`; `terms.nl.md:62-63`). The privacy text gives
  the ground for a family member's access and address as legitimate interests, which is not
  consent (`site/legal/privacy.md:1191`). So the page says *accept* where the two texts
  describe something the reader is told. (a) Step A leaves the sentence as it is, and the
  owner puts the question to the lawyer with D6's. (b) Step A says what the links are and
  claims no acceptance: *How Ownpace handles your data:* / *Zo gaat Ownpace met uw gegevens
  om:*, with the same two links in the same place. **Advice: (a).** It is a sentence about
  the law, and this plan changes none of those without the lawyer. (b) is the draft to put to
  the lawyer: it is plainer Dutch too, where today's begins *Door door te gaan*. **Answered:
  (a).** This plan's own phrase for the block, *the texts a person accepts*, means
  this sentence and its two links, and claims nothing about the law.

## 19. Not in this plan

- **A route with no link:** an address and a code typed by hand. The owner: *"Yes, but first
  reason more on this."* A plan of its own, after T4, because a typed code is a second spelling
  of the same one link.
- **A word agreed by voice.** The owner: *"No"*.
- **A mail to the organisation** when a person gives permission or stops. There is no such
  notification today (`packages/shared/src/notifications.ts`). §9.2 tells it on the member's
  screens only.
- **A single migration's own link** (`Grant.tsx:682` on), which a person's link replaced on
  2026-10-03. No such link is made any more, and one already sent lives at most 30 days to
  ask and 180 to show (`docs/adr/0035-who-signs-in-and-who-gets-a-link.md:123-130`). Its
  progress page shares this plan's parts, and takes their words and sizes with them (§6); its
  asking page is left as it is.
- **Where the service is run, said on the link page** (D3 (b)): with the site's next pass.
  D16 gives it a shape (§22.5).
- **The gift's screens,** and the member's own screens beyond §12. **Corrected by the sweep:**
  this line left the site out too. The owner asked for it on 2026-11-26, and §22 holds it. Of
  a story for families on the site, only a short block on the home page is in (D17 (b), §22.3);
  the rest is for the site's own plan.
- **Leaving the Alpha at Google.** Once Google has verified the app, the warning step and
  *Access blocked* are expected to go, and the weekly stop with them. Until somebody has seen
  that, `isAlpha()` is the rule.

Added by the sweep, so that none is lost:

- **The password card's own design.** A member who confirms the server for the person, a
  member who gives the five tries back without a new link, a box that keeps what was typed
  after a refusal. The card empties its boxes after every answer on purpose (0174;
  `apps/web/src/components/GrantPasswordCard.tsx:30-36`), and the desk review saw no password
  card. A plan of its own, if T12 shows people locking themselves out.
- **A narrower permission at Google.** If Ownpace asked for reading only, Google's screen would
  not say *permanently delete*, and the page would have nothing to explain. It cannot today:
  Gmail is read over IMAP, and Google's IMAP server takes only the widest permission
  (`docs/guides/nl/google.md:52`). Not asked, not decided.
- **A migration's own progress page after a destination's password is removed.** It shows the
  sentence and offers no stop for the source, because that page has one grant field (#2175,
  left open there). Old links only.
- **A mail or a line to the member that a link was opened, connected or refused.** With the
  mails to the organisation, above.
- **What the member's own screens say first,** beyond §12: whether anything needs them, one
  line per account.

## 20. Risks

- **The steps make the page longer to get through.** Four screens where there was one. The desk
  review preferred it, five readers of six; three real people may not. T12 decides.
- **Quoting Google ages.** Google changes its screens without notice. The words are kept in one
  place with the date they were read, and the step falls back to quoting nothing.
- **Google's rules for a sign-in button.** If the button carries Google's mark, Google names the
  words it may say. The builder checks the button's words against Google's current rules before
  the app goes to Google for verification.
- **A longer-lived link that can ask again** (D4 (a)). Bounded by the sign-in being bound to
  the account, by revocation, and by the page's own date.
- **The window on a stop keeps a token for ten minutes after a person said stop.** Said on the
  page, ended by one press, and read by the lawyer (D6).
- **Two voices double the Dutch.** A sentence changed in one and not the other; §11's guards
  catch the missing twin, not a wrong one. The owner reads both.
- **A name and a number make a false page more convincing too.** The page shows them as things
  to check and never as proof (§7), and the question of §5.1 stays.

Added by the sweep:

- **The question can be answered *yes* by anybody.** It stops no swindler. It is there for the
  reader who was not told: it gives them a calm way to wait. The page never treats *yes* as
  proof, and nothing on the server depends on it.
- **Steps hide what one page showed at once.** A fact the reader used to see before any button
  could now sit one screen back. §5.7 names each such fact and where it stands; the tests of
  §21.4 hold the ones that guard against a false link: where from, where to, which account,
  and the texts a person accepts.
- **One word on the person's page and another on the member's** (D1, D14). Two people on the
  phone no longer read one sentence. They read the same numbers.
- **A page that refreshes costs the server a read a minute** for each open page: nine reads
  a migration (`migrationProgress`, `apps/api/src/routes/person-progress.ts:109`). It stops
  when the page is hidden, and when nothing on it can change.
- **The words outrun the owner's reading time.** Step A drafts several dozen Dutch sentences,
  new or changed. The pull request shows them in one table, and no step merges before the
  owner has read its Dutch.
- **A phone may offer to make up a password** in the password box: the box is marked as a new
  password, as on the member's forms (`packages/shared/src/credential-fields.ts`). Watched in
  T12; a change there is 0174's.

## 21. The final sweep before step A (2026-11-26)

Asked for by the owner (§1, the Status block). Read for it, at `b5431b8`: every file and line
this plan names; the link page, the progress page and the parts they draw; the server's
routes, endings and refusals for a person's link; the dictionary, the glossary and their
guards; the unit tests and the UI smoke that hold these pages; the tester guide, the privacy
text and the accessibility statement. No test of the product was run and nothing was built:
the counts and the contrast figures were worked out from the files.

### 21.1 The claims that did not hold

The plan named a file and a line 94 times. 89 are where it says. Five were not, and eight
other statements were wrong or too narrow. Each is corrected in its place.

| The plan said | What holds at `b5431b8` | Corrected in |
|---|---|---|
| The progress page has no total (`migration-view.ts:49-55`) | A row carries `itemsFound` and `bytesFound` (`:79`, `:81`), and the page says *4,211 of ~5,000* | §3.2, §10, T6 |
| The box of facts is `Grant.tsx:583-615`, and the warning with no phone `:616` | `:583-611`, and `:614-618` | §3.1 |
| The page for a person is `Person.tsx:532-551` | `:532-553` | §3.6 |
| A guard reads the sign-in page for *u* (`…:358`) | It reads the sign-in service's mails; its case starts at `:357` | §3.5 |
| A stop on these pages runs through `withdraw-grant.ts` | That is a migration's own link. A person's page uses `withdrawPersonGrant` (`person-progress.ts:603`), by the same rules | §3.2, §9.2 |
| A waiting account says *Not connected yet* | English says *Waiting*; Dutch says *Nog niet verbonden* | §5.3 |
| `PROVIDER_WORDS` has Cirrux Drive's words | It has Google's, Microsoft's and Dropbox's. Cirrux Drive's are `grant.cirrux.*` | §5.4 |
| *Leave the ticks on* | It states from memory how Google's screen opens. The guide's sentence does not | §5.4, §15 |
| What a stranger holding the one link can do does not grow | True of what they can do. What they can read lasts longer | §8.2 |
| `gray-600` carries a sentence, at 7.56 to 1 | That is Tailwind's grey. The app's is 6.70 on the paper | §13 |
| Three sentences say *kopiëren*, and one glossary row has to change | 23 sentences, ten shared ones, the server's own, and four rows | §3.5, §21.3 |
| The Dutch of §15 says *u heeft* | The dictionary and the owner's read say *u hebt* | §3.5, §15 |

### 21.2 #2175 and this plan

Nothing of #2175 is undone. Where step A changes a sentence the owner read on 2026-11-26, it
does so on an answer the owner gave the same day.

| #2175 | Step A | On which word of the owner's |
|---|---|---|
| `view.state.destinationRemoved`, the owner's sentence | Left as read. It says *het kopiëren wacht* already. *Whoever set this up* stays until T3 | The read of 2026-11-26 |
| `grant.person.asking`, read and edited | Leaves a person's link. The first screen says it in D1's words (§15), the key is removed, and its pin moves (§21.3) | D1 (a), D9 |
| `grant.asking` and `view.who`, read | Left. Only an old link's page says them (§6) | The read of 2026-11-26 |
| The four refusals of a migration's own stop (`withdraw-grant.ts`) | Left. A person's page has its own two (`person-progress.ts:583-596`), with no form of *migr-* in them | The read of 2026-11-26 |
| `grant.person.connected` | Left, word for word, on the accounts screen | — |
| The ending's *one more*, *{n} more* and *Back to the link* | Left. T9 gives the link its size | — |
| `grant.person.theyOpenIt`: who can open the copy | Left, word for word. It stands on the first screen, or beside its migration (§5.1) | *"Yes, but what was agreed upon between the persons is outside Ownpace."* |
| `grant.together`, read | Whole on a migration's own link. On a person's link its two halves part. *Together* goes to *Have this ready*, in §15's words, for *"Yes, preferably"*. The warning's half goes to the warning step, in D12 (a)'s words | D9, and D12 (a) |
| A stop still offered after a destination's password is removed | Kept. The new stop screen offers it by the same rule (`groupByAccount`, `person-progress.ts`) | The answer of 2026-11-26 |
| The wizard's two choices, the cutover's word, the package names, the nine guides | Not touched: the member's screens | — |

### 21.3 D1 and D2, sentence by sentence

D1 (a) is *kopiëren* on a person's two pages. D2 (a) is *Stop copying* / *Kopiëren stoppen*.
This is every Dutch sentence those pages and their endings can say today that holds a form of
*migr-*, by where it lives. English follows its Dutch: *migrated*, *migration* and *Withdraw
access* go the same way.

**The two pages' own, 23.** Each changes in step A, in §15's words where §15 has them, and
else in the builder's draft for the owner's read.

- The link page, 3: `grant.person.asking` (leaves), `grant.person.yourPage` and
  `grant.person.keepIt` (as the ending's two, §15).
- The progress page's title and frame, 6: `view.person.title`, `view.person.who`,
  `view.person.none`, `view.person.others`, `view.person.grant.body`,
  `view.person.withdrawn.notConfirmed`.
- Its states and counts, 6: `view.state.active`, `view.state.paused`, `view.state.done`,
  `view.notStarted`, `view.copied.one`, `view.copied.many`.
- Its failures, 3: `view.failure.quotaExceeded`, `view.failure.policyRefused`,
  `view.failure.tooLarge`.
- Its stop, 3: `view.state.withdrawn`, `view.grant.whatHappens`, `view.grant.wholeApp`.
- *Report this link*, 2: `linkReport.sentWith`, and `linkReport.next.withdraw`, which also
  names the old button.

**Shared with the member's screens, 10.** The member's screens keep them; a person's page
gets its own form of each (D14 (a)). How is the builder's: a second key, or a
table of words per page, as the link page has one per provider.

- `state.stage.copying`; `confirm.progress.totalNotKnown`, `confirm.progress.noneFound`.
- `pause.ceiling`, `pause.ceiling.unknown`, `pause.ceiling.why`, `pause.dataCeiling`,
  `pause.dataCeiling.why`, `pause.hold.default`, `pause.hold.why`. An operator's own words
  for a hold still pass as written.
- Seven say *ronde*, which is the member's word for a pass: `people.line.lastPass`, the four
  `timeLeft.copying.*`, `timeLeft.afterThreePasses`, and `pause.ceiling.why` again.

**Written by the server.**

- The ending: three sentences (`google-consent.ts:1103-1116`; §15).
- A refused link, or an account that cannot be asked yet:
  `packages/shared/src/link-holder-refusals.ts` says *migratie* nine times. `MIGRATION_GONE`
  (`:99`) answers a person's progress link too (`apps/api/src/routes/view.ts:138`), and
  `notReady` (`:173`) a press on a person's link (`apps/api/src/routes/grant.ts:494`). They are
  both editions' and both kinds of link's. Step A words what a person's link shows; a
  migration's own keeps its sentence.

**Left as they are, each for a reason.**

- What only an old link's page says: `grant.asking`, `view.who`, `view.title`,
  `view.notStarted.why` (§6).
- *De verificatie is {when} geslaagd* (`people.line.checkPassed`): the name of a step, and no
  form of *migreren*.
- 13 sentences say *whoever set this up*, *the person who sent it*, or *them* of the sender.
  They stay until T3 gives them a name, but for the new ones, which say `{who}`.

**D2.** `view.grant.withdraw` becomes *Stop copying*. Its question and its two answers
become §15's. `linkReport.next.withdraw` names the new button. `grant.withdraw` and its two
twins for Microsoft and Dropbox, on the link page, become §15's *Before the buttons*. A
destination's *Remove my password* keeps its words. The glossary gains a row beside `:93`.

**The tests that pin today's words.** Each changes with its words, and says in a comment
which answer of the owner's moved it, with the date.

- `apps/web/src/i18n/the-owners-words-at-the-door.unit.test.ts`: `:93` (`grant.person.asking`
  begins *{organisation} migreert*), `:95-97` (`view.person.who`, whole), `:128` (the three
  keys that say *your email, calendar and files*: one of them leaves).
- `test/ui/managed-ui.ui.test.ts`: a person's two pages, `:1845-1878` and `:1916-1952`; a
  migration's progress page, `:1880-1913`, where a shared sentence changes; the language
  switch, `:1796`; the password card's walk, `:2021` on, which opens the link and expects the
  box at once.
- `apps/web/src/pages/Grant.unit.test.tsx:368-562` and `View.unit.test.tsx:286-420`,
  `:423-615`, `:734-771`, `:773-853`.
- `apps/web/src/components/AlphaGoogleLine.unit.test.tsx:291-355` (§5.7).
- `apps/api/src/routes/migrations/a-consent-ending-in-the-readers-language.unit.test.ts` and
  `google-consent.unit.test.ts`, for the ending.

### 21.4 Step A, task by task

For each: what done means, the tests to write first, and what must not change. A test written
first fails on `main` at `b5431b8` for the reason it names.

**What step A must not touch.** No table, no migration, no field in an answer of the API: the
server's ending and its sentences change, the shape of its answers does not. No screen of the
member's, but for the one line of D13 (a), where a person's link is made. A migration's own
asking page
(`Grant.tsx:775-913`). Nothing in `packages/` but sentences in `packages/shared`. The appliance
draws a migration's progress page from the same component: it takes the words and the sizes,
and imports nothing managed-only (hard rule 5).

**T1, the link page in steps.** Built from what the server sends today (`PersonGrantSubject`,
`apps/web/src/services/grant-service.ts`). Done means:

1. A person's link opens on the first screen while no account on it is connected and the tab
   holds no answer (§5.1). The screen has one `h1`, the question and two buttons of one size.
   No provider's button and no password box is on it.
2. *No, not yet* opens §5.2 and sends nothing: no request leaves the page. *Back* returns.
3. *Yes* opens the accounts where §5.3 says so, and else *Have this ready* for the one
   waiting account.
4. A provider's button stands only on the last screen of an account, and follows only that
   provider's own address, as today.
5. Each step keeps §5.6: one `h1`, focus on it, the page at its top, the scroll instant for a
   reader who asked for less motion, the tab named after the step, *Step n of total* in words.
6. The browser's Back goes one step back. A step opened first shows the first screen.
7. The answer is kept for the tab only. Storage that throws breaks nothing: the page asks
   again. The key holds the link's id and never its secret.
8. Shown again from the browser's back cache, the page's buttons can be pressed.
9. Before any button that leaves the page or sends a password: where from and where to, which
   account to sign in with, the date, and the texts a person accepts with their two links.
10. During the Alpha, for Google: the *together* line on *Have this ready*; the warning step
    in D12 (a)'s words, quoting nothing, and the fourth step without a quote; no
    `AlphaGoogleLine`. Outside the Alpha: no warning step,
    no fourth step and no *together* line.
11. *Read-only* is said only where the provider holds it. *Google's words are broader* is
    said only where it does not.
12. *Report this link* is a button on *not yet*, and a link at the foot of every other screen.
13. The person's new address stands on the accounts screen and never on the first.
14. Every rule of §5.7 holds, by its own test.

Written first: `apps/web/src/pages/a-link-page-that-asks-one-thing-at-a-time.unit.test.tsx`,
one case for each of 1 to 13. And the smoke's entry for a person's link, as a walk in both
languages, at 390 and at 320 pixels, and once in the Alpha's build.

**T2, the words.** Done means:

1. Every sentence of §15 that ships in step A is in the dictionary in both languages, in its
   page's own area (`strings/grant.ts`, `strings/migrations.ts`).
2. No Dutch sentence that a person's link page, progress page or ending can say holds a form
   of *migr-*, but for the ones §21.3 leaves, each named in the test. The ten shared ones are
   held to it as a person's page says them (D14 (a)).
3. The stop says *Stop copying* / *Kopiëren stoppen*, and nothing on these pages says
   *Toegang intrekken*.
4. Each provider is named by its own name: on the progress page's headings, in its stop, and
   in the ending's last sentence.
5. The glossary is changed first: the rows at `:106`, `:107`, `:109-110` and `:120`, a row
   for a person's stop, and the label *Sender*.
6. A key that leaves is gone from both languages. The tests of §21.3 are changed with their
   words.
7. The pull request holds one table of every new or changed Dutch sentence, and the owner has
   read it.

Written first: `apps/web/src/i18n/a-persons-pages-say-kopieren.unit.test.ts`, which lists the
keys those pages say, reads the server's sentences for them too, and fails today on the 23
sentences of §21.3 and on the ending's three.
`apps/web/src/pages/a-progress-page-that-names-the-right-provider.unit.test.tsx`: a Microsoft
account's section says *Microsoft*, and fails today on *Your Google account*. A case in the
ending's test: after a Microsoft sign-in the last sentence names Microsoft.

**T5, first half: the stop's screen.** Done means:

1. *Stop copying* is as wide as the column, at least 60 pixels high, outlined with an edge
   that can be seen, and not red.
2. A press opens the question as a step of its own (§5.6), with one `h1`. It says what
   stops, for that account, with the provider's own name and the account as the page names it.
3. Two answers of one size, *No, do not stop* first. Neither is filled, and neither is red.
4. The question says what is true in step A: a stop is final, and continuing later needs a
   new link from {who}. Nothing on the page says ten minutes.
5. After *Yes, stop*: that copying stopped, and when; what the provider answered, in both
   cases, with where to finish it by hand in the second; that nothing was deleted and where
   the copy so far is; and that stopping is allowed. *You do not have to do anything* is said
   only where the provider confirmed.
6. A refusal is said in the page's language and announced, as today.
7. A destination's *Remove my password* has the same two equal answers.

Written first: `apps/web/src/pages/a-stop-with-two-equal-answers.unit.test.tsx`: the question
has its own heading and is not drawn under the button; the two answers carry one size and no
fill; the unconfirmed case says where to finish; no sentence says ten minutes; a Microsoft
account's stop names Microsoft. `a-password-the-person-removes.unit.test.tsx` moves with it.

**T6, first half: the progress page.** Done means:

1. The page opens with what the reader has to do, by the rule of §10.
2. Each row says its stage and its count against the total, as today, in D14's words.
3. No price, no plan's name and no *Billing page* can be drawn on it.
4. It refreshes as §10 says: once a minute while visible and while something can change;
   nothing moves and nothing is announced; a refresh that fails keeps the numbers and says
   when they are from; a link refused meanwhile shows its refusal.
5. It asks the API for its own link, that link's report and the build stamp, and nothing
   else.

Written first: `apps/web/src/pages/a-progress-page-that-says-what-to-do.unit.test.tsx`: the
three first lines; a pause at the data ceiling with no amount in it, which fails today; a
second read after a minute, with the focus where it was; a failed read that keeps the
numbers; no read once every migration is done or held.

**T9, size, contrast and targets.** Done means, asked of the browser on a person's link page
at each step, on the progress page, and in the ending's own HTML, in Dutch, at 390 and at 320
pixels wide:

1. No visible text is under 16 pixels. A sentence is 18.
2. A main button is at least 60 pixels high and as wide as the column. Two answers to one
   question have the same box. Every other target that stands alone is at least 44 by 44.
3. Every sentence is 7 to 1 or better against what it sits on. Every outlined edge is 3 to 1
   or better.
4. Focus can be seen on the paper, on a card and on a filled button.
5. Nothing scrolls sideways, nothing is cut, and a label wraps.
6. No motion is added.
7. The language switch says *English* and *Nederlands* here. The sidebar's is unchanged, and
   a member's screen still draws its small text small.
8. The password box takes a paste.
9. The accessibility statement says what is now true, in both languages.

Written first: a case in the smoke, *nothing small on a person's pages*, which fails today
on 12- and 14-pixel text, on 32-pixel targets and on `gray-500` sentences. The ending's sizes
are held by a case on its HTML, since the smoke has no API behind it.

**T8, one line (D13 (a)).** Done means:

1. Where a person's link is made (`PersonGrantLinkSection`,
   `apps/web/src/components/MappingLinksPanel.tsx:400-406`), §15's line stands before the
   button: *Tell {name} first, by phone or in person. The page asks whether you did.*
2. Thirty days is the lifetime offered first for a person's link. Today the panel offers the
   service's fallback, seven (`MappingLinksPanel.tsx:201`;
   `apps/web/src/services/grant-link-service.ts:53-58`). The choices stay 1, 7 and 30. A
   progress link keeps its own three, and its ninety.
3. Nothing else on the member's screens changes: no tick, no message, no voice, no relation.
   They are step B's.

Written first: a case in `apps/web/src/components/MappingLinksPanel.unit.test.tsx`. The line
stands before the button, and thirty days is the choice selected when the section opens. It
fails today on both.

**T15, the website with step A.** Sentences, and one rule of the site's layout. No page is
added to the site and none is renamed. Done means:

1. The tester guide, in both languages, has no *Dat hoort zo tijdens de Alpha* and no *That is
   expected during the Alpha*. It says why Google warns, in the link page's own words (§15,
   *Google 2*).
2. The guide has a part for a family member's link, under *Zo begint u* / *How to start*,
   with its own id in each language (§22.3 has a draft). The six sections stay six
   (`site/site.unit.test.ts:759-766`), and the two Google ids stay
   (`apps/web/src/components/AlphaGoogleLine.unit.test.tsx`).
3. *Als Google opnieuw vraagt* / *When Google asks again* says what to do when the account is
   a family member's: a new link, made on that person's page.
4. A sentence the link page takes from the guide is the same sentence in both places: *Make
   sure everything Ownpace asks for is ticked*, and *Go on to Ownpace there* (D12 (a)).
5. The Google help guide, in both languages, no longer says *not to sit beside them while
   they sign in* (`docs/guides/en/google.md:90`, `docs/guides/nl/google.md:90`). It names what
   is wrong: asking for the password, or signing in for them.
6. The site's sentence under *What you will do* says *on their own page*, where it said *on a
   page only they see* (`site/copy.mjs:262` / `:648`).
7. The accessibility statement, in both languages, says what is true after step A (§13),
   names a person's two pages in their own words, and has no sentence over twenty words in
   the parts it changes.
8. No page of the site scrolls sideways at 320 pixels, in either language.
9. Nothing else on the site changes. The home page's picture of the app, and the words in it,
   are the member's screen, which step A leaves (`site/app-screen/screen.json`; the smoke's
   *the home page's app screen*).

Written first: `scripts/a-site-that-says-what-a-persons-page-says.unit.test.ts`. It reads the
two tester guides, the two Google help guides and `site/copy.mjs`. It fails today on *Dat
hoort zo*, on *That is expected*, on *ernaast te zitten* and *sit beside them*, on a guide
with no part for a family member, and on *a page only they see*. It holds the sentences of
point 4 equal in the guide and in the dictionary, as
`scripts/the-alpha-said-to-a-visitor.unit.test.ts` holds the visitor's line. And a case in
`test/ui/site.ui.test.ts`: the home page at 320 pixels, in English and in Dutch. It fails
today on the English one, which is 323 pixels wide there. The file opens one Dutch page at
that width (`:174`).

**T10 and T11 with step A** are §14's *With step A* and the tests above. Gates before it is
called done: lint, typecheck, the unit tests, the UI smoke. E2E against a real account is the
maintainer's to dispatch. `CHANGELOG.md` in both languages. This plan's Status.

### 21.5 Asked of every task, and where the answer is

| The question | The answer |
|---|---|
| Is each sentence plain Dutch, at about A2? | §6's rules, held to §15: one idea, fifteen words. The sweep found one sentence over, and split it |
| *Je* or *u*? | Step A writes *u*, as the app does. T7 adds *je* per person in step B. A sentence that needs no *u* gets none (§6) |
| Does step A put new personal data on a page? | No. The link page shows what it shows today, on more screens. The progress page gains no field: its account has no address, and its sender is the organisation. The tab's answer never leaves the browser |
| Does the privacy text change? | Not with step A (§14). With B and C it does, and the lawyer reads it |
| Is the ten-minute window in step A? | No. Step A's stop is final at once, and says so (§9.1). D6's read by the lawyer is for step C |
| Can a step leak the link? | No new address, no new request, no token on the page, no message to another window. The page's policy sends no referrer |
| Can a stranger with the link do more? | No. In step A the two links are as they are: the asking link is spent once used, and the page that lives long holds counts and states |
| Does stopping stay as easy as starting? | One button, as large as the one that started it, on the page; two equal answers; said before the provider's button too |
| Does the website say the same as the page? | After T15, yes, for what step A changes (§22.2). The legal texts wait for the lawyer, and D18 names the one place where they and the page differ today |
| What does a real person make of it? | Not known. T12 is the first test, and what it finds outranks all of this |

## 22. The public website (added to the sweep, 2026-11-26)

Asked for by the owner (the Status block). Read for it, at `b5431b8`: `site/copy.mjs` and
`site/pages/` in both languages; the privacy text, the terms and the Alpha conditions in both
languages, for what they say of a link, a family member and Google; the app's help guides
(`docs/guides/`), which the site's Leaving pages link; `site/build.mjs` for its layout; and
the guards that hold the site to the app. A copy of the site was built for the Alpha outside
the repository, and a browser was asked what it drew, at 390 and at 320 pixels wide. No test
of the product was run.

### 22.1 Which pages of the site a person can reach

A person with a link has no account and no menu. From their two pages the site is three links
away, and today a fourth.

| From | To | Where |
|---|---|---|
| The link page | The privacy policy and the terms | `Grant.tsx:657-666` |
| The link page, at its foot | The accessibility statement | `Grant.tsx:676` |
| The progress page, at its foot | The privacy policy and the accessibility statement | `View.tsx:764-774` |
| The link page, above the first Google button, during the Alpha | The tester guide's part *Als u Google koppelt* | `Grant.tsx:446`, `AlphaGoogleLine` |

Step A takes the fourth away on a person's link (D9): the steps say it on the page. After
step A a person reads three pages of the site, in the site's own type: the privacy policy, the
terms and the accessibility statement. §22.8 measures them.

The tester guide stays what the member reads. The Alpha's note links it on every signed-in
page, and the mail that lets a member in links it too
(`apps/web/src/services/tester-guide-link.ts:19-33`).

### 22.2 What the site says of these pages, sentence by sentence

| Where | What it says | Against this plan |
|---|---|---|
| The tester guide, *Google-adressen eerst* (`site/pages/nl/alpha-handleiding.md:68-71`; EN `alpha-guide.md:37-40`) | Mail every Google address first, a family member's too; without it Google does not allow the connection | Holds. It is the member's half of the link page's fourth step. It does not say what the family member then sees, or what the member does when they report it: T15 |
| The guide, *Open links in a browser* (`:83-84`; EN `:52-53`) | Not in a chat or mail app | Holds: the link page says the same (`grant.inAppBrowser`) |
| The guide, *Als u Google koppelt* (`:115-118`; EN `:82-85`) | A warning comes; *Dat hoort zo tijdens de Alpha*; go on to Ownpace; everything ticked; Google describes more than Ownpace uses | *Dat hoort zo* goes (R2; §14 had this). The link page quotes the rest, word for word (§5.4) |
| The guide, *Als Google opnieuw vraagt* (`:122-125`; EN `:89-92`) | After about seven days: *Accounts*, *Opnieuw verbinden*, *Verbinden met Google* | True for the member's own account. For a family member's account the member cannot sign in: a new link asks again (§3.3). The site says that nowhere: T15 |
| The guide, as a whole | The member's own steps | Nothing on what a family member sees, and nothing that says *tell them first*. Step A's first screen asks whether they were told: T15 |
| The Google help guide (`docs/guides/en/google.md:90`; NL `:90`) | The honest way is *not to ask them for their password, and not to sit beside them while they sign in* | Against #2175's *together* line and the owner's *"Yes, preferably"* (§1). The rule it shortens is in `docs/grant-links.md:5-9`: not to copy a token out of their browser. T15 |
| The same guide (`:90-94`) | One link for all of their migrations; they see who asks, sign in on Google's own page and press one button per account; a link is spent once every account is connected | Holds in step A. *Spent* changes with step C (T4) |
| The home page, *Where to* (`site/copy.mjs:152` / `:547`) | A family member connects a destination of their own with a grant link, and types its password *on their own page* | Holds |
| The Leaving pages, under *What you will do* (`:262` / `:648`) | The same, *on a page only they see* | Not literally true (R3): whoever holds the link sees the page. *On their own page*, as the line above says it. T15 |
| *How it works*, step 2 (`site/pages/en/how-it-works.md:17-26`; NL `hoe-het-werkt.md:19-28`) | Ownpace only reads; some permissions allow more; *for Google, the app says so beside the button*; access can be withdrawn at the provider at any time | Holds. On a person's link the sentence stands in the step before the button, which is still before they connect |
| The home page's picture of the app (`site/copy.mjs:138-143` / `:536-541`; `site/app-screen/`) | The member's page for one person: *Wordt gemigreerd*, *laatste ronde* | Holds. It is the member's screen, which keeps its words (D14). The smoke holds the picture's words to the app's, so a shared word changed by accident fails there |
| The accessibility statement (`site/pages/nl/toegankelijkheid.md:12-14`, `:50-53`, `:63-64`; EN `accessibility.md`) | Its scope names the two pages a link opens; *Start a migration* is the one exception to *a new screen is not announced*; nothing checked at 200% zoom | Changes with step A (§13). Its scope says *de voortgang van een migratie*: on a person's page that is *hoe ver het kopiëren is* (D1) |
| The privacy text, a family member (`site/legal/privacy.md:1143-1145`; NL `privacy.nl.md:425-427`) | A page *that says who asked, from which account and to where* | Holds in step A. Steps B and C change it (§14) |
| The terms (`site/legal/terms.md:627-628`; NL `terms.nl.md:62-63`) | Somebody who follows a progress link, or gives access through a link, is no party to the terms | Against the link page's *By continuing you accept* (D18). It names two kinds of link: step C |
| The Alpha conditions (`site/legal/alpha.nl.md:129`, `:141`, `:145`, `:161`; EN `alpha.md:331`, `:345`) | *That migration's progress link*; a family member's Google address first; *Reconnect* on the account; a family member withdraws *on their own progress page* | The second holds. A progress link has been the person's, for all of their migrations, since 2026-10-03 (`apps/web/src/components/MappingLinksPanel.tsx:42-49`). *Reconnect* is for the member's own account. Both are small, and both are the owner's and the lawyer's: with step C at the latest |
| The home page, *European, all the way down* (`site/copy.mjs:277` / `:663`) | *Ownpace runs in the Netherlands, in the EU* | D3's open part: D16 |

### 22.3 With step A (T15)

**The tester guide gains a part for a family member's link.** The Dutch is written first and
is the one the owner reads, as for the rest of the guide (`alpha-handleiding.md:2-9`). A
draft, under *Zo begint u*, after *Als u Google koppelt*:

> ### Als een familielid een link krijgt {#familielid-link}
>
> Is het account van een familielid? Vraag dan niet om het wachtwoord. U maakt een
> toegangslink, en uw familielid geeft zelf toestemming.
>
> 1. **Vertel het eerst zelf.** Bel, of zeg het als u elkaar ziet: er komt een link van u, en
>    waarvoor die is. De pagina vraagt uw familielid of u dat hebt gedaan. Is het antwoord nee,
>    dan wacht de pagina.
> 2. **Maak de link.** Open de persoon bij *Migraties* en kies *Toegangslink maken*. Stuur de
>    link zelf, zoals u die persoon altijd bereikt. Wij sturen hem nooit.
> 3. **Doe de stap bij Google het liefst samen:** aan de telefoon, of aan tafel. Uw familielid
>    typt het eigen wachtwoord zelf. U hoeft het niet te weten, en u vraagt er niet om.
> 4. **Laat Google de verbinding niet toe?** Dan staat het adres nog niet op de lijst van
>    Google. Mail het ons, en wacht op ons antwoord. Daarna opent uw familielid de link opnieuw.
>
> Daarna heeft uw familielid een eigen pagina. Daar staat hoe ver het kopiëren is. Daar kan uw
> familielid het ook stoppen.

In English, with the id `family-link`: *When a family member gets a link*, and the same five
things in the same order.

Each sentence restates something decided: the question on the first screen (§5.1); the owner's
*"Keep the rule"* on who sends the link; *"Yes, preferably"* on doing it together; and the
guide's own *Google-adressen eerst*. Point 4's last sentence holds while the link's date has
not passed. The part says *kopiëren* where it describes what the family member sees. The rest
of the guide keeps *migreren*: it speaks to the member.

D13 is answered (a), so the member's screen says *tell first* too, in one line. The guide
says it with its reasons. It is the page a tester is asked to read before they start.

***Als Google opnieuw vraagt* gains one paragraph:** *Is het het account van een familielid?
Maak dan een nieuwe toegangslink voor die persoon, en vertel het weer eerst.* Step C changes
it: the one link then asks again by itself (D4).

**The Google help guide** (`docs/guides/`, both languages, `google.md:90`). The sentence
becomes what `docs/grant-links.md:5-9` says. The two bad ways are asking for the password, and
signing in for them and taking what the provider gives back. Being with them while they sign
in themselves is fine, and during the Alpha the link page advises it. The guide is the app's,
it opens without an account, and the site's *Leaving Google* page links it three times
(`site/sources.mjs:80-82`).

**The accessibility statement** changes as §13 says, and the sweep of the website adds three
things. Its scope names a person's two pages in D1's word. Its sentence about what the tests
open gains the second width, 320 pixels. And the parts it changes are split into short
sentences. The statement is one of the three pages a person can reach. Its Dutch runs to 17.7
words a sentence, and one sentence has 58 (`toegankelijkheid.md:32-35`).

**The site's sentence about a link** says *on their own page*, in both languages
(`site/copy.mjs:262` / `:648`).

**The English pages at 320 pixels.** The header is 2.7 pixels wider than the screen there, on
every English page: the mark, *Nederlands* and *Menu*. The Dutch pages fit, because *English*
is the shorter word. One rule of the header's layout mends it, and the site's test opens a
page in each language at that width (§21.4).

**A short block for families on the home page (D17 (b)).** For the member who arranges this
for a family member: they arrange it, the family member gives permission themselves, nobody
sees their password, and the family member can follow it and stop it. In both languages, in
§22.7's words, and only what is true with step A: not *one link* (step C), not a sender *by
name* (step B), and no picture of a screen that is not built. The owner reads its Dutch with
step A's.

**What step A must not break on the site.** The file names the app links
(`scripts/a-policy-link-that-answers.unit.test.ts`); the guide's six sections and its two
Google ids; the visitor's line (`scripts/the-alpha-said-to-a-visitor.unit.test.ts`); and the
home page's picture, with the words in it.

### 22.4 With steps B and C

- **Step B.** The tester guide's new part names what the page then shows of the sender: the
  name, the relation and the number (T3). It names T8's tick and its message too. The privacy
  text changes as §14 says.
- **Step C.** One link, where the site and the help guides say two, or say *spent*: the Google
  help guide (`google.md:90-94`); `docs/grant-links.md`; the tester guide's paragraph for a
  family member's account when Google asks again; the terms' sentence about who is no party
  (`terms.md:627`); the Alpha conditions (`alpha.nl.md:129`, `:161`); the privacy text's *own
  progress page* (`privacy.nl.md:433`); and the accessibility statement's scope. The three
  legal texts are the owner's and the lawyer's, with §14's.
- **T0.** Google's own words go into the guide when they go into the link page, from the same
  record, with its date (§20).

### 22.5 D3's open part: where the service is run

D3 (b) waited for the site's next pass. What that pass finds:

- **The site says it by hand, twice** (§22.2's last row, and the privacy text). Nothing holds
  the two to each other, and the app has no word for it.
- **It can change.** The privacy text says where the service runs *during the Alpha*, and that
  it will say where data goes if the service moves (`site/legal/privacy.md:1247`,
  `:1323-1325`).
- **Somebody else can run the same software.** So the dictionary cannot hold a country, and a
  deployment that sets nothing must say nothing.
- **One thing is true for every reader:** where the service runs. Where the copy ends up is
  the provider the page names, which the family chose. The page never says the data *stays*
  in a country, or in the EU.

D16 puts the choice to the owner (§18). Under its (a), as advice to the builder: one key in
the stack's `.env`, handed to the web build and to the site build as the stage is
(`site/build.mjs:141`); a two-letter country code, refused when it is not one; the name from
the browser's own list, in the reader's language; the home page's sentence built from it; and
a guard that the privacy text's own sentence names the same country.

### 22.6 What the page says a person accepts

D18 (§18). The page's sentence, the terms and the privacy text say three things about one
moment. Nothing changes in step A. The lawyer's pass gets one more question, beside the window
on a stop: does a person who gives access through a link accept anything? And if not, what
should the sentence above the two links say?

### 22.7 A story for families on the site

What the desk review found on the site, each held against the owner's answers and the
glossary. Under D17 (b) the first row's block on the home page travels with step A (§22.3), in
the words this table settles; the rest is for the site's own plan, once step A is on a stack.

| What | Worth doing? | What settles its words |
|---|---|---|
| A block on the home page, and a page, for the member who arranges this for a family member: you arrange it, they give permission themselves, you never see their password, they can follow it and stop it | Yes. During the Alpha only households take part (`alpha-handleiding.md:56`), and the site does not say how a household does it | *Overstappen*, never *verhuizen* (`GLOSSARY.md:59`). *Kopiëren* for what the family member sees (D1). *One link* only after step C, and a sender *by name* only after step B. A picture of the first screen, taken as the home page's is (`scripts/shoot-the-app-screen.mjs`), only after step A |
| A price example for a family | Yes, small. Today a household reads as the fourth tier (`site/copy.mjs:350` / `:724`) | Worked out by the build from `site/prices.mjs`, as *A typical cost* on the Leaving pages is (`site/copy.mjs:263-266`). Never typed |
| A getting-started guide in plain Dutch, in steps, with the technical parts in a section of their own | Yes, larger. `docs/guides/nl/start.md` is *Hoe een migratie kopieert*: it explains the order of the copying, and is no first step | The member's level, which is the app's. A person's pages are a level plainer (§1). The app serves the guides, so this is the app's plan as much as the site's |
| The proof under *Nothing is deleted at the source*, said for people first | Yes, small. Today the link reads *The test that checks this (code, on GitHub)* (`site/copy.mjs:110` / `:519`) | The claim stays linked to the guard that holds it (`site/proof.mjs`). Only the words round the link change |
| One plain verb | Done by D1, for a person's pages. The site keeps *migreren* for the member, 84 times in its Dutch, and its first sentence already says *kopieert* (`site/copy.mjs:501`) | The owner, 2026-10-10 and 2026-11-26 |
| The country, where an older person reads it | D16 | R3: where the service runs, never where the data stays |

### 22.8 The site's own accessibility and plain language

Measured on the copy built for the Alpha, at 390 and at 320 pixels. In Dutch: the tester
guide, *Hoe het werkt*, the accessibility statement, the privacy policy, the Alpha conditions,
the home page, pricing, *Weg bij Google*, the estimate and the gift page. In English: the home
page and the guide, and six pages for the check at 320 pixels.

| What | Found | Against |
|---|---|---|
| The page's language, its title, one `h1`, no heading level skipped, a *Skip to content* link first, every picture with words | On every page measured | Holds |
| Sentences | 16 pixels on a line of 26, in `#1d2421` on the page's paper: 15.0 to 1 | AA holds. A person's pages will be 18 pixels (§13) |
| Small text | The language link 13.6 pixels; the Alpha's line under the header 14.4; the footer 14.7 and its build stamp 12.8; *Menu* 15.2; a table's cells 15.2 and its headings 12.8 | AA sets no least size. Under this plan's 16 for a person's pages |
| The muted colour, `#5d6763` | 5.56 to 1 on the paper: the footer, the Alpha's line, the language link, a table's headings | AA holds (4.5). Under this plan's 7 |
| A link in a sentence, `#146b60`, underlined | 6.04 to 1 | AA holds |
| Targets that stand alone | The language link 71 by 29 pixels; *Menu* 85 by 37; the mark 112 by 28 | AA holds (24 by 24). Under this plan's 44 |
| Focus | The browser's own ring | AA holds |
| Sideways at 390 pixels | None. The site's test holds it for every page | Holds |
| Sideways at 320 pixels | **Every English page: 3 pixels.** No Dutch page | Criterion 1.4.10. T15 |
| The body's size is set in pixels (`site/build.mjs:384`) | It does not follow a reader who chose a larger standard size in the browser. The smaller texts are set in `rem` and do: at a standard of 20 pixels the footer is larger than the sentences | Zoom works, so criterion 1.4.4 holds. For the site's plan |
| A field's edge on the estimate, `#e5e1d6` | 1.24 to 1 against the paper | Criterion 1.4.11 asks 3 to 1. Not a page of this plan: for the site's plan |

**Plain Dutch, by the length of a sentence.**

| Page | Sentences | Words a sentence | Over 20 words | Longest |
|---|---|---|---|---|
| The tester guide | 137 | 8.4 | 2 | 30 |
| *Hoe het werkt* | 50 | 14.9 | 14 | 35 |
| Pricing | 61 | 13.7 | 16 | 39 |
| The accessibility statement | 43 | 17.7 | 15 | 58 |

The tester guide is the plainest page of the site, and the one a tester is asked to read. Its
hard words are the app's: *bestemming*, *doelmap*, *koppelen*, *experimenteel*. The
accessibility statement is the hardest, and of these four the only one a person with a link is
sent to. T15 splits the parts it changes. The privacy policy and the terms are the lawyer's
words, and a person reads them in a translation that says the English is the text that
applies (`site/copy.mjs:742-743`).

**What follows for this plan.** The fault at 320 pixels and the statement are T15's, with
step A. The rest is the site's own. It holds AA, and making three pages of the site as large
and as dark as a person's pages is a choice about the whole site. It belongs in the site's
plan (D17), with the story for families, so that the site is changed once.

## 23. Building it in parts (2026-11-26)

The owner: *"When the plan is done, build it efficient, fan out in seperate sessions if
needed."* This says which parts can be built side by side, which files each part owns, and
what waits for what. A part changes only its own files. Step A's files were read at `b5431b8`
for this. Those of steps B and C are as this plan names them, and whoever builds them checks
the list first.

**One rule decides the shape.** A key no screen says is refused
(`apps/web/src/i18n/a-word-nobody-says.unit.test.ts`), so the words cannot be merged ahead of
the screens that say them. T2 is therefore not a part of its own: each part brings the words
of its own page, in its own dictionary file. T9 goes the same way, by file.

### 23.1 Step A: one first, four side by side, one last

Each step is one pull request (the Status block). The parts are branches that meet in it.

| Part | Tasks | Files it owns |
|---|---|---|
| **First: the glossary** | T2, point 5 | `apps/web/src/i18n/GLOSSARY.md`. *Change a word, change it here first* |
| **The link page** | T1; T8's one line (D13 (a)); T2 and T9 for this page | `apps/web/src/pages/Grant.tsx` and the new files of its steps; `apps/web/src/components/GrantPasswordCard.tsx`; `apps/web/src/components/MappingLinksPanel.tsx` and `apps/web/src/services/grant-link-service.ts`; `apps/web/src/i18n/strings/grant.ts` (`grant.*`, `grantLink.*`, `linkReport.*`); `Grant.unit.test.tsx`, `AlphaGoogleLine.unit.test.tsx`, `MappingLinksPanel.unit.test.tsx`, and the link page's rule tests under `apps/web/src/pages/` (§5.7) |
| **The progress page and the stop** | T5 and T6, first halves; D14 (a); T2 and T9 for this page | `apps/web/src/pages/View.tsx` and its new files; `apps/web/src/components/PausedBecause.tsx`, `StateChip.tsx`, `MigrationLines.tsx`, `TimeBeforeStartLine.tsx`, `TimeWhileCopyingLine.tsx`; `apps/web/src/i18n/strings/migrations.ts` (`view.*`, `state.stage.*`, `timeLeft.*`, `pause.*`), `people.ts` (`people.line.*`) and `confirm.ts` (`confirm.progress.*`); `View.unit.test.tsx`, `a-password-the-person-removes.unit.test.tsx`, and the new tests of §21.4 for T5 and T6 |
| **The server's sentences** | The ending and a refused link: T2 and T9 for them | `apps/api/src/routes/migrations/google-consent.ts`, `person-grant-ending.ts`; `packages/shared/src/link-holder-refusals.ts`; `a-consent-ending-in-the-readers-language.unit.test.ts`, `google-consent.unit.test.ts` |
| **The website and the documents** | T15 with step A; T10's documents | `site/pages/nl/alpha-handleiding.md`, `site/pages/en/alpha-guide.md`, `site/pages/nl/toegankelijkheid.md`, `site/pages/en/accessibility.md`, `site/copy.mjs`, `site/build.mjs`, `test/ui/site.ui.test.ts`; `docs/guides/nl/google.md`, `docs/guides/en/google.md`, `docs/grant-links.md`; `scripts/a-site-that-says-what-a-persons-page-says.unit.test.ts` |
| **Last: what both pages share, and the proofs** | T9 for the shared parts; T11; T10's records | `apps/web/src/components/LanguageSwitch.tsx`, `AccessibilityLink.tsx`, `BuildStamp.tsx`, `ReportThisLink.tsx`, `YourNewAddress.tsx`; `test/ui/managed-ui.ui.test.ts`; `apps/web/src/i18n/the-owners-words-at-the-door.unit.test.ts`; the new `apps/web/src/i18n/a-persons-pages-say-kopieren.unit.test.ts`; `CHANGELOG.md`; this plan's Status |

**What waits for what.**

- The four middle parts wait for the glossary, and for nothing else. None of them opens a
  file another owns.
- The last part waits for all four. Three of its files hold both pages by nature: the smoke,
  the owner's pinned sentences, and the test that reads every sentence for *migr-*. They are
  red until the parts meet, which is why the parts meet in one pull request and are not
  merged one by one.
- The website's test holds two sentences equal in the guide and in the dictionary (T15, point
  4). That one case joins in the last part, when the link page's keys have their names.
- The accessibility statement says what the two pages are after step A. It is written from
  §13 and §21.4, and read once more in the last part against what was built.
- The owner's read of the Dutch comes after the last part, on one table (§6).
- T0 and T12 are the owner's. T0 fills in Google's words whenever it is done. T12 needs step
  A on a stack.

### 23.2 Step B: one line of work, and three beside it

Step B's tasks lean on each other more. T8's form holds T3's name and relation and T7's
voice (§12), and T7 doubles every Dutch sentence, T3's and T8's among them (§11).

| Part | Tasks | Files, as this plan names them | Waits for |
|---|---|---|---|
| **The main line, in this order** | T3, then what T6 adds, then T8 with D15 (a)'s sheet, then T7 | T3: a managed migration, `packages/managed/src/schema-managed.ts`, `apps/api/src/routes/migrations/person-grant-subject.ts`, `packages/shared/src/tenant-contact.ts`, the Team page, `Grant.tsx`. T6: `packages/shared/src/migration-view.ts`, `apps/api/src/routes/person-progress.ts`, `View.tsx`. T8: `MappingLinksPanel.tsx`, `apps/web/src/pages/Person.tsx`, `StartMigration.tsx`. T7: a managed migration, the dictionary's informal layer, `apps/web/src/i18n/index.tsx`, the server's sentences | Step A merged. T3 and T7 each add a managed migration: they take their numbers one after the other, never side by side |
| **Beside it: everything on one page** | D15 (a)'s *Read everything on one page* | A new page of its own, built from step A's sentences. The one link to it from `Grant.tsx` is the main line's | Step A merged |
| **Beside it: where the service is run** | D16, if the owner answers (a) | A new module under `apps/web/src/services/`, `apps/web/vite.config.ts`, the stack's compose files, `site/build.mjs`, `site/copy.mjs`, a guard. The one sentence on the first screen is the main line's | D16's answer |
| **Beside it: the informal Dutch, as a draft** | T7's sentences | A new file for the informal layer: the *je* twin of every step A sentence | The owner's read of step A's Dutch. T3's and T8's sentences get their twins at the end of the main line |
| **After the main line** | T10 and T15 for step B | The tester guide in both languages; the privacy text, for the lawyer | T3 and T8 |

### 23.3 Step C: the record first, two halves, then the page

| Part | Tasks | Files, as this plan names them | Waits for |
|---|---|---|---|
| **First: the record** | ADR-0035 amended (§8, §9.2) | `docs/adr/0035-who-signs-in-and-who-gets-a-link.md`; `docs/adr/OPERATIVE.md`, by its script | Step B merged |
| **One link, on the server** | T4 | A managed migration (`asks_until`); `packages/managed/src/person-link-store.ts`; `packages/ledger/src/mapping-link-store.ts`; `apps/api/src/routes/person-link-routes.ts`, `grant.ts`, `view.ts`; `person-grant-ending.ts` | The record |
| **The window, on the server** | T5, second half | A ledger migration; `withdrawPersonGrant` in `apps/api/src/routes/person-progress.ts`; the job that makes a stop final | The record |
| **Then: the page, by one builder** | T4's one address, and the window's words and buttons | `Grant.tsx`, `View.tsx`, the app's routes, `MappingLinksPanel.tsx` (one section where there were two), the member's line about a stop | Both halves |
| **Last** | T10 and T15 for step C; T11 | The texts of §22.4; `docs/grant-links.md`; the integration tests of §16 | The page |

The two halves on the server can be built side by side: their migrations are in different
packages, and neither opens the other's store. They meet in two files, `person-progress.ts`
and `View.tsx`. So the window's half keeps to its one function there, and the page waits for
both. The lawyer's read of the window (D6) gates who gets it, not when it is built.

### 23.4 What holds for every part

- A part's builder runs that part's own tests, and the guards that read its files.
- The parts of a step meet on that step's branch. Lint, typecheck, the unit tests and the UI
  smoke run there, on everything together, before the owner reads the Dutch.
- No part changes a file of another step's.
- E2E against a real account is the maintainer's to dispatch, once per step.
