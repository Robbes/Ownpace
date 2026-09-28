<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->

# `site/legal/` — the published legal surface

Source of truth for the documents the managed service publishes. Markdown here, rendered in
both languages into the public site by [`site/build.mjs`](../build.mjs)
([workplan 0091](../../docs/workplans/0091-the-names-on-one-box.md) T2), whose `--public` build
refuses while any placeholder below is unfilled, and while any legal page it renders says on its
*Version* line that it is a draft or not yet published (workplan 0139 T2). They live outside every
workspace package for the same reason `site/prices.mjs` does — nothing in `apps/` or `packages/`
may import them, and nothing here may import anything.

| File | Published at | Required by |
|---|---|---|
| [`privacy.md`](./privacy.md) | `https://www.ownpace.eu/privacy.html` (Dutch: `/nl/privacy.html`) | GDPR; Google OAuth verification; Mollie onboarding |
| [`terms.md`](./terms.md) | `https://www.ownpace.eu/terms.html` (Dutch: `/nl/voorwaarden.html`) | Taking money; Google OAuth verification |

**Support address: `support@ownpace.eu`.** It appears in every document here and must appear on
the front door and in the Google consent-screen configuration. Google's verification requires a
support contact, and a policy naming an address nobody answers is worse than no policy.

**Brand assets** live in [`../brand/`](../brand/) — `logo-120.png` is the one Google's
verification requires (≥120×120, PNG or JPG). Regenerate with `python3 scripts/make-logo.py`;
never hand-edit the PNGs, because the sizes are generated from shared constants precisely so
they cannot become different drawings.

---

## Where each text stands (2026-09-28)

On 2026-09-28 the owner asked for the privacy policy and the terms to be revisited: *"Can you
revisite the privacy policy and terms? Make changes if needed, and i'll review them."* The
drafts below are that revision, for the owner's review first. The lawyer's pass is deferred:
*"legal: keep as is for now"* (2026-09-27,
[workplan 0139](../../docs/workplans/0139-the-legal-gate-for-the-alpha.md) T1). What changed, by
section, is in the briefing comment at the top of each file and in 0139's Status block. Asked
the same day whether to take them as final or wait for the lawyer, the owner answered *"park
them in PR that i will review."*: they stay drafts, in the pull request, and no *Version* line
changes until the owner approves the text. The owner's other answers of 2026-09-28 fill five
placeholders (below); 0139's Status block quotes every answer in full.

**The owner's 71 answers, 2026-09-28.** The questions still open in the briefings and in 0139 went
to the owner on one answer page, each with its options and a recommendation. The owner answered
all 71 the same day: *"all Ownpace Legal Choices where answered (71). Can you processess the
answers?"* Each text follows the option the owner chose, also in the 11 answers where it is not
the one recommended, and the owner's notes are part of the answer. Each briefing comment lists the
answers that touch its text, by id. 0139's Status block lists all 71, with the owner's notes. No
placeholder is left in a text the site renders.

| File | *Version* line | Where it stands |
|---|---|---|
| `privacy.md`, `privacy.nl.md` | `1.2 (draft — not yet published)`, `1.2 (concept — nog niet gepubliceerd)`; 2026-09-28 | For the owner's review, with the owner's answers applied. No placeholder |
| `terms.md`, `terms.nl.md` | `1.3 (draft — not yet published)`, `1.3 (concept — nog niet gepubliceerd)`; 2026-09-28 | For the owner's review, with the owner's answers applied. No placeholder |
| `alpha.md`, `alpha.nl.md` | `1.0`; 2026-09-28 | The owner's text for the Alpha, taken as final without the lawyer's pass. Edited in place with the owner's answers, because nobody has accepted it yet: it stays 1.0 (alpha-version-number (a)), and every change after the first acceptance gets a new number. No placeholder. Not rendered yet (below) |
| `subprocessors.md` | `0.2 (draft — not yet published)`; 2026-09-28 | English only. Unpublished until the first business customer: during the Alpha, privacy §7's table is the complete list (rec-subprocessors-url (a)). Not rendered (below) |
| `dpa.md` | No *Version* line: its *Status* line says `draft v0.2`; 2026-09-28 | English only, on purpose. Unpublished until the first business customer, and corrected in one pass before then (dpa-unpublished-until-business (a)). Not part of the Alpha, which admits households only (0139 open question 6) |

**Do not publish the drafts.** The site build refuses them in any case: on 2026-09-28, after
the owner's 71 answers, `node site/build.mjs --check` reports `4 legal page(s) marked draft` and
`0 unfilled placeholder(s)`, and `--public` refuses the drafts.

## The placeholders

The documents carry `«PLACEHOLDER»` tokens for facts only the owner can supply. **Every
placeholder used in a document must be listed in the table below** — `scripts/legal-docs.unit.test.ts`
fails if one is not, which is what stops a new placeholder being added and quietly forgotten
until a customer reads it. The test reads the privacy policy, the terms and the Alpha
conditions, in both languages (its `DOCS`). The table also lists what `subprocessors.md` and
`dpa.md` use, by hand, until the build renders them. A token that is filled, or no longer used,
leaves the table, and the list under it says what became of it.

| Placeholder | Used in | What fills it | Who |
|---|---|---|---|
| `«SUBPROCESSORS_URL»` | `dpa.md` (§8, Annex C, briefing); `subprocessors.md` (briefing). No rendered text | The address at which `subprocessors.md` is published. **The owner, 2026-09-28** (rec-subprocessors-url (a), *"§7's table is the complete list"*): during the Alpha, privacy §7's table is the complete list of sub-processors, and says so (*"This table is the complete list of our sub-processors."* / *"Deze tabel is de volledige lijst van onze subverwerkers."*). `subprocessors.md` is published with the DPA, when the first business customer arrives (0086 T5; dpa-unpublished-until-business (a)), with a Dutch text and the same version, and the token is filled then. It left privacy §7 on 2026-09-28 | The owner decides when; 0139 T10 renders it |

**Filled, or no longer used.** None of these is in a rendered text any more. Some briefing
comments still name them, to say what filled them.

- `«REGISTERED_ADDRESS»`: left out of every text on 2026-09-28, for the Alpha. The owner first
  asked *"My address, is it needed? I also live there, and rather have correspondance by
  email."*, and then chose rec-address (c), *"Leave the address out during the Alpha"*, with the
  note *"KVK number: 73922706"*. Privacy §1, terms §1 and the §15 model form, and `dpa.md`'s
  parties, now name Archico B.V., trading as Ownpace, its KvK number, its VAT number and
  `support@ownpace.eu`, and say we correspond by email. A hidden comment beside each says the
  address returns before the first paid tier, after the lawyer's pass, or sooner if the lawyer
  asks for it. The option said what it costs: BW 3:15d asks a company that offers an online
  service to show the address where it is established, probably also for a free service, so
  leaving it out probably breaks that rule. The risk is small for an Alpha by invitation, and the
  KvK register shows the address anyway. The lawyer confirms (terms briefing, question 22). No
  address is written in this repository.
- `«VAT_NUMBER»`: filled 2026-09-28 in privacy §1, terms §1 and `dpa.md`'s parties (fact-vat
  (a)), written exactly as the owner gave it: *"NL8597.110.06.B01 (VIES might validate it only
  without dots/spaces, but in legal document that doesnt mater.)"*. Its form is that of a Dutch
  btw-id, and its nine digits pass the 11-proof; it was not checked against VIES from here. The
  same number qualifies VIES checks on live, in `VIES_REQUESTER_VAT_NUMBER` beside
  `VIES_REQUESTER_MEMBER_STATE=NL` (both or neither; 0111 T2). The owner sets both in live's
  `.env`. A VAT number in a unit test's fixture is a format example, never this one.
- `«PRIVACY_HISTORY_URL»`: filled 2026-09-28 in privacy §13 (rec-privacy-history-url (a),
  *"Link to the file's history in the public repository"*): one link per language,
  `https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.md` and
  `https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.nl.md`. §13 also says that
  the history shows drafts that were never published, each marked by its *Version* line. GitHub
  is in the US; privacy §8 names it only as a route the reader chooses. Keeping each published
  version on `www.ownpace.eu` itself stays a later build change (0139 T10).

- `«HOSTING_REGION»`: filled 2026-09-28 in privacy 1.2 (§7) and `subprocessors.md` 0.2 with
  *the Netherlands* (NL: *Nederland*). The owner: *"app/site hosting is in The Netherlands,
  through NetBird (Germany) delivers the forward proxy."* The machine that the service, its
  databases, its sign-in service and this website run on during the Alpha (0139 D5; T0 fact 6)
  is in the EU, as privacy §8 requires. No company houses the machine or can reach it: the owner
  chose subprocessors-machine-housed (a) on 2026-09-28, *"No. I keep it and run it myself, for
  Archico B.V."*, so there is no hosting row. If that changes, the company is a row in privacy §7
  and `subprocessors.md`, with its own data-processing agreement, before the first tester is let
  in.
- `«INGRESS_PROVIDER»`, `«INGRESS_REGION»`: filled 2026-09-28 in privacy 1.2 (§6's transfer
  bullet, §7's first row) and `subprocessors.md` 0.2 with *NetBird GmbH*, in *Germany (EU)*
  (NL: *Duitsland (EU)*), from the same answer. *"Forward proxy"* is read as the service in
  front of the machine that ends TLS for `app.`, `id.`, `status.` and `www.ownpace.eu`, which is
  what the repository says of it (`managed.yml`: *"netbird terminating TLS on 443"*; 0091:
  *"Routing and TLS are netbird's"*), and NetBird's documentation says its hosted proxy, for an
  HTTP service, *"terminates TLS at the edge"*. Germany is in the EU, so privacy §8 needs nothing
  for it. **The owner, 2026-09-28** (dpa-netbird-agreement (a), *"Yes, it is already
  accepted"*): *"NetBird GmbH ("NetBird") terminates the TLS, and uses WireGuard tunnel with the
  backend towards the hosting provider. Check https://trust.netbird.io (whitelisted for you) for
  overview, subprocessors and other info. https://netbird.io/terms lists the reverse proxy in
  3.1"*. So the entity name is the owner's, the agreement is accepted, and TLS ends at NetBird in
  HTTP mode, not passthrough. Privacy §7's row and `subprocessors.md` now say that NetBird carries
  connections on to our machine through a WireGuard tunnel, and that it keeps its own log of each
  request, with the IP address and the page asked for, including the secret part of a link
  (ops-trust-proxy: that line comes in every option). **Not checked from here:**
  `trust.netbird.io` returns only an empty page shell whose content comes from a host the egress
  proxy refuses, and `netbird.io` is refused, so NetBird's sub-processors, its terms' §3.1 and its
  agreement were not read. NetBird's documentation on GitHub (`netbirdio/docs`) says the proxy
  forwards through WireGuard and that its cloud keeps the access log for 7 days. **To record**
  before the draft markers come off (0139 T0): the date the agreement was accepted; where the
  agreement or the dashboard says the proxy and its log run (`app.`, `id.` and
  `status.ownpace.eu` resolved to the cluster `eu1.netbird.services` on 2026-09-28; the country
  is not confirmed); and that none of NetBird's own sub-processors takes the proxy's traffic or
  its log outside the EU. If one does, privacy §8 and DPA §12 name it. **Our own logs**
  (ops-trust-proxy (b), *"Keep visitors' addresses in all our logs"*): live sets `TRUST_PROXY`,
  so the API reads the visitor's address from what NetBird passes on, and both nginx logs record
  that address: the app's (`apps/web/nginx.conf.template`, format `ownpace_combined`, which
  records `$remote_addr` only today) and the website's (`deploy/compose/www-nginx.conf`, which
  sets no `access_log` or `log_format` today, so the image's default applies). Privacy §4.5 says
  our server logs record *"your IP address, which NetBird passes on to us"*; a comment beside it
  says what live must set. Check a log line of each on live (0132 T3 (d)).
- `«UNADMITTED_SIGNIN_RETENTION»`: filled 2026-09-28 in privacy 1.2 (§9): 30 days after the
  sign-in account was created, unless a request for access with that address is still open (NL:
  *30 dagen nadat het is aangemaakt, tenzij een aanvraag voor toegang met dat adres nog
  openstaat*). The row now says such an account opens nothing. The owner: *"30 days is ok, but
  those are free no further used accounts?"* Unused, yes; free-tier, no, and nobody is billed.
  Self-registration is on at `id.ownpace.eu` (0095), so anyone can create a sign-in account, and
  it opens nothing in Ownpace until an operator grants a request for that address
  (`setup-zitadel.sh`: *"An account here grants nothing on its own"*). The sign-in service still
  holds a name, an email address, a user name, a password hash, sessions and its event history
  for each, and sends each a verification mail through Proton; hence a period. **Decided
  2026-09-28** (ops-unadmitted-signin-cleanup (a), *"A daily script, built before the first
  tester"*): 0135 T8's script (`idp-strays.sh`) removes them, run with the machine's daily
  duties. It is **not built**; privacy §9's 30 days stay as drafted, and the first tester waits
  for the script. T8's rule also spares an address with an open invitation (0135, 2026-09-28).
- `«LOG_RETENTION»`: filled 2026-09-28 in privacy 1.2 (§9, *Server logs*) with a criterion, not
  a number: until the part of the service that wrote them is replaced (the app and this website
  at each update of the service; the sign-in service when its version or settings change; a
  background task when its run ends), with no fixed period. The owner: *"Server logs: check
  ownpace repo on this."* What the repository shows: no compose file for live sets `logging`, so
  every container writes with Docker's default log driver, which keeps a container's output
  until the container is removed, with no limit of age or size. `deploy-live.sh` recreates the
  app's containers (a new image for each tag) and the website's (`--force-recreate`) at each
  deploy; the sign-in service's only when its image or configuration changes; Trigger.dev
  removes a task's container when its run ends (0134 open question 6). The owner's month for
  container logs (0129 D2) exists as guidance only: `docs/managed-bring-up.md` tells the operator
  to set the journald log driver with `MaxRetentionSec=1month`, and lists it among the owner's
  steps for live, while 0134 open question 6 was answered (a), which is no journald. Nothing
  checks which driver the machine uses. **What would make a fixed period true**: the owner
  re-decides 0134 open question 6 for journald on the machine (`/etc/docker/daemon.json`
  `{"log-driver": "journald"}`, a journal retention of 30 days, and a short `MaxFileSec` such as
  `1day`, because journald deletes whole journal files, as systemd documents it); a check that
  fails when `docker info --format '{{.LoggingDriver}}'` is not `journald`, in `stand-up-live.sh`
  or `box-duties.sh`; then the row reads *30 days* / *30 dagen*. A size cap per service limits
  volume, not age, so it cannot support a number of days. **Decided 2026-09-28** (ops-log-driver
  (a), *"Docker's default, as the text says"*, with the note *"needs checking"*): the criterion
  stays. The owner checks the machine with `docker info --format '{{.LoggingDriver}}'` and undoes
  the journald setting if it is there, and the journald step comes out of
  `docs/managed-bring-up.md`. **If the machine logs to journald** until then, the row is wrong
  for that time.

- `«SUPPORT_RETENTION»`: filled 2026-09-28 in privacy 1.2 (§9, the row *Support mail and problem
  reports*): until the question or problem is resolved, and then 6 months more. The owner chose
  *"Until resolved + 6 months"* the same day, when asked how long report mails in
  `support@ownpace.eu` are kept (recorded in 0139's Status). Proton keeps a copy of the
  service's own sent mail in that mailbox (the owner's *"yes"*, 2026-09-28), so since that day
  privacy §4.5 says so, as do privacy §7's Proton row, `subprocessors.md` and, for the mail to
  people items were shared with, privacy §4.6. **The owner, 2026-09-28**, for those copies
  (privacy-sent-mail-copies (b), *"The support-mail rule: until resolved, then 6 months"*): the
  same rule as support mail, in the owner's own words, and privacy §9's rows say so. The option
  named its cost: a mail that answers no question, such as a sign-in code, has no clear end date.
  Nothing prunes the Sent folder; the owner does it by hand (*Before the draft markers come
  off*).
- `«LEGAL_ENTITY»`: filled 2026-08-30, Archico B.V., the owner's existing BV (the spelling
  checked against public KvK-registry mirrors). Whether "Ownpace" is registered as its
  handelsnaam is a question in the terms briefing (question 22). The owner, 2026-09-28:
  *"Ownpace is registered, check Ownpace-repo for the info: TRADEMARK.md"*. `TRADEMARK.md`
  records a Benelux trademark *application* (1556706, filed 2026-08-30, registration pending),
  which is neither a registration yet nor a handelsnaam. The texts may say *"Ownpace is a
  trademark of Archico B.V."*, with ™, and never *registered trademark* or ® until the Benelux
  office registers it. The handelsnaam is an entry of its own in the KvK register. **The owner,
  2026-09-28** (fact-trademark (b), *"Add it now; the KvK already shows it"*): privacy §1, terms
  §1 and `dpa.md`'s parties say *"Archico B.V., trading as Ownpace"* / *"Archico B.V., handelend
  onder de naam Ownpace"*. The option was for when the KvK extract lists the name; the owner's
  note is empty, and no extract was seen here.
- `«COMPANY_NUMBER»`: filled 2026-08-30, Archico B.V.'s KvK number.
- `«COURT_DISTRICT»`: filled 2026-08-30, Overijssel, from the seat (Wijhe). Since terms 1.3 it
  is the court for business customers only (§13); the lawyer confirms the wording (terms
  briefing, question 14).
- `«EMAIL_PROVIDER»`, `«EMAIL_REGION»`: filled 2026-09-28 in privacy 1.2 (§7, §8) and
  `subprocessors.md` 0.2 with Proton AG, in Switzerland, which sends the service's mail and holds
  the support mailbox. The owner chose the relay: *"I was hoping to reuse my proton SMTP"*
  (workplan 0133, Status, 2026-09-28). 0133 kept both as tokens until the owner's final-text
  pass; this revision fills them for the owner's review. **The owner confirmed them on
  2026-09-28** (*"yes"*): Proton AG, in Switzerland, stays; Proton's data-processing agreement is
  accepted for the account behind `support@ownpace.eu`; that account is Archico B.V.'s, not only
  the owner's own, as 0133 had it (*"my proton SMTP"*); and Proton keeps the service's sent mail
  in that mailbox (see `«SUPPORT_RETENTION»` above). Privacy §8 and `subprocessors.md`'s opening
  now name the adequacy decision, *(Art. 45 GDPR; Commission Decision 2000/518/EC)*
  (privacy-switzerland-wording (b)), and `dpa.md` §12 names Proton AG (dpa-q1-transfers (c)).
  Still to check: where Proton's agreement says Proton processes (the *Where* column says
  Switzerland). Switzerland is outside the EU, under an EU adequacy decision, so the old rule that
  the mail provider "must be EU" does not hold as written (see *What must stay true*, below).
- `«HOSTING_PROVIDER»`: dropped from privacy §7 and `subprocessors.md` on 2026-09-28. During the
  Alpha the owner administers the machine (0139 D5, the owner: *"It's all controlled by me and
  invite only."* and *"No one will be added to NetBird network."*; the plan reads it as *"Only
  the owner administers either."*). The service in front of it that ends TLS is not a hosting
  provider; it had tokens of its own, `«INGRESS_PROVIDER»` and `«INGRESS_REGION»` (above). A
  provider the service moves to after the Alpha is named in privacy §7 and `subprocessors.md`
  before any data goes there (Alpha conditions §11). **Owner, 2026-08-20: self-hosted today,
  landing on OVH (EU).** Do not write "OVH" into a text until the service actually runs there —
  a privacy policy naming a host the service is not on is the kind of inaccuracy that is worse
  than a placeholder, because a placeholder is visibly unfinished and a wrong name is not.
- `«DPA_URL»`, `«PRICING_URL»`: no longer used since 2026-08-30. Privacy §3 and terms §4 say the
  data-processing agreement is "available on request" until it is published (the draft is
  [`dpa.md`](./dpa.md), 0086 T5, **not optional** once a business customer's mail is involved),
  and terms §6 links [the pricing page](../../site/pages/en/pricing.md) directly.
- `«ALPHA_NOTICE_PERIOD»`, `«UPDATE_COPY_DAYS»`, `«ACCOUNT_CLOSE_PERIOD»`: filled 2026-09-28
  with 7 days each, in the Alpha conditions 1.0 (§5 and §11, §6, §10).

**What a final *Version* line looks like.** A `--public` build reads each rendered document's own
`**Version:**` / `**Versie:**` line, outside the briefing comment, and refuses while it says
*draft*, *concept*, *ontwerp*, *voorlopig*, *not yet published* or *nog niet gepubliceerd*, in any
case and anywhere in the line, or when there is no such line (`DRAFT_WORDS` in `site/build.mjs`,
[workplan 0139](../../docs/workplans/0139-the-legal-gate-for-the-alpha.md) T2). A final line is
the version number and none of those words, the same number in both languages: `**Version:** 1.2`
and `**Versie:** 1.2`. The owner's final-text pull request writes them once the owner approves
the text: after the lawyer's pass (0139 T1), or without it, as the owner did for the Alpha
conditions (1.0, 2026-09-28). `node site/build.mjs --public --check` then prints
`0 legal page(s) marked draft` and exits 0.

**Before the draft markers come off**, some sentences need code, machine or owner steps that are
not done yet. The owner decided each on 2026-09-28 (the answer's id is in brackets). Each is also
a comment beside the sentence, in both languages, where the text rests on it. **Done:**

- *Nothing uses your access after closing* (privacy §9, terms §11, Alpha conditions §10): true
  on `main` since #1320 (`d7868276`, merged 2026-09-28): a closed organisation gets no pass, and
  no door that starts work. This branch has not merged `main` since, so it lands here with the
  next merge of `main`.
- *Problem reports by mail* (privacy §4.5): merged as #1318 (`0c019ab8`, 0130 T5), and on this
  branch. True on live once live's `.env` has no `ZAMMAD_URL`.

**To build or to do**, before the first invitation unless it says otherwise:

- *Acceptance, with version and time* (terms §1, Alpha conditions §2 and §11, privacy §4.4;
  terms-acceptance-route (b)): the in-app screen, 0139 T3. The first invitation waits for it and
  its tests.
- *The copy made right before an update, never longer than 7 days* (privacy §9, Alpha
  conditions §6; rec-copies (a)): one copy right before each update: the app's database, the
  sign-in service's database and the roles, and the task runner's database before a Trigger.dev
  upgrade. It is deleted once the update is proven (`deploy-live.sh` logged it as taken, one pass
  completed, and the hold lifted), and never kept past day 7; if the update is not proven by day
  6, roll back from the copy. To build: one script and one directory for the copy, a delete
  step, a daily backstop that deletes anything older than 6 days, and `dump-idp.sh` writing into
  the same place or refusing on live.
- *No daily copies of the task runner's database on live* (privacy §9; rec-drill (a)): the drill
  comes off live's duties in `box-duties.sh` and stays on the test stack.
  `trigger-version.sh backup` becomes part of the copy before a Trigger.dev upgrade on live, under
  the rule above. Privacy §9 no longer names the drill.
- *A sign-in account nobody let in, 30 days* (privacy §9; ops-unadmitted-signin-cleanup (a)):
  0135 T8's script, `idp-strays.sh`, run with the machine's daily duties. Not built.
- *Searches and downloads on the support screens, 12 months* (privacy §4.5, §9;
  privacy-search-records (a)): a daily duty deletes those log records older than 12 months, over
  the owner's connection, because the app cannot delete from that log. Not built.
- *The sharing list goes with its migration* (privacy §4.6, §9; privacy-sharing-list (b)): the
  migration delete also deletes that migration's `share_grant` rows, which have no foreign key to
  the migration today. Not built; until it is, the list stays until erasure.
- *Server logs until the part that wrote them is replaced* (privacy §9; ops-log-driver (a), the
  owner: *"needs checking"*): the owner runs `docker info --format '{{.LoggingDriver}}'` on the
  machine and undoes a journald setting if there is one; the journald step comes out of
  `docs/managed-bring-up.md`.
- *Visitors' IP addresses in our own logs* (privacy §4.5; ops-trust-proxy (b)): `TRUST_PROXY` in
  live's `.env`, and both nginx configurations (`apps/web/nginx.conf.template`,
  `deploy/compose/www-nginx.conf`) recording the address NetBird passes on.
- *Email and password only at the sign-in page* (privacy §4.4, §7, §8; ops-social-signin (a)):
  live's `.env` sets no `IDP_*` key.
- *Telemetry off* (privacy §8's negative; ops-telemetry (a)): `TRIGGER_TELEMETRY_DISABLED` for
  live and the test stack (`managed.yml`), and the sign-in service, ClickHouse and MinIO checked
  and switched off too.
- *The service's mails go to the support mailbox* (ops-notify-addresses (a); privacy-tester-list
  (a)): `NOTIFY_TO`, `ALERT_TO` and `REPORT_MAIL_TO` in live's `.env` are all
  `support@ownpace.eu`. The request notices there are also the list of testers kept off the
  machine.
- *What the app says* (ops-app-sentences (a)): the grant mail (`packages/shared/src/notifications.ts`),
  the Alpha note (`apps/web/src/i18n/strings.ts`, `alpha.note.terms`) and the request form
  (`access.privacy`) are reworded, in both languages: *"we store only a hash of it, in the
  sign-in service we run"*; *"no backups, apart from one copy before each update, kept up to 7
  days"*; *"We keep what you type to decide on your request and to answer you; asking creates no
  account."*
- *A privacy line in the mail to people items were shared with* (privacy §4.6;
  privacy-share-mail-notice (a)): one sentence and a link to the policy, in both languages, in
  `packages/shared/src/share-announcement.ts` and its copy in
  `docs/cutover-communication-templates.md`, before the first tester uses the feature.
- *By hand, by the owner*: the service's sent mail and support mail pruned in Proton, until
  resolved and then 6 months (privacy §9; privacy-sent-mail-copies (b)); a family member's
  Google address taken off Google's test list with the tester's, at erasure, or sooner if asked
  (privacy §6, §9, Alpha conditions §9, §10; alpha-s9-family-google (a)); and the query that
  answers a request for what the support log records about someone, written once in the operator
  runbook (privacy §4.5; privacy-read-log-copy (a)).
- *The sign-in service's history* (privacy §4.4, §9; privacy-signin-history (a), the owner:
  *"still needs to be checked."*): remove a test account on the test stack and look at what
  stays. §9 now says the entries are kept as long as we run this sign-in service, because it
  cannot remove them; if the check shows they go, the comment beside §9 has the other wording.
- *NetBird* (privacy §7; dpa-netbird-agreement (a)): record the date its agreement was accepted,
  where the proxy and its log run, and NetBird's own sub-processors (the filled list above).
- *VIES on live* (fact-vat (a)): `VIES_REQUESTER_MEMBER_STATE` and `VIES_REQUESTER_VAT_NUMBER` in
  live's `.env`.

**Later, not before the first invitation:** the export of the migration records that terms §11
and DPA §10 promise (terms-s11-export (a), dpa-q3-return-of-data (c)), made by hand until
[workplan 0155](../../docs/workplans/0155-the-migration-records-handed-over.md) builds it; the
background tasks' records reset at the end of the Alpha (privacy §9; privacy-task-records (a)),
one step in the end-of-Alpha routine; the order button, the confirmation step and the withdrawal
function before the first paid tier (terms-unbuilt-paid-steps (a)); ADR-0037's minimum TLS
versions, after which privacy §11 gains a line (privacy-tls-wording (a)).

The full list is in the terms briefing (A to F), the privacy briefing (*Still to do before the
draft marker comes off*), the Alpha conditions' briefing and 0139's Status block of 2026-09-28.

**Which language counts is not settled.** `privacy.nl.md` and `terms.nl.md` follow the English
section for section. Terms 1.3 §13 keeps v1.2's rule: the English governs, except where
mandatory consumer law provides otherwise. The note the site prints above the Dutch privacy and
terms pages (`translationNote` in `site/copy.mjs`, which `site/build.mjs` prints for those two
pages only) says that the English governs where the two differ, without §13's exception for
mandatory consumer law (terms briefing, question 15, has the words that would add it). The
privacy policy and the Alpha conditions have no language clause of their own. Asked on
2026-09-28 whether the English governs or both languages count, and whether the terms keep no
cap towards consumers, the owner answered *"yes"*; 0139 reads that as keeping both as drafted,
a reading the owner may correct in the pull request. The first draft of terms 1.3 made both texts count, which contradicted the note;
that rule is now a proposal in the terms briefing (question 15), and taking it changes the note
in the same change. Whether Dutch consumer law permits a translation to be purely "for
convenience", for a Dutch-first Alpha, is a question that cannot be answered from inside this
repository, and it is the one thing about the bilingual publication that is not merely
editorial.

**A lawyer should read them before they are published.** The owner deferred that pass on
2026-09-27 and reviews the texts first; the questions for it are in the briefing comments at the
top of `privacy.md`, `terms.md`, `alpha.md` and `dpa.md`. The texts are written to be accurate
about what the software does — which is the half that is hard to get right from outside and easy
to get wrong from inside — not to be a substitute for advice about Dutch and EU law.

## What must stay true in them

These are not stylistic preferences; each one is a claim the code currently supports, and a
change to the code that falsifies one is a change that has to update the document in the same
commit.

- **Self-host sends us nothing.** No telemetry, no usage counts, no error reports. The privacy
  policy opens with it because it is the strongest thing there is to say and it is checkable.
- **We are controller for the account; for migration content it depends on the customer**
  (privacy §3): processor for an organisation (ADR-0035 §17), and — draft position, lawyer to
  confirm — controller for a household migration, because Art. 2(2)(c) leaves the migrating
  parent outside the GDPR while recital 18 keeps the provider inside it (workplan 0111 §"Who
  is the controller"). It decides the whole shape of the DPA, which stays a business
  instrument; the privacy policy carries the household half itself. During the Alpha only
  households take part (0139 open question 6, *"tester: households only for now."*), so only
  the household half applies there, and no DPA is involved.
- **The ledger holds metadata, not bodies** — natural keys, hashes, sizes, folders, timestamps,
  the name a person knows an item by (an event's or task's title, a contact's name, a file's
  name, and since 2026-09-18 a message's subject, once it is fetched) and the provider's error
  text (privacy §4.2). No body, no attachment, no file content. Saying "technical data" instead
  would be vaguer and no more honest, and §4.2 says plainly that the metadata can be revealing.
- **Nothing is deleted at the source, ever.** At the target nothing is deleted unless the
  customer switches on *applying deletions* and approves each deletion (ADR-0024). A second
  switch, *auto-applying relocations*, removes the old copy of a file that moved at the source,
  after strict checks and without asking each time; deletions never apply unattended (ADR-0031).
  Both are off until turned on (terms §2).
- **There is no reverse sync**, so the source stays the customer's fallback.
- **Everything runs in the EU, with one named exception.** Privacy §8 says the service runs in
  the EU; the machine is in the Netherlands, and the service in front of it that ends TLS,
  NetBird GmbH, in Germany (the owner, 2026-09-28). If either moves outside the EU, §8 names it
  too. The exception is mail: Proton AG, in Switzerland, under an EU adequacy decision, sends the service's mail and
  holds `support@ownpace.eu` (the owner's choice, 0133, 2026-09-28). During the Alpha a tester
  also asks us to enter a Google address in Google's list of test users (privacy §6, §8). Since
  2026-09-28 §8 also names two routes to the US that the reader chooses, without calling them
  transfers: a vulnerability report through our GitHub form, and our mail to a mailbox at a US
  provider (privacy-other-transfers (b)). Whether the Google step stands beside the product's
  premise is the lawyer's to word (privacy-google-testlist-basis (a), left for the lawyer's
  pass). A migration off US cloud through a US-hosted tool is
  self-defeating; this is the product, not a compliance line, and anything else that leaves the
  EU changes privacy §8 in the same commit.
- **Google is offered as a source only**: there is no Google target to choose (privacy §6).
  The connections API has no Google target kind (`TARGET_KINDS` in
  `apps/api/src/routes/connections.ts`); a generic IMAP or DAV target is whatever server the
  customer names, which is why the policy says *offered* rather than *never*. The Limited Use
  commitments in privacy §6 are the ones
  [`docs/google-oauth-verification.md`](../../docs/google-oauth-verification.md) maps to
  Google's policy.
- **The billing promises are ADR-0014's**: tier derived not chosen, finishing lowers the bill,
  setup charged once on the highest tier, no billing from inattention, nothing past twelve
  months without re-confirmation. If ADR-0014 changes, terms §6 and §8 change with it. During
  the Alpha nothing is charged, and the Alpha conditions §2 set terms §6 to §8 aside.

## What is deliberately not here yet

- **The alpha conditions, as a published page** ([workplan 0139](../../docs/workplans/0139-the-legal-gate-for-the-alpha.md)
  T2). [`alpha.nl.md`](./alpha.nl.md), the text testers read first, and [`alpha.md`](./alpha.md)
  were drafted on 2026-09-28 as version 0.1, at the owner's request, for the owner's reading and
  the lawyer's pass. The owner reviewed them the same day and set their *Version* line to 1.0,
  with no draft marker. The owner's answers of the same day changed §2, §4, §5, §6, §9, §10 and
  §11, and the text stays 1.0 until the first tester accepts it (alpha-version-number (a)). They
  are not rendered by the site build and not linked from the app
  (`NOT_BUILT_YET` in `apps/web/src/services/legal-links.ts`). 0139 T10 renders them, and a
  `--public` build refuses them while their *Version* line says draft.
- **The DPA and the sub-processor list, as published pages** (0086 T5, 0139 T10). Drafts exist —
  [`dpa.md`](./dpa.md) and [`subprocessors.md`](./subprocessors.md), first written 2026-08-30
  and revised 2026-09-28, both at 0.2 — but they are not rendered by the site build, not linked
  from any published document, and not yet offered to anyone; until the DPA is published,
  privacy §3 and terms §4 say it is "available on request". Both stay unpublished until the
  first business customer (the owner, 2026-09-28: dpa-unpublished-until-business (a) and
  rec-subprocessors-url (a)). Before then, one pass fixes the DPA's known errors, answers the
  lawyer's questions, gives it a *Version* line, and publishes it with the list. During the Alpha,
  privacy §7's table is the complete list of sub-processors. Once the build renders
  `subprocessors.md`, it needs a Dutch text with the same version, because
  `scripts/legal-docs.unit.test.ts` holds every rendered document to one. A business customer
  cannot lawfully be onboarded without the DPA; the Alpha admits none.
- **A cookie statement of its own.** Privacy §5 (1.2, a draft) now says what there is: the app
  keeps its sign-in in the browser's own storage and sets no cookie of its own, this website
  sets none and loads nothing from other servers, and the sign-in page sets the cookies that
  signing in needs. Checked 2026-09-28: nothing in `apps/web/src` or `apps/api/src` sets a
  cookie, and the website's Content-Security-Policy starts `default-src 'none'`
  (`deploy/compose/www-nginx.conf`). Whether a separate cookie page is still wanted is the
  lawyer's question.
