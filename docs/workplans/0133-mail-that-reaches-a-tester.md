# Workplan 0133 — Mail that reaches a tester

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that no
mail leaves the OTA stack. The API's mail and the identity provider's mail both go to Mailpit, a
catcher on the compose network. A tester who registers with an email address cannot finish
without the identity provider's verification mail. Without a verified address they cannot join
the organisation they were granted. The owner answered the two questions about this (§2): they
will register a mail-sending account for Ownpace, and until then they pass mail on by hand. This
plan covers the interim (T1), the move to a relay (T0, T2–T5), and one parked task (T6). Nothing
is built. T2's first part, which gives the identity provider the relay's login, is drafted in the
pending consistency PR with its guard, and is not merged.

| Task | Status | Notes |
|---|---|---|
| T0 The mail-sending account, the sending address and its DNS | ⏳ **Owner** (D1) | §3. An EU relay with a login, SPF, DKIM and DMARC, a `NOTIFY_TO` a person reads, and a `NOTIFY_FROM` whose replies reach a person. |
| T1 Until then: the owner passes each mail on by hand | 📋 **Decided 2026-09-24** (D2, D3) | §3. Which mails matter, which of them carry a code, how long a code lives, and the one rule for passing a code on. Procedure only, no code. |
| T2 The identity provider sends with the relay's login, over TLS, and follows `.env` | 📋 **Decided 2026-09-24** (D1) | §3. The login part is drafted in the pending consistency PR. TLS for any relay that is not the catcher, and the existing provider updated rather than reported as "already configured". |
| T3 Both senders point at the relay, and Mailpit runs only where something needs it | 📋 **Decided 2026-09-24** (D1) for the switch; **Proposed** for the Mailpit gating | §3. Waits on T0, T2, 0132 T1 and 0135 T0. |
| T4 One outside mailbox, walked end to end | 📋 **Proposed**; the owner walks it after T3 | §3. Request, knock notice, grant mail, identity-provider verification, first sign-in, Join. Headers checked at two mail providers. |
| T5 The relay named as a sub-processor | 📋 **Proposed**; carried by 0139 | §3. Fills `«EMAIL_PROVIDER»` and `«EMAIL_REGION»` in three legal pages. |
| T6 A password on Mailpit's web page | 🅿️ **Parked (trigger: a second person on the mesh, or Mailpit on any stack a tester can reach)** | §3. `MP_UI_AUTH_FILE` is named in two docs and not passed to the container. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24. The reference machine's own
`.env` is not in this repository. Where a statement depends on it, this plan relies on
`docs/first-live-run.md` and the review, and says so.

**Two senders.** The product sends, from the API and from the tasks the worker runs:

- to the operator (`NOTIFY_TO`): the notice that somebody asked for access (`access_requested`,
  sent from `POST /api/access-requests` through `tellOperator` in `apps/api/src/access-notify.ts`);
- to the person who asked: the grant mail (`access_granted`, subject *"Ownpace — uw toegang staat
  klaar"* in Dutch) and the decline mail (`access_declined`), both from
  `apps/api/src/routes/access-requests.ts`, in the language of the request;
- from the tasks: the "what needs attention" digest, daily or weekly as each organisation chooses,
  to its active owners and admins (`apps/worker/src/jobs/managed-digest.ts`), and the rollback
  notice (`run-rollback.ts`);
- on a press, the fallback announcement to the people a by-hand share was given to
  (`POST /api/migrations/:mappingId/sharing/announce`, 0104).

It reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_ALLOW_SELF_SIGNED`, `NOTIFY_FROM`, `NOTIFY_TO`, `NOTIFY_LOCALE` and `NOTIFY_DIGEST`.
`managed.yml` passes all ten to the API as an explicit list. `set-task-env.sh` uploads eight of
them to the task environment: the five `SMTP_*` connection settings, `NOTIFY_FROM`, `NOTIFY_TO`
and `NOTIFY_LOCALE`. It skips a setting whose value is empty.

The identity provider sends its own mail, which never passes through the API: the verification of
a new account's address, an email-change confirmation and a password reset
(`docs/managed-bring-up.md`, "Mail: caught, not delivered"). `setup-zitadel.sh` creates its SMTP
provider from `SMTP_HOST`, `SMTP_PORT`, `NOTIFY_FROM` and `SMTP_SECURE`.

**Two things are never mailed.** A grant link: *"You send the link. We never do."*
(`docs/grant-links.md`). And an invitation to an existing organisation:
`apps/api/src/routes/tenants/members.ts` inserts the row and sends nothing. The invited person
finds the invitation when they sign in with that address (0099).

**Where it all goes.** `deploy/compose/managed.env.example` defaults to `SMTP_HOST=mailpit`,
`SMTP_PORT=1025`, `NOTIFY_FROM=ownpace@ownpace.invalid` and `NOTIFY_TO=operator@ownpace.invalid`.
The bring-up guide gives exactly those values *"For the OTA/dev stack"*. `docs/first-live-run.md`
(status of 2026-09-22) says the OTA deployment's `SMTP_HOST` points at mailpit, that this *"is the
thing that blocks inviting anybody"*, and that SPF, DKIM and DMARC (its §3) *"has never been
exercised, because nothing has ever left the machine"*. 0095 T4 (deliverability) is still
📋 Planned, *"needs DNS, so it is the owner's"*.

A send to the catcher reports `sent`, because the mail was sent. The access queue therefore says
*"We emailed {email}."* after a grant. `bootstrap-managed.sh` prints a note when `SMTP_HOST` is
`mailpit` and `WEB_URL` is a real https origin (`note_mail_goes_nowhere_real`), but the note does
not stop anything.

**Why a tester is stuck without mail.** The grant mail says: *"Heeft u nog geen account, maak er
daar dan een aan met dat adres en bevestig de bevestigingsmail."* The binding needs that
confirmation:

- `pendingInvitations` in `apps/api/src/middleware/auth.ts` returns nothing unless the token says
  `email_verified === true`;
- accepting (`apps/api/src/routes/invitations.ts`) is bounded by `app.current_email`, which
  `auth.ts` sets only when the issuer asserted `email_verified: true` (managed migrations 0006 and
  0008, in `packages/managed/migrations`);
- since 0099 the person accepts on purpose, on the Invitations page (*Meedoen* / *Afwijzen* /
  *Nu niet*, `apps/web/src/pages/Invitations.tsx`).

The review also read the identity provider's login code and found that an account whose address is
not verified cannot finish signing in. This plan did not re-read that code.

Signing in with Microsoft does not avoid the verification mail. `setup-zitadel.sh` sets
`emailVerified: false` on the Microsoft provider on purpose, so the identity provider sends its own
verification mail at the first Microsoft sign-in. The guide says that on the OTA stack this code
has to be read from Mailpit. This plan has not established what Google, GitHub and Apple sign-in
do here. T4 records it for whichever one it walks.

**How long a code lives.** The repository does not set the identity provider's code lifetimes, and
`managed.yml` overrides no `ZITADEL_DEFAULTINSTANCE_SECRETGENERATORS_*` setting. Zitadel
v4.17.3's `cmd/defaults.yaml`, read for this plan, gives `Expiry: "1h"` for both
`EmailVerificationCode` and `PasswordVerificationCode`. Whether anyone changed the values in the
reference machine's console is not visible from here.

**The identity provider's SMTP provider** (`deploy/compose/setup-zitadel.sh`, "mail this instance
sends"):

- **No login.** The create call sends `user: ""` and `password: ""`. The script never reads
  `SMTP_USER` or `SMTP_PASSWORD`, although the API does.
- **No TLS on a 587 relay.** `tls` comes from `SMTP_SECURE`, which defaults to false.
  `managed.env.example` says *"a relay is usually 587 (STARTTLS), or 465 with SMTP_SECURE=true"*,
  so the documented setting for 587 leaves `SMTP_SECURE` empty. Zitadel v4.17.3's SMTP channel
  (`internal/notification/channels/smtp/channel.go`, read for this plan) behaves like this:
  - with TLS off, it makes a plain connection and never tries STARTTLS;
  - with TLS on, it tries implicit TLS and falls back to STARTTLS when the server answers in plain
    text (on a `tls.RecordHeaderError`);
  - it logs in only when the provider holds a login.

  The API is different. It negotiates STARTTLS when the relay offers it (`smtp-transport.ts`) and
  sends the login. So on one relay, the API's mail can arrive while the identity provider's does
  not.
- **Not reconciled.** An existing provider is found by `host:port` alone. When one is found, the
  script says *"already configured"* and changes none of its settings (it only activates it if it
  is inactive), so a later change to the sender, the TLS setting or the login never reaches the
  identity provider. Changing `SMTP_HOST` creates a second provider and activates that one.
- **Not proved against a real relay.** The script sends a test mail only when the relay is
  `mailpit` and the catcher answers. Against any other relay it says *"configured, not proved"*.

**Mailpit** (`deploy/compose/managed.yml`, service `mailpit`):

- **It starts on every stack.** `phase_app` in `bootstrap-managed.sh` lists `mailpit`
  unconditionally, and only `nextcloud` is gated on `--with-demo`. The bring-up guide says the
  opposite: *"A production stack points `SMTP_HOST` at a real relay and never starts this
  service."* The demo's Nextcloud is wired to `SMTP_HOST: mailpit` on purpose (0103).
- **It is published on `MAILPIT_BIND`.** The default is loopback. Every interface is refused by a
  rule in `scripts/the-mail-the-issuer-could-not-send.unit.test.ts`. A mesh address is the
  documented alternative. Which of the two the reference machine uses is not in the repository.
- **Its web page has no password.** The guide and `managed.env.example` both say to set
  `MP_UI_AUTH_FILE` when more than one person is on the mesh. `managed.yml` passes only
  `MP_SMTP_AUTH_ACCEPT_ANY`, `MP_SMTP_AUTH_ALLOW_INSECURE`, `MP_MAX_MESSAGES` and `MP_DATABASE`,
  and mounts no file, so setting `MP_UI_AUTH_FILE` in `.env` does nothing.
- **It keeps what it caught.** Messages are stored on a volume (`MP_DATABASE`), capped at 500
  (`MP_MAX_MESSAGES`). That includes every verification code and password-reset link it has
  caught.

**The nightly gate reads the same catcher.** Before it brings the stack up with `--with-demo`,
`.github/workflows/e2e-managed.yml` copies `.env` from a directory kept on the runner
(`MANAGED_ENV_PERSIST_DIR`). The smoke then sends a request from a `smoke-knock-…@example.invalid`
address. It expects the notice, and the identity provider's test send, to land in Mailpit. The
review found that the gate rebuilds the same stack the OTA addresses serve (0131 §1, 0132). If
that holds, one `.env` decides the mail for both.

**No Reply-To.** `smtpTransport` sets `from`, `to`, `subject` and `text`, and nothing else. A reply
therefore goes to `NOTIFY_FROM`. The decline mail says *"Denkt u dat wij verkeerd hebben begrepen
wat u nodig heeft, beantwoord deze e-mail dan; hij komt bij een mens terecht."* That holds only if
a person reads `NOTIFY_FROM`.

**The legal pages.** `site/legal/subprocessors.md`, `privacy.md` and `privacy.nl.md` still carry
`«EMAIL_PROVIDER»` and `«EMAIL_REGION»`. `site/legal/README.md` says of them *"Must be EU"*.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — the relay.** *Which EU mail relay and which sending domain should the alpha use, and does a
person read support@ownpace.eu?* — *"I'll register a ownpace ampt, a todo"*. This is read as: the
owner will register a mail-sending (SMTP) account for Ownpace, as a to-do. The answer does not
name the relay or the domain, and it does not answer the support@ part. Both stay open (T0, open
questions 2 and 3).

**D2 — until then, by hand.** *Mail has to leave the machine before anybody is let in. Today
product mail and the identity provider's verification mail go to the catcher. What happens until
it does?* — *"I will practically forward / help"*. Asked what a member and a viewer may do, and
whether only owners and admins may invite, the owner answered: *"I am the gate for letting people
in the test."* That answer belongs to 0137, and it is used here only for what it says about
admission: every tester comes in through the owner. So the owner reads each tester's mail in
Mailpit and passes on what they need (T1).

**D3 — who can read the catcher.** *Are the database and service ports reachable from outside,
were the database passwords changed, and does the live identity provider hold other
organisations?* — *"No, these ports are not reachable outside of private
network/NetBird. Usernamea changed. No other organisations are hosted."* Mailpit's port (3127 by
default) was not among the ports that question named, so its bind on the reference machine is
still not recorded (§1). Asked whether the demo stack's secrets must be rotated if that stack is
reused for the alpha, the owner answered: *"Who would need/het credentials? I aupporrthe test. No
one will be added to NetBird network. Devs need to setup own private test/dev environments. GitHub
PRs and git is the bridge."* ("het" is read as "get", and "aupporrthe" as "support the".) So
nobody else is added to the mesh, and only the owner reads Mailpit. As long as that holds,
Mailpit's missing password is not an alpha task (T6 is parked on it).

**D4 — the language.** *What is the test: free or paid, for how many people, how long, in which
language?* — *"Free and invite only. 10 to 20 people max. Dutch."* The grant and decline mails
follow the language of the request, so a Dutch request gets them in Dutch. T4 walks the Dutch path
and records which language the identity provider's mail arrives in, which this plan has not
checked. 0135 T6 limits the identity provider to `nl` and `en` and rewrites its verification and
reset mails.

## 3. What each task does

### T0 — the mail-sending account, the sending address and its DNS (owner)

1. **An EU relay with a login.** SMTP submission on 587 with STARTTLS, or on 465 with implicit TLS.
   The relay's data processing agreement is needed for 0139 (T5).
2. **The From address.** `NOTIFY_FROM` is also the identity provider's sender. Because no Reply-To
   is set (§1), replies go to it. So it must be an address a person reads, or the decline mail's
   promise is false. Open question 2 sets out the choice.
3. **DNS for the sending domain:**
   - **SPF.** A domain has one SPF record. If it already has one, the relay is added to it. Two
     records make SPF fail altogether.
   - **DKIM.** The relay's public key, under the selector the relay names.
   - **DMARC.** `p=none` to start, with reports to a mailbox the owner reads (`first-live-run.md`
     §3). DKIM alone lets DMARC pass when it signs for the From domain. If the relay offers its
     own bounce (return-path) domain, setting it up aligns SPF as well.
4. **`NOTIFY_TO`:** the mailbox where the owner wants to hear that somebody asked for access.
5. **Where the values live:** only in the reference machine's `.env`. None of them goes in the
   repository. T3 applies them, and §4 says who holds the login.

### T1 — until then: the owner passes each mail on by hand (decided, D2, D3)

This is a procedure, not a build. It lives in this plan and in one short subsection of
`docs/managed-bring-up.md`, "Mail: caught, not delivered", titled "Before a relay: passing mail on
by hand". There is no code, so there is no guard test.

**Which mails matter.**

| Mail | Sent by | To | Carries a code | What the owner does |
|---|---|---|---|---|
| Somebody asked for access (`access_requested`) | API | `NOTIFY_TO`, caught | No | Nothing to pass on. The request is in the access queue. |
| *Ownpace — uw toegang staat klaar* (`access_granted`) | API | the tester | No. The mail says it is safe to forward. | Forward it. Or write the tester yourself with the same three facts: the app address, the address to register with, and that they must confirm the confirmation mail. |
| *Ownpace — over uw aanvraag* (`access_declined`) | API | the person who asked | No | Forward it, or untick *"Email them if you decline"* in the queue and write yourself. |
| Verify your address | identity provider | the tester | **Yes**, a code and a link that carries it. One hour by the default (§1). | Pass it on within the hour, by mail, to the address it was sent to. |
| Password reset | identity provider | the tester | **Yes**, one hour by the default | The same. |
| Email-change confirmation | identity provider | the new address | **Yes** | The same, to the new address. |
| The digest, daily or weekly | tasks | the organisation's active owners and admins | No | Nothing. The tester sees the same on screen. |

**The one rule: a code goes by mail, and only to the address it was sent to.** An invitation binds
on a verified address (§1). While the owner passes codes on, the owner's forward is the proof that
the tester reads that mailbox. Sent to the same address, it still proves that. Sent anywhere else,
such as a chat message or a text to a phone number, it would let whoever received it verify an
address they may not own. An invitation addressed to that address would then be theirs to accept.

**Only codes the owner is expecting.** The owner passes on a code only when it was sent to an
address the owner granted and is waiting for. A code for any other address stays in Mailpit. Until
0135 T0 has closed public organisation registration, such a code may belong to somebody founding
an organisation of their own, and a forward would complete the step that 0135 §4 says holds that
chain back today.

**Be there when they register.** A code lives an hour. The owner agrees a moment with each tester,
watches Mailpit while they register, and passes the code on within that hour. If a code lapses,
the tester asks for a new one on the same screen and the owner passes on the new one. This plan
does not propose lengthening the lifetimes for the alpha: a longer-lived code is a longer window
for anybody who can read the catcher.

**Tell the tester first.** The confirmation will come from the owner's own address, not from
Ownpace. A code from an unexpected sender looks like phishing, and a careful tester is right to
distrust it. The owner says so in the invitation they write, before the tester registers.

**Reading Mailpit.** From the reference machine: `curl -s localhost:3127/api/v1/messages`. From the
owner's laptop: the SSH tunnel in the bring-up guide, or the mesh address if `MAILPIT_BIND` is set
to one. Search by recipient to find one tester's mail. Only the owner reads it (D3).

### T2 — the identity provider sends with the relay's login, over TLS, and follows `.env` (decided, D1)

Changes in `deploy/compose/setup-zitadel.sh`, section "mail this instance sends":

1. **The login.** Read `SMTP_USER` and `SMTP_PASSWORD` and pass them to the provider when it is
   created. *Drafted in the pending consistency PR*, together with the bring-up guide's sentence
   that names the settings the script reads.
2. **TLS for any relay that is not the catcher.** `tls` is true whenever `SMTP_HOST` is not
   `mailpit`, whatever `SMTP_SECURE` says. In Zitadel, TLS on covers both 465 and 587 through the
   STARTTLS fallback (§1). It stays false only for the catcher, which speaks plain SMTP on 1025. A
   login is never sent without TLS.
3. **One provider, updated in place.** The script finds the provider it made by its description,
   `ownpace-managed`, not by address. It updates that provider to what `.env` says: host, sender,
   TLS and user, and the password when one is set, since a password cannot be read back to
   compare. Zitadel v4.17.3's `admin.proto` declares `PUT /admin/v1/email/smtp/{id}` and
   `PUT /admin/v1/email/smtp/{id}/password`. The script's own comment on the test verb warns
   *"DECLARED IS NOT IMPLEMENTED"*, so T2 proves both calls against the pinned server before
   relying on them. A refused update is reported and does not end the bring-up, which is the rule
   the script already follows for its test send. An earlier change of `SMTP_HOST` may have left
   more than one provider with that description. Then the script updates the active one and names
   the others, and removing them is done in the console.
4. **The guide.** The "For real delivery" steps in `docs/managed-bring-up.md` say that the
   identity provider takes the same login, and that `bootstrap-managed.sh --only app` is what
   applies it.
5. **Proposed, the API's half of the same rule.** `smtpTransport` sets nodemailer's `requireTLS`
   when a login is set and `secure` is not. Then the API cannot send a login in the clear either.
   Today it upgrades when the relay offers STARTTLS and does not insist.

**Guards that must fail without the change**, in `scripts/the-mail-the-issuer-could-not-send.unit.test.ts`:

- *hands the provider the relay credentials the API is handed* fails while the create call
  hard-codes `user: ""` or `password: ""`. This case is drafted in the pending consistency PR,
  with item 1;
- *never speaks to a relay that is not the catcher without TLS* fails while `tls` comes from
  `SMTP_SECURE` alone;
- *updates the provider it made instead of calling it configured* fails while the only branch on a
  found provider is `say "already configured"`.

For item 5, a new unit test beside `packages/connectors/src/smtp-transport.ts` (only an
integration test sits there today) asserts the options the transport is created with, and fails
without `requireTLS`. A text guard cannot show that a relay
accepts the login. T4 shows that.

### T3 — both senders point at the relay, and Mailpit runs only where something needs it (decided, D1; the gating proposed)

**It waits on 0132.** Today the nightly gate and the OTA addresses are one stack, so one `.env`
decides the mail for both. There are two possibilities, and both are wrong during the alpha:

- **The gate's `.env` keeps `SMTP_HOST=mailpit`.** Every nightly run points the API back at the
  catcher, and after T2 it also rewrites the identity provider's one provider back to the catcher.
- **The gate reads the relay's settings.** Its smoke grants and declines requests from
  `@smoke.local` addresses, so that mail goes through the real relay, which cannot deliver it.
  Each run's knock notice, from a `@example.invalid` address, lands in the owner's real
  `NOTIFY_TO`. Then the smoke fails, because it finds nothing in Mailpit.

0132 T1 separates the two. T3 is done on the stack the testers use.

**It waits on 0135 T0 as well.** Today one thing holds back the takeover chain that 0135 §4
describes: somebody founding an organisation of their own must confirm their address, and that
mail never leaves the machine. The switch to a relay removes that obstacle. Public organisation
registration is therefore closed before the switch, not after it.

**The switch.** On the alpha stack's `.env`, with `env-upsert.sh`:

```
SMTP_HOST=<the relay's submission host>
SMTP_PORT=587
SMTP_SECURE=
SMTP_USER=<from the relay>
SMTP_PASSWORD=<from the relay>
NOTIFY_FROM=<T0's From address>
NOTIFY_TO=<the owner's mailbox>
NOTIFY_LOCALE=nl
```

`NOTIFY_LOCALE` is the language of the owner's own notices. Testers' grant and decline mails follow
the language of their request. Then:

1. Run `./deploy/compose/bootstrap-managed.sh --only app`. The API reads the settings at boot, and
   `setup-zitadel.sh` re-applies the identity provider's provider (T2).
2. Run `./deploy/compose/set-task-env.sh`, because tasks inherit nothing from compose.
3. Check what the processes actually received, using the commands in the guide's "Is it actually
   pointed at the catcher?".

**Proposed: Mailpit only where something needs it.** `phase_app` in `bootstrap-managed.sh` starts
`mailpit` only with `--with-demo`, or when `SMTP_HOST` is `mailpit`. The review offered either
condition. This plan takes both: the demo alone would leave a development stack without the demo,
whose mail still goes to `mailpit`, sending into nothing. The demo's Nextcloud needs
the catcher (0103).

On the alpha stack neither condition holds, so Mailpit is not started. If a container from before
is still running, the bring-up says so and names `docker compose -f deploy/compose/managed.yml
stop mailpit`. It does not stop the container itself. Once T4 has passed, the owner deletes what
Mailpit caught on that stack and stops it. The codes have expired by then, but the store still
holds testers' addresses and grant mails. The guide's sentence *"never starts this service"* then
becomes true.

**Proposed: a note for `.invalid` addresses on a real relay.** When `SMTP_HOST` is not `mailpit`
and `NOTIFY_FROM` or `NOTIFY_TO` still ends in `.invalid`, `bootstrap-managed.sh` prints a note.
It sits beside `note_mail_goes_nowhere_real`, and like that function it is a note, not a refusal.
A relay refuses or bounces those addresses, so the owner would never hear that somebody asked for
access.

**Guards that must fail without the change:**

- in a new `scripts/the-catcher-only-where-it-catches.unit.test.ts`: *does not start mailpit on a
  stack without the demo whose mail goes to a relay*. It fails while `mailpit` sits in
  `phase_app`'s unconditional `services=(…)` list;
- in `scripts/the-stack-knew-and-did-not-say.unit.test.ts`, with the harness that already runs
  `note_mail_goes_nowhere_real` against a written `.env`: *speaks when a relay is configured and
  `NOTIFY_FROM` or `NOTIFY_TO` is still `.invalid`*. It fails while no such note exists.

### T4 — one outside mailbox, walked end to end (proposed)

This is `docs/first-live-run.md` §6, done after T3 with a Dutch browser. Use two addresses the
owner can open. Neither may be on the owner's own domains: one at a Google mailbox and one at a
Microsoft mailbox, because §3's check says the two *"disagree more often than you would expect"*.

1. On `https://app.ota.ownpace.eu/request-access`, ask for access. **Check:** the notice reaches
   `NOTIFY_TO`.
2. Grant the request in the access queue. The response says `notified: sent`. **Check:** the grant
   mail arrives in the outside inbox, in Dutch, and not in spam. In *Show original* / *View message
   details*, SPF, DKIM and DMARC all say **pass**.
3. In a private window, register at `id.ota.ownpace.eu` with that address. **Check:** the
   verification mail arrives in the inbox and not in Mailpit, with the same header check. Record
   the language it arrived in.
4. Enter the code and sign in. **Check:** the Invitations page offers the organisation. Press
   *Meedoen*, and the dashboard opens as its owner. In the database, the `tenant_member` row for
   that address reads `status = 'active'`, with a real subject (§6's check).
5. Ask for a password reset for that account. **Check:** the mail arrives.
6. Decline a second request from the other address, with *"Email them if you decline"* ticked, and
   reply to the decline mail. **Check:** the reply reaches a person (open question 2).
7. If the alpha offers Microsoft sign-in (0140), sign in with it once. **Check:** its verification
   mail arrives.

No code changes, so there is no guard. The evidence is the headers and the database row. Record
them in `first-live-run.md`'s status block, which then loses its exception, in 0095 T4, and here.

### T5 — the relay named as a sub-processor (proposed; carried by 0139)

The relay's name and region fill `«EMAIL_PROVIDER»` and `«EMAIL_REGION»` in
`site/legal/subprocessors.md`, `privacy.md` and `privacy.nl.md`, with its data processing
agreement. The relay handles recipient addresses and the whole content of every mail, including
the identity provider's codes. The owner decided that the legal pass comes before the first
invitation (0139 D1), so T5 does too. Whether the support mailbox's host must be listed as well
is 0139's question.

### T6 — a password on Mailpit's web page (parked)

**Trigger:** a second person on the mesh, or Mailpit on any stack a tester can reach. `managed.yml`
passes `MP_UI_AUTH_FILE` and mounts the file it names read-only, or the two docs stop naming a
setting that does nothing. **Guard:** a case in `the-mail-the-issuer-could-not-send.unit.test.ts`
that fails while the docs name `MP_UI_AUTH_FILE` and `managed.yml` does not pass it. Parked,
because D3 says nobody else joins the mesh.

## 4. Explaining the risk: who holds the relay's login, and who can read the catcher

The owner asked *"Who would need/het credentials?"* 0132 answers that question for the machine.
For mail, the answer is below.

**The relay's login is needed by three processes on the reference machine, and by nobody else.**

- The API gets it from `.env` through `managed.yml`.
- The tasks get it through `set-task-env.sh`, which copies it into the task environment, where
  the task platform keeps it encrypted.
- The identity provider gets it once T2 is done: `setup-zitadel.sh` writes it into the provider,
  which is stored in the identity provider's database.

No tester and no developer needs it. A developer's own stack keeps `managed.env.example`'s default
and catches its own mail, which is the owner's *"Devs need to setup own private test/dev
environments"*.

**What a leaked login costs.** Anyone who holds it can send mail as the sending domain through the
relay, DKIM-signed, and it passes DMARC. That is a phishing mail indistinguishable from the grant
mail. To limit it:

- use a login that can only send, if the relay offers one;
- restrict it to the one From address, if the relay allows that;
- rotate it when the alpha ends. Rotation means `.env`, then `--only app`, then
  `set-task-env.sh`, because the login lives in all three places above. Until T2's update in
  place (item 3) is built, `--only app` does not reach a provider that already exists, and the
  identity provider's copy is changed in the console.

**What the catcher holds.** Whoever can read Mailpit can take over any account whose password-reset
mail it caught within the last hour, and can verify any address whose code it caught. With nobody
else added to the mesh (D3), that reader is the owner. The exposure ends on the alpha stack once
T3 is done and Mailpit there is emptied and stopped.

## 5. Order

1. T1 now, and T0 alongside it. Both are the owner's, and neither waits on code.
2. T2 next. It does not wait on T0: the guards are text guards, and the login part is already
   drafted in the pending consistency PR.
3. T3 once T0 and T2 are done, 0132 T1 has separated the gate from the alpha stack, and 0135 T0
   has closed public organisation registration.
4. T4 straight after T3, and before any tester the owner does not know personally (open question
   1).
5. T5 with 0139's legal pass, before the first invitation.
6. T6 stays parked.

0131 T5 (go/no-go) carries this plan's minimum. 0135 hardens the sign-in page that sends the
verification mail. 0140 decides which sign-in buttons the alpha offers, and so which of them
trigger a verification mail.

## Open questions

1. **May the first invitations go out on T1 alone?** The owner's *"I will practically forward /
   help"* allows it, but 0131 T5 lists T4 as this plan's minimum. *Recommended:* yes, for the first
   few testers who know the owner and expect a code from the owner's address, and T4 before anyone
   else. 0131 T5 is then adjusted to say so.
2. **Which address the mail is sent from, and where replies go.** No Reply-To is set, and the
   decline mail promises that a reply reaches a person.
   - **(a)** Send as an address on `ownpace.eu` that a person reads, and add the relay to the
     domain's SPF record. No code is needed. *Recommended.*
   - **(b)** Send from a subdomain that only sends, and add a `NOTIFY_REPLY_TO` setting to both
     senders. That is a small build, with a guard in `notifier-from-env.unit.test.ts`.
3. **Does a person read support@ownpace.eu during the alpha?** The privacy policy says *"A person
   reads that address"*. The question that D1 answers asked this too, and the
   answer did not cover it.
4. **Mailpit's gating (T3).** On `--with-demo` only, or also whenever `SMTP_HOST` is
   `mailpit`? *Recommended:* both, for the reason in T3.
