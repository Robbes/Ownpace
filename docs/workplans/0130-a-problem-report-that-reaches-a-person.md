# Workplan 0130 — A problem report that reaches a person

> **In one line:** Report a problem on managed: `POST /api/problem-reports` files a ticket on the owner's Zammad, or mails the support mailbox without one (the alpha); linked from the `unknown` failure remedy with its reference; the same for *Report this link*; plus privacy wording.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: a report reaches support by mail (T5), built on branch
`claude/ownpace-public-readiness-y7orc6-a-report-that-reaches-support-by-mail`, not merged;
brought up to `main` at `83eb73ed` and corrected after its review the same day.**
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
  that with 429 and a log line. A send is given up on within `REPORT_MAIL_TIMEOUTS` (10 s to
  connect, 10 s for the greeting, 20 s of silence; nodemailer's defaults are 2 min, 30 s and
  10 min), as a Zammad call is within 20 s, because the web client stops waiting at 30 s.
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
  gate's stack) the form is now on, and Mailpit catches the reports.
- **Guards.** `a-report-that-reaches-support-by-mail` in the API (28: where a report goes, the mail
  it becomes with its `Reply to:` line and a Reply-To only for one valid address, the form's route
  and the link doors with the relay faked at its transport, the timeouts handed to it, a link
  report with no Reply-To, Zammad still winning, the 502, the limits and the day's cap shared by
  both doors, the log line said once), in `packages/connectors` (5: the Reply-To header and the
  attachment as nodemailer renders them, `requireTLS` with a login, and the three timeouts reaching
  nodemailer only when given), and in the web app (8: the answer in English and Dutch for both
  forms, naming a report reference and no ticket, and Zammad's sentence kept). Each new case was
  seen red with its line of the change undone. `a-helpdesk-the-api-was-never-handed` now also reads `reportMailConfigFrom`, so
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
