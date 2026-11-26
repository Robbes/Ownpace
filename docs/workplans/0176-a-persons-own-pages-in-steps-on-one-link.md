# Workplan 0176 — A person's own pages: in steps, in plain words, on one link

> **In one line:** The two pages a person opens from a link, with no account of their own: the permission asked in short steps, with Google's screens told before they come; one link for the whole journey; a stop that can be taken back; and *je* or *u* as the organisation chooses (the owner, 2026-11-26).

## Status — 2026-11-26 (update this block at the end of every session)

**2026-11-26: planned, written for the owner's review; nothing is built.** Every claim about the
code below was read at `2a16fab`, the head of the open draft pull request #2175
(`claude/ownpace-public-readiness-y7orc6-a21-family-words`), with file and line. That branch was
cut one commit behind `main` at `e0c271a`; the commit it lacks (#2174) changes
`grant-server-domain.ts` only. #2175's own changes are this plan's ground, and are not repeated
here (§3.7). **Build on #2175 once it is merged**, or on its branch.

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
- **Step A, words and layout, no schema:** T1, T2, T9, and the first halves of T5 and T6.
- **Step B, a small schema:** T3, T7, T8, and the total of T6.
- **Step C, the mechanism:** T4, and the second half of T5.

T10 and T11 travel with each step. T0 and T13 are the owner's and block only what they name.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's hand test: Google's own screens, word for word, in Dutch and English | owner | ⏳ **Owner** | §5.4, §15. The warning, its two buttons, the tick boxes, and *Access blocked*. Blocks only the quoted words of T1's fourth screen. |
| T1 The link page in steps: who asks, the accounts, what to have ready, what Google shows | builder | 📋 Planned | §5. No schema. L. Every rule today's page keeps stays (§5.7). |
| T2 The words, EN and NL, and the glossary rows they change | builder | 📋 Planned | §6, §15. After D1 and D2. M. |
| T3 Who asks: a name, a relation, and a number to check | builder | 📋 Planned | §7. A managed migration. M. After D7 and D11. |
| T4 One link: it asks, and afterwards it is the person's page | builder | 📋 Planned | §8. ADR-0035 amended first. A managed migration. L. After D4 and D5. |
| T5 Stopping: its own screen, two equal answers, and ten minutes to take it back | builder | 📋 Planned | §9. First half (the screen) in step A; second half (the window) needs a ledger migration. L. After D2 and D6. |
| T6 The progress page: nothing to do, how far, how long | builder | 📋 Planned | §10. The line and the refresh in step A; the total, an addition to the server's answer, in step B. M. |
| T7 *Je* or *u*, and the page's language, chosen per person | builder | 📋 Planned | §11. After T2, so each sentence is written once. A managed migration. L. After D8. |
| T8 Making the link: tell first, a message to send, 30 days | builder | 📋 Planned | §12. M. |
| T9 Size, contrast and targets on the two pages | builder | 📋 Planned | §13. No schema. M. |
| T10 What follows: the guides, the privacy text, ADR-0035, the glossary | builder | 📋 Planned | §14. With each step. M. |
| T11 Proofs: unit, the managed UI smoke, integration | builder | 📋 Planned | §16. With each step. |
| T12 A first test with three people | owner | ⏳ **Owner** | §17. After step A is on a stack the owner can reach. |
| T13 The owner's decisions | owner | ⏳ **Owner** | §18. D1 to D11, each with advice and with what the builder does until it is answered. |

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

Read at `2a16fab`. Grant links are managed-only: the appliance moves one implicit person and
issues none (`packages/managed/src/person-link-store.ts:29-30`).

### 3.1 The link page

`apps/web/src/pages/Grant.tsx` (927 lines). A person's link renders `PersonGrant` (`:353`); a
single migration's own link renders inside `Grant` (`:682`) and is not in this plan (§19).

`PersonGrant` is one long page. In order: one sentence, `grant.person.asking` (`:582`); a box of
facts, *Company*, *Asked by*, *Phone* (`:583-615`); a warning when a password is asked and there
is no phone (`:616`); `grant.check` (`:619`); *Report this link* (`:623`); the note about a page
opened inside a chat app (`:627`); then the accounts, sources first (`:629` on), one card each.
A card holds its state, its migrations, who can open the copy (`:479`), the read-only box, the
permission in words with the scope behind a fold, the *do it together* line and the button. Below
the cards: *every account is connected* (`:638`), the progress link once a password was
stored (`:644`), and the date the link works until (`:656`).

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

- **It says a state and a count.** *Your things are being migrated across now.* / *De migratie
  is actief.* (`view.state.active`, `:192` / `:632`), and *{count} migrated* / *{count}
  gemigreerd* (`view.copied.one`, `:200` / `:640`). There is no total: a row carries
  `itemsSynced`, `itemsFailed`, `bytesTransferred` and no count of what was found
  (`packages/shared/src/migration-view.ts:49-55`).
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
  account, and *a new grant clears it* (`apps/api/src/routes/withdraw-grant.ts:21-41`).

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
  (`view.state.destinationRemoved`), beside *gemigreerd* in the counts. D1 settles it.
- ***Leest alleen* is the software's promise; *alleen-lezen* is a permission the provider
  enforces.** Two facts, never one word (`:112`).
- **NL is formal: *u*, never *je*** (`:132`). No guard reads the dictionary for it; one reads
  the sign-in page (`scripts/a-sign-in-page-in-our-own-words.unit.test.ts:358`).

Also binding: *aanbieder*, never *provider* (`:98`); *stoppen* / *hervatten* is one data type no
longer following its source (`:93`), which is not what a person's stop does (D2); and the
guards `one-dutch-for-a-grant-link`, `a-word-nobody-says`, `words-that-fit-on-one-line` and
`hardcoded-text` in `apps/web/src/i18n/`.

### 3.6 Making the link

On a person's page in the app, under *For {name}* (`apps/web/src/pages/Person.tsx:532-551`):
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

- One line saying what Ownpace is (R5; D3).
- The title: *{who} asks for your permission*. `{who}` is who the page names today (`askedBy`,
  else the organisation); T3 makes it a name.
- The sender's facts, as §7 has them once T3 is built. Until then, today's box.
- **What is asked, in one sentence** for one source and one destination: *{who} wants to copy
  your {what} from {source} to {destination}.* For more than one, the sentence names how many
  accounts and the list comes on the next screen.
- Up to four facts, each a line: everything also stays in {source}; Ownpace only reads there
  (*leest alleen*, §3.5); who can open the copy, where it is true (`theOrganisationOpensIt`,
  from #2175); there is no hurry, with the date.
- **The question** (R6): *Did {who} tell you about this link themselves?* Two buttons of equal
  size: *Yes, that is right* and *No, not yet*. The buttons hold no name, so they fit a narrow
  screen whatever the sender is called.

The answer is not sent and not stored on the server. It opens the next screen. The page
remembers it for the tab only (session storage, read and written inside try and catch), so a
return from Google does not ask again.

`grant.check` leaves a person's link: the question replaces it. *Report this link* moves to the
*not yet* screen, where it answers something.

### 5.2 Not yet

A calm screen, with no blame (R6): ask {who} first, in a way you trust; the page can wait, with
the date; if you do not know {who}, close the page, or report the link. One button: *Back*.

### 5.3 The accounts

Shown when the link holds more than one account, or one that is already connected. With a single
waiting account the page goes straight on.

Sources first, then destinations, as today (`Grant.tsx:629`). Each line: the account, its
provider, what is copied from or to it, and its state in today's words (*Connected*, *Not
connected yet*, *Locked on this link*). One button per waiting account. When every account is
connected the page says so; after T4 it then shows the progress.

### 5.4 Per account: what to have ready, then what the provider shows

**A sign-in account (Google, Microsoft, Dropbox, Cirrux Drive): two screens.**

*Have this ready* (R7): the address; the password of that account; the phone, because the
provider may send a code to it; and *Give that code to nobody. Not to {who} either.* During the
Alpha, for Google: *Do this together with {who} if you can: on the phone, or at the table.* The
note about a page opened inside a chat app stands here (`grant.inAppBrowser`), because here it
can still be acted on.

*What you will see at {provider}* (R1, R3), as a numbered list:

1. **The sign-in.** *Sign in as {account}* (`grant.signInAs`, kept).
2. **The warning** (Google, and only while `isAlpha()`). *Google has not checked Ownpace yet.
   That is why Google warns, and Google is right to.* Then Google's own sentence, quoted, and
   the two things to tap, quoted (T0). Then: *Do this only here, because {who} told you about
   it themselves. At any other warning, stop.*
3. **What Google asks.** Today's lines (`grant.scope.*`), unchanged: they are Google's meaning,
   and the fold with the scope stays (ADR-0041 decision 4). Then: *Google's words are broader
   than what Ownpace does. Ownpace only reads. It sends nothing and deletes nothing. Leave the
   ticks on.*
4. ***Access blocked*** (Google, and only while `isAlpha()`). *Does Google say «…»? Then this
   address is not on Google's list yet. Close the page and tell {who}. You did nothing wrong.*
   The quoted words are T0's.

Then one line: *You can stop this at any time, on this page* (after T4; until then, *on the page
you get afterwards*, as today). And two buttons: *Sign in with Google* and *No, rather not*.
*No, rather not* ends calmly: nothing has happened, and the link works until its date.

For Microsoft, Dropbox and Cirrux Drive the same two screens carry their own words, which exist
(`PROVIDER_WORDS`, `Grant.tsx:176`). They have no warning step.

**An account connected with the person's own password** (0174): one screen, *Have this ready*,
then the password card as it is. Its lines stay: where the password is checked, the tries left,
that nobody can see it again, and that Ownpace never asks for a password by mail or phone.

**Until T0 is done** the warning step says what #2175 says (*Google shows a warning screen next,
because this service is new*) and quotes nothing. No word of Google's is written from memory.

**This replaces the owner's choice of 2026-10-18** on a person's link page only: there the
steps stand where the one line and its link to the guide stood. The member's own screens keep
`AlphaGoogleLine`. D9 asks the owner to confirm.

### 5.5 Coming back from Google

The ending is the server's own page (`apps/api/src/routes/migrations/google-consent.ts`,
`person-grant-ending.ts`). Since #2175 it says how many accounts are left and offers *Back to the
link*. Back on the link the first screen is passed over, and the accounts show the new state.
The endings take T2's words and T9's sizes.

### 5.6 Steps, as a browser and a screen reader meet them

- Each step is a history entry, so the browser's Back goes one step back and never off the page.
- Each step has one `h1`. Focus moves to it when the step opens.
- The step is told in words: *Step 2 of 4*. Never by colour or by dots alone.

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
the row at `:106` as D1 decides, adds a row for a person's stop as D2 decides, and adds the
sender's label. T7 edits *Register*.

**Keys that leave are removed**, with their Dutch, so `a-word-nobody-says` stays green.

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
for as long as the page lives, by the same account, into the same destinations. D4 has the
narrower option.

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
here. Whether that is *withdrawn as easily as it was given* is for the lawyer (D6).

## 10. The progress page (T6)

Serves R10.

- **First, whether anything is needed.** While copying runs: *You do not have to do anything
  now. You may close this page.* When something does wait, that comes first instead: an account
  to connect, or a connection that stopped (§8.4).
- **How far, of how much.** *{count} of ~{total}*, in the glossary's form (`GLOSSARY.md:106`),
  with *total not known* where discovery has no count. The total is a count, not content; it
  joins each row of `ViewDomainRow` (step B; no schema).
- **How long.** `HowLong`, as it is.
- **The numbers refresh by themselves**, once a minute while something is copying. Focus does
  not move and nothing is read out again. One line says when: *Last updated at {time}.*
- **Who can open the copy** is said here too, where it is true.
- **The date** the page works until stays (`view.until`).

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
- **Focus** shows as an outline two pixels wide that can be seen on white and on a button.
- **Zoom and width:** at 200% zoom and at 320 pixels wide nothing scrolls sideways and nothing
  is cut off (criteria 1.4.4 and 1.4.10).
- **The language switch** is a target like any other, in full words.
- **The accessibility statement** (`site/pages/en/accessibility.md` and its Dutch) is read
  against the result, and changed where it says less or more than is now true.

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

## 15. The words this plan introduces (for the owner to read)

`{who}` is the sender as the page names them; `{name}`, on the member's side, is the person
the link is for. Dutch is given with *u*; T7 adds the *je* form of each. The verb follows D1 (a)
and the stop's word D2 (a); the other option is in §18. `«…»` stands for Google's own words,
which T0 supplies.

**The link page.**

| Where | EN | NL |
|---|---|---|
| Above the title | *This page is from Ownpace, the service that makes the copy.* | *Deze pagina is van Ownpace, de dienst die de kopie maakt.* |
| Title | *{who} asks for your permission* | *{who} vraagt uw toestemming* |
| Label | *Sender* | *Afzender* |
| The number | *{who}'s number: {phone}. Or use the number you already have for {who}.* | *Nummer van {who}: {phone}. Of gebruik het nummer dat u al van {who} heeft.* |
| What is asked | *{who} wants to copy your {what} from {source} to {destination}.* | *{who} wil uw {what} kopiëren van {source} naar {destination}.* |
| Fact | *Everything also stays in {source}.* | *Alles blijft ook in {source} staan.* |
| Fact | *Ownpace only reads there. It deletes nothing and changes nothing.* | *Ownpace leest daar alleen. Het verwijdert niets en wijzigt niets.* |
| Fact | *There is no hurry. You can do this until {date}.* | *Er is geen haast. Dit kan tot {date}.* |
| The question | *Did {who} tell you about this link themselves?* | *Heeft {who} u zelf over deze link verteld?* |
| Answers | *Yes, that is right* · *No, not yet* | *Ja, dat klopt* · *Nee, nog niet* |
| Not yet, title | *Then wait a moment* | *Wacht dan even* |
| Not yet | *Ask {who} first, in a way you trust: call the number you already have, or ask when you see each other.* | *Vraag het eerst aan {who}, op een manier die u vertrouwt: bel het nummer dat u al heeft, of vraag het als u elkaar ziet.* |
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
| Google 3 | *Google's words are broader than what Ownpace does. Ownpace only reads. It sends nothing and deletes nothing. Leave the ticks on.* | *Google omschrijft het ruimer dan wat Ownpace doet. Ownpace leest alleen. Het verzendt niets en verwijdert niets. Laat de vinkjes aan.* |
| Google 4, Alpha | *Does Google say «…»? Then this address is not on Google's list yet. Close the page and tell {who}. You did nothing wrong.* | *Zegt Google «…»? Dan staat dit adres nog niet op de lijst van Google. Sluit de pagina en vertel het {who}. U heeft niets fout gedaan.* |
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

## 17. A first test with three people (T12)

The owner's. After step A is on a stack the owner can reach.

- **Who:** three people of the age these pages are for, on their own phone or tablet, with the
  person who would organise it beside them or on the phone.
- **What to watch, and write down:** do they tap the link at all; which screen they stop at,
  and what they say there; whether they read the warning step before Google; whether they find
  *stop*, and what they expect it to do; whether they can say afterwards who can read the copy.
- **What comes back to this plan:** sentences to change, a screen to add or drop. No name of
  anybody, and nothing they typed.

## 18. The owner's decisions (T13)

Each with the advice first, and what the builder does until it is answered.

- **D1. The verb on a person's two pages.** (a) *Kopiëren*, *gekopieerd*, *de kopie*, with the
  glossary's row at `:106` gaining the exception: a person's own pages say *kopiëren*, the
  member's app says *migreren*. A reader with no account hears in *migreren* that their mail
  goes away; *kopiëren* says the original stays, which is the fact they most need. The page
  half says it already (§3.5). (b) *Migreren* everywhere, as the row of 2026-10-10 says, and
  the three sentences that say *kopiëren* change back. **Advice: (a).** Until answered: (a) in
  drafts, nothing merged that changes a count's word.
- **D2. The word on the stop.** (a) *Stop copying* / *Kopiëren stoppen*, with a glossary row
  beside *stoppen* / *hervatten* (`:93`) saying a person's stop ends the reading of their
  account. (b) *Withdraw access* / *Toegang intrekken*, as today, on the larger button.
  **Advice: (a):** it names what the person sees stop. Until answered: (b), today's word.
- **D3. What the page says Ownpace is.** (a) *The service that makes the copy.* (b) The same,
  and where it is run, read from the deployment's configuration as the legal links are, never
  written into a sentence. **Advice: (a) now, (b) with the site's next pass.**
- **D4. Asking again on the same link.** (a) As §8.4: by itself when a connection stopped by
  itself; by a member's press after the person's own stop. (b) Only by a member's press, always.
  **Advice: (a).** Under (b) every person whose copy runs longer than a week waits on the
  member each time, during the Alpha. Until answered: (b), the narrower one.
- **D5. Lifetimes of the one link.** (a) The member makes one choice: how long the link asks,
  30 days first, 1 or 7 as today. The page lives 90 days, and a member can extend it. (b) Two
  choices, as today's two links have: 1, 7 or 30 days to ask, and 30, 90 or 180 for the page.
  **Advice: (a):** one question fewer at the moment a link is made. Until answered: (a).
- **D6. The window on a stop.** (a) Ten minutes, with the sentence of §9.2 that says what is
  kept, and the link that ends it at once. The lawyer reads it in the next pass. (b) No window
  until the lawyer has read it; the screen of §9.1 only. **Advice: (a) built, and (b)'s
  question put to the lawyer before it ships to anybody outside the Alpha.**
- **D7. The relation.** (a) A fixed list (§7). (b) Free text. **Advice: (a).**
- **D8. *Je* or *u*: per person or per organisation.** (a) Per person. (b) One choice for the
  organisation. **Advice: (a):** a family says *je* to one parent and *u* to another.
- **D9. Google's screens told on the link page.** This replaces, on a person's link page only,
  the choice of 2026-10-18 for one line and a link to the guide. **Advice: yes;** it is what
  all seven simulated readers asked for. Until answered: the steps are built, and the warning
  step says only what #2175 says.
- **D10. The order,** and which alpha takes step A. **Advice: the order of the Status block;
  step A in the next alpha.**
- **D11. Whose number.** (a) The member's own where given, else the organisation's. (b) The
  organisation's only, as today. **Advice: (a):** with two members, the organisation's number
  may not be the sender's. Until answered: (b).

## 19. Not in this plan

- **A route with no link:** an address and a code typed by hand. The owner: *"Yes, but first
  reason more on this."* A plan of its own, after T4, because a typed code is a second spelling
  of the same one link.
- **A word agreed by voice.** The owner: *"No"*.
- **A mail to the organisation** when a person gives permission or stops. There is no such
  notification today (`packages/shared/src/notifications.ts`). §9.2 tells it on the member's
  screens only.
- **A single migration's own link** (`Grant.tsx:682` on), which a person's link replaced on
  2026-10-03.
- **The gift's screens,** the member's own screens beyond §12, and the site.
- **Leaving the Alpha at Google.** Once Google has verified the app, the warning step and
  *Access blocked* are expected to go, and the weekly stop with them. Until somebody has seen
  that, `isAlpha()` is the rule.

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
