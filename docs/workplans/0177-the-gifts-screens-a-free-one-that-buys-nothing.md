# Workplan 0177 — The gift's screens: a free one that buys nothing, a door of its own, a card that reads alone

> **In one line:** The screens a gift's giver and recipient see, after a desk review: a free gift says that it costs nothing, buys nothing and can be refused; the code gets a door of its own; the card reads without a screen; the two mails say what happened; a paid gift code stays as 0172 left it.

## Status — 2026-11-26 (update this block at the end of every session)

**2026-11-26: planned, for the owner's review; nothing is built.** The owner asked for the
gift's screens to be reviewed before they join a plan, and decided what a free gift is (§1).
This plan is what the review asks for. It changes no decision of 0172: a gift still becomes a
request that the owner reads, and a paid gift code is still for after the Alpha.

**Where the design comes from, and how far to trust it.** From the owner's decisions (§1), and
from a desk review: the journey drawn as it is built and as a sketch, each read by six
simulated readers. A language model played each: an older recipient, the giver, a younger
recipient, a volunteer at a library's digital help desk, an accessibility and plain-language
reviewer, and a privacy reviewer who watched for wording shaped like a swindle. A desk review
finds problems. It proves nothing about real people. T14 is the first test with people, and
what it finds outranks this plan's words.

**What the review found, in short.** No simulated recipient got through today's journey: each
stopped at the request form. All six readers preferred the sketch. The sketch failed in three
places of its own, which §2's rules now forbid: a safety sentence that was not exactly true, a
message written for the giver to send, and the word *invitation* for something that can be
refused. §3.5 has the findings one by one.

**Whose words these are.** The giver's page and the card carry the owner's words of
2026-11-25 (0172 T8). The two mails carry the owner's text review of 2026-10-10 (#1556). None
of them moves before the owner has read what would replace it: D1 for the name, D11 and D12
for the mails. Every sentence in §7 and §8 is a draft for that read.

**Every claim about the code below was read at `ae57042`,** which is `main` on 2026-11-26.
Two changes came after 0172 was merged, and are in the lines cited: the privacy text's two
additions about a gift (#2171), and the request form's package names in the page's language
(#2175).

**The order.** Three steps, each one mergeable by itself.
- **Step A, words and screens, no schema:** T1 to T8. One new route, which stores nothing.
- **Step B, a little data:** T9, T10 and T11.
- **Step C, after the Alpha:** T12.

T0 and T14 are the owner's. T13 holds the decisions, D1 to D13. Each says what the builder
does until it is answered, so step A can start. It can be built beside 0176's step A; only
its last part waits for that one (§19).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's hand test: from the mail that lets a person in to the first screen after signing in, word for word | owner | ⏳ **Owner** | §8. On a real phone, in Dutch and English. Blocks nothing; the yes mail's third step takes its words. |
| T1 The door: the code first and alone, then the request | builder | 📋 Planned | §5. One new route, no schema. M. |
| T2 The card: a full sheet, in type that can be read, with steps that match the screens | builder | 📋 Planned | §6. No schema. S. |
| T3 The words, EN and NL, and one name for the thing | builder | 📋 Planned | §7. The glossary first. Built with D1's advised name; merged after the owner's read. M. |
| T4 The two mails: what happened, in both languages alike | builder | 📋 Planned | §8. For every request, with one line more when it came with a code. After D11 and D12. M. |
| T5 The giver's page: what it is, what it is not, and what the other person will read | builder | 📋 Planned | §9. No schema. M. |
| T6 Size, contrast and targets on the door and the giver's page | builder | 📋 Planned | §10. No schema. S. |
| T7 What follows: the site's page, the glossary, the privacy text, the records | builder | 📋 Planned | §11. With each step. S. |
| T8 Proofs | builder | 📋 Planned | §14. With each step. |
| T9 Who sent it: the giver's name at the door and in the yes mail | builder | 📋 Planned | §12. Step B. After 0176's T3, which holds the name. M. |
| T10 What the giver hears: used, let in, or not | builder | 📋 Planned | §12. Step B. A managed migration. S. |
| T11 A receipt by mail, at once, for an accepted code | builder | 📋 Planned | §12. Step B. Only if D10 says so. S. |
| T12 After the Alpha: a paid code at the same door | builder | 📋 Planned | §13. Step C. With payments; 0172's G2. Not designed here beyond the door. |
| T13 The owner's decisions, D1 to D13 | owner | ⏳ **Owner** | §15. Each has advice, and says what the builder does until it is answered. |
| T14 A first test with four people | owner | ⏳ **Owner** | §16. After step A is on a stack the owner can reach. |

## 1. What the owner decided

Restated here, not quoted.

- **2026-11-26: the gift's screens are reviewed before they join a plan.** 0176 left them out
  (§19 there). This plan holds what the review asks for.
- **2026-11-26: a gift may be free as well as paid.** A free one buys nothing: no plan and no
  money. It works as a referral does: it brings a person to Ownpace and says who sent them. A
  paid gift code is unchanged: 0172's G2, *a paid code buys one of the plans*, after the
  Alpha.
- **2026-11-26: a gift made during the Alpha becomes a code after it,** paid or free as its
  giver picks.
- **From 0172, unchanged** (2026-11-24 and 2026-11-25): a gift lets nobody in by itself; it
  becomes a request, which the owner reads and may decline; it is valid for two years; a
  declined request gives the giver's gift back; Ownpace never sends it, the giver does; and
  nothing about the recipient is kept on the gift.

Not decided, and asked in §15: whether a free one is a code, a link or both (D2); whether
giving one gives the giver anything (D4); and what one that nobody used is when the Alpha
ends and its giver picked nothing (D5).

## 2. Who reads these screens, and ten rules

Two people. The giver is a member, which during the Alpha means somebody the owner let in.
The recipient has no account, did not ask for this, and may be older. They have been taught
that a gift nobody asked for is not a gift, that a code is never given away, and that a link
in a message is not tapped. Today's journey hands them a gift, with a code, to type into a
website.

Ten rules follow from the review. Each task below cites the ones it serves.

- **G1. The name promises nothing that can be refused.** Not *a place*, and not a welcome
  before the answer.
- **G2. Nothing shaped like a swindle.** No gift that was not asked for, no *claim*, no hurry,
  no message written for the giver to send, and no sentence in which a mail or a page calls
  itself safe.
- **G3. Every sentence is literally true,** and a safety rule exactly so.
- **G4. The code first, and alone.** Then only what the request needs.
- **G5. The page gives something to check and does not vouch:** not for itself, and not for
  the sender.
- **G6. Say what happens next:** when, from whom, and what then.
- **G7. Say what it costs, and to whom,** now and after the Alpha.
- **G8. One name for one thing,** on the card, the door, both mails and the site.
- **G9. The paper works alone, and matches the screens.**
- **G10. The giver is told what the other person will be told,** and what the giver will get
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
  both, the list of gifts, with *Revoke* on an unused one (`:246-284`).
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
  `packages/managed/src/gift-under-rls.unit.test.ts` (the refusal).
- **The managed UI smoke** opens the plain request form on a phone
  (`test/ui/managed-ui.ui.test.ts:2096`). It has no entry for `/redeem` or for the giver's
  page, and none in print.

### 3.5 What the desk review found

| # | The finding | Where | Rule | Task |
|---|---|---|---|---|
| 1 | The request form stops the recipient: *Organisation*, *What are you moving?*, a package | The door | G4 | T1 |
| 2 | The code is checked after everything else is typed, and the refusal stands four fields below it | The door | G4 | T1 |
| 3 | The reader is welcomed to the Alpha before anybody has decided | The door, received | G3 | T1 |
| 4 | The card promises *a place*; the same card, and the no mail, take it back | The card, the no mail | G1 | T3 |
| 5 | One thing has eight names | Everywhere | G8 | T3 |
| 6 | Nothing says what the new mailbox costs, or what follows the Alpha | The card, the door | G7 | T3 |
| 7 | The printed card is small, in a corner, with one instruction | The card | G9 | T2 |
| 8 | The yes mail says it holds no link, and holds three; its *one thing left to do* is three | The yes mail | G3 | T4 |
| 9 | The no mail differs per language, promises a message in English, and says nothing of the gift or of the data | The no mail | G3, G6 | T4 |
| 10 | The giver is not told that the answer can be no, how long it takes, or what they will hear | The giver's page | G10 | T5, T10 |
| 11 | Nobody is named after the card: not on the door, not in a mail | The door, the mails | G5 | T9 |
| 12 | Small type, pale edges, small targets | The door, the giver's page | | T6 |
| 13 | In the sketch: a safety rule that was almost true | The card, received, the yes mail | G3 | T3 |
| 14 | In the sketch: a message written for the giver to send | The giver's page | G2 | T5 |
| 15 | In the sketch: *invitation* for something that can be refused | Everywhere | G1 | T3 |
| 16 | In the sketch: a page that says it is Ownpace's, and vouches for a typed name | The door | G5 | T1, T9 |

What the readers asked to keep from today: the card shown as it prints, beside its fields;
a code mended in its own field; *degene die u de kaart gaf*; one line of help on a screen; the
plain fact about backups; and what is kept, in its three cases.

## 4. The design in one page

1. **A name that is true** (T3, D1). A free one is a recommendation: the giver tells Ownpace
   that they know somebody, and Ownpace decides. *Gift* is kept for a code that somebody paid
   for.
2. **A door of its own** (T1). A short address. First the code, alone. Then one question, the
   address and an optional name. Then what happens next.
3. **A card that reads alone** (T2). A full sheet, large type, three steps that are the
   screens' own, and who to ask.
4. **Two mails that say what happened** (T4), alike in both languages.
5. **A giver who knows what they hand over** (T5): that the answer can be no, what the other
   person will read, and what the giver will see afterwards.
6. **Then, with a little data** (step B): who sent it, shown as something to check; what the
   giver hears; a receipt.
7. **Later** (step C): a paid code at the same door.

## 5. The door (T1)

Serves G1, G3, G4, G5 and G6. One new route, and no schema.

**The address.** One short path that reads the same in both languages (D9). The card prints
it (`Give.tsx:48`; `apps/api/src/routes/gifts.ts:81-84`).

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
  So the page names no address that the answer does not come from. Step B adds the giver's
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
each a line: that Ownpace is still a trial, called the Alpha; that Ownpace reads every
request itself and the answer can be no; what it costs and to whom, now and after the Alpha
(G7); and, once T10 is built, what the giver will see. Then the question, with three answers
of one size:

- *Did {giver} tell you about this themselves: by phone, or when you saw each other?* Until T9
  the page has no name, and says *the person you got the code from*.
- *Yes* goes on. *No, not yet* opens a calm screen: ask them first; the code can be used
  later; nothing has been sent. *No, I do not want this* ends calmly: nothing has been sent,
  and the page asks the reader to tell the giver, who can then recommend somebody else.

The answer is not sent and not stored. It is there for the reader who was not told, and
gives them two calm ways out.

**Step 3 of 3: the request.**

- The address, with which address is meant. A name that may be left empty. The address shown
  back in a sentence before the button.
- The three things that happen next, the third being *you make an account*.
- What is kept, in today's three cases (`access.privacy`), with the privacy text and the
  Alpha conditions linked under it, as today (0139 T4).
- No organisation, no note and no package: the page draws none and sends none. It sends the
  code, the address, the name if one was typed, and the page's language. The form's trap
  stays (0093 T2d).
- An address that already has a request waiting is answered as today, in the server's words,
  and the code is kept (409). A code that stopped working since step 1 is refused here in the
  same words as there.

**Received.** That nothing has to be done and the page may be closed; where the answer goes,
when (D6) and from which address it comes; one exactly true safety sentence (§7); and where to
write if the address was mistyped.

**What the door does not show:** the Alpha's welcome before an answer (D13), a link to sign
in, or a sentence that says whose page this is. The address bar says that, and the card says
what to expect there (G5). The build stamp and the accessibility statement stay at the foot,
as on every screen (0145 T9 (b)).

**Steps, as a browser and a screen reader meet them:** as *Start a migration* has them and
0176 §5.6 spells out. Each step is a history entry, so the browser's Back goes one step back.
Each has one `h1`, which takes the focus when the step opens. The tab is named after the
step. The step is told in words: *Step 2 of 3*.

## 6. The card (T2)

Serves G2, G7, G8 and G9. No schema.

- **It fills the sheet it is printed on.** The print rule lifts the card's own width, sets a
  margin, and sets the type in points: sentences at 14 point or larger, the code at 24 or
  larger. One sheet, upright, on A4 and on Letter. The proof asks the browser, in print, what
  it drew (§14).
- **In this order:** the name of the thing and who it is from; the giver's own message, large,
  because it is the one sentence a careful reader trusts; what Ownpace does; what this card
  is, and that the answer can be no; what it costs and to whom; where to go; three numbered
  steps; the code; who to ask; who Ownpace is; until when the code works.
- **The three steps are the door's three steps:** type the code; answer one question; fill in
  your address and send. The address to go to stands above them, with *in the bar at the top,
  not in a search box*.
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

Serves G1, G2, G3, G7 and G8. The glossary changes first (`GLOSSARY.md`: *Change a word →
change it here first*): one row for the free thing under the name D1 gives it, and one that
keeps *gift* / *cadeau* for a paid code.

**Rules.** Where the recipient reads, a sentence has one idea and at most fifteen words. The
Dutch is *u*, as 0172's sixth answer has it (D13). No word a reader has to look up: not
*redeem*, *migreren*, *postvakken*, *optioneel*, *tekens* or *betaalgegevens*. *E-mailadres*
is never shortened to *adres*. *Account* means the Ownpace account; what a person has today
is *uw oude mailbox*.

**Whose sentence it is.** A refusal is the server's, in both languages, and the page shows
the half in its reader's language (ADR-0024; `apps/web/src/services/link-refusal.ts:34`). The
rest is the page's. The table says which.

**The sentences,** as drafts for the owner's read, written with D1's advised name. `{giver}`
is the giver's name as the card carries it. The door knows it only after T9; until then it
says *the person you got the code from* / *degene van wie u de code kreeg*. `{support}` is
the deployment's support address, and `{from}` the address the service mails from.

| Where | EN | NL |
|---|---|---|
| Giver, menu and title | *Recommend someone* | *Iemand aanbevelen* |
| Giver, first line | *Recommend someone dear to you for the Alpha, on a card.* | *Beveel iemand die u dierbaar is aan voor de Alpha, op een kaart.* |
| Giver, what it is | *You tell us that you know this person. We read their request ourselves, and the answer can be no.* | *U zegt ons dat u deze persoon kent. Wij lezen de aanvraag zelf, en het antwoord kan nee zijn.* |
| Giver, fact | *It costs nothing, and you buy nothing with it.* | *Het kost niets, en u koopt er niets mee.* |
| Giver, fact | *They get an account of their own. You do not see what is in it.* | *Die persoon krijgt een eigen account. U ziet niet wat erin staat.* |
| Giver, what you will see | *You will see that it was used. If we say no, you may recommend someone again.* | *U ziet dat het is gebruikt. Zeggen wij nee, dan mag u opnieuw iemand aanbevelen.* |
| Giver, tell first | *Tell them first: by phone, or when you hand it over.* | *Vertel het eerst zelf: aan de telefoon, of als u het geeft.* |
| Giver, shown once | *The code is shown only now. Lost it? Withdraw it below and make a new one.* | *U ziet de code alleen nu. Kwijt? Trek hem hieronder in en maak een nieuwe.* |
| Giver, what is kept | *We never receive the name or the message on the card. We keep that you recommended someone, a fingerprint of the code, the card's language, its dates, and which request it became.* | *Wij ontvangen de naam en de boodschap op de kaart nooit. Wij bewaren dat u iemand aanbeval, een vingerafdruk van de code, de taal van de kaart, de datums, en welke aanvraag het werd.* |
| Giver, none for now | *No new recommendation can be made for now.* | *U kunt nu even geen aanbeveling maken.* |
| Card, title | *A recommendation from {giver}* | *Een aanbeveling van {giver}* |
| Card, what Ownpace does | *Ownpace copies your mail, calendars, contacts and files to a European provider. You switch from Google or Microsoft at your own pace. Until then Ownpace keeps the copy up to date.* | *Ownpace kopieert uw e-mail, agenda's, contacten en bestanden naar een Europese aanbieder. U stapt over van Google of Microsoft in uw eigen tempo. Tot dan houdt Ownpace de kopie bij.* |
| Card, what this is | *Ownpace is in a free Alpha, and we let people in ourselves. With this card you ask us to let you in. The answer can also be no.* | *Ownpace zit in een gratis Alpha, en we laten mensen zelf toe. Met deze kaart vraagt u ons om u toe te laten. Het antwoord kan ook nee zijn.* |
| Card and door, cost | *Ownpace charges nothing during the Alpha. Your new mailbox is at a European provider. You pay that provider for it, not Ownpace.* | *Tijdens de Alpha kost Ownpace niets. Uw nieuwe mailbox staat bij een Europese aanbieder. Daarvoor betaalt u die aanbieder, niet Ownpace.* |
| Door, cost after the Alpha | *After the Alpha there are paid packages and a free one. You pay nothing before you have accepted the new conditions.* | *Na de Alpha zijn er betaalde pakketten en een gratis pakket. U betaalt niets voordat u de nieuwe voorwaarden hebt geaccepteerd.* |
| Card, where | *Go to {address}. Type it in the bar at the top, not in a search box.* | *Ga naar {address}. Typ dit bovenaan in de adresbalk, niet in een zoekvak.* |
| Card, the steps | *1. Type the code from this card. 2. Answer one question. 3. Fill in your email address, and send.* | *1. Typ de code van deze kaart. 2. Beantwoord één vraag. 3. Vul uw e-mailadres in en verstuur.* |
| Card, help | *Need help? Ask {giver}. Or write to {support}: a person reads it.* | *Hulp nodig? Vraag het {giver}. Of schrijf naar {support}: daar leest een mens uw bericht.* |
| Card, who | *Who Ownpace is: {site}* | *Wie Ownpace is, leest u op {site}* |
| Card, until | *The code is for one request, and works until {date}.* | *De code is voor één aanvraag, en werkt tot {date}.* |
| Door, step 1 | *Type your code* | *Typ uw code* |
| Door, the field | *The code* · *As on the card. Capitals and dashes do not matter.* | *De code* · *Zoals op de kaart. Hoofdletters en streepjes maken niet uit.* |
| Door, no code | *No code? Ask for access without one.* | *Geen code? Vraag toegang aan zonder code.* |
| Door, refused, the heading | *This code does not work* | *Deze code werkt niet* |
| Door, refused, the server's | *This code cannot be used. It may have been typed wrong, used already, withdrawn, or it may have expired. Check it against the card, or ask the person who gave it to you.* | *Deze code kan niet worden gebruikt. Misschien is hij verkeerd getypt, al gebruikt, ingetrokken of verlopen. Vergelijk hem met de kaart, of vraag het aan degene die u de kaart gaf.* |
| Door, refused, the page's line | *You can correct the code below. Nothing about you has been sent.* | *U kunt de code hieronder verbeteren. Er is niets over u verstuurd.* |
| Door, too many tries, the server's | *That is more tries than we expected from one place. Try again later. Nothing is lost.* | *Dat waren meer pogingen dan wij van één plek verwachten. Probeer het later opnieuw. Er gaat niets verloren.* |
| Door, a request already waiting, the server's | *There is already a request from this email address waiting for an answer. Nothing was added, and your code is not used. Keep it: you can use it once that request is answered.* | *Er wacht al een aanvraag van dit e-mailadres op antwoord. Er is niets toegevoegd en uw code is niet gebruikt. Bewaar hem: u kunt hem gebruiken zodra die aanvraag is beantwoord.* |
| Door, step 2, the Alpha | *Ownpace is still a trial. It is called the Alpha.* | *Ownpace is nog een proef. Die heet de Alpha.* |
| Door, step 2, who decides | *We read every request ourselves. The answer can also be no.* | *Wij lezen elke aanvraag zelf. Het antwoord kan ook nee zijn.* |
| Door, the question | *Did {giver} tell you about this themselves: by phone, or when you saw each other?* | *Heeft {giver} u hier zelf over verteld: aan de telefoon, of toen u elkaar zag?* |
| Door, answers | *Yes* · *No, not yet* · *No, I do not want this* | *Ja* · *Nee, nog niet* · *Nee, ik wil dit niet* |
| Door, not yet | *Then ask them first. You can use the code later, until {date}. Nothing has been sent.* | *Vraag het dan eerst na. U kunt de code later gebruiken, tot {date}. Er is niets verstuurd.* |
| Door, no thank you | *That is fine. Nothing has been sent. Tell {giver}: they can then recommend someone else.* | *Dat mag. Er is niets verstuurd. Vertel het {giver}: die kan dan iemand anders aanbevelen.* |
| Door, step 3, the address | *Your email address* · *We answer you there. It may be the email address you use today.* | *Uw e-mailadres* · *Daar antwoorden wij u. Het mag het e-mailadres zijn dat u nu gebruikt.* |
| Door, the name | *Your name (you may leave this empty)* | *Uw naam (mag, hoeft niet)* |
| Door, shown back | *We will send our answer to {email}.* | *Wij sturen ons antwoord naar {email}.* |
| Door, what happens next | *1. A person at Ownpace reads your request. 2. You get an email from {from}. 3. Is the answer yes? Then you make an account. The email says how.* | *1. Een mens bij Ownpace leest uw aanvraag. 2. U krijgt een e-mail van {from}. 3. Is het antwoord ja? Dan maakt u een account. In de e-mail staat hoe.* |
| Received | *We have your request* · *You do not have to do anything now. You may close this page.* | *Uw aanvraag is binnen* · *U hoeft nu niets te doen. U mag deze pagina sluiten.* |
| Received, when (D6) | *You usually hear from us within five working days.* | *U hoort meestal binnen vijf werkdagen van ons.* |
| Received, safety | *Ownpace never asks for your password by email or phone.* | *Ownpace vraagt nooit per e-mail of telefoon om uw wachtwoord.* |
| Received, a mistyped address | *Is {email} not right? Write to {support}.* | *Klopt {email} niet? Schrijf naar {support}.* |

**What the drafts keep of the owner's words.** *Iemand die u dierbaar is* and *op een kaart*;
the card's sentence about the Alpha, whole, with one sentence after it; the refusal, whole,
with *cadeaucode* become *code*; the sentence for a request already waiting, with *adres*
become *e-mailadres*; and *een persoonlijke aanbeveling*, which becomes the name.
The card's sentence about what Ownpace does says what it says today, *in uw eigen tempo*
included, in three sentences where the Dutch was one of 27 words.

**Where three of them come from.**

- **The safety sentence** is the second half of one the app has (`grant.password.never`,
  `apps/web/src/i18n/strings/grant.ts:204` / `:395`). Its first half, *never emails you a
  link*, is true of a person on a grant link and untrue here: the yes mail holds one. The
  sketch said *never asks for a password or for money*, which making an account and an
  invoice both contradict (G3).
- **The cost** restates the site, *an account you open with a European provider, paid to
  them* (`site/copy.mjs:149`), and the app's *Nothing is charged during the Alpha*
  (`alpha.nothingCharged`). What follows the Alpha restates the Alpha conditions, §11
  (`site/legal/alpha.md:372-384`): new conditions, sent ahead, and nothing carries on before
  they are accepted.
- **The term** is the one the privacy text gives for mail to support, *We aim to answer
  within five working days* (`site/legal/privacy.md:809-812`). Whether it may be named for a
  request is D6.

## 8. The two mails (T4)

Serves G1, G2, G3, G6, G7 and G8. Both are every request's mails, and their faults are the
mails' own. So they are mended for every request, and a request that came with a code gets
one line more. Their words are the owner's (§3.3): T4 writes what follows as a proposal, and
changes nothing before D11 and D12 are answered. No schema.

**How a mail knows of a code.** The decline already touches the gift: `giveBackDeclinedGift`
answers how many it gave back (`gift-store.ts:172`;
`apps/api/src/routes/access-requests.ts:738-741`). The grant reads the gift by the request's
id in its own transaction, as the queue's list does (`:399-418`). Each passes one
true-or-false to its mail.

**What stays as it is,** and the proofs that hold it: one sign-in address in the yes mail and
no token; the sentence about backups, with its one copy and its 7 days; the Alpha's paragraph
and its two addresses, word for word; no address in the no mail; a reply that reaches a
person; no promise the service cannot keep. The subjects stay.

**Yes, proposed.** In this order:

1. What the person asked for, and the answer. With a code: that somebody they know
   recommended them. After T9, by name.
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
a link, and a mail that calls itself safe is what a false one says too (G2). The mail that
invites a member into an organisation keeps the sentence: that mail is not this plan's (§17).

| | EN | NL |
|---|---|---|
| Opens | *You asked Ownpace for access. The answer is yes.* | *U vroeg Ownpace om toegang. Het antwoord is ja.* |
| Opens, with a code | *You asked Ownpace for access, with a code from someone you know. The answer is yes.* | *U vroeg Ownpace om toegang, met een code van iemand die u kent. Het antwoord is ja.* |
| Step 1 | *Open the sign-in page with this link:* | *Open de aanmeldpagina met deze link:* |
| Under it | *The link ends in your own email address. That lets the page fill it in for you.* | *De link eindigt op uw eigen e-mailadres. Zo kan de pagina het voor u invullen.* |
| Step 2 | *Choose "Create your account". Use this email address:* | *Kies 'Maak uw account aan'. Gebruik dit e-mailadres:* |
| Step 3 | *Choose a password. The sign-in service then mails a code to this email address. With it you confirm that it is yours.* | *Kies een wachtwoord. De aanmeldservice mailt daarna een code naar dit e-mailadres. Daarmee bevestigt u dat het van u is.* |
| The guide | *Read the guide before you start:* | *Lees de handleiding voordat u begint:* |
| The name | *In the app your own space is called an organisation. Yours is called:* | *In de app heet uw eigen ruimte een organisatie. De uwe heet:* |

**No, proposed.** One text, the same in both languages:

1. What the person asked for. With a code: that somebody they know recommended them.
2. That Ownpace cannot let them in now. No reason is given.
3. With a code: that the recommendation goes back to the person who gave it, who can
   recommend somebody again.
4. That the request is kept for 30 days and then deleted.
5. That a reply to the mail reaches a person.

No promise of a later message. The line about the open source stays for a request without a
code, and is left out for one with a code: a person with a card did not come looking for
software to run (D12).

| | EN | NL |
|---|---|---|
| Opens | *You asked Ownpace for access. We cannot let you in now.* | *U vroeg Ownpace om toegang. Wij kunnen u nu niet toelaten.* |
| Opens, with a code | *You asked Ownpace for access, with a code from someone you know. We cannot let you in now.* | *U vroeg Ownpace om toegang, met een code van iemand die u kent. Wij kunnen u nu niet toelaten.* |
| With a code | *The recommendation goes back to the person who gave you the code. They can recommend someone again.* | *De aanbeveling gaat terug naar degene van wie u de code kreeg. Die kan opnieuw iemand aanbevelen.* |
| The data | *We keep your request for 30 days and then delete it.* | *Wij bewaren uw aanvraag nog 30 dagen en verwijderen die daarna.* |
| Without a code | *Ownpace is open source: you can also run it yourself.* | *Ownpace is open source: u kunt het ook zelf draaien.* |
| Closes | *Do you think we misunderstood you? Reply to this email. A person reads it.* | *Denkt u dat wij u verkeerd begrepen? Beantwoord deze e-mail. Een mens leest uw antwoord.* |

**The no mail's event gains one true-or-false,** and nothing that holds words. The proof that
it has nowhere for the operator's note is changed on purpose, and still holds that
(`notifications.unit.test.ts:612-632`). That is why the no mail never names the giver, in
step B either.

**T0, the owner's hand test.** From the yes mail to the first screen after signing in, on a
real phone, in Dutch and in English. Written down word for word: what each screen of the
sign-in service says and asks for; whether a person who types the sign-in page's address by
hand finds a way to make an account there; and what the first signed-in screen shows. It
blocks nothing. The yes mail's third step takes its words when they are known.

## 9. The giver's page (T5)

Serves G1, G2, G3 and G10. No schema.

- **What it is and is not, first and at reading size,** in §7's words: you tell us you know
  somebody; it costs nothing and buys nothing; we decide, and the answer can be no; how long
  it usually takes (D6); they get an account of their own.
- **What the giver will see afterwards,** as true as the step allows: in step A, that it was
  used, and that a no gives it back; in step B, T10's states.
- ***Tell them first* is advice.** One line, no tick box: a box would force an untruth on a
  giver who tells the other person at the hand-over.
- **The card is shown as it prints,** with the three fields that stay in the browser, as
  today. *We never ask who it is for* becomes what is true: *we never receive it*.
- **A link, if D2 says so.** The page gives the link and one line: *send it in your own
  words*. It writes no message. The link carries the code after a `#`, so that the code is in
  no request on its way in, and the door reads it from there.
- **One fold, *What they will see*:** the door's three steps, the two mails and the account,
  in a few lines. The giver's name stands on the card as the person to ask, so the giver must
  know what is asked of them.
- ***Shown only now* gets its other half:** a lost code is withdrawn and made again, which is
  true today (0172 §7, question 1).
- **When no card can be made** (D7) the page says so, and offers no button.
- **A link to the site's page,** the follow-up 0172's fifth answer left.

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
- **The site's page** in both languages says what the door says, under the same name. The
  door links it as *read more*, and so does the giver's page. Its two addresses stay; its
  link to the door follows D9 (`site/build.mjs:1844`). The words pinned in
  `site/site.unit.test.ts` change with it.
- **The privacy text** (`site/legal/privacy.md` §4.4 and §9, and the Dutch): the name of the
  thing, if D1 changes it; with step B, that the giver's name is shown to whoever holds the
  code, what the giver gets to know, and the receipt. T7 asks the owner whether the texts are
  still changed in place under 1.0 before it changes them, as 0176's T10 does.
- **`docs/ending-the-alpha.md`:** what one made during the Alpha is after it (D5).
- **`apps/api/docs/openapi.yaml`:** the new route, a ninth beside 0172's eight.
- **`CHANGELOG.md`**, per step.

## 12. Step B: who sent it, what the giver hears, a receipt

**T9, who sent it.** The door names the giver once the code is known, and the yes mail does.

- The name is the one 0176's T3 keeps for a member, *as the people they send links to know
  them*: asked once, and not typed per card. A member with no name yet is asked for it before
  their first card, in that same field.
- It is shown as something to check, under the label *Sender*, and never as proof: a false
  page would print a name too, which is why the question of §5 stays (G5).
- The check's yes carries the name and nothing else of the giver. How an open door may read
  one member's name is T9's to build under the database's own rules: a function that answers
  the name for the code it was given, and nothing else. `gift-under-rls` holds it.
- A card made by a member who has no name shows no sender, and the door says *the person you
  got the code from*, as in step A.
- If 0176's T3 is not built yet, T9 waits for it.

**T10, what the giver hears.** The giver's list says each card's state in words: not used
yet; used, and waiting for our answer; let in; not let in, with *you may recommend somebody
again*. *Let in* is new: today the gift's row knows a decline (`request_declined_at`) and not
a grant, and the giver cannot read the request (0172 §3.2). One column, stamped by the grant
in its own transaction as the decline's is, in a managed migration. The door tells the
recipient, before they send, that the giver will see this (§5).

**T11, a receipt.** Only if D10 says so. One short mail at once, to the address typed, and
only when a code was accepted: that the request arrived, and from which address the answer
will come. One code sends one mail, so the route cannot be used to mail strangers.

## 13. Step C: after the Alpha

**T12.** The same door takes a code that somebody paid for, and says so: what was bought, who
paid, and that the reader fills in no payment details. *Gift* is that code's word. 0172's G2
decides what it buys. This plan only keeps the door fit for it: the check's answer can then
say which kind a code is, and nothing in step A's words would have to be taken back.

## 14. Proofs (T8)

Each written first, to fail on `main` for the reason it names.

- **`apps/web/src/pages/a-code-with-a-door-of-its-own.unit.test.tsx`.** The first step holds
  one field and asks no address. A refused code stays in its field, under a heading that is
  tied to the field and announced; nothing else was asked. After an accepted code, the
  request has two fields, and no organisation, note or package is drawn or sent. The address
  is shown back before the button. An address with a request waiting keeps its code, and the
  page says so. Too many tries are said in Dutch on the Dutch page. `/redeem` opens the door,
  and so does the plain form's link. No welcome, and no link to sign in, stands before an
  answer. Fails today on the six fields.
- **`apps/api/src/routes/gifts.unit.test.ts`,** new cases. The check writes nothing and
  spends nothing. Each kind of bad code gets the one body. The check and the redeem share one
  limit. Its 429 has a Dutch half. **`apps/api/src/knock-limit.unit.test.ts`** lists the
  route.
- **`apps/web/src/i18n/one-name-for-a-free-gift.unit.test.ts`.** No sentence of the card, the
  door, the giver's page, the two mails or the site's page calls the free thing a *gift* or a
  *cadeau*, a *place* or a *plaats*; and each says D1's noun. Fails today on eight names.
- **`apps/web/src/pages/a-gift-on-every-screen.unit.test.tsx`** moves with the words. Its
  case for the owner's words gets a new date and the sentences the owner read. New cases: the
  giver's page says that the answer can be no; it has no tick box; with a limit of nought it
  says *none for now* and not *already given*, which fails today.
- **`packages/shared/src/notifications.unit.test.ts`** and **`what-the-mails-say.unit.test.ts`,**
  new cases, after D11 and D12. The yes mail has no sentence saying it holds no link, and its
  steps are numbered. The no mail's two languages say the same things: the same paragraphs,
  the 30 days in both, a promise of a later message in neither. With a code, each mail says
  so. The no mail's event holds its kind and one true-or-false, and nothing that holds words.
  Fails today on all four. The cases of §8's *What stays as it is* stay green.
- **The card in print,** a case in the managed UI smoke, which gains entries for the giver's
  page and the door. In print: the card is at least nine tenths of the page's width, no text
  is under 14 point, and the code is on one line. On a phone at 390 and at 320 pixels: the
  code is on one line. Fails today on 10.5 point and on the broken code.
- **Sizes on the door,** in the same smoke: no text under 16 pixels, each target and edge as
  §10 says, nothing sideways at 320 pixels.
- **`site/site.unit.test.ts`:** the gift page's words, and that the door's *read more* is a
  file the site writes.
- **With step B:** `packages/managed/src/gift-under-rls.unit.test.ts`, for the one name an
  open door may read and for the grant's stamp; `a-gift-that-keeps-no-recipient`, still green.

Gates before a step is called done: lint, typecheck, the unit tests, the UI smoke.
`CHANGELOG.md` in both languages. E2E is the maintainer's to dispatch.

## 15. The owner's decisions (T13)

Not answered yet. Each has options, advice, and what the builder does until it is answered.

- **D1. What the free thing is called.** (a) A *recommendation* / *aanbeveling*: the giver
  tells Ownpace they know somebody, and Ownpace decides. (b) An *invitation* / *uitnodiging*.
  (c) A *gift* / *cadeau*, as today. **Advice: (a).** It is what the giver's page already
  calls it in its small print, in the owner's words. (b) is two other things in the app
  (§3.4) and was heard as a promise. (c) buys nothing, and a gift with a code and a website
  has a swindle's shape (G2). What moves under (a): the menu's *Geef Ownpace cadeau*; the
  owner's *Geef iemand die u dierbaar is een plaats in de Alpha, op een kaart*; the card's
  *Een plaats in Ownpace, voor u*; *cadeaucode*; the site page's title; and the privacy
  text's *Cadeaus*. §7 has what each becomes. **Until answered: (a) in the drafts; nothing
  merges before the owner has read the Dutch.**
- **D2. A code on a card, a link, or both.** (a) Both: the card first, and a link that the
  giver sends in their own words. (b) The card only. (c) The link only. **Advice: (a).** A
  careful reader will not tap a link, and a hurried one will lose a card. Under (a) the page
  writes no message for the giver. **Until answered: the card only, which is what exists.**
- **D3. Does the door say who sent it.** (a) The giver's name, as 0176's T3 keeps it, shown as
  something to check. (b) The name, and the address the giver signs in with. (c) Nothing: the
  card says it. **Advice: (a), in step B.** (b) shows a member's address to whoever finds a
  lost card. **Until answered: (c).**
- **D4. Does recommending give the giver anything.** (a) Nothing, and the giver's page says
  so. (b) Something later, with payments. **Advice: (a).** A recommendation that pays is a
  sale. **Until answered: nothing is given, and nothing is said.**
- **D5. An unused one at the end of the Alpha, when its giver picks nothing.** The owner has
  decided that the giver picks then: paid or free (§1). (a) Until the giver picks,
  it is a free one, and works until its date. (b) It ends with the Alpha, and the giver is
  told. **Advice: (a).** No card already handed over turns false. **Until answered: nothing
  printed promises more than (a).**
- **D6. May the door name a time for the answer.** (a) *Usually within five working days*,
  the term the privacy text gives for mail to support. (b) *Within a week*. (c) No time.
  **Advice: (a), if the owner will keep it.** A term that is missed is worse than none.
  **Until answered: (c), and the sentences that hold a time are left out.**
- **D7. What the giver's page says when nobody is being let in.** (a) That the answer can
  always be no; and when the number each person may give is nought, *none for now*, with no
  button. (b) How many places are left, which needs a number the product does not hold (0172
  §7, question 4). **Advice: (a). Until answered: (a),** since it only says what is true.
- **D8. What the giver gets to know.** (a) Used, let in, or not let in, in words; and the
  recipient reads the same before they send. (b) As today: *Used*, and a count that goes down
  by one after a no. **Advice: (a), in step B.** The privacy text already tells the recipient
  that the giver can tell a no. **Until answered: (b).**
- **D9. The address on the card.** (a) One short path that reads the same in both languages,
  such as `/code`. (b) `/redeem`, as 0172's fifth answer kept it. (c) A Dutch and an English
  one. **Advice: (a).** *Redeem* is the one English word on a Dutch card, and (a) serves a
  paid code too. **Until answered: (b).**
- **D10. A receipt by mail.** (a) Yes, in step B, for an accepted code only. (b) No: the
  received screen shows the address back. **Advice: (a).** A mistyped address is otherwise
  found after a week. **Until answered: (b).**
- **D11. The yes mail.** Its words are the owner's, from the text review of 2026-10-10.
  (a) §8's proposal, for every request. (b) The owner's words stay, and two things change: a
  request that came with a code says so, and the sentence that the mail holds no link goes,
  since it holds one. (c) Nothing changes. **Advice: (a).** With the sketch, each simulated
  recipient sent the request and then stopped at this mail. **Until answered: (c).**
- **D12. The no mail.** Its words are the owner's too. (a) §8's proposal: the promise to
  write when the Alpha ends goes, because the request is deleted after 30 days and nothing is
  kept to keep it with; the line about the open source stays for a request without a code.
  (b) As (a), and that line stays for every request. (c) The owner's words stay, and two
  sentences are added under them: the 30 days, and with a code that the recommendation goes
  back. **Advice: (a). Until answered: the mail stays as it is.** Under (c) the English still
  makes a promise that the Dutch does not.
- **D13. Two readings to confirm.** The card and the door stay *u*, as 0172's sixth answer
  has it, and the giver's own message carries the warmth; 0176's choice of *je* or *u* is for
  a person's link pages. And the Alpha's welcome leaves the code's door and its received
  screen, where it stands before any answer, while the plain request form keeps it, in the
  owner's words of 2026-10-04 (0131, D4 as amended). **Advice: both as stated. Until
  answered: both as stated.**

## 16. A first test with four people (T14)

The owner's. After step A is on a stack the owner can reach.

- **Who:** two recipients of seventy or older and one of thirty or younger, each given a card
  by somebody they know, on their own device; and one giver.
- **What to watch, and write down:** whether they start at all; where they type the address;
  what they answer to the question, and why; what they say they are getting and what it costs;
  what they do with the yes mail; what the giver says they are giving, and what they expect to
  hear back.
- **What comes back to this plan:** sentences to change, a screen to add or drop. No name of
  anybody, and nothing they typed.

## 17. Not in this plan

- **The plain request form,** for somebody with no code. It keeps its questions, which are
  the owner's words. The review read it only as the gift's door. One thing changes on it:
  *I have a gift code* becomes a link (§5).
- **The mail that invites a member into an organisation.** It ends on the same sentence about
  a link (`notifications.ts:1705`), and holds a link too. For whoever next touches that mail.
- **The screens after signing in:** the three texts to accept, and *Start a migration*.
- **What a paid code buys, and its price.** 0172's G2, with payments.
- **A cap on how many people the Alpha lets in.** 0172 §7, question 4: counted by hand.
- **The sign-in service's own screens.** T0 reads them; changing them is another plan.
- **A route with no link for a person's own pages** (0176 §19). The door here is built so
  that one door could later take that code too; nothing of it is built.

## 18. Risks

- **A new word for what the owner called a gift a day ago.** The owner's words of 2026-11-25
  are pinned by tests. D1 asks before a word moves, and the owner reads the Dutch before a
  step merges.
- **The mails are the owner's words, and every request's.** D11 and D12 ask first. The
  Alpha's paragraph and the sentence about backups do not move.
- **A check is one more thing to guess at.** It shares the redeem's limit and its one
  refusal, and the code is 80 bits. Forty an hour is still nothing against that.
- **Two calls where there was one.** A code can stop working between them. The third step
  refuses it in the same words, and nothing was sent before it.
- **A name at the door makes a false page more convincing too.** It is shown as something to
  check; the question stays; and nothing on the server depends on the answer.
- **The question can be answered *yes* by anybody.** It is there for the reader who was not
  told: it gives them a calm way to wait, or to say no.
- **A term for the answer is a promise** (D6).
- **The address the answer comes from is a setting.** The door names it only from the
  server's own answer, never from the web build's.
- **Two plans touch the member's name.** T9 reads what 0176's T3 writes, and waits for it.

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
| **The web** | T1, T2, T5, T6 and their words | `apps/web/src/pages/Give.tsx`; the door's new files under `apps/web/src/pages/`; `RequestAccess.tsx`; `apps/web/src/AppRoutes.tsx`; `apps/web/src/services/gifts.ts`; `apps/web/src/index.css` (print); `apps/web/src/i18n/strings/gifts.ts`; `a-gift-on-every-screen.unit.test.tsx` and the two new web tests |
| **The server** | T1's route, the limit, the server's sentences | `apps/api/src/routes/gifts.ts`, `packages/managed/src/gift-store.ts`, `apps/api/docs/openapi.yaml`, `apps/api/src/routes/gifts.unit.test.ts`, `apps/api/src/knock-limit.unit.test.ts`, `packages/managed/src/gift-under-rls.unit.test.ts` |
| **The mails** | T4, after D11 and D12 | `packages/shared/src/notifications.ts`, `apps/api/src/access-notify.ts`, `apps/api/src/routes/access-requests.ts`, `notifications.unit.test.ts`, `what-the-mails-say.unit.test.ts` |
| **The site and the documents** | T7 | `site/pages/nl/cadeau.md`, `site/pages/en/gift.md`, `site/site.unit.test.ts`, `docs/ending-the-alpha.md` |
| **Last** | T8's smoke; T6's language switch; D9's path on the site; the records | `test/ui/managed-ui.ui.test.ts`, `site/build.mjs`, `CHANGELOG.md`, this plan's Status |

**The web and the server meet at one contract,** fixed here so that neither waits. `POST
/api/gifts/check` takes `{ code }`. It answers 200 with `{ ok: true, until, answersFrom }`,
where `answersFrom` is left out when no mail is set up; 410 with the body `GIFT_REFUSAL` has;
and 429 as the redeem does, with a Dutch half. The path the card prints is D9's, in both
`Give.tsx` and `apps/api/src/routes/gifts.ts`.

**What waits for what.** The four middle parts wait for the glossary, and for nothing else.
The mails wait for the owner. If D11 and D12 are not answered when the rest is ready, step A
merges without the mails, and they follow as a pull request of their own. The last part waits
for the others. The owner's read of the Dutch comes after it, on §7's table.

**Step B is one line of work:** T9, then T10, then T11, with one managed migration, after
0176's T3.
