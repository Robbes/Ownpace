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

| File | *Version* line | Where it stands |
|---|---|---|
| `privacy.md`, `privacy.nl.md` | `1.2 (draft — not yet published)`, `1.2 (concept — nog niet gepubliceerd)`; 2026-09-28 | For the owner's review. Four placeholders, in four places, in each language |
| `terms.md`, `terms.nl.md` | `1.3 (draft — not yet published)`, `1.3 (concept — nog niet gepubliceerd)`; 2026-09-28 | For the owner's review. Two placeholders, in three places, in each language |
| `alpha.md`, `alpha.nl.md` | `1.0`; 2026-09-28 | The owner's text for the Alpha, taken as final without the lawyer's pass. No placeholder. Not rendered yet (below) |
| `subprocessors.md` | `0.2 (draft — not yet published)`; 2026-09-28 | English only. Not rendered yet (below) |
| `dpa.md` | No *Version* line: its *Status* line says `draft v0.2`; 2026-09-28 | English only, on purpose. Not part of the Alpha, which admits households only (0139 open question 6) |

**Do not publish the drafts.** The site build refuses them in any case: on 2026-09-28, after
the owner's answers, `node site/build.mjs --check` reports `4 legal page(s) marked draft` and
`14 unfilled placeholder(s)`, and `--public` refuses both.

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
| `«REGISTERED_ADDRESS»` | privacy §1; terms §1 and §15; `dpa.md` (the parties) | Archico B.V.'s registered address: its vestigingsadres as the KvK register shows it. It also goes on invoices. The register already publishes it, but the form is the owner's, so it stays a token until supplied. A postbus alone is probably not the *geographic address* that BW 3:15d and terms §15's model form ask for; it can be printed beside it as a correspondence address (terms briefing, question 22, a reading for the lawyer). **The owner, 2026-09-28:** *"My address, is it needed? I also live there, and rather have correspondance by email."* Recommended: print it in privacy §1, terms §1 and the §15 form, with email first beside it (the wording, in both languages, is in terms question 22); or register a business address at the KvK as the vestigingsadres, which changes the register, not only the texts. Not decided | The owner (0139 T0) |
| `«VAT_NUMBER»` | privacy §1; terms §1 | Archico B.V.'s btw-id. It also qualifies VIES checks (0111 T2; `VIES_REQUESTER_VAT_NUMBER` is empty in `managed.env.example`); `pricing.ts` already knows `VAT_RATE = 0.21`. **The owner, 2026-09-28:** *"VAT number was already mentioned, check Ownpace-repo for the info: site/legal/README.md"*. It is not here: this row has held the placeholder in every version of this file, and no other file in the repository records Archico B.V.'s btw-id. The KvK number, 73922706, printed beside the token since 2026-08-30, may be what was meant. A VAT number in a unit test's fixture is a format example, not Archico B.V.'s; never copy one from there. The btw-id is on the Belastingdienst's letters and on a btw-aangifte | The owner or their accountant (0139 T0) |
| `«SUBPROCESSORS_URL»` | privacy §7; `dpa.md` (§8, Annex C, briefing); `subprocessors.md` (briefing) | The address at which `subprocessors.md` is published, once 0139 T10 renders it; the file then needs a Dutch text with the same version. Or the owner makes privacy §7's table the complete list, and the sentence goes. Since privacy 1.2 the token has no backticks there, so the site build counts it. **The owner, 2026-09-28:** *"recommend me what to do."* Recommended (privacy briefing): privacy §7's table is the complete list for the Alpha, *"This table is the complete list of our sub-processors."* / *"Deze tabel is de volledige lijst van onze subverwerkers."*, and `subprocessors.md` is published, with its Dutch text, when the first business customer and the DPA arrive (0086 T5). The token then leaves privacy §7 and stays in `dpa.md` and `subprocessors.md` until that day. Not applied | The owner decides; 0139 T10 builds it |
| `«PRIVACY_HISTORY_URL»` | privacy §13 | Where earlier versions of the privacy policy stay available, as §13 promises. One option is this file's history in the public repository; the lawyer says whether that is enough. **The owner, 2026-09-28:** *"recommend me what to do."* Recommended: that history, per language, `https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.md` and `https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.nl.md`. The repository is public, and live's site is built from a release tag, so every published text is the file at a tag. The history also shows unpublished drafts, each marked by its own *Version* line; keeping each published version on `www.ownpace.eu` itself is a later build change (0139 T10). Not applied | The owner (0139 T0) |

**Filled, or no longer used.** None of these is in a rendered text any more. Some briefing
comments still name them, to say what filled them.

- `«HOSTING_REGION»`: filled 2026-09-28 in privacy 1.2 (§7) and `subprocessors.md` 0.2 with
  *the Netherlands* (NL: *Nederland*). The owner: *"app/site hosting is in The Netherlands,
  through NetBird (Germany) delivers the forward proxy."* The machine that the service, its
  databases, its sign-in service and this website run on during the Alpha (0139 D5; T0 fact 6)
  is in the EU, as privacy §8 requires. Still open (0139 T0): whether any company houses the
  machine or can reach it. If one does, it is a row in privacy §7 and `subprocessors.md`, named
  by the owner.
- `«INGRESS_PROVIDER»`, `«INGRESS_REGION»`: filled 2026-09-28 in privacy 1.2 (§6's transfer
  bullet, §7's first row) and `subprocessors.md` 0.2 with *NetBird GmbH*, in *Germany (EU)*
  (NL: *Duitsland (EU)*), from the same answer. *"Forward proxy"* is read as the service in
  front of the machine that ends TLS for `app.`, `id.`, `status.` and `www.ownpace.eu`, which is
  what the repository says of it (`managed.yml`: *"netbird terminating TLS on 443"*; 0091:
  *"Routing and TLS are netbird's"*), and NetBird's documentation says its hosted proxy, for an
  HTTP service, *"terminates TLS at the edge"*. Germany is in the EU, so privacy §8 needs nothing
  for it. **To confirm** before the draft markers come off: (1) the entity name, NetBird GmbH,
  which was read from search results quoting NetBird's terms (Amtsgericht Berlin
  (Charlottenburg), HRB 237529 B), because `netbird.io` cannot be reached from here; take it from
  NetBird's terms or data-processing agreement; (2) that agreement accepted for the account, with
  its date recorded in 0139 T0, as for Proton; (3) which of NetBird's proxy clusters the names
  point to, and where it runs; (4) that the services use HTTP mode, not TLS passthrough. Two
  findings are in the privacy briefing and not yet in the text: NetBird's reverse proxy keeps an
  access log with the visitor's IP address, a location derived from it, and the full path, a
  grant or progress link's secret included, so privacy §4.5's *"without the secret part of a
  link"* holds for our own logs only; and with TLS ending at NetBird, our nginx logs record
  `$remote_addr`, which is then NetBird's proxy, not the visitor, and the API's the same unless
  live sets `TRUST_PROXY`. Privacy §4.5 says whose IP address our logs record once that is
  checked on live (0132 T3 (d)).
- `«UNADMITTED_SIGNIN_RETENTION»`: filled 2026-09-28 in privacy 1.2 (§9): 30 days after the
  sign-in account was created, unless a request for access with that address is still open (NL:
  *30 dagen nadat het is aangemaakt, tenzij een aanvraag voor toegang met dat adres nog
  openstaat*). The row now says such an account opens nothing. The owner: *"30 days is ok, but
  those are free no further used accounts?"* Unused, yes; free-tier, no, and nobody is billed.
  Self-registration is on at `id.ownpace.eu` (0095), so anyone can create a sign-in account, and
  it opens nothing in Ownpace until an operator grants a request for that address
  (`setup-zitadel.sh`: *"An account here grants nothing on its own"*). The sign-in service still
  holds a name, an email address, a user name, a password hash, sessions and its event history
  for each, and sends each a verification mail through Proton; hence a period. **Not built**:
  0135 T8 (`idp-strays.sh`) removes them, and until it exists the owner does, by hand. T8's rule
  should also spare an address with an open invitation (privacy briefing).
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
  volume, not age, so it cannot support a number of days. **If the machine already logs to
  journald**, the criterion is wrong and the row must give the journal's period; the same command
  says which.

- `«SUPPORT_RETENTION»`: filled 2026-09-28 in privacy 1.2 (§9, the row *Support mail and problem
  reports*): until the question or problem is resolved, and then 6 months more. The owner chose
  *"Until resolved + 6 months"* the same day, when asked how long report mails in
  `support@ownpace.eu` are kept (recorded in 0139's Status). Proton keeps a copy of the
  service's own sent mail in that mailbox (the owner's *"yes"*, 2026-09-28), so since that day
  privacy §4.5 says so, and the row covers those copies: 6 months after sending. That reads the
  owner's period for mail that answers no question; the owner confirms it in the pull request.
- `«LEGAL_ENTITY»`: filled 2026-08-30, Archico B.V., the owner's existing BV (the spelling
  checked against public KvK-registry mirrors). Whether "Ownpace" is registered as its
  handelsnaam is a question in the terms briefing (question 22). The owner, 2026-09-28:
  *"Ownpace is registered, check Ownpace-repo for the info: TRADEMARK.md"*. `TRADEMARK.md`
  records a Benelux trademark *application* (1556706, filed 2026-08-30, registration pending),
  which is neither a registration yet nor a handelsnaam. The texts may say *"Ownpace is a
  trademark of Archico B.V."*, with ™, and never *registered trademark* or ® until the Benelux
  office registers it. The handelsnaam is an entry of its own in the KvK register; once a current
  uittreksel shows it, privacy §1 and terms §1 can say *"Archico B.V., trading as Ownpace"* /
  *"Archico B.V., handelend onder de naam Ownpace"*. Nothing is added to the texts until then.
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
  in that mailbox (see `«SUPPORT_RETENTION»` above). Still to check: where Proton's agreement
  says Proton processes (the *Where* column says Switzerland), and the adequacy wording (privacy
  briefing, question 11). Switzerland is outside the EU, under an EU adequacy decision, so the old rule that
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

**Before the draft markers come off**, some sentences need code, product or owner steps that do
not exist yet on `main` (683525c8). Each is also a comment beside the sentence, in both
languages, where the text rests on it:

- *Nothing uses your access after closing* (privacy §9, terms §11, Alpha conditions §10): the
  sync tick's `ACTIVE_MAPPINGS_SQL` never reads the organisation's status, so a closed
  organisation still gets new passes until the purge. The closed-organisation fix must be merged
  first.
- *The copy made right before an update, never longer than 7 days* (privacy §9, Alpha conditions
  §6): the copy of the service's databases is taken and deleted by hand, and
  `deploy/compose/dump-idp.sh` keeps every dump of the sign-in service's database, with its
  accounts and password hashes, with no limit. Prune or delete those dumps within 7 days and
  automate the copy, or change the texts. **The owner, 2026-09-28:** *"deletes only after procen
  successfull upgrade, so we already have one backup copy of what actually works."* That is §9's
  *"until the next update succeeds"*, and it covers `dump-idp.sh`'s dumps too. Not settled: the
  7-day cap, on which privacy §9, the Alpha conditions §6 (1.0) and the erasure date a closing
  organisation is told all rest (`BACKUP_RETENTION_DAYS=7`). If the copy is deleted once the
  update it was made for is proven, and never later than day 7, the texts hold. If the last good
  copy is kept until the *next* upgrade is proven, it is a standing backup that can last weeks,
  which needs an Alpha conditions 1.1 and a longer period in privacy §9. Recommended, in the
  privacy briefing: the first reading, with *proven* meaning that `deploy-live.sh` logged the
  deploy as taken and one pass completed; one script and one directory for the whole copy (the
  app's database, the sign-in service's database and the roles, as the runbook's recipe already
  dumps them), and a daily duty that deletes anything older than 6 days as a backstop, which
  leaves `dump-idp.sh` nothing to do on live.
- *The daily copies of the background tasks' records* (privacy §9): live's daily `drill` duty
  (`box-duties.sh`) dumps the task runner's database and keeps the newest 7. Keep it, as privacy
  §9 now says, or stop it on live for the Alpha and drop the sentence. The Alpha conditions §6
  say no backups *"of the service's own records"*. **The owner, 2026-09-28:** *"What about the
  drill?"* Recommended, in the privacy briefing: take the drill off live's duties for the Alpha
  and keep the OTA stack's nightly drill; before a Trigger.dev upgrade on live, take
  `trigger-version.sh backup before-<version>` as part of the copy before an update, under the
  same rule; then privacy §9 drops the drill sentence and the *"daily copies"*, in both
  languages. Live has not been stood up, so the drill has dumped nothing there yet. Not decided.
- *A sign-in account nobody let in, 30 days* (privacy §9): nothing removes one yet. 0135 T8
  (`idp-strays.sh`) is proposed, not built; until it is, the owner removes these by hand in the
  sign-in service's console.
- *Server logs until the part that wrote them is replaced* (privacy §9): true while the machine
  uses Docker's default log driver (0134 open question 6 (a)). If it logs to journald, as
  `docs/managed-bring-up.md`'s steps for live still ask, the row gives the journal's period
  instead. `docker info --format '{{.LoggingDriver}}'` on the machine says which.
- *The sign-in service's history* (privacy §4.4, §9): removing a sign-in account does not remove
  its earlier events in Zitadel's event store, as far as Zitadel's own statements go (privacy
  briefing, question 19). Check it on v4.19.2, and decide: purge by hand at erasure, or a period.
- *Problem reports by mail* (privacy §4.5): 0130 T5, committed on its branch, not merged; on
  `main` the form needs a Zammad. Merge it, and run live without `ZAMMAD_URL`.
- *Acceptance before the first connection* (terms §1): the sentence now names no screen, so 0139
  T3 or a route the owner runs by hand can make it true, but one of them must exist before the
  first invitation (terms briefing, precondition A and question 12).
- *Where TLS ends* (privacy §6, §7): answered on 2026-09-28, at NetBird GmbH, in Germany (0139
  T0 fact 1). To confirm: the entity name, NetBird's data-processing agreement, the proxy
  cluster's location, and HTTP mode (the filled list above); and whose IP address our own logs
  record, for privacy §4.5 (0132 T3 (d)).
- *Email and password only at the sign-in page* (privacy §4.4, §7, §8): 0139 T0 fact 4. If live
  sets any `IDP_*` key, the texts name the social sign-in and its provider.
- *Telemetry* (privacy §8's negative): `managed.yml` sets no opt-out; Trigger.dev's
  self-hosting documentation says its webapp sends telemetry unless `TRIGGER_TELEMETRY_DISABLED`
  is set. Set the opt-outs, or name what is sent.
- *What the app says* must match these texts: the grant mail's *"Your password lives with the
  sign-in service, never with us"* and *"nothing is backed up"*
  (`packages/shared/src/notifications.ts`), the Alpha note's *"nothing is backed up"*
  (`apps/web/src/i18n/strings.ts`, `alpha.note.terms`), and the request form's *"We keep what you
  type only to answer you"* (`access.privacy`). Suggested: *"we store only a hash of it, in the
  sign-in service we run"*; *"no backups, apart from one copy before each update, kept up to 7
  days"*; *"We keep what you type to decide on your request and to answer you; asking creates no
  account."* In both languages, in a change of their own.

The full list is in the terms briefing (A to F), the privacy briefing (*For the owner before
publication*) and 0139's Status block of 2026-09-28.

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
  also asks us to enter a Google address in Google's list of test users (privacy §6, §8). Whether
  both stand beside the product's premise is the owner's to confirm and the lawyer's to word
  (privacy briefing, questions 11 and 12). A migration off US cloud through a US-hosted tool is
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
  with no draft marker. They are not rendered by the site build and not linked from the app
  (`NOT_BUILT_YET` in `apps/web/src/services/legal-links.ts`). 0139 T10 renders them, and a
  `--public` build refuses them while their *Version* line says draft.
- **The DPA and the sub-processor list, as published pages** (0086 T5, 0139 T10). Drafts exist —
  [`dpa.md`](./dpa.md) and [`subprocessors.md`](./subprocessors.md), first written 2026-08-30
  and revised 2026-09-28, both at 0.2 — but they are not rendered by the site build, not linked
  from any published document, and not yet offered to anyone; until the DPA is published,
  privacy §3 and terms §4 say it is "available on request". Once the build renders
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
