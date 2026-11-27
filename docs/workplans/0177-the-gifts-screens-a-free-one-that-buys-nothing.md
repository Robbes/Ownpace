# Workplan 0177 — The gift's screens: a free one that buys nothing, a door of its own, a card that reads alone

> **In one line:** The screens a gift's giver and recipient see: a free gift becomes a recommendation that lets a person in at once and buys nothing; the code gets a door of its own; the card reads without a screen; the two mails say what happened; the Alpha gets two ceilings; a paid gift code stays as 0172 left it.

## Status — 2026-11-27 (update this block at the end of every session)

**2026-11-27, alpha.22: three of alpha.21's follow-ups, in one pull request, #2215**
(`claude/ownpace-public-readiness-y7orc6-a22-a21-follow-ups`).

- **The giver's refusals in both languages.** What #2206 left for after alpha.21: `POST
  /api/gifts`, `GET /api/gifts/mine` and `POST /api/gifts/:id/revoke` now answer each refusal
  with `reason` and `reasonNl` beside `message`, as the door's do: the number reached (409
  `gift_limit`, with the number), a full Alpha (409 `no_room`), a card that is not theirs (404),
  one no longer unused (409), and a sign-in with no organisation (400). The sentences live in
  `gift-store.ts` beside D18's; the first two are the page's own (`give.atLimit`, `give.full`).
  The operator's revoke keeps its English. Five cases in `gifts.unit.test.ts` and one in
  `an-alpha-with-two-ceilings.unit.test.ts`, each failing first. The Dutch was drafted here, and
  the owner read it on the pull request (*"2215: ok"*, 2026-11-27): the four new Dutch rows, the
  fifth refusal kept, and the new English that says *recommendation* and *withdraw*.
- **Google's list on *Gifts* (§20.5, §20.6).** Since 0176's D19 a member may help
  acquaintances, so the sentence names each person they help, family or acquaintance (§20.6's
  row). The owner read it on the pull request (*"2215: ok"*, 2026-11-27).
- **The door's three answers** were made one size by #2210; a person's pages now do the same
  for their two (0176's Status).

**2026-11-27: step A is in alpha.21.** alpha.21, tagged at `c34b30f8` (0146), carries step A
(#2198), its door's three answers kept one size when one wraps (#2210), and its words as the owner
read them (#2206). The task table says so: T1 to T8, T10 and T16 are merged, and T11 is met by T1
and T4. Two things wait: the 76 rows marked *drafted (plan)* and the operator's English, for the
owner's read (T3), and the privacy text, changed in place under 1.0 once the lawyer has read it (T7,
Q1). Still open: T0 and T14, the owner's; T9 (step B); T12 (step C).

**2026-11-26, later still: the owner's answers on the privacy text (Q1) and the menu's icon
(Q3), and the read of step A's Dutch.** Step A is merged (#2198), with E2E managed, Postgres
and PGlite green on its tree. In the owner's words:

- **Q1, the privacy text:** *"Q1: yes"*. It is changed in place under 1.0, once the lawyer
  has read it, as for 0176. Nothing in `site/legal` changes now: #2198's drafts for §4.4, §5
  and §9, and the shorter sentence for a declined request that came with a code, are on the
  lawyer's list (T7, §11).
- **Q3, the menu's icon:** *"Q3: yes as advised"*. *Recommend someone* / *Iemand
  aanbevelen* is drawn with the handshake the card carries, so the menu and the card match
  (`Layout.tsx`); the operator's *Gifts* keeps its gift box. A case in `Layout.unit.test.tsx`
  holds it, and failed on the gift box before.
- **The Dutch of #2198:** *"Dutch read 2 (#2198's sentences): ok, as advised"*. The owner
  had the seven groups the pull request flagged first, with the advice *all ok*, and the
  rest of its table. No word changes. Every row of that table marked *drafted (here)*, a
  sentence step A wrote that this plan does not give, is *owner (read) 2026-11-26* (§7).
  The door's two field hints stay one sentence each, as the copy budget holds (0118):
  §7's first sentences for them are not wanted, and nothing goes in the budget's `RAISED`.

**Open:** T0 and T14. The rows marked *drafted (plan)* and the operator's English keep the
marks they had in #2198, as the read was passed on.

**2026-11-26, later still: step A is built, its two halves met on the pull request's branch
(`claude/ownpace-public-readiness-y7orc6-a21-gift-step-a`), in review.** The back's half, the
server and the mails, was built on its own branch and merged in; the front's was built against
§19's contracts and then read against the answers as built.

- **The glossary** (§21.1): *recommendation* / *aanbeveling* for the free thing, with the
  names it does not take, and *gift* / *cadeau* kept for a code somebody paid for.
- **The web** (§21.2, 1 to 22): the door at `/code` (`/redeem` and `?gift=1` open it; the
  plain form's *I have a code* links it), its three steps and its endings; the giver's page
  and the card on the screen; the operator's *Gifts* and the queue, with both counts and
  ceilings; the overview on *Support* (D17); `onlyAfterAlpha` on the giver's page and the line
  on *Gifts* (D18). A person's sizes come from 0176's `PersonsPageProvider` and
  `data-persons-page`. `/give` and `/gifts` no longer draw a second `h1` (0172's, found by the
  smoke). A refusal's Dutch half is read from `reason` / `reasonNl`, where a 429 also carries
  the English as `message`.
- **The server and the mails** (§21.3, §21.4): the back's, as its branch's commits say:
  managed migration 0066, the check and the redeem, the two ceilings, D15, D17 and D18, and
  the two mails for every request.
- **The site and the documents** (§21.5): the site's page in both languages, its cases in
  `site/site.unit.test.ts`, `docs/ending-the-alpha.md` (D5, the ceilings, D18), and 0172's
  Status. **The privacy text is not changed:** T7 asks the owner whether it is still changed in
  place under 1.0, and the drafts are in the pull request.
- **The last part** (§21.6): the smoke walks the door in both languages at 390 and 320 pixels
  under 0176's measure, shows the code on one line on the giver's page at both widths, and
  prints the card to A4 and Letter (nine tenths of the sheet or more, one sheet, upright, no
  text under 14 point, the code on one line); the print rule; the site's link to `/code` and
  the page's title; the tester guide's *Google addresses first* (D14); `CHANGELOG.md`.

**Proved,** each test written first and failing on the code before it: the door's
`a-code-with-a-door-of-its-own.unit.test.tsx` (24 cases, §21.2's 1 to 10),
`one-name-for-a-free-gift.unit.test.ts` (item 20, the two mails included), new cases in
`a-gift-on-every-screen.unit.test.tsx`, `AccessRequests.unit.test.tsx`, `Support.unit.test.tsx`
and `Layout.unit.test.tsx`, this page's cases in `site/site.unit.test.ts`, ten cases in the
managed UI smoke, and the back's own (its branch's commits list them). **Open:** the owner's
read of the Dutch and of the operator's English, on the pull request's tables; the privacy
text's question; E2E, which the maintainer dispatches; T0 and T14.

**2026-11-26, later still: the owner's answers to D17 and D18 (T17). Step A is being
built.** In the owner's words:

- **D17:** *"(refuse a 51st): no, ik will count. But you add oversight on the operator
  support page."*
- **D18:** *"no, not in the alpha. Yes after the alpha."*

**What these change.** §15.3 says it for each one.

- **D17: nothing refuses the owner's own yes.** The owner keeps count. The operator's
  *Support* screen gains an overview of the Alpha: the three counts that *Gifts* shows, from
  the same answer (§20.4, §20.6). What the overview holds is this plan's reading.
- **D18: during the Alpha, only the people the owner let in may recommend.** A person who
  came in by a recommendation may not until the Alpha ends; after it, every member has the
  number each person may give (§20.7). The second ceiling stays as D16 set it.
- **Step A carries both.** T16 holds the work, and §19 fixes the two names the web and the
  server share for D18. What is left for the owner: the read of the Dutch, T0 and T14.

**2026-11-26, later: the owner's answers to D14 to D16, and a yes to building step A (T15).
Nothing is built yet.** In the owner's words:

- **D14:** *"a"*
- **D15:** *"a"*
- **D16:** *"alpha limited to 50 people I let in, en 50 max someone invites (each let in user
  1 invite)."*
- **Whether step A is built now, beside 0176's:** *"yes"*

**What these change.** §15.2 says it for each one, and §20 works the third one out.

- **D14:** the door's third step asks one question about a Google account. A yes is kept with
  the request, and the owner's notice names the address to add at Google (§5).
- **D15:** a code lets in a person whose request is already waiting. That waiting request is
  the one granted (§5).
- **D16: the Alpha has two ceilings.** The numbers are the owner's: 50, 50 and 1. How they
  are counted, kept and shown is this plan's reading, and §20 marks it as one. Step A gains a
  task for it, T16, and its migration now adds two numbers to one row.
- **Step A is to be built.** Builders start once this plan is merged. It is built beside
  0176's step A (§19). Its last part waits until that step is merged, which is #2180. §21
  says for each part what done means.

**These answers left two questions,** D17 and D18 (T17, §15.3): whether the owner's own 50
refuses a 51st yes or is only shown, and whether a person who came in by a recommendation
may recommend somebody too. The owner answered them later the same day: the entry above.

**2026-11-26, the owner's read of the Dutch that D6 changed.** The owner: *"The G6 Dutch: all
ok"*. G6 is this plan's D6, as it was put to the owner. Five things were read: the card's
sentence, the giver's page, the giver's new line, the last screen, and the yes mail's opening
for a code. §7 and §8 mark the rows. Every other Dutch sentence is still a draft.

**The migration's number.** Step A's migration is managed 0066. The maintainer assigns the
numbers of this plan's and 0176's migrations, so that nothing is built side by side on the
same one (§19).

**2026-11-26, the owner's answers to D1 to D13 (T13).** In the owner's words, in the plan's
order:

- **D1:** *"aanbeveling (recommendation). Don't mention 'geen sleutel', thats obvius)"*
- **D2:** *"both"*
- **D3:** *"yes"*
- **D4:** *"no"*
- **D5:** *"free when it was free. given during free-alpha doesn't make it free unlimited after
  alpha."*
- **D6:** *"The free giving is limited in alpha to 1, so one needs to be allow in straight away.
  I do however have to add one's google account if they have it, so the google oauth client
  works."*
- **D7:** *"yes, adviced."*
- **D8:** *"yes, adviced."*
- **D9:** *"yes, adviced."*
- **D10:** *"yes"*
- **D11:** *"a"*
- **D12:** *"a"*
- **D13:** *"both, as stated"*

**What the answers change.** §15 says it for each one, and keeps this plan's reading apart
from the owner's words. In short:

- **D6 changes the most, and it changes a decision of 0172.** A recommended person is let in
  straight away. The door no longer makes a request that waits for the owner. 0172's G1 said
  that a redeemed gift lets nobody in by itself; for a free one that no longer holds. §5 is
  rewritten for it. Step A gains a managed migration, which adds no table.
- **The free thing is a *recommendation* / *aanbeveling*** (D1), and no sentence says what it
  is not. The sentences that said *not a key* go.
- **A card and a link** (D2). **`/code`** (D9). **Both mails as proposed** (D11, D12).
- **A free one gives what was free:** the free Alpha, and nothing free after it (D5).
- **Step B is one task now:** who sent it (D3). Under D6 what the giver hears needs no data
  (D8), and the yes mail, sent at once, is the receipt (D10). §12 says why.
- **The time for an answer falls away** (D6): for a code the answer is at once.
- **The half of D7 that said *the answer can always be no* falls away too.** It is no longer
  true of a recommendation.

**These answers left three questions,** D14 to D16: how Ownpace learns of a Google address
to add; an address that already has a request waiting; and a ceiling, now that nobody reads a
recommendation first. The owner answered them later the same day: the entry above.

**2026-11-26: planned, after a desk review.** The owner asked for the gift's screens to be
reviewed before they join a plan, and decided what a free gift is (§1).

**Where the design comes from, and how far to trust it.** From the owner's decisions (§1,
§15), and from a desk review: the journey drawn as it is built and as a sketch, each read by
six simulated readers. A language model played each: an older recipient, the giver, a younger
recipient, a volunteer at a library's digital help desk, an accessibility and plain-language
reviewer, and a privacy reviewer who watched for wording shaped like a swindle. A desk review
finds problems. It proves nothing about real people. T14 is the first test with people, and
what it finds outranks this plan's words.

**What the review found, in short.** No simulated recipient got through today's journey: each
stopped at the request form. All six readers preferred the sketch. The sketch failed in three
places of its own, which §2's rules now forbid: a safety sentence that was not exactly true, a
message written for the giver to send, and the word *invitation* for something that can be
refused. §3.5 has the findings one by one. No reader saw a door that lets a person in at
once: that is the owner's answer, after the review.

**Whose words these are.** The giver's page and the card carry the owner's words of
2026-11-25 (0172 T8). The two mails carry the owner's text review of 2026-10-10 (#1556). The
owner chose the new name and both mails' proposals (D1, D11, D12). Every sentence in §7 and
§8 is still a draft until the owner has read the Dutch. Five have been read: the entry on
the Dutch that D6 changed, above.

**Every claim about the code below was read at `ae57042`,** which is `main` on 2026-11-26.
Two changes came after 0172 was merged, and are in the lines cited: the privacy text's two
additions about a gift (#2171), and the request form's package names in the page's language
(#2175). §20 and §21 were read at the same tree. `main` has moved since, and no change in it
opens a file that this plan cites for what the code does.

**The order.** Three steps, each one mergeable by itself.
- **Step A, words, screens, letting a person in, and two ceilings:** T1 to T8, T10 and T16.
  One new route. One managed migration, which adds no table: two numbers on one row, and what
  the code's own transaction needs to let a person in.
- **Step B, a little data:** T9.
- **Step C, after the Alpha:** T12.

T0 and T14 are the owner's. Step A is built beside 0176's step A; only its last part waits
for that one to be merged (§19, §21).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's hand test: from the mail that lets a person in to the first screen after signing in, word for word | owner | ⏳ **Owner** | §8. On a real phone, in Dutch and English. Blocks nothing; the yes mail's third step takes its words. |
| T1 The door: the code first and alone, then let in at once | builder | ✅ Merged, alpha.21 (#2198, `f9f24bef`) | §5. One new route, and a managed migration with no table (D6). The question about Google (D14) and a request already waiting (D15) are part of it. L. |
| T2 The card: a full sheet, in type that can be read, with steps that match the screens | builder | ✅ Merged, alpha.21 (#2198) | §6. S. |
| T3 The words, EN and NL, and one name for the thing | builder | ✅ Merged, alpha.21 (#2198, #2206); the 76 rows marked *drafted (plan)* wait for the owner's read | §7. D1 (a). The glossary first. Merged after the owner's read of the Dutch. M. |
| T4 The two mails: what happened, in both languages alike | builder | ✅ Merged, alpha.21 (#2198) | §8. D11 (a), D12 (a). For every request. M. |
| T5 The giver's page: what it is, and what the other person will read | builder | ✅ Merged, alpha.21 (#2198) | §9. With a link beside the card (D2). M. |
| T6 Size, contrast and targets on the door and the giver's page | builder | ✅ Merged, alpha.21 (#2198, #2210) | §10. S. |
| T7 What follows: the site's page, the glossary, the privacy text, the records | builder | 🔄 Merged, alpha.21 (#2198, #2206); the privacy text under 1.0, after the lawyer (Q1) | §11. With each step. S. The privacy text: *"Q1: yes"* (the owner, 2026-11-26), changed in place under 1.0 once the lawyer has read it, as for 0176; #2198's drafts are on the lawyer's list. |
| T8 Proofs | builder | ✅ Merged, alpha.21 (#2198) | §14. With each step. |
| T9 Who sent it: the giver's name at the door and in the yes mail | builder | 📋 Planned | §12. Step B. D3 (a). After 0176's T3, which holds the name. M. |
| T10 What the giver hears: used, and so let in | builder | ✅ Merged, alpha.21 (#2198) | §9. Step A now, in words: under D6 *used* means *let in*, so no column is needed (D8). S. |
| T11 A receipt by mail | builder | ✅ Met by T1 and T4 (#2198) | §12. Met by T1 and T4: under D6 the yes mail goes out at once, and it is the receipt (D10). No task of its own is left. |
| T12 After the Alpha: a paid code at the same door | builder | 📋 Planned | §13. Step C. With payments; 0172's G2. Not designed here beyond the door. |
| T13 The owner's decisions, D1 to D13 | owner | ✅ Answered 2026-11-26 | §15.1. In the owner's words, with what each changes. Later that day the owner also said yes to building step A now. |
| T14 A first test with four people | owner | ⏳ **Owner** | §16. After step A is on a stack the owner can reach. |
| T15 The owner's decisions after the answers, D14 to D16 | owner | ✅ Answered 2026-11-26 | §15.2. In the owner's words. What D16's numbers mean in the code is this plan's reading (§20). |
| T16 The Alpha's two ceilings: 50 people the owner lets in, 50 by a recommendation | builder | ✅ Merged, alpha.21 (#2198) | §20. D16 to D18. Step A. Two numbers on the operator's *Gifts* screen; both counts shown there, on the queue, and in an overview on *Support* (D17); nothing refuses the owner's yes; a new card and the door keep to the second; during the Alpha only the people the owner let in recommend (D18). M. |
| T17 The owner's decisions on the ceilings, D17 and D18 | owner | ✅ Answered 2026-11-26 | §15.3. In the owner's words. D17: nothing is refused, and *Support* gets an overview. D18: during the Alpha only the people the owner let in recommend; after it, every member. |

## 1. What the owner decided

The first three are restated here, not quoted. The answers to this plan's own decisions are in
§15, in the owner's words.

- **2026-11-26: the gift's screens are reviewed before they join a plan.** 0176 left them out
  (§19 there). This plan holds what the review asks for.
- **2026-11-26: a gift may be free as well as paid.** A free one buys nothing: no plan and no
  money. It works as a referral does: it brings a person to Ownpace and says who sent them. A
  paid gift code is unchanged: 0172's G2, *a paid code buys one of the plans*, after the
  Alpha.
- **2026-11-26: a gift made during the Alpha becomes a code after it,** paid or free as its
  giver picks.
- **2026-11-26, on this plan's D1 to D13:** §15. The one that reaches furthest is D6: a
  recommended person is let in straight away.
- **2026-11-26, later, on D14 to D16:** §15.2. The Alpha has two ceilings: 50 people the owner
  lets in, and 50 let in by a recommendation, one for each person let in. The same day the
  owner said yes to building step A now, beside 0176's.
- **2026-11-26, later still, on D17 and D18:** §15.3. Nothing refuses the owner's own yes:
  the owner keeps count, and the operator's *Support* screen shows the Alpha's counts. During
  the Alpha only the people the owner let in may recommend; after it, every member may.
- **From 0172** (2026-11-24 and 2026-11-25), still so: a gift is valid for two years; Ownpace
  never sends it, the giver does; nothing about the recipient is kept on the gift; each
  person gives one. **Changed by D6, for a free one:** 0172 said a gift lets nobody in by
  itself and becomes a request that the owner reads and may decline. A recommendation now
  lets its person in at once. Somebody who asks without a code still waits for the owner's
  answer.

## 2. Who reads these screens, and ten rules

Two people. The giver is a member, which during the Alpha means somebody the owner let in: a
member who came in by a recommendation may give one only after the Alpha (D18). The recipient
has no account, did not ask for this, and may be older.
They have been taught that a gift nobody asked for is not a gift, that a code is never
given away, and that a link in a message is not tapped. Today's journey hands them a gift,
with a code, to type into a website.

Ten rules follow from the review. Each task below cites the ones it serves.

- **R1. The name promises nothing that can be refused.** Not *a place*, and not a welcome
  before the answer.
- **R2. Nothing shaped like a swindle.** No gift that was not asked for, no *claim*, no hurry,
  no message written for the giver to send, and no sentence in which a mail or a page calls
  itself safe.
- **R3. Every sentence is literally true,** and a safety rule exactly so.
- **R4. The code first, and alone.** Then only what is needed to let the person in.
- **R5. The page gives something to check and does not vouch:** not for itself, and not for
  the sender.
- **R6. Say what happens next:** when, from whom, and what then.
- **R7. Say what it costs, and to whom,** now and after the Alpha.
- **R8. One name for one thing,** on the card, the door, both mails and the site.
- **R9. The paper works alone, and matches the screens.**
- **R10. The giver is told what the other person will be told,** and what the giver will get
  to know.

## 3. What exists

Built by 0172, merged for alpha.21 (#2141). The lines below are the tree at `ae57042`.

### 3.1 The giver's page and the card

`apps/web/src/pages/Give.tsx` (289 lines), in the menu of every member of an organisation
(`apps/web/src/components/Layout.tsx:365`). Its words are in
`apps/web/src/i18n/strings/gifts.ts` (EN `:12-58`, NL `:60-103`).

- **Before a gift is made** (`:142-191`): the title *Give Ownpace*; *Give someone dear to you a
  place in the Alpha, on a card*, which is the owner's sentence of 2026-11-25; then, in small
  grey type, that a gift is *a personal recommendation rather than a key*, and what is kept. A
  panel: how many a person may give, the card's language, and *Make my gift*.
- **After** (`:193-244`): *This code is shown only now*; three fields that stay in the
  browser, which are the giver's name, filled in from their sign-in name (`:107`), the
  recipient's first name and a message (`:229`); the card; and *Print or save as PDF*. Under
  both, the list of gifts, with *Revoke* on an unused one (`:246-284`). The list's answer
  already holds the day a gift was used (`packages/managed/src/gift-store.ts:240`); the page
  does not show it.
- **The card** (`:61-97`): a title, *From {giver}*, the message, two paragraphs of 14 pixels,
  the code at 24 pixels, *Use it at* with the app's `/redeem`, and *Valid until* at 12 pixels
  in grey. Its second paragraph is the owner's sentence about the Alpha: *Ownpace zit in een
  gratis Alpha, en we laten mensen zelf toe. Met deze kaart vraagt u ons om u toe te laten*
  (`gifts.ts:94-95`).
- **Printed,** the card stands at the top left of the sheet. The print rule asks for the whole
  width (`apps/web/src/index.css:278-284`), but the card keeps its own limit of 512 pixels
  (`Give.tsx:69`), so it is 13.5 centimetres wide. Its paragraphs are 10.5 point and its last
  line 9. No paper size or margin is set.
- **On a phone** the code breaks over two lines on the giver's screen: nineteen characters at
  24 pixels in a box 258 pixels across (`Give.tsx:87`; the page's padding, `Layout.tsx:665`).
- **When the owner stops new gifts** by setting the number each person may give to nought
  (0172 §3.7), the page reads *Gifts you may give: 0. Given: 0.* and under it *You have given
  your gift already* (`Give.tsx:137`, `:172-173`). A small fault, and T5's to mend.

### 3.2 The door

`/redeem` is the request form with the code's field open
(`apps/web/src/AppRoutes.tsx:219`; `apps/web/src/pages/RequestAccess.tsx:223-465`). The
site's gift page arrives the same way (`?gift=1`), and on the plain form *I have a gift code*
opens the field (`:277-305`).

- **It is titled *Request access* / *Toegang aanvragen*,** says *Invite-only for now*, and
  welcomes the reader to the Alpha in an amber note before they have asked for anything
  (`:237-247`).
- **It asks six things** (`:260-390`): an address; the code; a name; an organisation; *What
  are you moving?*, with a hint about mailboxes and sizes; and a package, from five or *Not
  sure yet*. The name, the organisation and the package say *optional*. *What are you moving?*
  does not, though it may be left empty. The route needs the address and the code
  (`RedeemSchema`, `apps/api/src/routes/gifts.ts:196-205`).
- **The code is checked last,** when the whole form is sent. One refusal covers every kind of
  bad code (`GIFT_REFUSAL`, `packages/managed/src/gift-store.ts:185-192`), and nothing is
  written (0172 §3.4). The page shows it as one red sentence above the button, four fields
  below the code (`RequestAccess.tsx:411-422`). The typed code stays in its field, which is
  worth keeping.
- **An address that already has a request waiting** is told so, and the code is not spent
  (409, `GIFT_ALREADY_ASKED`, `gift-store.ts:195-202`; 0172 §7, question 3).
- **Tries are limited** to twenty an hour, for the whole deployment unless it is set to count
  per caller (`GIFT_REDEEM_LIMIT`, `apps/api/src/routes/gifts.ts:55-61`;
  `apps/api/src/knock-limit.ts`). One try too many is answered in English only (`:214-221`).
- **Received** (`RequestAccess.tsx:191-218`): *Thank you — we have your request, with your
  gift* and *You will hear back by email*, then the Alpha's welcome again and a link to sign
  in. No time, no sender, and the address is not shown back.
- **Nothing on the door says who gave the gift.** The giver's name is on the card only.

### 3.3 The two mails

`packages/shared/src/notifications.ts`, composed at `:1672-1693`. They are every request's
mails: neither knows of a gift. Only the operator's own mail does (`fromGift`, `:1559`,
`:1670`). Their words are the owner's text review of 2026-10-10 (#1556).

- **Yes** (EN `:1313-1351`, NL `:1460-1477`), in this order: *Organisation: {name}*, where
  the name is what the person typed, or their address
  (`apps/api/src/routes/access-requests.ts:572`); *One thing left to do*, followed by three;
  *Sign in here*, with the sign-in page's address, which ends in the person's own address
  after a `#` (`packages/shared/src/registration-link.ts:58-60`); *Use this account*; a
  sentence about making an account; and *There is no link or code in this email: it is safe
  to forward*. What that sentence means is that the mail gives nobody access. Then the
  Alpha's paragraph and two addresses: the Alpha conditions and the guide.
- **What holds the yes mail today.** It carries one sign-in address and no token
  (`packages/shared/src/notifications.unit.test.ts:529-562`). Its sentence about backups is
  held to the privacy text: no backups, apart from one copy before each update, kept up to 7
  days (`packages/shared/src/what-the-mails-say.unit.test.ts:68-97`). The Alpha's paragraph is
  held in `apps/web/src/components/an-alpha-said-out-loud.unit.test.tsx`.
- **No** (EN `:1355-1360`, NL `:1478-1481`): the two languages differ. English promises *We
  will inform you when the Alpha has ended*; Dutch does not. A declined request is deleted 30
  days after the decision (`access.privacy`, `apps/web/src/i18n/strings/sign-in.ts:196` /
  `:330`), so nothing is kept to keep that promise with. Both end on the open source. Neither
  says that a declined request gives the giver's gift back, which the privacy text does say
  (`site/legal/privacy.md:969-974`).
- **What holds the no mail today.** Its event is a kind and nothing else, so that the
  operator's note has nowhere to go (`notifications.unit.test.ts:612-632`). Its body holds no
  address, says that a reply reaches a person, and promises no *not yet*, no list and no
  criteria (`:635-666`).
- **What follows the yes mail is not the app's own screen.** *Create your account* is drawn
  only on a page opened from the mail's link. It sends the person to the sign-in service,
  which mails a code to their address (`login.createAccount.as`, `sign-in.ts:54` / `:228`).
  The privacy text says that service keeps a name, a user name and a hash of a password
  (`site/legal/privacy.md:916-924`), so making an account asks for a password. What its
  screens say, word for word, is not in this repository. T0.

### 3.4 The site, and the words

- **The site has a page about the gift** in both languages (`site/pages/nl/cadeau.md`,
  `site/pages/en/gift.md`), in Alpha builds only and out of the menu. It links the door
  (`site/build.mjs:1844`). Nothing links the page: not the card, the door or a mail (0172 §7,
  question 5). It is the one place that says in plain words what a gift is.
- **One thing has eight names** in the Dutch of the card, the door, the mails and the site:
  *een plaats*, *kaart*, *uw code*, *cadeaucode*, *cadeau*, *cadeaukaart*, *plek* and
  *persoonlijke aanbeveling*.
- ***Uitnodiging* is taken.** The Alpha is *op uitnodiging* (`alpha.visitor.line`), and a
  member invites somebody into their own organisation (*Iemand uitnodigen*,
  `apps/web/src/i18n/strings/organisation.ts:459`). The second is nearly the opposite of a
  gift, whose recipient gets an organisation of their own (0172 §2, point 2).
- **The glossary has no row** for a gift (`apps/web/src/i18n/GLOSSARY.md`).
- **The tests that pin today's words:** `apps/web/src/pages/a-gift-on-every-screen.unit.test.tsx`
  (`:182` on, the owner's words of 2026-11-25), `site/site.unit.test.ts` (`:909` on) and
  `packages/managed/src/gift-under-rls.unit.test.ts` (the refusal). Two of them hold *a
  personal recommendation rather than a key* / *geen sleutel*, which D1 takes out.
- **The managed UI smoke** opens the plain request form on a phone
  (`test/ui/managed-ui.ui.test.ts:2096`). It has no entry for `/redeem` or for the giver's
  page, and none in print.

### 3.5 What the desk review found

| # | The finding | Where | Rule | Task |
|---|---|---|---|---|
| 1 | The request form stops the recipient: *Organisation*, *What are you moving?*, a package | The door | R4 | T1 |
| 2 | The code is checked after everything else is typed, and the refusal stands four fields below it | The door | R4 | T1 |
| 3 | The reader is welcomed to the Alpha before anybody has decided | The door, received | R3 | T1 |
| 4 | The card promises *a place*; the same card, and the no mail, take it back | The card, the no mail | R1 | T3 |
| 5 | One thing has eight names | Everywhere | R8 | T3 |
| 6 | Nothing says what the new mailbox costs, or what follows the Alpha | The card, the door | R7 | T3 |
| 7 | The printed card is small, in a corner, with one instruction | The card | R9 | T2 |
| 8 | The yes mail says it holds no link, and holds three; its *one thing left to do* is three | The yes mail | R3 | T4 |
| 9 | The no mail differs per language, promises a message in English, and says nothing of the gift or of the data | The no mail | R3, R6 | T4 |
| 10 | The giver is not told what happens to their gift, how long it takes, or what they will hear | The giver's page | R10 | T5, T10 |
| 11 | Nobody is named after the card: not on the door, not in a mail | The door, the mails | R5 | T9 |
| 12 | Small type, pale edges, small targets | The door, the giver's page | | T6 |
| 13 | In the sketch: a safety rule that was almost true | The card, received, the yes mail | R3 | T3 |
| 14 | In the sketch: a message written for the giver to send | The giver's page | R2 | T5 |
| 15 | In the sketch: *invitation* for something that can be refused | Everywhere | R1 | T3 |
| 16 | In the sketch: a page that says it is Ownpace's, and vouches for a typed name | The door | R5 | T1, T9 |

What the readers asked to keep from today: the card shown as it prints, beside its fields;
a code mended in its own field; *degene die u de kaart gaf*; one line of help on a screen; the
plain fact about backups; and what is kept, in its three cases.

Findings 4 and 10 read differently after D6: nothing is taken back, because the person is let
in; and the giver is told that, and no time.

### 3.6 What letting a person in takes today

D6 asks for it at the door, so this is what the door has to do.

- **A grant is the operator's.** `POST /api/access-requests/:id/grant` writes three things in
  one transaction: the organisation, an invitation for its owner, and the request's own state
  (`apps/api/src/routes/access-requests.ts:574-608`). The owner's row is an invitation, bound
  to the request's address. The person becomes the owner on their first sign-in with an
  address that the sign-in service has verified (`:494-501`).
- **An address that already owns an organisation** gets no second one, unless the operator
  asks for it (`:555-569`).
- **The yes mail goes out after the commit** (`:660-665`).
- **Who decided may be left empty** (`decided_by`, `packages/managed/src/schema-managed.ts:370`),
  and the invitation's origin is *requested* (`:290`).
- **The code's own transaction may do three things:** read its gift, spend it, and write a
  request (`packages/managed/migrations/0065_a_place_given_as_a_present.sql:126-130`;
  `0002_a_door_somebody_can_knock_on.sql:100`). It may not make an organisation or an
  invitation.
- **The operator is mailed for each request with a code:** *Someone has asked for access.
  Nothing has been granted.* and *It came with a gift code; the queue shows whose*
  (`packages/shared/src/notifications.ts:1555-1560`).
- **Setting the number each person may give to nought stops new ones;** cards already made
  keep working (`apps/web/src/i18n/operator-strings.ts:455`).
- **Google's list.** While Ownpace's app at Google is in Google's test phase, Google lets in
  only the addresses on its list of test users (`apps/web/src/components/AlphaGoogleLine.tsx:6-9`).
  A tester mails each Google address to support and waits for an answer
  (`site/pages/en/alpha-guide.md:37-40`; NL `alpha-handleiding.md:68-71`). The privacy text
  says so: a person gives the address, and Ownpace enters it in that list
  (`site/legal/privacy.md:958-959`).
- **Google's list ends at 100, and it counts addresses.** Google's page on getting an app
  ready for production says that an app whose status is *Testing* is *"limited to a hard cap
  of 100 test users"*, and that *"Only users explicitly added to the test user allowlist can
  access the app"*
  (https://developers.google.com/identity/protocols/oauth2/production-readiness/overview,
  opened on 2026-11-26). Google's help page *Manage App Audience* gives the same number
  (https://support.google.com/cloud/answer/15549945; seen in search results on 2026-11-26,
  the page itself could not be opened). The page that was opened does not say whether an
  address that is taken off the list gives its place back.
- **Who is on Google's list.** Each Google address that connects: a member's, each family
  member's whose account the member moves (`site/legal/alpha.md:340-342`), and any address
  the owner tests with. Ownpace takes an address off when the account's data is erased
  (`alpha.md:368-369`).
- **Nothing counts today.** The operator's *Gifts* screen shows how many requests were
  granted, how many wait, and how many cards are unused
  (`apps/api/src/routes/gifts.ts:332-336`; `apps/web/src/pages/Gifts.tsx:96-112`), and says
  under them that nothing refuses a grant past a number
  (`apps/web/src/i18n/operator-strings.ts:452-453`). 0172 kept no cap, because the owner
  counted by hand (§7, question 4 there).
- **Only a grant makes an organisation.** No other route of the product writes one
  (`apps/api/src/routes/access-requests.ts:574`), so the requests that were granted are the
  people the Alpha let in. A request is erased with its account's data
  (`packages/managed/src/offboarding.ts:254-274`), and a card that pointed to it then points
  to nothing (`packages/managed/migrations/0065_a_place_given_as_a_present.sql:69-70`).

## 4. The design in one page

1. **A name that is true** (T3, D1). A free one is a recommendation: the giver tells Ownpace
   that they know somebody, and that is enough. *Gift* is kept for a code that somebody paid
   for.
2. **A door of its own** (T1). A short address. First the code, alone. Then one question.
   Then the address, an optional name, and one question about Google (D14). Then the person
   is in, at once (D6).
3. **A card that reads alone** (T2). A full sheet, large type, three steps that are the
   screens' own, and who to ask.
4. **Two mails that say what happened** (T4), alike in both languages. For a code the yes
   mail goes out at once.
5. **A giver who knows what they hand over** (T5, T10): that the person is let in at once,
   what they will read, and that the giver will see when the code is used.
6. **Two ceilings** (T16, D16): 50 people the owner lets in, and 50 by a recommendation. A
   card is made only while a place is free for it.
7. **Then, with a little data** (step B): who sent it, shown as something to check.
8. **Later** (step C): a paid code at the same door.

## 5. The door (T1)

Serves R1, R3, R4, R5 and R6. One new route. A managed migration that adds no table.

**The address.** `/code`, which reads the same in both languages (D9). The card prints it
(`Give.tsx:48`; `apps/api/src/routes/gifts.ts:81-84`).

**Arriving.** `/redeem` keeps working, for cards already printed, and opens the door. So does
the site's link. On the plain request form, *I have a gift code* becomes a link to the door:
one place checks a code. With a link (D2), the code stands after a `#` and the door puts it
in the field; the reader still presses the button.

**Step 1 of 3: the code, alone.** One `h1`, one field, one button, and one line of help.
Under them: *No code? Ask for access without one*. No address is asked yet, so a mistyped
code costs nothing and sends nothing about the person.

**The check.** `POST /api/gifts/check` takes the code and answers whether it can be used.

- It reads the gift in the code's own transaction, as the redemption does (`withGiftCode`,
  `packages/managed/src/gift-store.ts:330`). It writes nothing and spends nothing.
- It refuses every kind of bad code with one body, the redeem's own (`GIFT_REFUSAL`), so that
  trying codes still learns nothing about which kind it was.
- It shares one limit with `/api/gifts/redeem`. The limit goes from twenty to forty an hour,
  because a person's journey is now two calls where it was one. A script that tries codes gets
  forty an hour against 80 bits (0172 §2, point 4).
- Its yes carries the code's last day, which the card prints anyway, and the bare address the
  service mails from, where one is set (`NOTIFY_FROM`; `apps/api/src/access-notify.ts:232`).
  So the page names no address that the mail does not come from. Step B adds the giver's
  name (T9).
- A good code that the Alpha has no room for is answered apart: the Alpha is full (§20). The
  code is kept, and the page says so before it asks for anything.
- It is an open route, and joins the list of them with its note
  (`apps/api/src/knock-limit.unit.test.ts:197-209`): it writes nothing, and only the holder of
  a code made by somebody already let in gets a yes.

**A refused code is mended where it was typed.** The refusal is a heading above the same
field, tied to it and announced. The code stays in the field. Under the heading stand the
server's sentence, in the page's language, and the page's own line: that the code can be
corrected, and that nothing about the reader has been sent (§7). Too many tries are said in
the page's language.

**Step 2 of 3: what this is, and one question.** One sentence on what Ownpace does. Then,
each a line: that Ownpace is still a trial, called the Alpha; that this code lets the reader
in at once; what it costs and to whom, now and after the Alpha (R7, D5); and that the person
who gave the code will see that it was used (D8). Then the question, with three answers of
one size:

- *Did {giver} tell you about this themselves: by phone, or when you saw each other?* Until T9
  the page has no name, and says *the person you got the code from*.
- *Yes* goes on. *No, not yet* opens a calm screen: ask them first; the code can be used
  later; nothing has been sent. *No, I do not want this* ends calmly: nothing has been sent,
  and the page asks the reader to tell the giver, who can then recommend somebody else.

The answer is not sent and not stored. It is there for the reader who was not told, and
gives them two calm ways out. Under D6 it matters more: nobody reads the request before the
person is in.

**Step 3 of 3: the address.**

- The address, with which address is meant. A name that may be left empty. The address shown
  back in a sentence before the button.
- One question about Google (D14), with two answers of one size: *Is this the email address
  of a Google account that you want to move?* One line of help stands under it: *Gmail is a
  Google account.* The page sends the answer with the address.
- That the code works once, and is used by this step. The button says so: *Use my code*.
- What is kept, in today's words for a request that is granted (`access.privacy`), with the
  privacy text and the Alpha conditions linked under it, as today (0139 T4).
- No organisation, no note and no package: the page draws none and sends none. It sends the
  code, the address, the name if one was typed, the answer about Google, and the page's
  language. The form's trap stays (0093 T2d).

**What the server does with it (D6).** In one transaction, all of it or none:

- the request, written as granted, with nobody named as having decided it;
- the organisation, named after the name the person typed, or else after their address;
- its owner's invitation, bound to the address, as a grant writes it (§3.6);
- the code, spent, and pointing to the request.

**A request that is already waiting (D15 (a)).** If the address has a request waiting, no
second one is written. The waiting one is the one granted, and the code points to it. It
keeps what the person wrote in it. Its organisation is named as a grant names it: after the
organisation the person named, else their name, else the name typed at the door, else the
address (`apps/api/src/routes/access-requests.ts:571-572`). The yes mail goes out in the
door's language. A request that arrives from the same address in the same moment makes the
write fail on the index that allows one waiting request for an address
(`ux_access_request_one_open_per_email`); the door then tries once more, and finds it.

**A yes to the question about Google (D14 (a))** is kept with the request, as one fixed
English line in its note: *Said at the door: this address is a Google account to move.* A
note the person wrote earlier stays above it. A no writes nothing. No column is added.

**The ceiling (D16).** The server counts before it writes, behind one lock. At the ceiling
it writes nothing, keeps the code, and answers that the Alpha is full (§20).

After the commit it sends the yes mail to the person (§8), and a notice to the operator in
new words: somebody was let in with a recommendation, and the queue shows whose. After a yes
to the question about Google the notice says that the address is to be added at Google. The
queue shows the request as let in by a recommendation, and by nobody's decision.

**The migration.** The code's own transaction may today read its gift, spend it and write a
request (§3.6). It must now do four more things, and nothing else: write the organisation;
write the invitation; grant the one waiting request of the address it was given; and learn,
as a yes or a no, whether the Alpha has room. A managed migration lets it: policies, or
functions that run with their definer's rights, for a session that holds an unused code. The
same migration adds the two ceilings to the rule's one row (§20). It adds no table.
`gift-under-rls` holds that a session with no code, with a used one or with somebody else's
can write none of it, and that no session of a code can read how many people are in.

**Three answers that are not a yes.** In each the code is kept, and the page says so in the
server's words (§7).

- **A code that stopped working since step 1** is refused as there.
- **An address that already has access:** the page says so, and offers to sign in.
- **The Alpha is full:** a calm screen, which says until when the code works (§20).

**Let in.** One `h1`: the person is in. Then:

- one thing left, with the button that does it: *Create your account*, which opens the
  sign-in page with the address filled in, as the mail's link does
  (`packages/shared/src/registration-link.ts:58-60`). The sign-in service then mails a code
  to confirm the address;
- that the same was sent by mail, to which address and from which, if it was sent;
- after a yes to the question about Google (D14): that Ownpace adds the address at Google by
  hand and writes when that is done, and that Google does not allow the connection until
  then;
- one exactly true safety sentence (§7), and where to write if the address was mistyped.

**What the door does not show:** the Alpha's welcome (D13; the yes mail carries the owner's
own), a link to sign in before the person is in, or a sentence that says whose page this is.
The address bar says that, and the card says what to expect there (R5). The build stamp and
the accessibility statement stay at the foot, as on every screen (0145 T9 (b)).

**Steps, as a browser and a screen reader meet them:** as *Start a migration* has them and
0176 §5.6 spells out. Each step is a history entry, so the browser's Back goes one step back.
Each has one `h1`, which takes the focus when the step opens. The tab is named after the
step. The step is told in words: *Step 2 of 3*. Back after the person is let in does not use
the code twice.

## 6. The card (T2)

Serves R2, R7, R8 and R9. No schema.

- **It fills the sheet it is printed on.** The print rule lifts the card's own width, sets a
  margin, and sets the type in points: sentences at 14 point or larger, the code at 24 or
  larger. One sheet, upright, on A4 and on Letter. The proof asks the browser, in print, what
  it drew (§14).
- **In this order:** the name of the thing and who it is from; the giver's own message, large,
  because it is the one sentence a careful reader trusts; what Ownpace does; what this card
  does; what it costs and to whom, now and after the Alpha; where to go; three numbered
  steps; the code; who to ask; who Ownpace is; until when the code works.
- **The three steps are the door's three steps:** type the code; answer one question; fill in
  your address. The address to go to stands above them, with *in the bar at the top, not in a
  search box*.
- **The code** stands in a box with a visible edge, on one line at every width. The door reads
  an O as a nought and an I or an L as a one (`readGiftCode`, `gift-store.ts:87-98`), so the
  card explains nothing about them.
- **No square to scan.** It is a link in another form, and the card's worth to a careful
  reader is that it is not one.
- **Who to ask** is the giver by name, and the address the deployment gives for support
  (`supportAddress`, `apps/web/src/components/SupportLine.tsx:44`). With no such address, the
  second half is left out.
- **On the giver's page** the card is shown as it will print, as today, and the code no longer
  breaks on a phone.

## 7. The words (T3)

Serves R1, R2, R3, R7 and R8. The glossary changes first (`GLOSSARY.md`: *Change a word →
change it here first*): one row for the free thing, *recommendation* / *aanbeveling* (D1),
and one that keeps *gift* / *cadeau* for a paid code.

**Rules.** Where the recipient reads, a sentence has one idea and at most fifteen words. The
Dutch is *u*, as 0172's sixth answer has it (D13). No word a reader has to look up: not
*redeem*, *migreren*, *postvakken*, *optioneel*, *tekens* or *betaalgegevens*. *E-mailadres*
is never shortened to *adres*. *Account* means the Ownpace account; what a person has today
is *uw oude mailbox*. No sentence says what a recommendation is not (D1), and none says what
the giver gets (D4): the owner calls the first obvious, and the second is the same kind.

**Whose sentence it is.** A refusal is the server's, in both languages, and the page shows
the half in its reader's language (ADR-0024; `apps/web/src/services/link-refusal.ts:34`). The
rest is the page's. The table says which.

**What goes.** *So a gift is a personal recommendation rather than a key* on the giver's
page (`give.how`), and *A gift is a personal recommendation, not a key* on the site's page,
in both languages, with the tests that pin them (§3.4). *The answer can also be no* is in no
draft any more.

**The sentences,** as drafts for the owner's read. `{giver}` is the giver's name as the card
carries it. The door knows it only after T9; until then it says *the person you got the code
from* / *degene van wie u de code kreeg*. `{support}` is the deployment's support address,
and `{from}` the address the service mails from.

**What the owner has read.** On 2026-11-26 the owner read the Dutch that D6 changed, and
said: *"The G6 Dutch: all ok"*. G6 is D6 here. Those sentences are the rows marked *read*
below, and the yes mail's opening for a code (§8). Every other row is a draft. Later that
day the owner read step A's table of every new or changed Dutch sentence, in #2198: *"Dutch
read 2 (#2198's sentences): ok, as advised"*. Its rows marked *drafted (here)*, the
sentences step A wrote that this table does not give, are the owner's now. Among them are
the door's two field hints, one sentence each as the copy budget holds (0118): *Capitals
and dashes do not matter.* / *Hoofdletters en streepjes maken niet uit.* and *It may be the
email address you use today.* / *Het mag het e-mailadres zijn dat u nu gebruikt.* The first
sentences drafted below for those two are not wanted.

| Where | EN | NL |
|---|---|---|
| Giver, menu and title | *Recommend someone* | *Iemand aanbevelen* |
| Giver, first line | *Recommend someone dear to you for the Alpha, on a card.* | *Beveel iemand die u dierbaar is aan voor de Alpha, op een kaart.* |
| Giver, what it does · *read* | *You tell us that you know this person. That is enough: they are let in at once.* | *U zegt ons dat u deze persoon kent. Dat is genoeg: die persoon wordt meteen toegelaten.* |
| Giver, fact | *They get an account of their own. You do not see what is in it.* | *Die persoon krijgt een eigen account. U ziet niet wat erin staat.* |
| Giver, how many | *People you may recommend: {limit}. Recommended: {held}.* | *Mensen die u mag aanbevelen: {limit}. Aanbevolen: {held}.* |
| Giver, hand it over · *read* | *Give the card yourself. Whoever has the code is let in.* | *Geef de kaart zelf. Wie de code heeft, wordt toegelaten.* |
| Giver, tell first | *Tell them first: by phone, or when you hand it over.* | *Vertel het eerst zelf: aan de telefoon, of als u het geeft.* |
| Giver, shown once | *The code is shown only now. Lost it? Withdraw it below and make a new one.* | *U ziet de code alleen nu. Kwijt? Trek hem hieronder in en maak een nieuwe.* |
| Giver, what you will see | *You will see here when it is used. The person is then in.* | *U ziet hier wanneer hij is gebruikt. Die persoon is dan toegelaten.* |
| Giver, the list | *Not used yet* · *Used on {date}: let in* · *Withdrawn* · *Expired* | *Nog niet gebruikt* · *Gebruikt op {date}: toegelaten* · *Ingetrokken* · *Verlopen* |
| Giver, what is kept | *We never receive the name or the message on the card. We keep that you recommended someone, a fingerprint of the code, the card's language, its dates, and which request it became.* | *Wij ontvangen de naam en de boodschap op de kaart nooit. Wij bewaren dat u iemand aanbeval, een vingerafdruk van de code, de taal van de kaart, de datums, en welke aanvraag het werd.* |
| Giver, the link (D2) | *Or send a link. Say in your own words what it is.* | *Of stuur een link. Zeg in uw eigen woorden wat het is.* |
| Giver, none for now | *No new recommendation can be made for now.* | *U kunt nu even geen aanbeveling maken.* |
| Giver, none for now, the Alpha is full (D16) | *The Alpha is full for now. No new recommendation can be made.* | *De Alpha is nu vol. U kunt nu geen aanbeveling maken.* |
| Giver, none during the Alpha, let in by a recommendation (D18) | *During the Alpha, only the people Ownpace let in itself can recommend someone. After the Alpha, you can too.* | *Tijdens de Alpha kunnen alleen de mensen die Ownpace zelf toeliet iemand aanbevelen. Na de Alpha kunt u dat ook.* |
| Card, title | *A recommendation from {giver}* | *Een aanbeveling van {giver}* |
| Card, what Ownpace does | *Ownpace copies your mail, calendars, contacts and files to a European provider. You switch from Google or Microsoft at your own pace. Until then Ownpace keeps the copy up to date.* | *Ownpace kopieert uw e-mail, agenda's, contacten en bestanden naar een Europese aanbieder. U stapt over van Google of Microsoft in uw eigen tempo. Tot dan houdt Ownpace de kopie bij.* |
| Card, what this card does · *read* | *Ownpace is in a free Alpha. With this card you are let in at once.* | *Ownpace zit in een gratis Alpha. Met deze kaart wordt u meteen toegelaten.* |
| Card and door, cost | *Ownpace charges nothing during the Alpha. Your new mailbox is at a European provider. You pay that provider for it, not Ownpace.* | *Tijdens de Alpha kost Ownpace niets. Uw nieuwe mailbox staat bij een Europese aanbieder. Daarvoor betaalt u die aanbieder, niet Ownpace.* |
| Card and door, after the Alpha (D5) | *After the Alpha there are paid packages and a free one. You pay nothing before you have accepted the new conditions.* | *Na de Alpha zijn er betaalde pakketten en een gratis pakket. U betaalt niets voordat u de nieuwe voorwaarden hebt geaccepteerd.* |
| Card, where | *Go to {address}. Type it in the bar at the top, not in a search box.* | *Ga naar {address}. Typ dit bovenaan in de adresbalk, niet in een zoekvak.* |
| Card, the steps | *1. Type the code from this card. 2. Answer one question. 3. Fill in your email address.* | *1. Typ de code van deze kaart. 2. Beantwoord één vraag. 3. Vul uw e-mailadres in.* |
| Card, help | *Need help? Ask {giver}. Or write to {support}: a person reads it.* | *Hulp nodig? Vraag het {giver}. Of schrijf naar {support}: daar leest een mens uw bericht.* |
| Card, who | *Who Ownpace is: {site}* | *Wie Ownpace is, leest u op {site}* |
| Card, until | *The code works once, until {date}.* | *De code werkt één keer, tot {date}.* |
| Door, step 1 | *Type your code* | *Typ uw code* |
| Door, the field | *The code* · *As on the card. Capitals and dashes do not matter.* | *De code* · *Zoals op de kaart. Hoofdletters en streepjes maken niet uit.* |
| Door, no code | *No code? Ask for access without one.* | *Geen code? Vraag toegang aan zonder code.* |
| Door, refused, the heading | *This code does not work* | *Deze code werkt niet* |
| Door, refused, the server's | *This code cannot be used. It may have been typed wrong, used already, withdrawn, or it may have expired. Check it against the card, or ask the person who gave it to you.* | *Deze code kan niet worden gebruikt. Misschien is hij verkeerd getypt, al gebruikt, ingetrokken of verlopen. Vergelijk hem met de kaart, of vraag het aan degene die u de kaart gaf.* |
| Door, refused, the page's line | *You can correct the code below. Nothing about you has been sent.* | *U kunt de code hieronder verbeteren. Er is niets over u verstuurd.* |
| Door, too many tries, the server's | *That is more tries than we expected from one place. Try again later. Nothing is lost.* | *Dat waren meer pogingen dan wij van één plek verwachten. Probeer het later opnieuw. Er gaat niets verloren.* |
| Door, step 2, the Alpha | *Ownpace is still a trial. It is called the Alpha.* | *Ownpace is nog een proef. Die heet de Alpha.* |
| Door, step 2, what the code does | *With this code you are let in at once.* | *Met deze code wordt u meteen toegelaten.* |
| Door, step 2, what the giver sees | *{giver} will see that the code was used.* | *{giver} ziet dat de code is gebruikt.* |
| Door, the question | *Did {giver} tell you about this themselves: by phone, or when you saw each other?* | *Heeft {giver} u hier zelf over verteld: aan de telefoon, of toen u elkaar zag?* |
| Door, answers | *Yes* · *No, not yet* · *No, I do not want this* | *Ja* · *Nee, nog niet* · *Nee, ik wil dit niet* |
| Door, not yet | *Then ask them first. You can use the code later, until {date}. Nothing has been sent.* | *Vraag het dan eerst na. U kunt de code later gebruiken, tot {date}. Er is niets verstuurd.* |
| Door, no thank you | *That is fine. Nothing has been sent. Tell {giver}: they can then recommend someone else.* | *Dat mag. Er is niets verstuurd. Vertel het {giver}: die kan dan iemand anders aanbevelen.* |
| Door, step 3, the address | *Your email address* · *You sign in with it. It may be the email address you use today.* | *Uw e-mailadres* · *Daarmee meldt u zich aan. Het mag het e-mailadres zijn dat u nu gebruikt.* |
| Door, the name | *Your name (you may leave this empty)* | *Uw naam (mag, hoeft niet)* |
| Door, the question about Google (D14) | *Is this the email address of a Google account that you want to move?* | *Is dit het e-mailadres van een Google-account waar u weg wilt?* |
| Door, its answers, and its line of help | *Yes* · *No* · *Gmail is a Google account.* | *Ja* · *Nee* · *Gmail is een Google-account.* |
| Door, shown back | *We send an email to {email}. The code works once: after this step it is used.* | *Wij sturen een e-mail naar {email}. De code werkt één keer: na deze stap is hij gebruikt.* |
| Door, the button | *Use my code* | *Gebruik mijn code* |
| Door, already has access, the server's | *This email address already has access to Ownpace. Your code is not used. Sign in with that email address.* | *Dit e-mailadres heeft al toegang tot Ownpace. Uw code is niet gebruikt. Meld u aan met dat e-mailadres.* |
| Door, the Alpha is full, the heading (D16) | *The Alpha is full for now* | *De Alpha is nu vol* |
| Door, the Alpha is full, the server's | *Nobody can be let in with a code right now. Your code is not used.* | *Met een code kan nu niemand worden toegelaten. Uw code is niet gebruikt.* |
| Door, the Alpha is full, the page's line | *Keep your code. You can try again later, until {date}. Nothing about you has been kept.* | *Bewaar uw code. U kunt het later opnieuw proberen, tot {date}. Er is niets over u bewaard.* |
| Let in · *read* | *You are in* | *U bent toegelaten* |
| Let in, what is left · *read: its first sentence* | *One thing is left: make your account. The sign-in service mails a code to {email}. With it you confirm that the address is yours.* | *Er is nog één ding te doen: maak uw account aan. De aanmeldservice mailt een code naar {email}. Daarmee bevestigt u dat het e-mailadres van u is.* |
| Let in, the button | *Create your account* | *Maak uw account aan* |
| Let in, the mail | *We also sent you an email, from {from}. It says the same.* | *Wij hebben u ook een e-mail gestuurd, vanaf {from}. Daarin staat hetzelfde.* |
| Let in, and the yes mail, after a yes about Google (D14) | *You want to move away from Google. We add {email} to a list at Google by hand, and write to you when that is done. Until then Google does not allow the connection.* | *U wilt weg bij Google. Wij zetten {email} met de hand op een lijst bij Google, en schrijven u als dat is gebeurd. Tot dan laat Google de koppeling niet toe.* |
| Let in, safety | *Ownpace never asks for your password by email or phone.* | *Ownpace vraagt nooit per e-mail of telefoon om uw wachtwoord.* |
| Let in, a mistyped address | *Is {email} not right? Write to {support}.* | *Klopt {email} niet? Schrijf naar {support}.* |

**What the drafts keep of the owner's words.** *Iemand die u dierbaar is* and *op een kaart*;
*Ownpace zit in een gratis Alpha*; the refusal, whole, with *cadeaucode* become *code*; and
*aanbeveling*, which becomes the name. The card's sentence about what Ownpace does says what
it says today, *in uw eigen tempo* included, in three sentences where the Dutch was one of 27
words.

**What D15 took out.** The owner's sentence for a request that is already waiting, kept as
built on 2026-11-25. Under D15 (a) that request is granted, so nothing is left to say it of.

**What D6 took out of the owner's words.** *En we laten mensen zelf toe. Met deze kaart
vraagt u ons om u toe te laten* (2026-11-25) said that Ownpace decides. Under D6 the card
lets the person in, so the card says that. The owner read the new sentence on 2026-11-26.

**One line is new under D6, and is this plan's reading:** *Give the card yourself. Whoever
has the code is let in.* It is not the sentence D1 took out. That one said what a
recommendation is not. This one tells the giver what the code does, now that nobody reads a
request first. The owner read its Dutch on 2026-11-26, and it stays.

**Where three of them come from.**

- **The safety sentence** is the second half of one the app has (`grant.password.never`,
  `apps/web/src/i18n/strings/grant.ts:204` / `:395`). Its first half, *never emails you a
  link*, is true of a person on a grant link and untrue here: the yes mail holds one. The
  sketch said *never asks for a password or for money*, which making an account and an
  invoice both contradict (R3).
- **The cost** restates the site, *an account you open with a European provider, paid to
  them* (`site/copy.mjs:149`), and the app's *Nothing is charged during the Alpha*
  (`alpha.nothingCharged`). What follows the Alpha restates the Alpha conditions, §11
  (`site/legal/alpha.md:372-384`): new conditions, sent ahead, and nothing carries on before
  they are accepted. That is D5 said to the recipient: the recommendation gives the free
  Alpha, and no free use after it.
- **The Google sentence** says what the tester guide says today (§3.6), at the moment the
  person needs it. The question before it is D14 (a)'s, with *address* become *email
  address*. The Dutch avoids every form of *verhuizen*, as the glossary asks, and says *waar
  u weg wilt*.
- **The sentences for a full Alpha** are new, and this plan's (§20). They say *let in*, as
  the card does, and name no place: *plaats* was one of the eight names.

## 8. The two mails (T4)

Serves R1, R2, R3, R6, R7 and R8. Both are every request's mails, and their faults are the
mails' own, so they are mended for every request. The owner chose both proposals (D11 (a),
D12 (a)) and still reads the Dutch. No schema.

**What stays as it is,** and the proofs that hold it: one sign-in address in the yes mail and
no token; the sentence about backups, with its one copy and its 7 days; the Alpha's paragraph
and its two addresses, word for word; no address in the no mail; a reply that reaches a
person; no promise the service cannot keep. The subjects stay.

**What D6 changes for the mails.**

- **For a code, the yes mail goes out at once,** from the door (§5). It says in its first
  line that the person used a code from somebody they know. The door passes that to the mail
  as one true-or-false. After T9 the mail names the giver.
- **After a yes to the question about Google** (D14) the mail carries the sentence the last
  screen shows (§7), so that the two say the same. That is a second true-or-false.
- **A request that was waiting and is granted by a code** (D15) gets this mail too, in the
  door's language.
- **A request without a code still waits for the owner,** and gets the yes mail or the no
  mail as before, in the new texts.
- **No no mail is ever sent for a code,** so the no mail says nothing about a recommendation.
  Its event stays a kind and nothing else, and the proof that it has nowhere for the
  operator's note is not touched (`notifications.unit.test.ts:612-632`). A request with a
  code that was already waiting when step A ships is the owner's to answer as before; if it
  is declined, the giver still gets the gift back (0172), and the mail is the plain one.

**Yes, as the owner chose it (D11 (a)).** In this order:

1. What happened. For a request: that the person asked, and the answer is yes. For a code:
   that they used a code from somebody they know, and are in.
2. Three numbered steps: open the sign-in page with the mail's link; choose *Create your
   account*, with the address the mail names; choose a password, after which the sign-in
   service mails a code to confirm the address. T0 gives the third step the service's own
   words.
3. Under the link, why it ends in the person's own address: so that the page can fill it in.
4. The guide's address, before the person starts.
5. What the account is called. *Organisation: {name}* becomes a sentence that explains the
   word, as the privacy text does (§4.4): *in the app your own space is called an
   organisation; yours is called {name}*.
6. The Alpha's paragraph and the conditions' address, unchanged.

*There is no link or code in this email: it is safe to forward* goes from this mail. It holds
a link, and a mail that calls itself safe is what a false one says too (R2). The mail that
invites a member into an organisation keeps the sentence: that mail is not this plan's (§17).

| | EN | NL |
|---|---|---|
| Opens, for a request | *You asked Ownpace for access. The answer is yes.* | *U vroeg Ownpace om toegang. Het antwoord is ja.* |
| Opens, for a code · *read* | *You used a code from someone you know. You are in.* | *U gebruikte een code van iemand die u kent. U bent toegelaten.* |
| Step 1 | *Open the sign-in page with this link:* | *Open de aanmeldpagina met deze link:* |
| Under it | *The link ends in your own email address. That lets the page fill it in for you.* | *De link eindigt op uw eigen e-mailadres. Zo kan de pagina het voor u invullen.* |
| Step 2 | *Choose "Create your account". Use this email address:* | *Kies 'Maak uw account aan'. Gebruik dit e-mailadres:* |
| Step 3 | *Choose a password. The sign-in service then mails a code to this email address. With it you confirm that it is yours.* | *Kies een wachtwoord. De aanmeldservice mailt daarna een code naar dit e-mailadres. Daarmee bevestigt u dat het van u is.* |
| The guide | *Read the guide before you start:* | *Lees de handleiding voordat u begint:* |
| The name | *In the app your own space is called an organisation. Yours is called:* | *In de app heet uw eigen ruimte een organisatie. De uwe heet:* |

The owner read the Dutch of the opening for a code on 2026-11-26 (§7). The other rows are
drafts.

**No, as the owner chose it (D12 (a)).** One text, the same in both languages:

1. What the person asked for.
2. That Ownpace cannot let them in now. No reason is given.
3. That the request is kept for 30 days and then deleted.
4. That Ownpace is open source, and can be run by the person themselves.
5. That a reply to the mail reaches a person.

No promise of a later message.

| | EN | NL |
|---|---|---|
| Opens | *You asked Ownpace for access. We cannot let you in now.* | *U vroeg Ownpace om toegang. Wij kunnen u nu niet toelaten.* |
| The data | *We keep your request for 30 days and then delete it.* | *Wij bewaren uw aanvraag nog 30 dagen en verwijderen die daarna.* |
| The open source | *Ownpace is open source: you can also run it yourself.* | *Ownpace is open source: u kunt het ook zelf draaien.* |
| Closes | *Do you think we misunderstood you? Reply to this email. A person reads it.* | *Denkt u dat wij u verkeerd begrepen? Beantwoord deze e-mail. Een mens leest uw antwoord.* |

**The operator's notice,** English only, gets new words for a code: *Someone was let in with
a recommendation. Nothing is waiting for you. The queue shows whose it was.* It names the
address, as today's notice does (`packages/shared/src/notifications.ts:1664`). After a yes to
the question about Google (D14 (a)) it adds: *They said this address is a Google account
they want to move. Add it to Google's list of test users, then write to them.*

**T0, the owner's hand test.** From the yes mail to the first screen after signing in, on a
real phone, in Dutch and in English. Written down word for word: what each screen of the
sign-in service says and asks for; whether a person who types the sign-in page's address by
hand finds a way to make an account there; and what the first signed-in screen shows. It
blocks nothing. The yes mail's third step takes its words when they are known.

## 9. The giver's page (T5, T10)

Serves R1, R2, R3 and R10. No schema.

- **What it does, first and at reading size,** in §7's words: you tell us you know somebody;
  that is enough, and they are let in at once; they get an account of their own.
- **How many, and that the card is the way in.** How many people the member may recommend,
  and that whoever has the code is let in, so the card is given by hand.
- **What the giver will see afterwards** (T10, D8): each card's state in words, with the day
  it was used. *Used* means *let in*. The list's answer already holds that day (§3.1), so
  this is words and no data.
- ***Tell them first* is advice.** One line, no tick box: a box would force an untruth on a
  giver who tells the other person at the hand-over.
- **The card is shown as it prints,** with the three fields that stay in the browser, as
  today. *We never ask who it is for* becomes what is true: *we never receive it*.
- **A link, beside the card** (D2). The page gives the link and one line: *say in your own
  words what it is*. It writes no message. The link carries the code after a `#`, so that the
  code is in no request on its way in, and the door reads it from there.
- **One fold, *What they will see*:** the door's three steps, the mail and the account, in a
  few lines. The giver's name stands on the card as the person to ask, so the giver must know
  what is asked of them.
- ***Shown only now* gets its other half:** a lost code is withdrawn and made again, which is
  true today (0172 §7, question 1). Under D6 it is also how a lost card is stopped.
- **When no card can be made** the page says *none for now*, and offers no button: when the
  number each person may give is nought (D7), and when the Alpha has no place left for a new
  card (D16, §20). During the Alpha a member let in by a recommendation reads §20.7's
  sentences there instead (D18).
- **A link to the site's page,** the follow-up 0172's fifth answer left.
- **Nothing about what the giver gets** (D4): they get nothing, and the page does not say so.

## 10. Size, contrast and targets (T6)

On the door, its endings and the giver's page, by 0176 §13's figures, which were worked out
from the app's own palette:

- Sentences at 18 pixels, and nothing under 16.
- A main button at least 60 pixels high, and as wide as the column on a phone. Every other
  target that stands alone at least 44 by 44. Three answers to one question are one size.
- Sentences at 7 to 1 or better. A field's edge, and an outlined button's, at 3 to 1 or
  better, where today's `gray-300` is 1.5.
- Focus that can be seen.
- Nothing sideways at 320 pixels wide, and nothing cut off at 200% zoom.
- The language switch says *English* and *Nederlands* here, as 0176's T9 builds it.

## 11. What follows (T7)

- **The glossary:** the two rows of §7.
- **The site's page** in both languages says what the door says, under the same name, and no
  longer says *not a key*. The door links it as *read more*, and so does the giver's page. Its
  two addresses stay; its link to the door is `/code` (`site/build.mjs:1844`). The words
  pinned in `site/site.unit.test.ts` change with it.
- **The privacy text** (`site/legal/privacy.md` §4.4 and §9, and the Dutch), with step A now:
  the name of the thing; that a code lets a person in at once; that the giver sees that it
  was used, where the text now says the giver can tell a decline; and that a person can say
  at the door that their address is a Google account, which Ownpace then enters in Google's
  list (D14). With step B: that the giver's name is shown to
  whoever holds the code. T7 asks the owner whether the texts are still changed in place
  under 1.0 before it changes them, as 0176's T10 does. **Answered** (Q1, 2026-11-26):
  *"Q1: yes"*, in place under 1.0, once the lawyer has read it. Step A's drafts (#2198) are
  on the lawyer's list; nothing in `site/legal` changes before that.
- **Plan 0172** gets one dated line in its Status: its G1 is changed by D6 here, and its
  answer that there is no cap by D16.
- **The tester guide's *Google addresses first*** (§3.6) says the door's way too (D14): a
  person who came in with a code and said yes there need not mail that address again.
- **`docs/ending-the-alpha.md`:** what a recommendation is after the Alpha (D5, §13), and
  that the two ceilings are the Alpha's.
- **The operator's *Gifts* screen** and the access queue, English only: the free thing's
  name, a request that is let in by a recommendation, and the two ceilings with their counts
  (§20).
- **`apps/api/docs/openapi.yaml`:** the new route, a ninth beside 0172's eight, the redeem's
  new answers, and the ceilings in the operator's answers.
- **`CHANGELOG.md`**, per step.

## 12. Step B: who sent it

**T9, who sent it (D3 (a)).** The door names the giver once the code is known, and the yes
mail does. Under D6 the name stands on the door before the person is let in, which is when
it helps.

- The name is the one 0176's T3 keeps for a member, *as the people they send links to know
  them*: asked once, and not typed per card. A member with no name yet is asked for it before
  their first card, in that same field.
- It is shown as something to check, under the label *Sender*, and never as proof: a false
  page would print a name too, which is why the question of §5 stays (R5).
- The check's yes carries the name and nothing else of the giver. How an open door may read
  one member's name is T9's to build under the database's own rules: a function that answers
  the name for the code it was given, and nothing else. `gift-under-rls` holds it.
- A card made by a member who has no name shows no sender, and the door says *the person you
  got the code from*, as in step A.
- If 0176's T3 is not built yet, T9 waits for it.

**T10, what the giver hears (D8 (a)), is in step A now.** It was advised for step B because
*let in* needed a column: the gift's row knew a decline and not a grant. Under D6 there is no
decline: a recommendation that is used has let its person in. *Not let in* has nothing left
to say for a recommendation. So the giver's list says it in words (§9), with no new data.
This is the plan's reading of D6 and D8 together.

**T11, a receipt (D10 (a)), is met in step A.** The receipt was a mail sent at once, saying
that the request arrived and from which address the answer would come. Under D6 the answer
itself goes out at once: the yes mail. Nothing is left for a second mail to say. This too is
the plan's reading.

## 13. Step C: after the Alpha

**T12.** The same door takes a code that somebody paid for, and says so: what was bought, who
paid, and that the reader fills in no payment details. *Gift* is that code's word. 0172's G2
decides what it buys. This plan only keeps the door fit for it: the check's answer can then
say which kind a code is, and nothing in step A's words would have to be taken back.

**What a recommendation is after the Alpha (D5).** In the owner's words it was *free when it
was free*. So, as this plan reads it:

- A recommendation made during the Alpha gives the free Alpha. It does not make Ownpace free
  after it. A person who came in with one gets the new conditions like everybody else
  (the Alpha conditions, §11).
- One that nobody has used when the Alpha ends still works until its date. It is then a way
  in that says who sent the person, and it gives nothing that is not free for everybody.
- The giver may turn it into a paid code (§1). How is step C's, with payments.
- The two ceilings are the Alpha's (§20). What limits a recommendation after it is step C's
  to say.

## 14. Proofs (T8)

Each written first, to fail on `main` for the reason it names.

- **`apps/web/src/pages/a-code-with-a-door-of-its-own.unit.test.tsx`.** The first step holds
  one field and asks no address. A refused code stays in its field, under a heading that is
  tied to the field and announced; nothing else was asked. The third step has two fields, and
  no organisation, note or package is drawn or sent. It asks the question about Google, with
  two answers of one size, and sends the answer. The address is shown back before the
  button, with the sentence that the code is used by this step. After it the page says the
  person is in, and holds *Create your account* with the address filled in. An address that
  already has access keeps its code, and the page says so. A full Alpha is a calm screen
  with the code's last day, at the first step and at the third. Too many tries are said in
  Dutch on the Dutch page. `/redeem` opens the door, and so does the plain form's link. No
  welcome stands on the door. Fails today on the six fields.
- **`apps/api/src/routes/gifts.unit.test.ts`,** new cases. The check writes nothing and
  spends nothing. Each kind of bad code gets the one body. The check and the redeem share one
  limit. Its 429 has a Dutch half. An accepted code is answered as let in, and the yes mail
  and the operator's notice are sent after the commit, never before. A yes to the question
  about Google is the one fixed line in the request's note, and reaches the notice; a no
  writes nothing. A filled trap is answered as let in, and nothing is written.
  **`apps/api/src/knock-limit.unit.test.ts`** lists the route.
- **`apps/api/src/routes/a-gift-turned-into-a-request.unit.test.ts`** turns round: a code
  makes a request that is granted, an organisation and its owner's invitation, or none of
  the three. An address with a request waiting gets that one granted, and no second one.
  Never a seat in the giver's organisation, as today.
- **`apps/api/src/routes/an-alpha-with-two-ceilings.unit.test.ts`,** new. Each count is
  §20.1's: a request a card points to is never one of the owner's. No card is made while
  the people let in by a recommendation and the cards not used yet fill the second number.
  At that number the check and the redeem answer that the Alpha is full, and nothing is
  written or spent. Two codes at the last place let one person in. A number set under the
  count takes nobody out. The operator's answer carries both counts and both ceilings.
  Nothing refuses the owner's grant past the first number (D17). During the Alpha a member
  let in by a recommendation has a limit of nought and is refused a card, and after it is
  not (D18). Fails today on the absent numbers.
- **`packages/managed/src/gift-under-rls.unit.test.ts`,** new cases, on a real database where
  the suite runs one. A session that holds an unused code can write its own organisation and
  invitation, once. A session with no code, a used one, a withdrawn one or somebody else's
  can write none of it, and can read nobody's. No session of a code can read how many people
  are in: it learns a yes or a no. A member's session learns whether it came in by a
  recommendation, its own yes or no, and nobody else's (D18).
- **`apps/web/src/i18n/one-name-for-a-free-gift.unit.test.ts`.** No sentence of the card, the
  door, the giver's page, the two mails or the site's page calls the free thing a *gift* or a
  *cadeau*, a *place* or a *plaats*; each says *recommendation* or *aanbeveling*; and none
  says *key* or *sleutel*. Fails today on eight names.
- **`apps/web/src/pages/a-gift-on-every-screen.unit.test.tsx`** moves with the words. Its
  case for the owner's words gets a new date and the sentences the owner read. New cases: the
  giver's page says that the person is let in at once, and that whoever has the code is; it
  has no tick box; a used card says the day and *let in*; with a limit of nought, and with
  a full Alpha, it says *none for now* and not *already given*, which fails today; with
  `onlyAfterAlpha` it says §20.7's sentences instead (D18). The operator's *Gifts* screen
  shows both counts with their ceilings and the two fields, and §20.6's sentence in place of
  `gifts.count.noCap`. **`AccessRequests.unit.test.tsx`:** the queue shows the owner's line,
  and a grant past it is not refused. **`Support.unit.test.tsx`:** the Alpha's overview,
  with its three counts and no names (D17).
- **`packages/shared/src/notifications.unit.test.ts`** and **`what-the-mails-say.unit.test.ts`,**
  new cases. The yes mail has no sentence saying it holds no link, and its steps are
  numbered. For a code it says so in its first line, and after a yes about Google it
  carries that sentence. The no mail's two languages say the
  same things: the same paragraphs, the 30 days in both, a promise of a later message in
  neither. Fails today on all four. The cases of §8's *What stays as it is* stay green, and
  the no mail's event is still a kind and nothing else.
- **The card in print,** a case in the managed UI smoke, which gains entries for the giver's
  page and the door. In print: the card is at least nine tenths of the page's width, no text
  is under 14 point, and the code is on one line. On a phone at 390 and at 320 pixels: the
  code is on one line. Fails today on 10.5 point and on the broken code.
- **Sizes on the door,** in the same smoke: no text under 16 pixels, each target and edge as
  §10 says, nothing sideways at 320 pixels.
- **`site/site.unit.test.ts`:** the page's words, and that the door's *read more* is a file
  the site writes.
- **With step B:** `gift-under-rls`, for the one name an open door may read;
  `a-gift-that-keeps-no-recipient`, still green.

Gates before a step is called done: lint, typecheck, the unit tests, the UI smoke.
`CHANGELOG.md` in both languages. E2E is the maintainer's to dispatch.

## 15. The owner's decisions (T13, T15, T17)

### 15.1 Answered on 2026-11-26: D1 to D13

For each: what was asked, the owner's words, and what they change. Where a consequence is
this plan's reading and not the owner's words, it says *reading*.

- **D1. What the free thing is called.** (a) A *recommendation* / *aanbeveling*. (b) An
  *invitation* / *uitnodiging*. (c) A *gift* / *cadeau*, as today. The owner:
  *"aanbeveling (recommendation). Don't mention 'geen sleutel', thats obvius)"*. **So:** (a),
  everywhere §7 lists. Every sentence that says a recommendation is not a key goes: on the
  giver's page and on the site's page, with their tests (§7). *Cadeau* is the paid code's
  word.
- **D2. A code on a card, a link, or both.** The owner: *"both"*. **So:** the card first, and
  a link that the giver sends in their own words (§9). The page writes no message.
- **D3. Does the door say who sent it.** The owner: *"yes"*. **So:** (a), the giver's name,
  shown as something to check, in step B (T9).
- **D4. Does recommending give the giver anything.** The owner: *"no"*. **So:** nothing.
  *Reading:* the page does not say so either. The owner's note on D1 argues against stating
  the obvious, and no reader of the review needed the sentence. The owner reads the Dutch.
- **D5. What a recommendation is after the Alpha.** The owner: *"free when it was free. given
  during free-alpha doesn't make it free unlimited after alpha."* **So:** a free one gives
  what was free, the free Alpha. *Reading:* it works until its date; after the Alpha it gives
  nothing that is not free for everybody (§13). The card and the door say what follows the
  Alpha (§7).
- **D6. May the door name a time for the answer.** The owner: *"The free giving is limited in
  alpha to 1, so one needs to be allow in straight away. I do however have to add one's google
  account if they have it, so the google oauth client works."* **So:** the question falls
  away, and more changes than it asked. A recommended person is let in straight away, without
  a review (§5). The one step by hand is the owner's: adding the person's Google address to
  Google's list of test users. *Reading,* worked out in this plan:
  - the door and its last screen: §5 and §7;
  - the mails: §8. A request without a code still waits for the owner;
  - the server: §5, with a managed migration that adds no table and no column;
  - the giver's page: *not let in* is no longer needed for a recommendation (§12, T10);
  - how the owner learns of a Google address, and what the person sees until it is added:
    D14;
  - what it leaves open: D14, D15 and D16.
- **D7. What the giver's page says when nobody is being let in.** The owner: *"yes,
  adviced."* **So:** (a). When the number each person may give is nought the page says *none
  for now*, with no button. *Reading:* the other half of (a), that the answer can always be
  no, is not built. D6 made it untrue of a recommendation.
- **D8. What the giver gets to know.** The owner: *"yes, adviced."* **So:** (a), in words,
  and the recipient reads the same before they use the code. *Reading:* under D6 the words
  are *used* and *let in*, they need no data, and they are built with step A (§12).
- **D9. The address on the card.** The owner: *"yes, adviced."* **So:** (a), `/code`.
  `/redeem` keeps working.
- **D10. A receipt by mail.** The owner: *"yes"*. **So:** (a). *Reading:* under D6 the yes
  mail goes out at once and is the receipt (§12, T11).
- **D11. The yes mail.** The owner: *"a"*. **So:** §8's text, for every request.
- **D12. The no mail.** The owner: *"a"*. **So:** §8's text. The promise to write when the
  Alpha ends goes. *Reading:* under D6 no no mail is sent for a code, so its line for a code
  is not built, and the line about the open source stays in the one text that is left.
- **D13. Two readings to confirm.** The owner: *"both, as stated"*. **So:** the card and the
  door stay *u*. The Alpha's welcome leaves the code's door; the plain request form keeps it.
  *Reading:* the door's last screen now comes after the answer, and still carries no welcome
  of its own: the yes mail carries the owner's.

### 15.2 Answered on 2026-11-26, later: D14 to D16

As §15.1: what was asked, the owner's words, what they change, and *reading* where it is one.

- **D14. How Ownpace learns of a Google address to add.** (a) The door asks one question on
  its third step. (b) As for every tester today: the person mails the address to support
  first, and waits. (c) A Gmail address is recognised by its ending and added unasked. The
  owner: *"a"*. **So:** the door asks, with two answers of one size. A yes is kept with the
  request, in fixed words. The owner's notice names the address. The person reads that
  Google does not allow the connection until Ownpace has written (§5, §7, §8). Any other
  Google address is mailed to support, as the guide says.
- **D15. An address that already has a request waiting.** (a) The code lets that person in
  too: the request that waits is the one granted. (b) As today: the door says so and keeps
  the code. The owner: *"a"*. **So:** (a), in §5. The door's sentence for a waiting request
  goes, and so does that answer of the route.
- **D16. A ceiling, now that nobody reads a recommendation first.** (a) None. (b) A number
  the owner sets: at it the door lets nobody in, says so, and keeps the code. The owner:
  *"alpha limited to 50 people I let in, en 50 max someone invites (each let in user 1
  invite)."* **So:** a ceiling, with numbers: 50, 50 and 1. *Reading,* all of it worked out
  in §20:
  - the Alpha holds at most 50 people the owner lets in, and at most 50 let in by a
    recommendation;
  - each person let in has one recommendation: the number each person may give is 1, as it
    is today;
  - 50 and 50 is 100, the length of Google's list of test users (§3.6). The two numbers
    count people and Google counts addresses, so the two are not the same thing (§20.5);
  - at the second ceiling the door lets nobody in by a code, says so, and keeps the code;
  - a card is made only while a place is free for it, so that a card on paper stays true;
  - the people already in count; a test address counts like anybody's; and both numbers are
    settings on the operator's *Gifts* screen, 50 unless the owner changes them;
  - what it leaves open: D17 and D18, answered later the same day (§15.3).
- **Whether step A is built now, beside 0176's step A.** The owner: *"yes"*. **So:** builders
  start once this plan is merged (§19, §21).

### 15.3 Answered on 2026-11-26, later still: D17 and D18

As §15.2: what was asked, the owner's words, what they change, and *reading* where it is one.

- **D17. The owner's own 50: a 51st yes refused, or the number only shown.** Until now the
  owner counted by hand, and the operator's screen says that nothing refuses a grant past a
  number (§3.6). (a) Refused: at the number, the owner's next yes is answered with one
  sentence that names the number and where to raise it, and nothing is written. (b) Only
  shown: *People you let in: n of 50*, on the queue and on the *Gifts* screen, and nothing
  is refused. The advice was (a). The owner: *"(refuse a 51st): no, ik will count. But you
  add oversight on the operator support page."* **So:** (b), and shown in one more place.
  Nothing refuses the owner's own yes, at the number or past it: the owner keeps count. The
  operator's *Support* screen (`/support`) gains an overview of the Alpha (§20.4, §20.6).
  *Reading:*
  - the overview holds the three counts that *Gifts* shows: the people the owner let in and
    the people let in by a recommendation, each against its number, and the cards not used
    yet;
  - it reads them from the same answer as *Gifts* and the queue
    (`GET /api/gifts/operator`, §19), so no two screens can disagree;
  - it holds numbers and no names: the queue lists each request, and *Support* each
    organisation;
  - at a number and past it, its line stands out as the queue's does, and not by colour
    alone.
- **D18. May a person who came in by a recommendation recommend somebody too.** The owner's
  words fit both: *each let in user 1 invite*. (a) Yes, as today: every member has one, and
  the second ceiling stops it at 50. (b) No: only the people the owner let in have one. The
  advice was (b). The owner: *"no, not in the alpha. Yes after the alpha."* **So:** (b)
  during the Alpha, and (a) after it. §20.7 says what it takes. *Reading:*
  - *during the Alpha* is read in one place, as the server reads the stage today
    (`alphaFrom`, `apps/api/src/access-notify.ts:108`), from the one setting the web build
    reads too (`isAlpha`, `apps/web/src/components/AlphaNote.tsx:73`);
  - after the Alpha the rule falls away by itself, and every member has the number each
    person may give;
  - the second ceiling stays as D16 set it, and a card such a member made before step A
    stays as it is.

## 16. A first test with four people (T14)

The owner's. After step A is on a stack the owner can reach.

- **Who:** two recipients of seventy or older and one of thirty or younger, each given a card
  by somebody they know, on their own device; and one giver.
- **What to watch, and write down:** whether they start at all; where they type the address;
  what they answer to the question, and why; what they say they are getting and what it costs;
  what they do when the page says they are in; what they do with the yes mail; what the giver
  says they are giving, and what they expect to see afterwards.
- **What comes back to this plan:** sentences to change, a screen to add or drop. No name of
  anybody, and nothing they typed.

## 17. Not in this plan

- **The plain request form,** for somebody with no code. It keeps its questions, which are
  the owner's words, and its request still waits for the owner. The review read it only as
  the gift's door. One thing changes on it: *I have a gift code* becomes a link (§5).
- **The mail that invites a member into an organisation.** It ends on the same sentence about
  a link (`notifications.ts:1705`), and holds a link too. For whoever next touches that mail.
- **The screens after signing in:** the three texts to accept, and *Start a migration*.
- **What a paid code buys, and its price.** 0172's G2, with payments.
- **Taking a person out again.** A lost card can be withdrawn while it is unused (§9). Once
  somebody is in, removing an organisation is the operator's, as for anybody.
- **The sign-in service's own screens.** T0 reads them; changing them is another plan.
- **A route with no link for a person's own pages** (0176 §19). The door here is built so
  that one door could later take that code too; nothing of it is built.
- **Counting Google's list.** Ownpace does not hold it: the owner keeps it at Google by hand.
  The two ceilings count people (§20.5).
- **A waiting list for a full Alpha,** or telling anybody when there is room again.

## 18. Risks

- **A code is now a way in for whoever holds it.** Before D6 the owner read every request.
  Now the giver's care is the check: the page tells them to give the card by hand, an unused
  code can be withdrawn, the door asks its question, and the owner is mailed for each person
  let in. The code is 80 bits behind a limit.
- **Nobody reads a recommendation first, and each person the owner let in may recommend one
  more.** During the Alpha a person let in by a recommendation may not (D18, §20.7), so
  nobody comes in by a chain. The second ceiling stops it at 50 (D16, §20).
- **The two ceilings count people, and Google's list counts addresses.** A member who moves
  three family members' Google accounts takes four places there, and each address the owner
  tests with takes one. So 50 and 50 can be more than Google's 100. The numbers are settings
  for that reason: the owner lowers one when Google's list fills first. Nothing in Ownpace
  counts that list (§17).
- **A place may not come back at Google when a person leaves.** Ownpace's count goes down
  when a person's data is erased. Whether Google's list gives the place back is not known
  here (§3.6). The owner sees it in Google's console.
- **A card on paper says *let in at once*, and a full Alpha cannot keep that.** A card is
  made only while a place is free for it, so this happens only after the owner lowers the
  number while cards are out. The door then says so calmly, and keeps the code (§20.3).
- **A code can let in an address the owner has not answered yet, or has declined.** That is
  D6 and D15 (a): a member's word is enough. The owner is mailed for each person let in, and
  the notice names the address.
- **A mistyped address is let in.** The address is shown back before the button, and the
  page says where to write. The invitation is bound to an address that the sign-in service
  must verify, so only whoever reads that mailbox can take it up.
- **The yes mail may not arrive.** The page itself holds the way on, and says that a mail was
  sent only when one was.
- **This plan changes a decision of 0172.** Its G1 said that a redeemed gift lets nobody in
  by itself. T7 writes the change into 0172's Status when step A is built.
- **A new word for what the owner called a gift a day ago, and a card that says more than
  the owner's sentence did.** The owner chose the word (D1) and the way in (D6), and has
  read the card's new sentence (§7). The rest of the Dutch is read before a step merges.
- **The mails change for every request,** not only for a code. The Alpha's paragraph and the
  sentence about backups do not move.
- **A check is one more thing to guess at.** It shares the redeem's limit and its one
  refusal. Forty an hour is still nothing against 80 bits.
- **Two calls where there was one.** A code can stop working between them. The third step
  refuses it in the same words, and nothing was written before it.
- **One answer tells a code's holder something about an address:** that it already has
  access. Only a holder of an unused code can ask. A request that waits is no longer told
  (D15 (a)): it is granted.
- **A name at the door makes a false page more convincing too.** It is shown as something to
  check; the question stays; and nothing on the server depends on the answer.
- **The question can be answered *yes* by anybody.** It is there for the reader who was not
  told: it gives them a calm way to wait, or to say no.
- **The address the mail comes from is a setting.** The door names it only from the server's
  own answer, never from the web build's.
- **Two plans touch the member's name.** T9 reads what 0176's T3 writes, and waits for it.
- **Two plans add migrations, and each has its number.** This step A's is managed 0066;
  0176's steps B and C take the ones after it (§19). One that merges out of that order is
  renumbered, with every mention of it.

## 19. Building it in parts

As 0176 §23 does it. A key that no screen says is refused
(`apps/web/src/i18n/a-word-nobody-says.unit.test.ts`), so words travel with their screen.
Step A is one pull request, and its parts are branches that meet in it.

**Beside 0176's step A,** which is #2180 and is not merged yet. The owner said yes to
building this step A now (§15.2). Nine files are opened by both, as #2180's own list of
files shows: the glossary, the language switch (`apps/web/src/components/LanguageSwitch.tsx`),
`apps/web/src/index.css`, `site/build.mjs`, `site/site.unit.test.ts`, the tester guide in its
two languages, the managed UI smoke and `CHANGELOG.md`.

- **Two of the nine are changed at a place of their own,** so that the two steps merge
  without a conflict. The glossary's two rows stand apart from the rows 0176 changes. The
  site's cases for this plan's page are the ones that are there today
  (`site/site.unit.test.ts:909` on).
- **The other seven wait for the last part,** and the last part waits until #2180 is merged.
  It takes the language switch in full words from there (T6); writes the card's print rule
  in `index.css` (T2); adds its one line to `site/build.mjs` (D9); says the door's way in
  the tester guide (D14); and adds its cases to the smoke and its lines to the changelog.
- **The first part and the four middle parts open none of those seven,** so they are built
  while #2180 is.

| Part | Tasks | Files it owns |
|---|---|---|
| **First: the glossary** | T3's two rows | `apps/web/src/i18n/GLOSSARY.md` |
| **The web** | T1's screens, T2 on the screen, T5, T10, T16's screens, T6's sizes, and their words | `apps/web/src/pages/Give.tsx`; the door's new files under `apps/web/src/pages/`; `RequestAccess.tsx`; `Gifts.tsx`; `AccessRequests.tsx`; `apps/web/src/AppRoutes.tsx`; `apps/web/src/services/gifts.ts` and `access-requests.ts`; `apps/web/src/i18n/strings/gifts.ts`; `apps/web/src/i18n/operator-strings.ts`; `a-gift-on-every-screen.unit.test.tsx`, `AccessRequests.unit.test.tsx` and the two new web tests |
| **The server** | T1's route, the limit, letting a person in (D6, D14, D15), T16's counts and ceilings, the server's sentences | `apps/api/src/routes/gifts.ts`; `apps/api/src/routes/access-requests.ts`; `packages/managed/src/gift-store.ts`; `packages/managed/src/schema-managed.ts`; one new file under `packages/managed/migrations/`, numbered 0066; `apps/api/docs/openapi.yaml`; `apps/api/src/routes/gifts.unit.test.ts`, `a-gift-turned-into-a-request.unit.test.ts`, the new `an-alpha-with-two-ceilings.unit.test.ts`, `access-request-grant-alpha.unit.test.ts`; `apps/api/src/knock-limit.unit.test.ts`; `packages/managed/src/gift-under-rls.unit.test.ts` |
| **The mails** | T4, and the operator's notice | `packages/shared/src/notifications.ts`, `apps/api/src/access-notify.ts`, `notifications.unit.test.ts`, `what-the-mails-say.unit.test.ts` |
| **The site and the documents** | T7, but for the tester guide | `site/pages/nl/cadeau.md`, `site/pages/en/gift.md`, `site/site.unit.test.ts` (this page's cases), `docs/ending-the-alpha.md`, the privacy text if the owner says so, plan 0172's Status |
| **Last** | T8's smoke; T2 in print; T6's language switch; D9's path on the site; D14 in the tester guide; the records | `test/ui/managed-ui.ui.test.ts`, `apps/web/src/index.css`, `apps/web/src/components/LanguageSwitch.tsx`, `site/build.mjs`, `site/pages/en/alpha-guide.md`, `site/pages/nl/alpha-handleiding.md`, `CHANGELOG.md`, this plan's Status |

**The parts meet at five contracts,** fixed here so that none waits.

- **The check.** `POST /api/gifts/check` takes `{ code }`. It answers 200 with
  `{ ok: true, until, answersFrom }`, where `answersFrom` is left out when no mail is set up;
  410 with the body `GIFT_REFUSAL` has; 409 `full`, with the server's sentence in both
  languages and `until`; and 429 as the redeem does, with a Dutch half.
- **The redeem.** `POST /api/gifts/redeem` takes the code, the address, a name if one was
  typed, `google` as true or false, and the language. It answers 201 with
  `{ letIn: true, mailed }`; 410 for a bad code; 409 `already_in` for an address that already
  has access; 409 `full`, as the check's; and 429. It has no answer for a request that
  waits any more: that request is granted (D15).
- **The giver's own.** `GET /api/gifts/mine` gains `room`, true or false: whether the Alpha
  has a place for a new card. `POST /api/gifts` answers 409 `no_room` when it has none. It
  also gains `onlyAfterAlpha`, true or false: true during the Alpha for a member who came in
  by a recommendation, whose `limit` is then nought (D18). `POST /api/gifts` answers such a
  member 409 `only_after_alpha`, with §20.7's first sentence in both languages.
- **The operator's.** The `alpha` of `GET /api/gifts/operator` gains `byOwner`,
  `byRecommendation`, `ownerCeiling` and `recommendationCeiling`, beside the `unusedGifts`
  it has. `PUT /api/gifts/operator/rule` takes either ceiling beside the number each person
  may give. The queue reads the owner's line from that same answer, and so does the
  overview on *Support* (D17): no new route. Nothing refuses
  `POST /api/access-requests/:id/grant` at the owner's number (D17).
- **The mails.** The event of the yes mail, and the operator's notice, each take two more
  true-or-false: that it came with a code, and that the person said their address is a
  Google account. The server passes them; the mails' part says the words.

The path the card prints is `/code`, in both `Give.tsx` and `apps/api/src/routes/gifts.ts`.

**The managed migration's number: 0066.** This step A is built now, beside 0176's step A,
which adds no migration. 0176's step B starts only once its step A is merged. The maintainer
assigns the numbers, so that nothing is built side by side on the same one. The managed
chain on `main` ends at 0065, and the ledger chain at 0075:

- this plan's step A: managed 0066;
- 0176's step B: managed 0067 for its T3, and managed 0068 for its T7;
- 0176's step C: managed 0069 for its T4, and ledger 0076 for the window of its T5.

Whichever merges out of that order renumbers its file and every mention of it, as the
gift's own migration went from 0064 to 0065 on 2026-11-25 (plan 0172's Status).

**What waits for what.** The four middle parts wait for the glossary, and for nothing else.
The last part waits for the others, and for #2180 to be merged. The owner's read of the
Dutch comes after it, on §7's and §8's tables. D17 and D18 are answered (§15.3), and step A
builds both. §21 says for each part what done means.

**Step B is one task:** T9, after 0176's T3.

## 20. The Alpha's two ceilings (T16)

The owner, on D16: *"alpha limited to 50 people I let in, en 50 max someone invites (each let
in user 1 invite)."* The numbers are the owner's: 50, 50 and 1. Everything else in this
section is this plan's reading of them, for the owner to correct, but for the answers to D17
and D18 (§15.3), which are in §20.4 and §20.7. Serves R1 and R3. Step A. Where only the
operator reads, English only.

### 20.1 What is counted

- **People the owner let in:** requests that are granted, and that no card points to.
- **People let in by a recommendation:** requests that a card points to, granted or still
  waiting. The waiting ones are requests made with a code before step A, which the owner
  still answers (§8).
- **Cards not used yet** are places promised: a card that is not used, not withdrawn and not
  expired (`giftState`, `packages/managed/src/gift-store.ts:120-128`).

Four things follow. Each is a reading.

- **The people already in count,** whichever way they came. The Alpha holds them, and
  Google's list holds their addresses.
- **A person whose data is erased leaves the count.** Their request is erased with it, and
  the card that pointed to it then points to nothing (§3.6). A declined request does not
  count either.
- **A test address counts like anybody's.** It is a request that was granted, and its
  address is on Google's list like any other. An owner who wants more room for people
  raises the number.
- **Nothing keeps a running total.** Each count is read from the requests and the cards at
  the moment it is needed, so it cannot drift.

### 20.2 Where the two numbers live

Two numbers on the rule's one row (`gift_rule`,
`packages/managed/src/schema-managed.ts:996-1001`), beside the number each person may give.
Each is 50 unless the owner changes it. The owner sets them on the operator's *Gifts*
screen, where *Gifts per person* is set today (`apps/web/src/pages/Gifts.tsx:118-140`;
`PUT /api/gifts/operator/rule`, `apps/api/src/routes/gifts.ts:375`).

Settings and not constants, for three reasons. Google's list counts addresses and not people
(§20.5), so the owner may need a lower number before 50 is reached. A constant changes only
with a release. And the row, its screen and its route exist: this is two columns in the
migration step A already has, and two fields.

A number can be set under what is already counted. Nobody is taken out. Nobody new comes in
until the count is under it again.

### 20.3 What the second ceiling does

1. **A card is made only while a place is free for it.** The people let in by a
   recommendation and the cards not used yet are counted together. While they fill the
   number, no member can make a card, and the giver's page says *none for now* (§9). The
   card says on paper *With this card you are let in at once* (§7). This rule keeps that
   true (R3), and keeps the review's fourth finding from coming back (§3.5).
2. **The door is the backstop.** It counts the people let in by a recommendation. At the
   number it lets nobody in: the check and the last step both answer that the Alpha is
   full, the code is kept, and nothing is written. With rule 1 this happens only after the
   owner lowers the number while cards are out.
3. **Counted and written behind one lock,** as a giver's cards are counted today
   (`gift-store.ts:280`). Two codes at the last place let one person in.
4. **A code's session learns a yes or a no, never a number.** How many people are in is the
   operator's to read.

**The screen for a full Alpha** is calm, and is not an error on a field: one `h1`, the
server's sentence, until when the code works, and that nothing about the reader was kept
(§7). Its one button goes back. It makes no promise about when there is room.

### 20.4 What the first ceiling does

**Shown, in step A:** *People you let in: n of 50*, on the access queue above the requests,
on the *Gifts* screen, and in the Alpha's overview on *Support* (D17). At the number and
past it the line stands out, and not by colour alone.

**Nothing refuses the owner's next yes** (D17). The owner keeps count. A grant past the
number is written like any other, and the line then reads, say, *52 of 50*. A request that a
card points to is counted under the second ceiling, not this one.

**The overview on *Support*** (D17) stands on the first screen of *Support*. It shows
§20.6's three counts, read from the same answer as *Gifts* (§19), and links to *Gifts*,
where the numbers are set. It holds no names.

### 20.5 What the two numbers do not count: Google's list

50 and 50 is 100, and Google's list of test users ends at 100 (§3.6). The two are the same
only while each person moves one Google account and nobody else is on the list.

- **Google counts addresses.** A member who moves three family members' Google accounts
  takes four places. A person who moves from Microsoft takes none.
- **Every address that connects must be on it,** the owner's own test addresses too (§3.6).
- **Ownpace does not hold the list.** The owner keeps it at Google by hand, and reads its
  length there.

So the *Gifts* screen says in one sentence that the two numbers count people and that Google
counts addresses (§20.6). Nothing in Ownpace counts that list (§17). When Google's list
fills first, the owner lowers a number.

### 20.6 What the operator reads

English only (`apps/web/src/i18n/operator-strings.ts`). Drafts, for the owner's read.

| Where | The words |
|---|---|
| *Gifts*, the counts | *People you let in: {n} of {max}* · *People let in by a recommendation: {n} of {max}* · *Cards not used yet: {n}* |
| *Gifts*, under the counts | *At its number a recommendation lets nobody in, and no new card is made. Nothing refuses your own yes past yours.* |
| *Gifts*, the two fields | *The most people you let in* · *The most people let in by a recommendation* |
| *Gifts*, beside *Gifts per person*, during the Alpha (D18) | *During the Alpha only the people you let in have these. A person let in by a recommendation has none until the Alpha ends.* |
| *Gifts*, about Google | *These count people. Google's list of test users counts addresses, and ends at 100: the Google address of each member and of each person they help, family or acquaintance, takes a place, and so do your own test addresses.* (alpha.22, for D19: it said *each family member's address and your own test addresses are on it too*) |
| The queue, above the requests | *People you let in: {n} of {max}* |
| *Support*, the Alpha's overview (D17) | *The Alpha* · *People you let in: {n} of {max}* · *People let in by a recommendation: {n} of {max}* · *Cards not used yet: {n}* · *Nothing refuses your own yes: you keep count. The numbers are set on Gifts.* |

The sentence that goes: *Nothing refuses a grant past a number: the limit on how many people
the Alpha lets in is yours to keep* (`gifts.count.noCap`, `operator-strings.ts:452-453`).

### 20.7 During the Alpha, only the people the owner let in recommend (D18)

The owner, on D18: *"no, not in the alpha. Yes after the alpha."* During the Alpha only the
people the owner let in have a recommendation. A member whose own organisation was made by a
request that a card points to has none until the Alpha ends. The server answers their limit
as nought, with `onlyAfterAlpha` (§19). Their page says, where it says *none for now*:
*During the Alpha, only the people Ownpace let in itself can recommend someone. After the
Alpha, you can too.* / *Tijdens de Alpha kunnen alleen de mensen die Ownpace zelf toeliet
iemand aanbevelen. Na de Alpha kunt u dat ook.* Drafts, for the owner's read (§7).
`POST /api/gifts` refuses such a member with the first of the two sentences, as 409
`only_after_alpha`. How a member's own session learns it is the server's to build under the
database's rules, as a yes or a no. A card such a member made before stays as it is.

*During the Alpha* is read in one place, as the server reads the stage today (`alphaFrom`,
`apps/api/src/access-notify.ts:108`). After the Alpha the rule falls away by itself, and
every member has the number each person may give.

## 21. Step A, part by part: what done means

For each part of §19: what done means, the tests to write first, and what must not change. A
test written first fails on `main` for the reason it names. The tree was read at `ae57042`.
Whoever builds a part checks its lines first.

**What step A must not touch.**

- No new table, and no migration but the one. Nothing in the shared chain
  (`packages/ledger/migrations`): a gift is the managed edition's.
- The code: its form, its 80 bits, its two years, shown once and kept as a fingerprint
  (0172).
- Nothing about the recipient on the gift's row
  (`apps/api/src/routes/a-gift-that-keeps-no-recipient.unit.test.ts`).
- The plain request form's questions, and that its request waits for the owner (§17). One
  thing changes on it: *I have a gift code* becomes a link.
- The no mail's event: a kind and nothing else. The Alpha's paragraph and the sentence about
  backups in the yes mail, word for word (§8).
- The mail that invites a member into an organisation (§17).
- The appliance. It has no gift, no door and no operator. Nothing in `packages/` but
  `packages/managed` may come to need the managed edition (hard rule 5).
- 0176's step A: none of its files but the nine of §19.

### 21.1 First: the glossary

Done means:

1. One row for the free thing: *recommendation* / *aanbeveling*, with the names it does not
   take: *gift*, *cadeau*, *place*, *plaats*, *plek*, *invitation* and *uitnodiging*.
2. One row that keeps *gift* / *cadeau* for a code that somebody paid for.
3. Both rows stand apart from the rows 0176's step A changes (§19).

No test is written first for it: `one-name-for-a-free-gift` is the web's.

### 21.2 The web

T1's screens, T2 on the screen, T5, T10, T16's screens, T6's sizes. Done means:

**The door.**

1. `/code` opens the door. `/redeem` and the site's link open it too. On the plain form *I
   have a gift code* is a link to it. A code after a `#` fills the field, and nothing is
   sent until the reader presses the button.
2. The first step holds one `h1`, one field, one button, one line of help, and the link for
   a reader with no code. It asks for no address, and sends the code and nothing else.
3. A refused code stays in its field, under a heading that is tied to the field and
   announced, with the server's sentence in the page's language and the page's own line.
   Too many tries are said in the page's language.
4. The second step says §5's lines and asks the one question, with three answers of one
   size. *Not yet* and *I do not want this* each end calmly and send nothing. The answer is
   neither sent nor stored.
5. The third step holds the address, the name that may be left empty, and the question
   about Google with two answers of one size. The address is shown back before the button,
   with the sentence that the code is used by this step. No organisation, note or package
   is drawn or sent.
6. A full Alpha is a calm screen, at the first step and at the third: the server's
   sentence, the code's last day, and that nothing was kept.
7. An address that already has access keeps its code. The page says so and offers to sign
   in.
8. Let in: one `h1`. *Create your account* opens the sign-in page with the address filled
   in. The mail's line stands only when a mail was sent, and the Google lines only after a
   yes. Then the safety sentence, and where to write.
9. The steps are as §5 has them: a history entry each, one `h1` that takes the focus, the
   tab named after the step, *Step n of 3* in words. Back after the person is let in does
   not use the code twice.
10. The door shows no welcome of the Alpha, no link to sign in before the person is in, and
    no sentence that says whose page it is. The build stamp and the accessibility statement
    stand at its foot.

**The giver's page and the card.**

11. The page says first, at reading size, what a recommendation does; then how many; that
    whoever has the code is let in; and what the giver will see.
12. The list says each card's state in words, with the day it was used and *let in*.
13. A link stands beside the card, with one line and no written message. The code stands
    after a `#`.
14. One fold, *What they will see*. No tick box. Nothing about what the giver gets.
15. *None for now*, and no button, when the limit is nought and when the Alpha has no place
    for a new card. Never *already given* for either. With `onlyAfterAlpha`, §20.7's
    sentences stand there instead (D18).
16. On the screen the card is shown as it prints, in §6's order, with the door's three
    steps and no square to scan. Its code is on one line at every width. The print rule is
    the last part's.

**The operator's screens (T16).**

17. *Gifts* shows both counts with their ceilings and the cards not used yet, two fields
    that set the ceilings, the sentence about Google, and, during the Alpha, the line about
    *Gifts per person* (D18). `gifts.count.noCap` makes way for §20.6's sentence under the
    counts.
18. The queue shows *People you let in: n of max* above the requests. At the number and
    past it the line stands out, and not by colour alone. A request that was let in by a
    recommendation says so, and names nobody as having decided it. Nothing refuses a grant
    (D17).
19. *Support* shows the Alpha's overview on its first screen (D17): §20.6's three counts,
    from the same answer as *Gifts*, a link to *Gifts*, and no names. At a number and past
    it the line stands out, and not by colour alone.

**Words and sizes.**

20. Every sentence of §7 is in the dictionary in both languages
    (`apps/web/src/i18n/strings/gifts.ts`). The operator's are English only
    (`operator-strings.ts`). No sentence calls the free thing a *gift*, a *cadeau*, a
    *place* or a *plaats*, and none says *key* or *sleutel*. A key that leaves is gone from
    both languages.
21. §10's sizes hold on the door, its endings and the giver's page.
22. The pull request holds one table of every new or changed Dutch sentence, for the
    owner's read.

Written first: `apps/web/src/pages/a-code-with-a-door-of-its-own.unit.test.tsx`, one case
for each of 1 to 10. `apps/web/src/i18n/one-name-for-a-free-gift.unit.test.ts`, for 20. New
cases in `a-gift-on-every-screen.unit.test.tsx` for 11 to 15 and 17, in
`AccessRequests.unit.test.tsx` for 18, and in `Support.unit.test.tsx` for 19. The sizes of 21
and the card in print are held by the smoke, in the last part.

### 21.3 The server

T1's route, letting a person in, D14, D15, and T16's counts. Done means:

1. `POST /api/gifts/check` answers as §19's contract has it. It writes nothing and spends
   nothing. Every kind of bad code gets the one body.
2. The check and the redeem share one limit of forty an hour. Its 429 has a Dutch half.
3. The check is on the list of open routes, with its note.
4. The redeem lets a person in, in one transaction: the request as granted with nobody
   named as having decided it, the organisation, its owner's invitation, and the code spent
   and pointing to the request. All of it or none.
5. An address with a request waiting gets that request granted. No second one is written
   (D15 (a)).
6. A yes to the question about Google is the one fixed line in the request's note. A no
   writes nothing (D14 (a)).
7. An address that already has access is answered 409 `already_in`. Nothing is written,
   and the code is kept.
8. The yes mail and the operator's notice go out after the commit, never before, each with
   its two true-or-false. A filled trap is answered as let in: nothing is written, and
   nothing is sent.
9. The migration is one file, managed 0066 (§19). It adds the two numbers to the rule's
   row, each 50. It gives a session that holds an unused code what 4 and 5 need, and the
   room's yes or no, and nothing else. It gives a member's own session one more yes or no:
   whether their organisation was made by a request that a card points to (D18). It adds
   no table.
10. The counts are §20.1's. No card is made while the people let in by a recommendation and
    the cards not used yet fill the second number. `GET /api/gifts/mine` says so as `room`,
    and `POST /api/gifts` answers 409 `no_room`.
11. At the second number the check and the redeem answer 409 `full`. Nothing is written or
    spent. Two codes at the last place let one person in.
12. The operator's answer carries both counts and both ceilings. The rule's route sets
    either ceiling: a whole number, nought or more.
13. The queue's answer marks a request that was let in by a recommendation, with nobody
    named as having decided it.
14. Nothing refuses the owner's own yes, at the number or past it (D17).
15. During the Alpha, a member whose own organisation was made by a request that a card
    points to has a limit of nought: `GET /api/gifts/mine` says so with `onlyAfterAlpha`,
    and `POST /api/gifts` answers 409 `only_after_alpha`. The stage is read in one place.
    After the Alpha, every member has the number each person may give (D18).
16. `apps/api/docs/openapi.yaml` holds the new route, the redeem's new answers and the new
    fields.
17. The log names a gift and a request by their ids, never by a code or an address, as
    today.

Written first: new cases in `apps/api/src/routes/gifts.unit.test.ts` for 1, 2, 6, 7, 8 and
11. `apps/api/src/knock-limit.unit.test.ts` for 3.
`a-gift-turned-into-a-request.unit.test.ts`, turned round, for 4 and 5.
`packages/managed/src/gift-under-rls.unit.test.ts` for 9: what a session with an unused
code may write, once, and that a session without one may write none of it and read no count;
and that a member's session learns its own yes or no and nobody else's.
The new `apps/api/src/routes/an-alpha-with-two-ceilings.unit.test.ts` for 10 to 15, with the
stage read both ways.

### 21.4 The mails

T4, and the operator's notice. Done means:

1. The yes mail opens with what happened: one line for a request, another for a code.
2. Three numbered steps. Under the link, why it ends in the person's own address. The
   guide's address before the person starts. The sentence that explains *organisation*.
3. *There is no link or code in this email: it is safe to forward* is gone from this mail,
   and stays in the mail that invites a member.
4. After a yes to the question about Google, the mail carries the last screen's sentence
   about Google.
5. The no mail is one text, the same in both languages: §8's five things, and no promise
   of a later message.
6. The operator's notice for a code says §8's words and the address, and the line about
   Google after a yes.
7. What stays: one sign-in address and no token; the sentence about backups; the Alpha's
   paragraph and its two addresses; no address in the no mail; the subjects; and the no
   mail's event.
8. T0's words go into the third step when the owner has them. Until then the step is §8's.

Written first: new cases in `packages/shared/src/notifications.unit.test.ts` and
`what-the-mails-say.unit.test.ts` for 1 to 6. They fail today on the sentence that says the
mail holds no link, on the steps without numbers, on the first line, and on the no mail's
two languages.

### 21.5 The site and the documents

T7, but for the tester guide. Done means:

1. The site's page says in both languages what the door says, under the one name, and no
   longer says *not a key*.
2. `site/site.unit.test.ts` holds the page's new words, and that the door's *read more* is
   a file the site writes. Only this page's cases change.
3. `docs/ending-the-alpha.md` says what a recommendation is after the Alpha (D5), and that
   the two ceilings are the Alpha's.
4. The privacy text, in both languages, changes only after the owner has said whether it
   is still changed in place: the name; let in at once; that the giver sees that the code
   was used; and the answer about Google at the door.
5. Plan 0172's Status has one dated line: its G1 is changed by D6 here, and its answer
   that there is no cap by D16.

### 21.6 Last

After the other parts, and after #2180 is merged. Done means:

1. The managed UI smoke has entries for the giver's page and the door, as a walk in both
   languages, at 390 and at 320 pixels.
2. In print the card is at least nine tenths of the page's width, on one sheet, upright,
   on A4 and on Letter. No text is under 14 point. The code is on one line.
3. On the door no text is under 16 pixels, each target and edge is as §10 has it, and
   nothing goes sideways at 320 pixels.
4. The language switch says *English* and *Nederlands* on the door, as 0176's T9 built it.
5. The site's link to the door is `/code`.
6. The tester guide's *Google addresses first* says the door's way too, in both languages.
7. `CHANGELOG.md` has its entry in both languages, and this plan's Status says what was
   proved.

**Gates before step A is called done:** lint, typecheck, the unit tests and the UI smoke,
on all parts together. Then the owner reads the Dutch. E2E is the maintainer's to dispatch.

### 21.7 Asked of every part, and where the answer is

| The question | The answer |
|---|---|
| Is each sentence plain Dutch? | §7's rules: one idea, at most fifteen words, *u*, and no word to look up. The owner reads every Dutch sentence before the step merges |
| Does step A keep new personal data? | One thing: a yes to the question about Google, as a fixed line in the request's note (D14). The address and the name are what a request holds today. The answer to the second step's question is neither sent nor stored |
| Does the privacy text change? | Yes, in place under 1.0, once the lawyer has read it: the owner's *"Q1: yes"* (§11). Not in step A's pull request; its drafts are on the lawyer's list |
| Can somebody with a code do more than before? | Yes, and that is D6: the code lets its holder in. The giver hands it over by hand and can withdraw it unused; the door asks its question; the owner is mailed for each person; and the second ceiling ends it at 50 |
| Can somebody without a code learn anything? | No. The check and the redeem answer every bad code alike, behind one limit. A full Alpha is told only to the holder of a good code |
| Can a session of a code read the Alpha's numbers? | No. It learns a yes or a no (§20.3) |
| Who may recommend during the Alpha? | Only the people the owner let in (D18). A person let in by a recommendation may after the Alpha |
| Is a card on paper still true? | Yes: a card is made only while a place is free for it. Only an owner who lowers the number can make it untrue, and the door then says so calmly |
| Do the two ceilings keep Google's list from filling? | No. They count people, and Google counts addresses (§20.5). The owner watches that list at Google |
| What does a real person make of it? | Not known. T14 is the first test, and what it finds outranks all of this |
