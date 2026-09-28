# Workplan 0130 — A problem report that reaches a person

> **In one line:** Report a problem on managed: `POST /api/problem-reports` files a ticket on the owner's Zammad, or mails the support mailbox without one (the alpha); linked from the `unknown` failure remedy with its reference; the same for *Report this link*; plus privacy wording.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: a screenshot anyone can make.** Of two proposals for the form's screenshot, the
owner answered *"yes, build 1 and 2"*. The form asked for a screenshot and said nothing of how to
make one, and took one only as a file to choose, while Windows+Shift+S, Print Screen, a
Chromebook's Ctrl+Show windows and a Mac's Control+Shift+Command+4 all put the picture on the
clipboard. Built on branch `claude/ownpace-public-readiness-y7orc6-a-screenshot-anyone-can-make`,
on top of the 8 MB branch below (#1319, itself on T5's #1318), not merged:

- **A closed fold under the field**, *How do I make a screenshot?* / *Hoe maak ik een
  schermafbeelding?*, with one line each for Windows (Windows+Shift+S, then paste; or Print
  Screen), Mac (Shift+Command+4, then the file from the desktop; or Control+Shift+Command+4 to copy
  it, then paste), iPhone or iPad (the side or top button and volume up; on a model with a Home
  button, the side or top button and the Home button; then the picture from Photos), Android
  (power and volume down, on most phones) and Chromebook (Ctrl+Show windows, then paste), and a
  last line: look at the picture before sending it, since it shows everything that was on the
  screen. Each shortcut was checked against its vendor's help page as a web search returned it
  (Microsoft's Snipping Tool page, Apple's pages for Mac, iPhone and iPad, Google's Android and
  Chromebook pages, and the Dutch Chromebook page for *Vensters weergeven*); the pages themselves
  could not be fetched from the session. The owner's iPhone line was *side or top button + volume
  up*, which Apple gives for models without a Home button only, so the line names the Home button
  as well.
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

Guard: `apps/web/src/pages/a-screenshot-anyone-can-make.unit.test.tsx` (40, English and Dutch): the
fold, closed and under the field, its six lines and the keys each names; a pasted PNG and a pasted
JPEG attach and are sent; a picture pasted into the description attaches; text pasted into the
description stays there and attaches nothing, also with a picture beside it; a pasted GIF and a
pasted picture over 5 MB are refused with the existing sentences; a dropped PNG attaches and is
sent, and a dropped PDF is refused; a chosen file is named; Remove works for a chosen and a pasted
picture; and the Paste button, absent without `navigator.clipboard.read`, attaches, refuses a GIF,
and says an empty clipboard and a refused read. Red on the branch head: 36 of 40 failed, and the
four that passed are the text-paste cases, which hold only once pictures are pasted. 18
mutations, all killed: the fold open, not a fold, or a line short; a paste taking a PNG only; the
text swallowed two ways; a paste, and the Paste button, skipping the checks; no drop; Remove not
removing, not emptying the chooser, or not giving the focus back; the Paste button where it cannot
work; a refused read called an empty clipboard; the attached line not a status; a paste heard in
the description only; the Dutch Mac line in English; the iPhone line without the Home button.

Seen in a browser as well, not only in jsdom: the built bundle in headless Chromium, with the
clipboard filled by `navigator.clipboard.write`. Ctrl+V with nothing focused attached the picture;
text pasted into the description stayed text, also with a picture beside it; a picture pasted into
the description attached and left its text alone; the Paste button attached, and said *There is no
picture on the clipboard* for text; a real `DataTransfer` dropped on the chooser attached and was
what the report sent, and the field turned blue while it was dragged over; Remove gave the chooser
the focus. Firefox and Safari were not tried: Stage 8 step 7 of `docs/owner-test-runbook.md` now
has A paste the screenshot and B choose or drop it, and records the browser. 8f of
`docs/managed-bring-up.md` names the three ways.

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
| T4 The privacy policy names support requests | 📋 **Proposed** | §3. What is sent, where it is kept, for how long. Link reports too (0108 T8 (d)): what the person wrote and, if they want an answer, a reply address, from somebody who has no account. During the alpha, reports go by mail (T5): through the Proton relay (0133) into the support mailbox, and the paragraph must say so. |
| T5 Without a Zammad, a report goes to the support mailbox by mail | 🔨 **Built 2026-09-28**, not merged (the owner, 2026-09-28: *"b"*) | Status entry of the day. `REPORT_MAIL_TO` (else `NOTIFY_TO`) through the API's own relay, the signed-in reporter as Reply-To and on a `Reply to:` line, the screenshot attached; the form's answer names a report reference, not a ticket. Link reports too, with no Reply-To. At most 50 report mails a day, since the relay is the identity provider's too (0133). A Zammad, when set, still wins. |

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
