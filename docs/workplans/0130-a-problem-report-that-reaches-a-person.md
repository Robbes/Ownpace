# Workplan 0130 — A problem report that reaches a person

> **In one line:** Report a problem on managed: `POST /api/problem-reports` files a Zammad ticket, or mails the support mailbox (the alpha), with facts from our records and the browser shown before sending; linked from the `unknown` failure remedy; the same for *Report this link*; plus privacy wording.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: T6 Part B, what the browser knows.** The second of the owner's *"Both parts"*. On
the same branch, on top of Part A, not merged:

- **The facts only the browser has**, sent as one small object, `browser`, with the report and,
  as JSON in the query, with the preview, so the fold shows what is sent: the screen's language
  (`Screen language: Dutch`), the IANA time zone (`Time zone: Europe/Amsterdam`, which turns
  "at 14:02" into the log's UTC), the window's width in CSS pixels (`Window width: 390 px`: the
  proposal's *screen width*, taken as the width the page is laid out at, which is what a layout
  bug follows), the web app's build (`App build in the browser: v… · …, not the server's`,
  written only when its version, or both commits, differ from the API's own `/version`), the
  failure line the form came from (`Failure line: email, target side, migration <id>`), and a
  `Recent error: <reference>, <code>` line for each fault the page met in the five minutes
  before the form was opened, at most three, newest first.
- **Checked by the server, and never a reason to refuse** (`apps/api/src/report-browser-facts.ts`).
  Zod, one schema per key of a fixed list (`BROWSER_FACT_KEYS`): the language `en` or `nl`; a
  time zone of at most 64 characters, letters, digits, `_+-` and up to two `/`; a whole width
  from 1 to 20 000; a version of at most 40 characters without spaces; a commit of 7 to 40 hex; a
  data type of `DISCOVERY_DOMAINS`, a side of `FAILURE_SIDES`, a migration id in the UUID shape;
  recent errors a list of one to three, each an 8-hex reference and a code in `serverFault`'s
  shape. Anything else is dropped without a word: an unknown key (an entry's too), a value too
  long or of the wrong shape, a longer list, a preview query longer than 2000 characters or not
  a JSON object. `reportFactLines` writes the lines after `Browser:`, under six new labels of
  `REPORT_FACT_LABELS`, so the fold, the mail and the Zammad article carry them alike.
- **The recent faults, kept as two words** (`apps/web/src/services/recent-errors.ts`). A
  *"Something went wrong"* answers with its reference inside a sentence, which the person had to
  copy. Both of the app's session clients (`api.ts` and the operating screens' in
  `operating-service.ts`) hand every error to `rememberFault`, which reads the answer's status and
  body and nothing else: an answer from 500 up whose `reason` or `message` names `Reference
  <8 hex>` is kept as that reference, its `error` code (`unknown` when it is not in the code's
  shape) and when. Never the error: what axios rejects with holds the request, whose headers carry
  the sign-in token and whose address can carry a query. In memory, the newest three, each once,
  and forgotten on sign-out and on sign-in (`auth-store.ts`). The form reads them once, with the
  time zone, width and build, when it opens, so the preview and the report say the same and the
  five minutes count to when the person came to report.
- **The failure line passes what it knows.** `SendItToUs` takes a data type, a side and a
  migration, and puts them in the form's address as `dataType`, `side` and `migration`: the
  progress strip its line's data type and side, Connections its standing failure's migration, its
  side, and its data type when there is one, the failed item its data type, a failure group its
  data type and migration. The form keeps each only in its own shape.
- **The fold** lists them among the service's lines; when those cannot be had, in the reader's
  own words under the form's own list: *the language of this screen: English* / *de taal van dit
  scherm: Nederlands*, the time zone, *the width of this window* / *de breedte van dit venster*,
  this page's version *if the service runs another* / *als de dienst een andere draait*, the
  failure's data type (in the reader's word for it), its side, its migration, and *the reference
  of an error from the last 5 minutes* / *de referentie van een fout uit de afgelopen 5 minuten*.
- **Privacy §4.5**, EN and NL, same place in the same sentence, version lines untouched: after
  the browser's name, *what your browser tells the form* / *wat uw browser het formulier vertelt*,
  each of the above named. `openapi.yaml` (the `browser` query parameter and body field, a
  `BrowserFacts` schema), step 8f of `docs/managed-bring-up.md` and Stage 8 step 7 of
  `docs/owner-test-runbook.md` say so.

Guards: `apps/api/src/a-report-that-carries-what-the-browser-knows.unit.test.ts` (33), through
the real route: every fact as its line after `Browser:`, the same in the preview (asked with
JSON), the mail and the Zammad article; English, a failure line with only what it had, the app's
build only when it is not the server's, nothing when nothing was sent; every line under a label
of the list; the fixed key list; a canary token planted as an unknown key, in a config's
`Authorization` header, in an address's query and in a recent error's extra key reaching neither
the mail nor the preview; eighteen values dropped one by one, each beside a fact that is kept (a
language it does not have, a time zone too long, with a newline and a header after it, or with
markup, a width that is text, too wide or not whole, a version too long or with a space, a commit
that is not one, a data type, side or migration id that is not one, a recent error's reference,
code or length, a list too long, a list that is an object); the whole object dropped when it is
text, a list, a number or null, in the body and the query; a preview query over 2000 characters
dropped while every fact at its longest fits; a report never refused for what the browser said.
`apps/web/src/pages/a-report-that-carries-what-the-browser-knows.unit.test.tsx` (17), through the
app's real axios clients and interceptors with a stand-in network: a failed request carrying the
canary as its sign-in token, a header, its address's query, its parameters and body, and the
answer's other field and header, leaves the reference and code and nothing else, in what the ring
hands out and in what it holds; the operating client's faults too; nothing of a 400, a 500
without a reference, an HTML 502 or a request with no answer; a code it cannot read kept as
`unknown`; the newest three, each once; forgotten on sign-out and sign-in; offered to a form
opened 4:59 after the fault and not to one opened 5:01 after, in the preview and the report; the
canary in neither the preview, the report nor the fold, with the preview's lines and without;
the facts the same in the preview and the report; a data type, side or migration in the address
that is not one dropped; the fold's own list in English and Dutch; the strings' EN and NL pairs;
and the failure line's links. Red on the branch head: neither file loads (no
`report-browser-facts.ts`, no `recent-errors.ts`); with empty stand-ins, 27 of 33 and 15 of 17
failed, the ones passing being those that hold something is dropped or forgotten, which a head
that takes nothing does vacuously. Existing guards adapted to the new object in the body and the
query, and the new `dataType` in the strip's link: the web `a-report-that-reaches-a-person`,
`a-report-that-says-what-it-sends` and `a-failure-that-says-send-it-to-us`.
`scripts/a-screenshot-the-front-door-lets-through.unit.test.ts` counts every browser fact at its
longest in the largest report, and holds that none of them is dropped there. 22 mutations, all
killed: the API client, or the operating client, not remembering a fault; the ring keeping the
request (killed once the guard read what the ring holds, not only what it hands out) or handing
out whole entries; ten minutes counted as recent; a 4xx counted as a fault; sign-out keeping
them; a code kept as it came; no dedupe (killed once the sequence repeated the newest); the side
taken from the address unchecked; the link without the migration; the preview asked without the
facts; the fold's own list without the recent error; a Dutch string left in English; and in the
API every key copied, a time zone of any characters, recent errors unbounded, the preview's JSON
unbounded, the app's build always written, the lines without the browser's, a code of any text,
and a width of any number.

**2026-09-28: T6 Part A, the review's seven findings fixed.** On the same branch, not merged:

- **The preview no longer hands out the operator's address.** With `REPORT_MAIL_TO` empty,
  reports go to `NOTIFY_TO`, the operator's own list, and `GET /preview` gave that list to every
  signed-in member, a viewer too. Now `reportMailConfigFrom` records whether `to` is the support
  mailbox (`supportMailbox`, true only when `REPORT_MAIL_TO` names it), and the preview answers
  `{ kind: 'mail' }` without addresses otherwise; the form then says *"Goes to the Ownpace support
  team."* / *"Gaat naar het supportteam van Ownpace."*. `openapi.yaml` and step 8f of
  `docs/managed-bring-up.md` say so.
- **Privacy §4.5, EN and NL,** names the sign-in address among what a report from the app carries,
  *so we can reply* / *zodat we kunnen antwoorden* (the mail's `Reply to` line, its Reply-To, and a
  Zammad ticket's customer), and says *these facts* / *deze feiten* where it said *facts from our
  records*: the page, the build and the browser are not records. Version lines untouched.
- **The fold** says *"…exactly as our support team reads them, in English"* only above the
  service's lines, which are marked `lang="en"` (WCAG 3.1.2, for a Dutch screen reader); when
  they cannot be had, the form's own list has an introduction of its own (`report.facts.known`).
  *From our records* is gone from the fold's sentences.
- **Step 8f** no longer says the form showed every line: it showed the fact lines, `Page` to
  `Browser`, unless the preview could not be read, and `Reply to` and `Report reference` are added
  on sending.

Guards: the API's `a-report-that-says-what-it-sends` (23, was 20) adds a migration whose grant was
withdrawn with a token still stored, with a revoked and an expired grant link, a newer used one
and a newest progress link (*Grant: withdrawn on …*, *Grant link: used*); a malformed
`last_error_reference`, planted with the column's CHECK (0061) dropped for that case, written
*reference unrecognised* and never itself; and `REPORT_MAIL_TO` empty, blank or absent giving a
viewer `{ kind: 'mail' }`, no address, while the report still goes to `NOTIFY_TO`.
`a-report-that-reaches-support-by-mail` expects the new field. The web guard (22, was 16) waits
for the service's first line before comparing, with the preview answering 30 ms late: before the
fix the Dutch case compared the form's own list to the lines and failed; it checks `lang="en"`,
the fallback's own introduction in both languages, and the address left out when the service
names none. Real Postgres (`local-pg.sh`, 16): the integration file, 2 of 2. 15 mutations, all
killed: the grant link always `live`, the oldest grant link, a progress link counted, a token
winning over a withdrawal, the reference passed through unvetted (the five that survived the
review), the preview handing out `NOTIFY_TO`, `supportMailbox` set by an empty `REPORT_MAIL_TO`,
never naming the support mailbox; and in the web app the lines without `lang`, `lang="en"` on the
Dutch fallback, the English promise above the fallback, a recipient without addresses refused, a
"by email to" with no address, *from our records* back in the fold, and the fold's introduction
dropped.

**2026-09-28: a report that says what it sends (T6, Part A).** A report carried the page, the
error's reference and category, the organisation's id and the build, and support's first answer
was always a question. The proposal (what a report could carry by itself, and why not an
automatic screenshot) went to the owner, who chose *"Both parts"*, kept report mails *"Until
resolved + 6 months"*, and for facts that cannot be read chose *"Send anyway"*. This is Part A,
the facts from our records; Part B, the browser's facts and the recent error's reference, is not
built. Built on branch `claude/ownpace-public-readiness-y7orc6-a-screenshot-anyone-can-make`, on
top of the screenshot work below, not merged:

- **Facts from our records, read on the server** (`apps/api/src/report-facts.ts`), in one
  `withTenantDb` transaction in the reporter's organisation, as `app_user`, never from the
  browser: the organisation's status, and its closing and removal dates when it is closed; the
  migration the page names (`/mappings/<id>`), when it is one of this organisation's: its state,
  whether access was given through a link or withdrawn (asked in SQL as whether there is a
  grant, so the token never leaves the database), its newest grant link's state, and each data
  type's state, error category, side and reference; the providers of its two accounts and their
  status as the last test left it; whether the report's reference is a current failure, and of
  which data type on which migration; the service hold, on or off and since when (never the
  operator's message); and whether the scheduler's tick ran in the last five minutes. From the
  request: the role, from the membership row, and the browser, the `User-Agent` header on one
  line and capped at 300 characters. Another organisation's migration id, which anybody can
  type into the address bar, reads as *not one of this organisation's*, as an id that exists
  nowhere does. Every value is one of its column's own words or it is written `unrecognised`:
  `last_error_category` has no CHECK in the database.
- **What is never read:** a provider's error text, items and their names, folders, what an
  organisation or a migrated person typed (names, addresses, hosts, the organisation's name and
  settings), credentials and tokens, and the hold's message. Each read names its columns, and
  `REPORT_FACT_FIELDS` is the whole list of what the facts can hold.
- **One function writes the lines** (`reportFactLines` in `problem-report.ts`): `Page`,
  `Reference`, `Category`, `Organisation`, `Build`, then `Role`, `Organisation status`,
  `Migration`, `Grant`, `Grant link`, a `Data type …` line each, `Source account`, `Destination
  account`, `Reference match`, `Service hold`, `Scheduler`, `Browser`. The mail and the Zammad
  article carry them; `REPORT_FACT_LABELS` lists every label a line can start with.
- **`GET /api/problem-reports/preview`**, signed in, for the reporter's own organisation, sixty
  an hour per person: where the report goes (`{ kind: 'mail', addresses }` from `REPORT_MAIL_TO`,
  or `{ kind: 'helpdesk' }`) and the lines. On sending, the route reads the facts again and takes
  none from the body. In `apps/api/docs/openapi.yaml`.
- **Facts that cannot be read do not stop a report.** It goes with `Facts: could not be read [ref
  …]` in place of the records' lines (the role, the page and the browser still go), and the error
  is recorded as `report.facts-unread` under that reference. A read that takes more than five
  seconds (`REPORT_FACTS_DEADLINE_MS`) is treated the same: the person is waiting, and a report
  is for exactly the moment the database is the problem.
- **The form.** Above Send it says where the report goes: *"Goes to the Ownpace support team,
  by email to support@ownpace.eu."* / *"Gaat naar het supportteam van Ownpace, per e-mail naar
  support@ownpace.eu."*, with the address the service answers, every address when there are
  several; *"Goes to the Ownpace support team's helpdesk."* / *"Gaat naar de helpdesk van het
  supportteam van Ownpace."* with a Zammad; and *"Goes to the Ownpace support team."* when the
  preview could not be had. Then *Replies go to …* as before, and a closed fold, *What we send
  with this* / *Wat we meesturen*: what you write and the screenshot, and every line from the
  preview, verbatim and in English, as the support team reads them (ADR-0024's prose boundary);
  the fold says so in Dutch too. This closes the gap the research found in T5: the form never
  listed the organisation or the build, and said only "us". When the preview fails, the fold
  lists the page, reference and category the form knows and says the rest is read on sending
  and goes with it. The *Sent with your report* box and its key are gone.
- **The link form** says what it already sends, text only, no new facts: *"Sent with it, from our
  records: which link this is; the organisation and the migration it belongs to, with the state
  of the migration; the address of whoever made the link; the account the migration copies from
  and the account it copies to; and whether you have given access."* and its Dutch.
- **The privacy policy (T4),** EN and NL, same structure, version lines untouched: §4.5 gains a
  paragraph on reports (both doors; during the Alpha by email to support@ownpace.eu, a mailbox at
  Proton, through the mail provider in §7; what a report from the app and one from a link carry;
  content only if the person puts it in their words or the screenshot), and §9 a row, *Support
  mail and reports: until your question or problem is resolved, then 6 months more* / *Supportmail
  en meldingen: tot uw vraag of probleem is opgelost, en daarna nog 6 maanden*. §7's relay row,
  §8's "no third country" beside Proton in Switzerland, and alpha §10's erasure list are
  unchanged and stay with the lawyer (0133, 0139).
- **Docs.** Step 8f of `docs/managed-bring-up.md` lists the new lines and the unread line; Stage 8
  step 7 of `docs/owner-test-runbook.md` expects the recipient sentence, the fold, and the same
  lines in the mail.

Guards: `apps/api/src/a-report-that-says-what-it-sends.unit.test.ts` (20), through the real route
on PGlite as `app_user` with both chains: the facts read with every column of every table filled
in hold exactly `REPORT_FACT_FIELDS`, and every line starts with a label of `REPORT_FACT_LABELS`;
the exact lines for a migration with a failing data type, a withdrawn grant, a grant never given,
no migration on the page, a closed organisation, a hold and a stopped scheduler; the role from the
session and not the query, the browser on one line and capped; canaries planted in a provider's
error text, an item's name and folder, an account's name, address, host and token, the
organisation's name and phone, the migration's name, a category nobody wrote and the other
organisation's rows reach neither the preview nor the mail; another organisation's migration id
and its failure's reference give nothing of it; the preview's lines are the mail's and the Zammad
article's; sending reads again (a migration paused between preview and send says paused) and takes
no role, lines or facts from the body; facts that throw or hang still send, with the line and one
`report.facts-unread` event; and the preview's sign-in, refusals, redaction, 503 and limit. And
`apps/api/src/routes/a-report-that-says-what-it-sends.integration.test.ts` (2), on real Postgres
through the API as wired (`APP_DATABASE_URL`, `app_user`, no test seam), run here on
`scripts/local-pg.sh`'s PostgreSQL 16: A's own migration and failure give their facts, B's give
nothing, and no planted text reaches the answer. `apps/web/src/pages/a-report-that-says-what-it-sends.unit.test.tsx`
(16): every line in the fold, in English and Dutch, closed until opened and above Send; the
preview asked with the page, reference and category; the fallback and an answer of the wrong
shape; the recipient sentence for mail, several addresses, the helpdesk and no answer, and no
address in any string; the report's body unchanged; the link form's sentence names the
organisation, migration, account, maker and access in both languages. Red on the branch head: the
API file does not load (no `report-facts.ts`); with an empty stand-in module, 19 of 20 failed, the
one passing being the field list held against the stand-in's own empty list. The web file: 16 of
16. The integration file: 2 of 2 (404). Existing guards adapted: `a-report-that-reaches-a-person`
and `a-report-that-reaches-support-by-mail` in the API hand the route a quiet reader (their subject
is where a report goes), the web `a-report-that-reaches-a-person` opens the fold, and
`a-link-that-can-be-reported` and the UI smoke (`test/ui/managed-ui.ui.test.ts`, with a preview
fixture, run in Chromium, 12 of 12) read the new sentences. 0137's `a-role-that-promises-less-than-it-allows`, which lists every
read of the caller's role under `apps/api/src/routes` as a door only an owner may pass, now names
the report's two reads (`GET /preview` and `POST /`) as not a door: the role is written into the
facts and neither route decides anything by it; the owner-only acts, and the Team page's admin
line, are unchanged. 27
mutations: 25 killed, 2 survived by design. Killed: a whole status row spread into each data type
(by the field list alone: the lines are written from named fields, so the provider's text never
reached a line); the category passed through unvetted; another organisation's id read as a
migration with defaults; the page's migration never found; the role taken from the body on
sending; the mail, and the Zammad article, sent without the facts; facts that fail stopping the
report; no deadline; the browser line not kept to one line, and not capped; the preview not
limited, and without the server's facts; the closing dates left out; the hold always off; a grant
always given; the reference match not asked; no unread line when the facts fail; and in the web
app the fold open, the lines ignored, the recipient without its address, an answer of any shape
shown, and the preview asked without the reference. **Survived, by design:** the organisation
filter taken off the reference match, and off the migration's read. Row security is the second
net and still refused the other organisation's rows, on PGlite and on Postgres. With the filters
off *and* the read on a connection row security does not bind (PGlite's owner connection; on
Postgres the API's pool pointed at the owner), the other-organisation case fails in both files,
so the guard sees a leak once both nets are gone.

**2026-09-28: a screenshot anyone can make.** Of two proposals for the form's screenshot, the
owner answered *"yes, build 1 and 2"*. The form asked for a screenshot and said nothing of how to
make one, and took one only as a file to choose, while Windows+Shift+S, Print Screen, a
Chromebook's Ctrl+Show windows and a Mac's Control+Shift+Command+4 all put the picture on the
clipboard. Built on branch `claude/ownpace-public-readiness-y7orc6-a-screenshot-anyone-can-make`,
on top of the 8 MB branch below (#1319, itself on T5's #1318), not merged:

- **A closed fold under the field**, *How do I make a screenshot?* / *Hoe maak ik een
  schermafbeelding?*, with one line each for Windows (Windows+Shift+S, then paste; or Print Screen,
  which on Windows 11 gives the same choice, then paste), Mac (Shift+Command+4, then the file from
  the desktop; or Control+Shift+Command+4 to copy it, then paste), iPhone or iPad (the side or top
  button and volume up; on a model with a Home button, the side or top button and the Home button;
  then the picture from Photos), Android (power and volume down, on most phones) and Chromebook
  (Ctrl+Show windows, then paste), and a last line: look at the picture before sending it, since it
  shows everything that was on the screen. Each shortcut was checked against its vendor's help page
  as a web search returned it (Microsoft's Snipping Tool page, Apple's pages for Mac, iPhone and
  iPad, Google's Android and Chromebook pages, and the Dutch Chromebook page for *Vensters
  weergeven*); the pages themselves could not be fetched from the session. The owner's iPhone line
  was *side or top button + volume up*, which Apple gives for models without a Home button only, so
  the line names the Home button as well.
- **Paste and drop.** A picture pasted anywhere on the page (Ctrl+V, Command+V), or dropped on it,
  becomes the screenshot through the same type and 5 MB checks as a chosen file, so a GIF or a
  picture over 5 MB is refused with the same sentences. A paste that carries text, into a place
  that takes text, is left to the text, even when a picture comes with it as it does in a copy from
  Word or Excel; a picture pasted into the description with no text beside it is attached. A drop
  that misses the field is taken too, rather than left to the browser, which would open the picture
  in place of the form and what the person wrote.
- **What is attached is said**, *Attached: image.png (182 B).* / *Bijgevoegd: …*, as a status a
  screen reader announces, with *Remove the screenshot* / *Schermafbeelding verwijderen* beside it,
  which empties the chooser and gives it the focus. A picture that came by paste or drop empties
  the chooser too, so it never shows a file other than the one attached.
- **A *Paste screenshot* button** (*Schermafbeelding plakken*), only where the browser has
  `navigator.clipboard.read`, which reads the clipboard when it is pressed. A clipboard with no
  picture on it, and a browser that will not let the page read it, are each said; the keyboard's
  paste still works.
- The hint under the field now says a picture can be chosen, dropped or pasted. The link-report
  form has no screenshot and is unchanged.

Guard: `apps/web/src/pages/a-screenshot-anyone-can-make.unit.test.tsx` (40, 50 after the review,
English and Dutch): the fold, closed and under the field, its six lines and the keys each names; a
pasted PNG and a pasted JPEG attach and are sent; a picture pasted into the description attaches;
text pasted into the description stays there and attaches nothing, also with a picture beside it; a
pasted GIF and a pasted picture over 5 MB are refused with the existing sentences; a dropped PNG
attaches and is sent, and a dropped PDF is refused; a chosen file is named; Remove works for a
chosen and a pasted picture; and the Paste button, absent without `navigator.clipboard.read`,
attaches, refuses a GIF, and says an empty clipboard and a refused read. Red on the branch head: 36
of 40 failed, and the four that passed are the text-paste cases, which hold only once pictures are
pasted. 18 mutations, all killed: the fold open, not a fold, or a line short; a paste taking a PNG
only; the text swallowed two ways; a paste, and the Paste button, skipping the checks; no drop;
Remove not removing, not emptying the chooser, or not giving the focus back; the Paste button where
it cannot work; a refused read called an empty clipboard; the attached line not a status; a paste
heard in the description only; the Dutch Mac line in English; the iPhone line without the Home
button.

Seen in a browser as well, not only in jsdom: the built bundle in headless Chromium, with the
clipboard filled by `navigator.clipboard.write`. Ctrl+V with nothing focused attached the picture;
text pasted into the description stayed text, also with a picture beside it; a picture pasted into
the description attached and left its text alone; the Paste button attached, and said *There is no
picture on the clipboard* for text; a real `DataTransfer` dropped on the chooser attached and was
what the report sent, and the field turned blue while it was dragged over; Remove gave the chooser
the focus. Firefox and Safari were not tried: Stage 8 step 7 of `docs/owner-test-runbook.md` now
has A paste the screenshot and B choose or drop it, and records the browser. 8f of
`docs/managed-bring-up.md` names the three ways.

The review the same day found the guard weaker than it read, and one line of the fold out of date.
**The drops:** the tests dropped on the chooser itself and never asked whether the page cancelled
the drag or the drop, so the guard stayed green with either `preventDefault` gone, with no
`dragover` listener at all, and with drops taken only inside the field. In a browser, each of those
leaves a drop anywhere but the chooser to the browser, which opens the picture in place of the form
and what was written. The drops now land on the field's hint and, in a new case, on the page outside
the field, and each asserts that the drag and the drop were cancelled (`fireEvent` answers false
only then); a refused PDF is cancelled too. **Four more behaviours were claimed and not held**, and
each now has a case: a picture pasted after a chosen file is the one the status names, and the
chooser is empty; once the page has gone, a drag, a drop and a paste on what follows are no longer
cancelled (and were while it was shown); a picture the browser gives only in `files`, or only in
`items`, attaches; and the fake clipboard now refuses a `read` called without the clipboard as its
`this`, as a browser does (WebIDL's *Illegal invocation*): a page that took `read` off the
clipboard, and in a browser said *could not read the clipboard* on every press, passed before. **The
Windows line:** on an up-to-date Windows 11, Print Screen opens the same snipping bar as
Windows+Shift+S (a setting under Accessibility, Keyboard, on by default), and it copies the whole
screen only on Windows 10 or with that setting off; the line said only the latter. It now reads *Or
press Print Screen (on Windows 11 you get the same choice), then paste* / *Of druk op Print Screen
(in Windows 11 krijgt u dan dezelfde keuze) en plak hem daarna*, and the guard holds both to name
Windows 11. This came from web search results on Microsoft's own Q&A pages; neither
support.microsoft.com nor learn.microsoft.com could be fetched from the session, so the claim above
that each line was checked against its vendor's page holds for the other lines as a search returned
them, and did not catch this one. `ReportProblem.tsx` is unchanged: all 50 pass on it as it was. 14
more mutations, all killed: `preventDefault` gone from the drag, the drop and the paste; no
`dragover` listener; drops only inside the field; `read` detached from the clipboard; a paste
leaving the chooser's file; no listener removed, the drop's alone, the paste's alone; `files` alone
and `items` alone read; the Windows 11 clause gone from the English and from the Dutch.

**2026-09-28: a screenshot the front door lets through.** On managed, a report with a
screenshot above about 750 KB never reached the API. The web image's nginx proxies `/api/` and
set no `client_max_body_size`, so its default of 1 MB answered with its own HTML 413 before the
API's 8 MB limit applied. No ticket was made, nothing was recorded as `report.not-delivered`,
and the form printed *"Request failed with status code 413"*. No test sent a body through the
front: the API's tests call Express directly, and the UI smoke mocks the route. Reproduced on
nginx 1.24 with the template as it was: a 2 MB report got `413 text/html`. Now
`apps/web/nginx.conf.template` sets `client_max_body_size 8m` on `/api/`, named after
`PROBLEM_REPORT_BODY_LIMIT`. On the same nginx, a 2 MB report and the largest the form can send
(a 5 MB screenshot and 5000 characters, 7.0 MB) reach the upstream, and 9 MB is still refused.
When any front answers 413, the form says the screenshot is too large to send and to choose a
smaller one, in English and Dutch (`report.tooLarge`).

With 8 MB let through, the route no longer parses before it knows who is sending. Its parser was
mounted on the whole router, so it read and parsed up to 8 MB before sign-in, and a body that was
not JSON became a 500 *"fault on our side"* recorded as `api.unhandled`. Now sign-in, where a
report can go (`reportChannel`: a Zammad or, since T5 below, the support mailbox; neither answers
503 as before), the reply address and the hour's five come first, and a body too large is answered
413 (`report_too_large`) in JSON. Only T5's day's cap on report mails is taken after the body, as
T5 built it: a report that is refused sends no mail, so it uses none of the fifty, and reading its
body first is bounded by the hour's five. Every other refusal the parser makes of what was sent is answered
with its own status as `invalid_report`: not JSON 400, a charset or a `Content-Encoding` it does
not read 415 (the review found `charset=latin1` still answered 500 and recorded as
`api.unhandled`), a body cut short 400. A 5xx the parser raises still goes to the API's handler.
The 8m stays on all of `/api/` on purpose, as the template now says: nginx takes the whole body
before the API asks who is sending, so a location of the report's own would let the same 8 MB in
unsigned.

The public ingress in front of the machine may have a body limit of its own, which this
repository cannot set: `docs/managed-bring-up.md` says to check it allows 8 MB, and 8f's test
report now sends a screenshot close to 5 MB (a request of about 7 MB) through the public name.
The API hands Zammad the same screenshot in a ticket of about 7 MB, so whatever answers on
`ZAMMAD_URL`'s name must take that too. A refusal there is answered with a reference and
recorded as `report.not-delivered`, with `Zammad answered 413` in the API's log line, and 8f now
says which of the two fronts each sign points to. 0131 T5's row for this plan carries the same
check. The form waits two minutes for a report (`REPORT_TIMEOUT_MS`), not the API client's 30
seconds, which needed about 1.9 Mbit/s of upstream for a report that large. When the time runs out,
the form says in English or Dutch that it cannot tell whether the report arrived
(`report.timedOut`), since the front may already have handed it on and sending it again can make
a second ticket or mail. T5's 20 s deadline on a report mail sits inside those two minutes as the
Zammad call's does; a link's page still waits the API client's 30 seconds. **Two gaps, not handled:** below about 0.6 Mbit/s of upstream a report near
7 MB still runs out of time. And a front that drops the connection instead of answering 413
leaves the form saying *Network Error*, with no hint that the screenshot was the cause. Showing
the too-large hint then would be wrong whenever the network itself was down, so it is not.

Guards: `a-screenshot-the-front-door-lets-through` (15), red on main. It reads every
`express.json`, `.raw`, `.text` and `.urlencoded` in `apps/api/src` and refuses a body read any
other way it could miss (a parser imported by name or from `body-parser`, another body-reading
package, the request stream read by hand). For each route whose parser takes more than nginx's
default, it knows the URI (today the report's alone) and checks the location nginx would choose
for it, in every nginx config under `apps/` and `deploy/`: exact, else the longest prefix unless
`^~` or a regex comes first, nested locations likewise. So 8m on `location = /api/problem-reports`
alone passes too; the guard as first written refused it. It also holds the parser to the
largest report there is, which nothing did: the review found `PROBLEM_REPORT_BODY_LIMIT` at
'6mb' and the form's own `MAX_SCREENSHOT_BYTES` at 10 MB both passing every test. The largest
report `parseProblemReport` takes (a 5 MB screenshot, 5000 characters of description and 2000 of
page, each character one JSON writes as six bytes: 7.03 MB) must fit the route's limit, one byte
or character more in any field must be refused, and the form's `MAX_SCREENSHOT_BYTES` and
description `maxLength` must be the API's. The API's `a-report-that-reaches-a-person` goes from
25 to 35, with a route test that posts the largest report the form sends and gets 201, and the
web app's from 7 to 16. `scripts/lessons.mjs` now indexes `.template`
files and Dockerfiles, so `docs/LESSONS.md` files this guard under the template it protects. 29
mutations, all killed: 11 on the first version, then 5 on the route, 11 on the guard and the
template, 2 on the index. One, the Dutch sentence left in English, died only once a test pinned
the Dutch; another, a nested location's `proxy_pass` counted as its parent's, only once a case
pinned it. The review round added 22 more: 20 killed, among them the limit at '6mb', the form's
screenshot at 10 MB and its `maxLength` at 10000, the page cap at 4000, the 4xx branch gone, a
5xx answered as the sender's, the report's own timeout gone or 30 seconds, and the Dutch left in
English. The two that survived were conditions no test could tell apart (a 400 floor no
body-parser error goes under, and a "not JSON" branch the 4xx one now covers), and both were
removed.

Stacked on T5's branch (merged in, 2026-09-28), so both hold: the checks before the body ask
`reportChannel`, a report by mail gets the same 413 and 400 as one to a Zammad, and
`a-report-that-reaches-support-by-mail` gains a case (34) that a body too large or not JSON sends
nothing and uses none of the day's mails. Seen red with the day's cap moved before the body.

**2026-09-28: a report reaches support by mail (T5), built on branch
`claude/ownpace-public-readiness-y7orc6-a-report-that-reaches-support-by-mail`, not merged;
brought up to `main` at `683525c8` (merged in) and corrected after two reviews the same day.**
The owner had never seen the form work: no deployment the repository defines runs a Zammad, so
`/available` answered false and the link never showed. Two answers the same day:

- the form is on at `ownpace-live` for the whole alpha: *"yes, we need that. I haven't seen it
  funcitonal yet."*;
- for the alpha a report goes by mail, not to a Zammad: *"b"*, the option *"The report form sends
  its report as an email to support@ownpace.eu, with the screenshot attached, through the Proton
  relay that already works"*. Zammad stays the long-term plan (D1 is not withdrawn).

What was built:

- **A second way for a report to travel** (`apps/api/src/services/report-channel.ts`). When
  `ZAMMAD_URL` and `ZAMMAD_TOKEN` are not both set and the API's mail is (`SMTP_*` and
  `NOTIFY_FROM`, read by the notifier's own `readNotifierConfig`), a report is one plain-text mail
  through the same `smtpTransport` and its TLS rules (no login over cleartext, 0133 T2 item 5):
  from `NOTIFY_FROM`, to the new `REPORT_MAIL_TO` (one address or several; `NOTIFY_TO` when
  empty), Reply-To the reporter's sign-in address when it is one valid address, Subject the
  ticket's title (*Ownpace: <first line>*), the ticket's article as the body (description, `Page`,
  `Reference`, `Category`, `Organisation`, `Build`), and the screenshot attached after the same
  first-bytes check. Two lines more than the ticket. `Reply to: <address> (sign-in address)`: on
  live the mail goes from `support@ownpace.eu` to itself, where a client may answer to its own To
  or the provider may drop the header, so the body names who to write to as well. And `Report
  reference: <reference>`: with no ticket number, the person is answered with the report's own
  reference, named apart from the error's `Reference` above it, which the log page finds and this
  one it does not. Zammad, when set, still wins; a Zammad set wrongly leaves the form off, as
  before, rather than falling back to mail.
- **The relay is shared, so report mail is capped and quick.** On live the relay's login also
  sends the identity provider's sign-in codes (0133 T0), and the link door needs no account. At
  most 50 report mails a day go out for both doors together (`REPORT_MAIL_PER_DAY`), refused past
  that with 429 and a log line. A send is given up on at `REPORT_MAIL_DEADLINE_MS`, 20 s, as a
  Zammad call is, because the web client stopped waiting at 30 s (a link's page still does; the
  form, since *a screenshot the front door lets through* above, waits two minutes); the route then answers 502 with a
  reference. nodemailer's own waits (`REPORT_MAIL_TIMEOUTS`: 5 s to connect, 5 s for the
  greeting, 20 s of silence; its defaults are 2 min, 30 s and 10 min) bound each wait, not the
  send: when a connection times out it tries the relay's next address with a fresh wait, and
  `smtp.protonmail.ch` resolves to three. The second review measured the first round's 10 s to
  connect against three addresses that let the connection hang: given up on after 30 s, when the
  web client already had. With 5 s, three addresses and the greeting fit inside the deadline.
  nodemailer cannot be stopped mid-send, so a mail given up on that goes out after all, or fails
  after all, is said in the log (`went out after all`, `failed after all`).
  `REPORT_MAIL_TO` set with the mail still off is said in the log once, with what is missing.
- **`GET /available`** answers true when either way is set up. A mail the relay refuses is
  answered exactly as a Zammad refusal: 502 with a reference, `report.not-delivered` recorded. The
  five-an-hour limit per person applies to both.
- **The web form's answer.** With mail there is no ticket number: *"Sent to our support team, with
  report reference {reference}. We will reply by email to {email}."* / *"Verstuurd naar ons
  supportteam, met meldingskenmerk {reference}. We antwoorden per e-mail naar {email}."* Zammad's
  sentence stays when Zammad answered.
- **Link reports** (*Report this link*, 0108 T8 (d)) go the same way: one mail with the note's
  facts and the reporter's words, and the same answer with a reference (EN and NL, with and
  without an address). The mail has **no Reply-To**, even when the reporter typed an address. In
  Zammad the note is internal; in a mailbox, Reply would quote it (who issued the link, the
  accounts, the ids) to an unverified address. The address is on the note's `Reply to:` line, and
  the mail's first line tells the owner to answer with a new mail and leave the facts out. This
  part turned out small, so it was built rather than left on Zammad only.
- **One change on the Zammad path too.** The ticket's title is now kept to one line: a control
  character in the first line (a tab, a stray carriage return) becomes a space, since the mail's
  Subject is the same title. The article and the link note are unchanged.
- **Deploy and docs.** `managed.yml` passes `REPORT_MAIL_TO` to the API, empty by default;
  `managed.env.example` documents it and says the form works with mail alone; step 8f of
  `docs/managed-bring-up.md` puts the mail first and Zammad second, and now recreates the API with
  `docker compose -f deploy/compose/managed.yml up -d --wait api`, since `restart` does not read
  `.env` again. On a stack still pointed at Mailpit (`managed.env.example`'s defaults, the nightly
  gate's stack) the form is now on, and Mailpit catches the reports. Stage 8 step 7 of
  `docs/owner-test-runbook.md` now expects the form on live and checks the mail, its screenshot
  and reference, and the reply; 0141 T12, 0151 §1, 0108 T8 (d) and 0144 T6 say the form shows
  with the mail alone (dated notes where the old sentence was a record).
- **Guards.** `a-report-that-reaches-support-by-mail` in the API (33: where a report goes, the mail
  it becomes with its `Reply to:` line and a Reply-To only for one valid address, the form's route
  and the link doors with the relay faked at its transport, the timeouts handed to it, a link
  report with no Reply-To, Zammad still winning, the 502, the limits and the day's cap shared by
  both doors, the log line said once; from the second review, the 502 at the deadline, the late
  outcome said in the log, nodemailer itself over a relay of three and of six addresses that let
  every connection hang, and the day's cap as the routes are wired, with no `mailCap` of the
  test's own, driven to fifty through all three doors), in `packages/connectors` (5: the Reply-To
  header and the attachment as nodemailer renders them, `requireTLS` with a login, and the three timeouts reaching
  nodemailer only when given), and in the web app (8: the answer in English and Dutch for both
  forms, naming a report reference and no ticket, and Zammad's sentence kept). Each new case was
  seen red with its line of the change undone; the second review's eight mutations (no deadline,
  a 30 s deadline, 10 s to connect, no late log line, the late success not said, a new day's
  count on every call, a count of the link doors' own, and no fresh day between tests) each
  turned a guard red. `a-helpdesk-the-api-was-never-handed` now also reads
  `reportMailConfigFrom`, so
  `REPORT_MAIL_TO` must reach the API (12, was 10). Existing guards green:
  `a-report-that-reaches-a-person` (API 25, web 7), `a-link-that-can-be-reported` (API 18, web
  11; the web one's mocked service now answers `{ ticket }`).

**The privacy consequence, for T4.** By mail, a report (what the person wrote, the page, the
organisation's id, the build, the screenshot) and a link report (its facts and, if given, a typed
address) pass the Proton relay, already the mail sub-processor (0133), and are kept in the support
mailbox, not on a Zammad the owner runs. T4's paragraph, not written yet, must say so: where
reports go during the alpha, that the relay carries them, and how long the mailbox keeps them. It
is recorded here only; `site/legal` is not edited by this change.

**2026-09-24: a link holder can report too (workplan 0108 T8 (d)).** The owner decided that
*"report this link"* goes to this form's helpdesk. The grant and progress pages offer it when
a Zammad is set up, with no account: what makes the person doubt the link, and an address to
reply to. It becomes an internal note on a ticket, with the facts from the link's own rows.
Three a day per link, thirty an hour for every link. The details are in 0108's status entry of
the day. T4 now covers these reports too: the privacy policy names what they carry.

**2026-09-23: opened from the owner's answers.** The owner asked: *"Is there a way people the use
Ownpace can report issues/bugs? What EU based product do you suggest we use? Creating form
scratch seems not smart. Id like to be able to see the issues, be able to contact a user with
questions/more info, and help out. These might be operational with customer data, so i think
GitHub issues it not the right place... Devs will find there own way to GitHub issues section.
Perhaps something that enables users to register the URL they on, the error they see
(screenshot or similar)"*. The recommendation was Zammad, open source and made in Germany, and
two questions went back. Both were answered (§2).

**2026-09-23, later: T1 and T2 built.** "Report a problem" sits beside Sign out, on the
managed edition, and only when the deployment has a Zammad set up (`ZAMMAD_URL` and
`ZAMMAD_TOKEN`, https). It opens a form that says what goes with the report (the page, without
any link secret; the reference and kind of error when there is one) and which address the reply
goes to, before anything is sent. `POST /api/problem-reports` makes the ticket on the owner's
Zammad with the reporter as its customer, in plain text, with a PNG or JPEG screenshot of at
most 5 MB checked by its own first bytes; five reports an hour per person; its own 8 MB body
limit, ahead of the global parser. A report Zammad refuses is answered with a reference and
recorded as `report.not-delivered` (0129 T1). The appliance does not offer the form yet: it has
no report route, and it will send nothing until its owner points it at a helpdesk (0129 D5).
Set-up is step 8f of `docs/managed-bring-up.md`. Guards: `a-report-that-reaches-a-person` in the
API (23) and the web app (7), and `a-report-link-that-can-reach-someone` (3); 23 mutations, all
killed.

**2026-09-23, T3 built: "send it to us" opens the form.** The `unknown` remedy is followed by
**Send it to us** (*Stuur het ons*), a link to the report form with the page, the category and,
on the progress strip, the failure's reference. The form states all three before anything is
sent, and checks each again. It is on every customer screen that shows the sentence: the
progress strip, a failed item's line, the failure groups and Connections. It is not on the
operator's Support screen, since the operator is who receives the report. The link is offered
only where a report can reach somebody: on managed, when the service takes reports, with the
same cached answer as the link beside Sign out. The appliance has no form. Guards:
`a-failure-that-says-send-it-to-us` in the web app (7); 7 mutations, all killed.

**2026-09-23, T3's first half: the failure line has a reference to carry.** A failed data type's
reference lived only in `app_event`, which the application's role cannot read, so nothing on the
customer's screen could fill the form's reference in. Now the status row keeps the reference its
failure was recorded under (`last_error_reference`, ledger migration 0061), beside the category:
written by both catch sites with the event's own reference, cleared when a pass completes or
pauses, eight hex characters or nothing by CHECK. The progress strip shows it under the error, on
both editions, and a progress link does not carry it: its reader cannot report. The link to the
form is the second half. Guards: `a-failure-with-its-reference` in ledger (6), orchestration
(2), shared (3) and the web app (4), and the stranger guard's fixture names the field.

| Task | Status | Notes |
|---|---|---|
| T1 A report form in the app | ✅ **Built 2026-09-23** (D2) | §3. What the person writes, the page they are on, the error they see, and a screenshot if they add one. |
| T2 The report becomes a Zammad ticket | ✅ **Built 2026-09-23** (D1) | §3. Created by the API on the owner's own Zammad, so a reply reaches the person by email. |
| T3 The failure line that says "send it to us" opens the form | ✅ **Built 2026-09-23** (D2) | §3. With the failure's category and reference already filled in, wherever the `unknown` remedy is shown to a customer. |
| T4 The privacy policy names support requests | 🔨 **Drafted 2026-09-28**, not merged; in the drafts for the lawyer's pass | §3. What is sent, where it is kept, for how long. Link reports too (0108 T8 (d)): what the person wrote and, if they want an answer, a reply address, from somebody who has no account. During the alpha, reports go by mail (T5): through the Proton relay (0133) into the support mailbox, and the paragraph must say so. Written with T6: privacy §4.5's paragraph on reports and §9's row, until resolved and then 6 months (the owner, 2026-09-28), EN and NL. §7, §8 and alpha §10 stay with the lawyer. |
| T5 Without a Zammad, a report goes to the support mailbox by mail | 🔨 **Built 2026-09-28**, not merged (the owner, 2026-09-28: *"b"*) | Status entry of the day. `REPORT_MAIL_TO` (else `NOTIFY_TO`) through the API's own relay, the signed-in reporter as Reply-To and on a `Reply to:` line, the screenshot attached; the form's answer names a report reference, not a ticket. Link reports too, with no Reply-To. At most 50 report mails a day, since the relay is the identity provider's too (0133). A Zammad, when set, still wins. |
| T6 A report says what it sends: facts from our records (Part A) and the browser (Part B) | 🔨 **Built 2026-09-28**, not merged (the owner, 2026-09-28: *"Both parts"*, *"Send anyway"*) | Status entries of the day. Part A: the role, the organisation's status, the migration on the page, the reference's match, the hold, the scheduler, the two accounts' providers and the browser, read on the server under row security; `GET /api/problem-reports/preview` shows the same lines in the form's fold before sending, with the recipient above Send; the report goes without them, with a reference, when they cannot be read. Part B: the screen's language, the time zone, the window's width, the web app's build when it is not the server's, the failure line's data type, side and migration, and the references of the faults of the last five minutes (kept in the browser as reference and code only, never the request, which carries the sign-in token), sent as one object the API checks key by key and drops the rest of. |

## 1. What there is today

Nothing a customer can press. The one sentence that sends somebody to us is the `unknown`
failure's remedy, *"if it does not help, send it to us and we will look"*, and it says neither
where nor how. GitHub issues are for developers, and a customer's report can hold operational
detail about their data, which is why the owner wants it elsewhere.

## 2. The owner's decisions (2026-09-23)

- **D1, the product:** *"Zammad self-hosted: yes."*
- **D2, the form:** *"Yes. The 'send it to us' failure line would then link to it."*

## 3. The design

**T1, the form.** *Report a problem*, reachable from every page of a signed-in customer and
from the failure line (T3). It carries:

- what the person writes, in their own words;
- the page they are on, recorded the way the access log records it (0108): a grant or view
  link as `:link`, and no query, so a report never carries a credential;
- the error on the screen: its category and reference number (0129 T1), when there is one;
- a screenshot, if the person adds one: an image file they choose, of a bounded size;
- their email address, so the owner can write back.

The form says what will be sent before it is sent, and to whom.

**T2, the ticket.** The API creates the ticket in Zammad's REST API with a token that lives in
the deployment's secrets, in a group the owner configures, with the customer as the ticket's
customer, so Zammad's own email replies reach them. Nothing is sent from the browser to Zammad
directly, so the token never leaves the server. Signed-in customers only, with a per-person
limit. When Zammad is not configured, the form is not offered, and the failure line keeps its
present sentence. The appliance offers the form only when its owner points it at a Zammad of
their own (0129 D5, the same rule for sending anything).

**T3, the failure line.** The `unknown` remedy links to the form, with the failure's category
and reference filled in, in both languages.

**T4, the privacy policy.** A report is personal data the customer chooses to send: what is in
it, that it is kept on the owner's own Zammad in the EU, and for how long. That sentence goes in
the next pass of the lawyer drafts, like 0110 T6's.

## 4. Order

T2 and T1 together (one PR: the form has nothing to send to without the ticket), then T3, which
needs 0129 T1's reference number. T4 with the next legal pass.
