# Workplan 0177 — The gift's screens: a free one that buys nothing, a door of its own, a card that reads alone

> **In one line:** The screens a gift's giver and recipient see: a free gift becomes a recommendation that lets a person in at once and buys nothing; the code gets a door of its own; the card reads without a screen; the two mails say what happened; a paid gift code stays as 0172 left it.

## Status — 2026-11-26 (update this block at the end of every session)

**2026-11-26, the owner's answers to D1 to D13 (T13). Nothing is built.** In the owner's
words, in the plan's order:

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
  rewritten for it. Step A gains a managed migration, which adds no table and no column.
- **The free thing is a *recommendation* / *aanbeveling*** (D1), and no sentence says what it
  is not. The sentences that said *not a key* go.
- **A card and a link** (D2). **`/code`** (D9). **Both mails as proposed** (D11, D12).
- **A free one gives what was free:** the free Alpha, and nothing free after it (D5).
- **Step B is one task now:** who sent it (D3). Under D6 what the giver hears needs no data
  (D8), and the yes mail, sent at once, is the receipt (D10). §12 says why.
- **The time for an answer falls away** (D6): for a code the answer is at once.
- **The half of D7 that said *the answer can always be no* falls away too.** It is no longer
  true of a recommendation.

**Three questions are left for the owner,** D14 to D16 (T15, §15): how Ownpace learns of a
Google address to add; an address that already has a request waiting; and a ceiling, now that
nobody reads a recommendation first. Each has advice, and says what the builder does until it
is answered.

**When step A is built is the owner's to say.** Nothing here starts it.

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
§8 is still a draft until the owner has read the Dutch.

**Every claim about the code below was read at `ae57042`,** which is `main` on 2026-11-26.
Two changes came after 0172 was merged, and are in the lines cited: the privacy text's two
additions about a gift (#2171), and the request form's package names in the page's language
(#2175).

**The order.** Three steps, each one mergeable by itself.
- **Step A, words, screens and letting a person in:** T1 to T8, and T10. One new route. One
  managed migration, which adds no table and no column.
- **Step B, a little data:** T9.
- **Step C, after the Alpha:** T12.

T0 and T14 are the owner's. Step A can be built beside 0176's step A; only its last part
waits for that one (§19).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's hand test: from the mail that lets a person in to the first screen after signing in, word for word | owner | ⏳ **Owner** | §8. On a real phone, in Dutch and English. Blocks nothing; the yes mail's third step takes its words. |
| T1 The door: the code first and alone, then let in at once | builder | 📋 Planned | §5. One new route, and a managed migration with no table and no column (D6). L. |
| T2 The card: a full sheet, in type that can be read, with steps that match the screens | builder | 📋 Planned | §6. S. |
| T3 The words, EN and NL, and one name for the thing | builder | 📋 Planned | §7. D1 (a). The glossary first. Merged after the owner's read of the Dutch. M. |
| T4 The two mails: what happened, in both languages alike | builder | 📋 Planned | §8. D11 (a), D12 (a). For every request. M. |
| T5 The giver's page: what it is, and what the other person will read | builder | 📋 Planned | §9. With a link beside the card (D2). M. |
| T6 Size, contrast and targets on the door and the giver's page | builder | 📋 Planned | §10. S. |
| T7 What follows: the site's page, the glossary, the privacy text, the records | builder | 📋 Planned | §11. With each step. S. |
| T8 Proofs | builder | 📋 Planned | §14. With each step. |
| T9 Who sent it: the giver's name at the door and in the yes mail | builder | 📋 Planned | §12. Step B. D3 (a). After 0176's T3, which holds the name. M. |
| T10 What the giver hears: used, and so let in | builder | 📋 Planned | §9. Step A now, in words: under D6 *used* means *let in*, so no column is needed (D8). S. |
| T11 A receipt by mail | builder | 📋 Planned | §12. Met by T1 and T4: under D6 the yes mail goes out at once, and it is the receipt (D10). No task of its own is left. |
| T12 After the Alpha: a paid code at the same door | builder | 📋 Planned | §13. Step C. With payments; 0172's G2. Not designed here beyond the door. |
| T13 The owner's decisions, D1 to D13 | owner | ✅ Answered 2026-11-26 | §15. In the owner's words, with what each changes. |
| T14 A first test with four people | owner | ⏳ **Owner** | §16. After step A is on a stack the owner can reach. |
| T15 The owner's decisions after the answers, D14 to D16 | owner | ⏳ **Owner** | §15. Each has advice, and says what the builder does until it is answered. |

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
- **From 0172** (2026-11-24 and 2026-11-25), still so: a gift is valid for two years; Ownpace
  never sends it, the giver does; nothing about the recipient is kept on the gift; each
  person gives one. **Changed by D6, for a free one:** 0172 said a gift lets nobody in by
  itself and becomes a request that the owner reads and may decline. A recommendation now
  lets its person in at once. Somebody who asks without a code still waits for the owner's
  answer.

## 2. Who reads these screens, and ten rules

Two people. The giver is a member, which during the Alpha means somebody the owner let in, or
somebody a member recommended. The recipient has no account, did not ask for this, and may be
older. They have been taught that a gift nobody asked for is not a gift, that a code is never
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
- **Google's list ends at 100.** Google's help page *Manage App Audience* says that a project
  whose publishing status is *Testing* is limited to 100 test users
  (https://support.google.com/cloud/answer/15549945; seen in search results on 2026-11-26, the
  page itself was not opened).

## 4. The design in one page

1. **A name that is true** (T3, D1). A free one is a recommendation: the giver tells Ownpace
   that they know somebody, and that is enough. *Gift* is kept for a code that somebody paid
   for.
2. **A door of its own** (T1). A short address. First the code, alone. Then one question, the
   address and an optional name. Then the person is in, at once (D6).
3. **A card that reads alone** (T2). A full sheet, large type, three steps that are the
   screens' own, and who to ask.
4. **Two mails that say what happened** (T4), alike in both languages. For a code the yes
   mail goes out at once.
5. **A giver who knows what they hand over** (T5, T10): that the person is let in at once,
   what they will read, and that the giver will see when the code is used.
6. **Then, with a little data** (step B): who sent it, shown as something to check.
7. **Later** (step C): a paid code at the same door.

## 5. The door (T1)

Serves R1, R3, R4, R5 and R6. One new route. A managed migration that adds no table and no
column.

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
- One question about Google, if D14 goes as advised (§15).
- That the code works once, and is used by this step. The button says so: *Use my code*.
- What is kept, in today's words for a request that is granted (`access.privacy`), with the
  privacy text and the Alpha conditions linked under it, as today (0139 T4).
- No organisation, no note and no package: the page draws none and sends none. It sends the
  code, the address, the name if one was typed, and the page's language. The form's trap
  stays (0093 T2d).

**What the server does with it (D6).** In one transaction, all of it or none:

- the request, written as granted, with nobody named as having decided it;
- the organisation, named after the name the person typed, or else after their address;
- its owner's invitation, bound to the address, as a grant writes it (§3.6);
- the code, spent.

After the commit it sends the yes mail to the person (§8), and a notice to the operator in
new words: somebody was let in with a recommendation, and the queue shows whose. The queue
shows the request as let in by a recommendation, and by nobody's decision.

**The migration.** The code's own transaction may today read its gift, spend it and write a
request (§3.6). It must now also write the organisation and the invitation, and nothing
else. A managed migration lets it: policies, or one function, for a session that holds an
unused code. It adds no table and no column. `gift-under-rls` holds that a session with no
code, with a used one or with somebody else's can write none of it.

**Three answers that are not a yes.** In each the code is kept, and the page says so in the
server's words (§7).

- **A code that stopped working since step 1** is refused as there.
- **An address that already has access:** the page says so, and offers to sign in.
- **An address that already has a request waiting:** as today, until D15 is answered.

**Let in.** One `h1`: the person is in. Then:

- one thing left, with the button that does it: *Create your account*, which opens the
  sign-in page with the address filled in, as the mail's link does
  (`packages/shared/src/registration-link.ts:58-60`). The sign-in service then mails a code
  to confirm the address;
- that the same was sent by mail, to which address and from which, if it was sent;
- with a Google address under D14: that the owner adds it at Google by hand and writes when
  that is done, and that Google does not allow the connection until then;
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

| Where | EN | NL |
|---|---|---|
| Giver, menu and title | *Recommend someone* | *Iemand aanbevelen* |
| Giver, first line | *Recommend someone dear to you for the Alpha, on a card.* | *Beveel iemand die u dierbaar is aan voor de Alpha, op een kaart.* |
| Giver, what it does | *You tell us that you know this person. That is enough: they are let in at once.* | *U zegt ons dat u deze persoon kent. Dat is genoeg: die persoon wordt meteen toegelaten.* |
| Giver, fact | *They get an account of their own. You do not see what is in it.* | *Die persoon krijgt een eigen account. U ziet niet wat erin staat.* |
| Giver, how many | *People you may recommend: {limit}. Recommended: {held}.* | *Mensen die u mag aanbevelen: {limit}. Aanbevolen: {held}.* |
| Giver, hand it over | *Give the card yourself. Whoever has the code is let in.* | *Geef de kaart zelf. Wie de code heeft, wordt toegelaten.* |
| Giver, tell first | *Tell them first: by phone, or when you hand it over.* | *Vertel het eerst zelf: aan de telefoon, of als u het geeft.* |
| Giver, shown once | *The code is shown only now. Lost it? Withdraw it below and make a new one.* | *U ziet de code alleen nu. Kwijt? Trek hem hieronder in en maak een nieuwe.* |
| Giver, what you will see | *You will see here when it is used. The person is then in.* | *U ziet hier wanneer hij is gebruikt. Die persoon is dan toegelaten.* |
| Giver, the list | *Not used yet* · *Used on {date}: let in* · *Withdrawn* · *Expired* | *Nog niet gebruikt* · *Gebruikt op {date}: toegelaten* · *Ingetrokken* · *Verlopen* |
| Giver, what is kept | *We never receive the name or the message on the card. We keep that you recommended someone, a fingerprint of the code, the card's language, its dates, and which request it became.* | *Wij ontvangen de naam en de boodschap op de kaart nooit. Wij bewaren dat u iemand aanbeval, een vingerafdruk van de code, de taal van de kaart, de datums, en welke aanvraag het werd.* |
| Giver, the link (D2) | *Or send a link. Say in your own words what it is.* | *Of stuur een link. Zeg in uw eigen woorden wat het is.* |
| Giver, none for now | *No new recommendation can be made for now.* | *U kunt nu even geen aanbeveling maken.* |
| Card, title | *A recommendation from {giver}* | *Een aanbeveling van {giver}* |
| Card, what Ownpace does | *Ownpace copies your mail, calendars, contacts and files to a European provider. You switch from Google or Microsoft at your own pace. Until then Ownpace keeps the copy up to date.* | *Ownpace kopieert uw e-mail, agenda's, contacten en bestanden naar een Europese aanbieder. U stapt over van Google of Microsoft in uw eigen tempo. Tot dan houdt Ownpace de kopie bij.* |
| Card, what this card does | *Ownpace is in a free Alpha. With this card you are let in at once.* | *Ownpace zit in een gratis Alpha. Met deze kaart wordt u meteen toegelaten.* |
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
| Door, shown back | *We send an email to {email}. The code works once: after this step it is used.* | *Wij sturen een e-mail naar {email}. De code werkt één keer: na deze stap is hij gebruikt.* |
| Door, the button | *Use my code* | *Gebruik mijn code* |
| Door, already has access, the server's | *This email address already has access to Ownpace. Your code is not used. Sign in with that email address.* | *Dit e-mailadres heeft al toegang tot Ownpace. Uw code is niet gebruikt. Meld u aan met dat e-mailadres.* |
| Door, a request already waiting, the server's | *There is already a request from this email address waiting for an answer. Nothing was added, and your code is not used. Keep it: you can use it once that request is answered.* | *Er wacht al een aanvraag van dit e-mailadres op antwoord. Er is niets toegevoegd en uw code is niet gebruikt. Bewaar hem: u kunt hem gebruiken zodra die aanvraag is beantwoord.* |
| Let in | *You are in* | *U bent toegelaten* |
| Let in, what is left | *One thing is left: make your account. The sign-in service mails a code to {email}. With it you confirm that the address is yours.* | *Er is nog één ding te doen: maak uw account aan. De aanmeldservice mailt een code naar {email}. Daarmee bevestigt u dat het e-mailadres van u is.* |
| Let in, the button | *Create your account* | *Maak uw account aan* |
| Let in, the mail | *We also sent you an email, from {from}. It says the same.* | *Wij hebben u ook een e-mail gestuurd, vanaf {from}. Daarin staat hetzelfde.* |
| Let in, Google (D14) | *You want to move away from Google. We add {email} to a list at Google by hand, and write to you when that is done. Until then Google does not allow the connection.* | *U wilt weg bij Google. Wij zetten {email} met de hand op een lijst bij Google, en schrijven u als dat is gebeurd. Tot dan laat Google de koppeling niet toe.* |
| Let in, safety | *Ownpace never asks for your password by email or phone.* | *Ownpace vraagt nooit per e-mail of telefoon om uw wachtwoord.* |
| Let in, a mistyped address | *Is {email} not right? Write to {support}.* | *Klopt {email} niet? Schrijf naar {support}.* |

**What the drafts keep of the owner's words.** *Iemand die u dierbaar is* and *op een kaart*;
*Ownpace zit in een gratis Alpha*; the refusal, whole, with *cadeaucode* become *code*; the
sentence for a request already waiting, with *adres* become *e-mailadres*; and *aanbeveling*,
which becomes the name. The card's sentence about what Ownpace does says what it says today,
*in uw eigen tempo* included, in three sentences where the Dutch was one of 27 words.

**What D6 took out of the owner's words.** *En we laten mensen zelf toe. Met deze kaart
vraagt u ons om u toe te laten* (2026-11-25) said that Ownpace decides. Under D6 the card
lets the person in, so the draft says that. For the owner's read.

**One line is new under D6, and is this plan's reading:** *Give the card yourself. Whoever
has the code is let in.* It is not the sentence D1 took out. That one said what a
recommendation is not. This one tells the giver what the code does, now that nobody reads a
request first.

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
  person needs it.

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
| Opens, for a code | *You used a code from someone you know. You are in.* | *U gebruikte een code van iemand die u kent. U bent toegelaten.* |
| Step 1 | *Open the sign-in page with this link:* | *Open de aanmeldpagina met deze link:* |
| Under it | *The link ends in your own email address. That lets the page fill it in for you.* | *De link eindigt op uw eigen e-mailadres. Zo kan de pagina het voor u invullen.* |
| Step 2 | *Choose "Create your account". Use this email address:* | *Kies 'Maak uw account aan'. Gebruik dit e-mailadres:* |
| Step 3 | *Choose a password. The sign-in service then mails a code to this email address. With it you confirm that it is yours.* | *Kies een wachtwoord. De aanmeldservice mailt daarna een code naar dit e-mailadres. Daarmee bevestigt u dat het van u is.* |
| The guide | *Read the guide before you start:* | *Lees de handleiding voordat u begint:* |
| The name | *In the app your own space is called an organisation. Yours is called:* | *In de app heet uw eigen ruimte een organisatie. De uwe heet:* |

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
a recommendation. Nothing is waiting for you. The queue shows whose it was.* With D14 (a) it
adds the Google address to add.

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
- **When no card can be made** (D7) the page says *none for now*, and offers no button.
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
  was used, where the text now says the giver can tell a decline; and the Google address
  given at the door, if D14 goes as advised. With step B: that the giver's name is shown to
  whoever holds the code. T7 asks the owner whether the texts are still changed in place
  under 1.0 before it changes them, as 0176's T10 does.
- **Plan 0172** gets one dated line in its Status: its G1 is changed by D6 here.
- **The tester guide's *Google addresses first*** (§3.6) says the door's way too, if D14 goes
  as advised.
- **`docs/ending-the-alpha.md`:** what a recommendation is after the Alpha (D5, §13).
- **The operator's *Gifts* screen** and the access queue, English only: the free thing's
  name, and a request that is let in by a recommendation.
- **`apps/api/docs/openapi.yaml`:** the new route, a ninth beside 0172's eight, and the
  redeem's new answers.
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

## 14. Proofs (T8)

Each written first, to fail on `main` for the reason it names.

- **`apps/web/src/pages/a-code-with-a-door-of-its-own.unit.test.tsx`.** The first step holds
  one field and asks no address. A refused code stays in its field, under a heading that is
  tied to the field and announced; nothing else was asked. The third step has two fields, and
  no organisation, note or package is drawn or sent. The address is shown back before the
  button, with the sentence that the code is used by this step. After it the page says the
  person is in, and holds *Create your account* with the address filled in. An address that
  already has access, or a request waiting, keeps its code, and the page says so. Too many
  tries are said in Dutch on the Dutch page. `/redeem` opens the door, and so does the plain
  form's link. No welcome stands on the door. Fails today on the six fields.
- **`apps/api/src/routes/gifts.unit.test.ts`,** new cases. The check writes nothing and
  spends nothing. Each kind of bad code gets the one body. The check and the redeem share one
  limit. Its 429 has a Dutch half. An accepted code is answered as let in, and the yes mail
  and the operator's notice are sent after the commit, never before. A filled trap is
  answered as let in, and nothing is written. **`apps/api/src/knock-limit.unit.test.ts`**
  lists the route.
- **`apps/api/src/routes/a-gift-turned-into-a-request.unit.test.ts`** turns round: a code
  makes a request that is granted, an organisation and its owner's invitation, or none of
  the three. Never a seat in the giver's organisation, as today.
- **`packages/managed/src/gift-under-rls.unit.test.ts`,** new cases, on a real database where
  the suite runs one. A session that holds an unused code can write its own organisation and
  invitation, once. A session with no code, a used one, a withdrawn one or somebody else's
  can write none of it, and can read nobody's.
- **`apps/web/src/i18n/one-name-for-a-free-gift.unit.test.ts`.** No sentence of the card, the
  door, the giver's page, the two mails or the site's page calls the free thing a *gift* or a
  *cadeau*, a *place* or a *plaats*; each says *recommendation* or *aanbeveling*; and none
  says *key* or *sleutel*. Fails today on eight names.
- **`apps/web/src/pages/a-gift-on-every-screen.unit.test.tsx`** moves with the words. Its
  case for the owner's words gets a new date and the sentences the owner read. New cases: the
  giver's page says that the person is let in at once, and that whoever has the code is; it
  has no tick box; a used card says the day and *let in*; with a limit of nought it says
  *none for now* and not *already given*, which fails today.
- **`packages/shared/src/notifications.unit.test.ts`** and **`what-the-mails-say.unit.test.ts`,**
  new cases. The yes mail has no sentence saying it holds no link, and its steps are
  numbered. For a code it says so in its first line. The no mail's two languages say the
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

## 15. The owner's decisions (T13, T15)

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

### 15.2 Open: D14 to D16

Each has options, advice, and what the builder does until it is answered.

- **D14. How Ownpace learns of a Google address to add.** The owner adds it at Google by hand
  (D6). (a) The door asks one question on its third step, with two answers of one size: *Is
  this the address of a Google account that you want to move?* A yes is kept with the request,
  in fixed words; the operator's notice names the address; and the person reads that Google
  will not allow the connection until Ownpace has written (§7). (b) As for every tester
  today: the guide and the yes mail ask the person to mail the address to support first, and
  to wait. (c) A Gmail address is recognised by its ending and added unasked. **Advice: (a).**
  It is one tap for the common case, where the address a person gives is their Gmail address.
  (b) lets a recommended person find it in the guide after Google has refused them. (c)
  enters an address in a list at Google that the person did not ask for, which the privacy
  text does not cover. Any other Google address is mailed to support, as the guide says.
  **Until answered: (b).**
- **D15. An address that already has a request waiting.** Today the door says so and keeps
  the code (0172 §7, question 3, kept as built on 2026-11-25). (a) The code lets that person
  in too: the request that waits is the one that is granted, and nothing is left waiting.
  (b) As today. **Advice: (a).** D6 lets a recommended person in straight away, and (b) makes
  the one person who asked earlier wait longest. **Until answered: (b).**
- **D16. A ceiling, now that nobody reads a recommendation first.** 0172 kept no cap, because
  the owner counted by hand (§7, question 4 there). Under D6 the owner's hand is no longer in
  the way. Each person who is let in may recommend one more. Cards already made keep working
  after the owner sets the number each person may give to nought (§3.6). And Google's list
  ends at 100 addresses (§3.6). (a) No ceiling: one for each member is the limit, and the
  owner is mailed for each person who is let in. (b) A number the owner sets on the *Gifts*
  screen. At that number the door lets nobody in, says so, and keeps the code. **Advice:
  (b).** It is one column in the migration step A already has, one check and one sentence.
  **Until answered: (a),** which is what D6 says.

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

## 18. Risks

- **A code is now a way in for whoever holds it.** Before D6 the owner read every request.
  Now the giver's care is the check: the page tells them to give the card by hand, an unused
  code can be withdrawn, the door asks its question, and the owner is mailed for each person
  let in. The code is 80 bits behind a limit.
- **Nobody reads a recommendation first, and each person let in may recommend one more.**
  D16.
- **A mistyped address is let in.** The address is shown back before the button, and the
  page says where to write. The invitation is bound to an address that the sign-in service
  must verify, so only whoever reads that mailbox can take it up.
- **The yes mail may not arrive.** The page itself holds the way on, and says that a mail was
  sent only when one was.
- **This plan changes a decision of 0172.** Its G1 said that a redeemed gift lets nobody in
  by itself. T7 writes the change into 0172's Status when step A is built.
- **A new word for what the owner called a gift a day ago, and a card that says more than
  the owner's sentence did.** The owner chose the word (D1) and the way in (D6). The Dutch is
  read before a step merges.
- **The mails change for every request,** not only for a code. The Alpha's paragraph and the
  sentence about backups do not move.
- **A check is one more thing to guess at.** It shares the redeem's limit and its one
  refusal. Forty an hour is still nothing against 80 bits.
- **Two calls where there was one.** A code can stop working between them. The third step
  refuses it in the same words, and nothing was written before it.
- **Two answers tell a code's holder something about an address:** that it already has
  access, or that it has a request waiting. 0172 accepted the second (§7, question 3 there);
  the first is its like. Only a holder of an unused code can ask.
- **A name at the door makes a false page more convincing too.** It is shown as something to
  check; the question stays; and nothing on the server depends on the answer.
- **The question can be answered *yes* by anybody.** It is there for the reader who was not
  told: it gives them a calm way to wait, or to say no.
- **The address the mail comes from is a setting.** The door names it only from the server's
  own answer, never from the web build's.
- **Two plans touch the member's name.** T9 reads what 0176's T3 writes, and waits for it.
- **Three plans add managed migrations.** This step A's, and 0176's two in its step B, take
  their numbers one after the other, never side by side.

## 19. Building it in parts

As 0176 §23 does it. A key that no screen says is refused
(`apps/web/src/i18n/a-word-nobody-says.unit.test.ts`), so words travel with their screen.
Step A is one pull request, and its parts are branches that meet in it.

**Beside 0176's step A.** Five files are both plans': the glossary, the language switch
(`apps/web/src/components/LanguageSwitch.tsx`), `site/build.mjs`, the managed UI smoke and
`CHANGELOG.md`. The four middle parts open none of them, so they can be built while 0176's
step A is. Two parts wait. The glossary's two rows go in after 0176's glossary part. And the
last part waits until 0176's step A is merged: it takes the language switch in full words
from there (T6), and adds its one line to `site/build.mjs` (D9), its cases to the smoke and
its lines to the changelog.

| Part | Tasks | Files it owns |
|---|---|---|
| **First: the glossary** | T3's two rows | `apps/web/src/i18n/GLOSSARY.md` |
| **The web** | T1's screens, T2, T5, T6, T10 and their words | `apps/web/src/pages/Give.tsx`; the door's new files under `apps/web/src/pages/`; `RequestAccess.tsx`; `apps/web/src/AppRoutes.tsx`; `apps/web/src/services/gifts.ts`; `apps/web/src/index.css` (print); `apps/web/src/i18n/strings/gifts.ts`; `apps/web/src/i18n/operator-strings.ts` (the free thing's name); `a-gift-on-every-screen.unit.test.tsx` and the two new web tests |
| **The server** | T1's route, the limit, letting a person in, the server's sentences | `apps/api/src/routes/gifts.ts`, `packages/managed/src/gift-store.ts`, a new file under `packages/managed/migrations/`, `apps/api/docs/openapi.yaml`, `apps/api/src/routes/gifts.unit.test.ts`, `a-gift-turned-into-a-request.unit.test.ts`, `apps/api/src/knock-limit.unit.test.ts`, `packages/managed/src/gift-under-rls.unit.test.ts` |
| **The mails** | T4, and the operator's notice | `packages/shared/src/notifications.ts`, `apps/api/src/access-notify.ts`, `apps/api/src/routes/access-requests.ts`, `notifications.unit.test.ts`, `what-the-mails-say.unit.test.ts` |
| **The site and the documents** | T7 | `site/pages/nl/cadeau.md`, `site/pages/en/gift.md`, `site/site.unit.test.ts`, `docs/ending-the-alpha.md`, the privacy text if the owner says so, plan 0172's Status |
| **Last** | T8's smoke; T6's language switch; D9's path on the site; the records | `test/ui/managed-ui.ui.test.ts`, `site/build.mjs`, `CHANGELOG.md`, this plan's Status |

**The parts meet at three contracts,** fixed here so that none waits.

- **The check.** `POST /api/gifts/check` takes `{ code }`. It answers 200 with
  `{ ok: true, until, answersFrom }`, where `answersFrom` is left out when no mail is set up;
  410 with the body `GIFT_REFUSAL` has; and 429 as the redeem does, with a Dutch half.
- **The redeem.** `POST /api/gifts/redeem` takes the code, the address, a name if one was
  typed, and the language. It answers 201 with `{ letIn: true, mailed }`; 410 for a bad code;
  409 `already_in` for an address that already has access; 409 `already_asked` for one that
  has a request waiting; and 429.
- **The mails.** The event of the yes mail, and the operator's notice, each take one more
  true-or-false: that it came with a code, and that the person was let in. The server passes
  them; the mails' part says the words.

The path the card prints is `/code`, in both `Give.tsx` and `apps/api/src/routes/gifts.ts`.

**What waits for what.** The four middle parts wait for the glossary, and for nothing else.
The last part waits for the others. The owner's read of the Dutch comes after it, on §7's and
§8's tables. D14 to D16 each say what is built until they are answered; an answer that comes
later is a small change in one part.

**Step B is one task:** T9, after 0176's T3.
