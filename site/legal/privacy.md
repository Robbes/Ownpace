<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  DRAFT — v1.2, 2026-09-28, for the owner's review. This comment never renders
  (the site generator strips HTML comments). It is the briefing for the
  reviewing lawyer, beside the ones at the top of terms.md and alpha.md. The
  owner asked for this revision on 2026-09-28 and reads it first; the lawyer's
  pass is deferred (0139 Status, 2026-09-27: "legal: keep as is for now").
  privacy.nl.md mirrors this file section for section, and this briefing
  applies to both. v1.1 (2026-08-30) is in this file's history.

  v1.2 brings the policy in line with the code on main (683525c8, which
  includes #1302 and #1303's row security), with the owner's decisions of
  2026-09-24 to 2026-09-28, and with the Alpha conditions (alpha.md, v1.0, the
  owner's), which prevail during the Alpha where they differ. A review of the
  first draft the same day checked it against that code and corrected it; the
  list below is the result. What changed:

  - Header: the policy covers this website too; a box says the Alpha
    conditions apply as well and prevail.
  - §2: messages and files are not stored, plainly; what §4.2 keeps instead.
  - §3: during the Alpha only households take part (0139 open question 6),
    so no DPA is involved. The other-people paragraph names a family member
    and the people items were shared with, and points to the new §4.6.
  - §4.1, §11: the key is kept apart from the database, but on the same
    machine (0139 T1 point 11), in the service's configuration and in the
    background tasks' settings (deploy/compose/set-task-env.sh uploads
    SECRET_ENCRYPTION_KEY to the task runner, which keeps it encrypted in its
    own database). The Dutch §4.1 said "describe" the target.
  - §4.2: the ledger keeps the name a person knows an item by (a message's
    subject, an event's title, a contact's name, a file's path) and the
    provider's error text, which can name an address. The code has stored
    subjects since 2026-09-18. Also what each migration and the organisation
    keep beside the item rows.
  - §4.4: the request for access (the name is optional: access-requests.ts,
    z.string().optional()); nobody is let in without asking, unless invited
    (the sign-in page itself is open: setup-zitadel.sh, "SELF-REGISTRATION,
    ON"); the sign-in account at the identity provider we run ourselves, its
    sessions, and the history it keeps (§9); the account; the Google address
    entered as a test user; no invoices during the Alpha; the billing page's
    details. "We never see or store your card details" became "we do not ask
    for or keep your card number": managed migration 0001's payment_method
    table and the billing route accept a card's brand, last four digits and
    expiry, though no screen calls that route.
  - §4.5: support mail arrives at Proton; problem and link reports go there by
    mail during the Alpha (0130 T5, the owner's "b"); what server logs hold,
    for this website too, and that a request for access is logged with the
    email address it gives (access-requests.ts); that logs can name a folder,
    a file or an address; what the support screens show, including members'
    identifiers and the pseudonymised download of the audit log
    (GET /api/support/audit-export); the screens cannot show content; the read
    log, sent on request, and what of it outlives an erasure; the person who
    runs the machine can reach the database and the key outside the screens,
    which the read log does not record (the support_log view's own comment,
    managed migration 0025: audit detail is what "an investigation reads with
    a database query"); nobody reads content, for every provider (terms §4
    points here).
  - §4.6 (new): people who are not our customers. A family member's
    withdrawal deletes the token here only on the progress page
    (withdraw-grant.ts); a revocation at the provider leaves a useless token
    until the migration is deleted or the data erased. Share announcements go
    one wave per kind of item, and again only on purpose (share-announce.ts).
  - §5: rows for the request, the test-user entry, the copy before an update,
    other people's data (a family member's and invitees' included) and the
    audit log; browser storage and cookies; no automated decisions; what a
    tester must provide.
  - §6: the test-user list; the transfer bullet names the people a tester asks
    us to tell, the ingress (a placeholder, §7) and the mail provider; Google
    is offered as a source only.
  - §7, §8: Proton AG, Switzerland, as mail relay and support mailbox (0133,
    2026-09-28); during the Alpha the service runs on a machine we administer
    ourselves (0139 D5, T0 fact 6); a row for the service in front of it that
    ends TLS, «INGRESS_PROVIDER» in «INGRESS_REGION», until the owner answers
    0139 T0 fact 1 (see the README); a later host is named before any data
    goes there (0131 T4 (b)); who inside an organisation sees what; §8's
    negative carves out a target outside the EU the tester chose.
  - §9: rewritten to the owner's decisions and alpha §6 and §10: credentials
    (0139 open question 3 (a)); requests for access (open question 2 (a),
    built); closing and the erasure windows (alpha §10); the sign-in account
    and the Google test-user entry removed by hand on erasure day; the sign-in
    service's own history, which removing the account does not remove (below);
    the copy before an update (0134 open question 1 (b), 7 days), which also
    covers dump-idp.sh's dump; the task runner's daily drill copies; no
    backups otherwise (0139 D3); the log periods of 0129 D2 as built; what of
    the read log stays after erasure. «LOG_RETENTION» now covers server logs
    only. The heading and the row "Credentials" keep their words, because
    alpha §2 cites them.

  The owner's answers of 2026-09-28 (0139 Status quotes each in full),
  applied the same day. The Version line keeps its draft marker: the owner
  reviews these texts in the pull request ("park them in PR that i will
  review."), and the lawyer's pass stays deferred.

  - §7 and subprocessors.md: the machine is in the Netherlands ("app/site
    hosting is in The Netherlands"). The ingress row, and §6's transfer
    bullet, name NetBird GmbH, in Germany ("through NetBird (Germany)
    delivers the forward proxy"; read as the reverse proxy in front of the
    machine that ends TLS, which is what managed.yml says of it). Germany is
    in the EU, so §8 needs nothing for it. The entity name is from NetBird's
    published terms as search results quote them (Amtsgericht Berlin
    (Charlottenburg), HRB 237529 B); netbird.io could not be read from here,
    so the README marks it to confirm.
  - §4.5, §4.6, §7 and §9: Proton keeps the service's sent mail in the
    support mailbox (the owner's "yes"). §4.5 says so, §7's Proton row says
    the mailbox keeps a copy of each mail the service sends, and §4.6 says a
    copy of the mail to people items were shared with stays there, so that
    §3's "§4.6 lists it" stays a complete list. The service mails nobody a
    customer invites (apps/api/src/routes/tenants/members.ts sends nothing;
    the app's tenants.invite.hint: "No email yet; tell them yourself"), so
    §4.6's invitees bullet needs no such sentence. §9's support-mail row
    covers those copies: 6 months after sending, which reads the owner's
    "Until resolved + 6 months" for mail that answers no question (the
    owner confirms). Nothing prunes the Sent folder yet; a comment beside §9
    says so (README).
  - §9: a sign-in account nobody let in goes 30 days after it was created,
    unless a request for access with that address is still open (the owner:
    "30 days is ok"; 0135 T8's rule). The row says such an account opens
    nothing. Nothing removes one yet; a comment beside §9 says so.
  - §9: server logs are kept until the part of the service that wrote them
    is replaced. That is what Docker's default log driver does; whether the
    machine uses it is not checked (README: docker info --format
    '{{.LoggingDriver}}'). There is no fixed period, and the row says so.
    The README lists what would make a number true.
  - §10: the right to object on its own; a check that a request is yours; a
    complaint where you live or work.
  - §11: TLS as the code does it: the one switch a customer has is the
    wizard's "Use SSL/TLS" (useSsl), which turns TLS off altogether, not
    certificate checking (tlsVerify is in no API schema); ADR-0037 §5's floors
    are not built. Row security as SECURITY.md and docs/rls-guide.md state it
    at 683525c8: every route of the app, the support views passing it by
    design with an operator check, the background tasks not yet. A breach
    paragraph that tells the person, as the owner answered (question 18); the
    vulnerability channel as SECURITY.md (0139 open question 5).
  - §13: during the Alpha, alpha §11 sets the notice before what follows.
  - Words: "tenant" and "workspace" became "organisation"; the Dutch
    "beheerders" for our operators no longer collides with the admin role.

  The questions from v1.1, and where they stand:

  1. The household controller role and basis (§3): open. During the Alpha it
     is the only case.
  2. Correspondents and Art. 14(5)(b): open, and wider: §4.6 adds a family
     member and the people items were shared with, who get a mail from us.
     The announcement mail (renderShareAnnouncement in
     packages/shared/src/share-announcement.ts) carries no privacy notice or
     link. As we read Art. 14(3)(b), where data are used to communicate with
     the person, the information is due at the first communication at the
     latest; please confirm. If so, the mail needs a line and a link to this
     policy, which is a code change.
  3. Mollie as independent controller: does not arise during the Alpha
     (nothing is charged); open for later.
  4. The DPA "on request": answered for the Alpha, households only (0139
     open question 6); open for businesses later.
  5. The preflight's basis: open. v1.1's premise "counts kept 30 days" was
     wrong: the counts go with their migration (§4.3).
  6. Children under 16: open. A grant link can reach a family member under
     16, whose Google address then goes on the test-user list. Terms 1.3 §3
     now asks 16 or older, and a parent's or guardian's permission under 18,
     so the two texts agree (terms question 20).
  7. Invoices kept 7 years: does not arise during the Alpha; open.
  8. The portability note: open.
  9. «LOG_RETENTION»: the other log periods are rows of their own now (0129
     D2, as built). What is left is the output of the app's, the sign-in
     service's and this website's containers, which Docker keeps until a
     container is recreated; the owner declined journald (0134 open
     question 6 (a)). NOW: filled with that criterion, not a number (the
     owner: "Server logs: check ownpace repo on this."). The app's and the
     website's output goes at each update; the sign-in service's lasts until
     its version or settings change, which can be months. As we read Art.
     13(2)(a), stating the criteria is allowed; is this one enough, and does
     it meet Art. 5(1)(e) for the sign-in service's output?
  10. Entity facts: «REGISTERED_ADDRESS» and «VAT_NUMBER» are still the
      owner's. On the address the owner asked: "My address, is it needed? I
      also live there, and rather have correspondance by email." Our
      reading, in the terms briefing (question 22), is that the terms need
      the geographic address and that email can come first beside it. For
      this policy alone, Art. 13(1)(a) asks for the controller's identity and
      contact details; an email address may be enough there, though WP260
      rev.01 prefers more than one channel. Please confirm. The btw-id: the
      owner says it "was already mentioned" in site/legal/README.md; it is
      not there, nor anywhere in this repository or its history, so it stays
      a token until the owner or the accountant supplies it.

  New questions:

  11. §7, §8: is the wording on Switzerland's adequacy decision right and
      enough, and should an article be cited? The README's "Must be EU" rule
      reads against Proton. Is Proton's data-processing agreement in place
      for the account behind support@ownpace.eu, and where does it say Proton
      processes the data? The "Where" column should say that. NOW: the owner
      answered "yes" (2026-09-28): keep Proton AG, Switzerland; the agreement
      is accepted for that account; the account is Archico B.V.'s; and
      Proton keeps the service's sent mail in it (§4.5, §4.6, §7, §9).
      Where the agreement says Proton processes, and the adequacy wording,
      stay open.
  12. §6, §8: is entering a Google address in the test-user list of our app
      at Google a transfer by us, and is Google a processor or a controller
      for that list? If it is a transfer, on what basis, which §8 would then
      have to name (Art. 13(1)(f), as we read it; please confirm)? The text
      states no basis. When does a family member's address come off it?
  13. §5: the basis for other people's data (drafted as legitimate
      interests), and in particular for a family member, who is not a party
      to our contract, whose access, address and test-user entry we hold;
      for invitees; and for the audit log (both added as rows, drafted as
      legitimate interests). And which exception covers special-category data
      passing through, now that subject lines are kept.
  14. §8: in the household case we are controller. Is writing to a target
      outside the EEA then a transfer by us? The text now carves it out of
      the negative rather than asserting it. Two more paths, not asserted
      either way: a vulnerability report through the advisory form sits at
      GitHub, in the US, where we read it (§11); and the service's mail to a
      tester's own address, or to a grantee, whose mailbox is at a US
      provider. Are either of these transfers by us?
  15. §6: do the mail to people items were shared with, mail carried by
      Proton, and NetBird GmbH, which sees the app's pages readable, fit
      Limited Use's allowed transfers? Does reading a log line
      that names a Gmail label, to answer a report, fit its exceptions?
  16. §13: may 7 days' notice with explicit acceptance (alpha §11) stand
      beside §13's 30 days for the step after the Alpha?
  17. Language: the site prints a note above the Dutch privacy and terms
      pages that the English governs (translationNote in site/copy.mjs), and
      terms 1.3 §13 keeps that rule, as v1.2 had it. Can it stand for a
      Dutch-first Alpha (alpha briefing q. 2, terms question 15)?
  18. §11: the breach paragraph now says "and we tell you", following the
      owner's answer "We do tell the tester." (0139 Status, the nine answers,
      6). The Alpha conditions §4 say "where that is required", and prevail
      where they differ; a 1.1 of the conditions can drop the qualifier, or
      the owner keeps it here too.
  19. §9: the sign-in service's history. Zitadel stores every change as an
      event, and a removal appends an event; its maintainers write "Delete in
      ZITADEL means a new events org.deleted, all events still exist in the
      eventstore" (zitadel/zitadel#2758), and de-identifying the events of
      deleted users after a retention period is a feature request that is
      still open (zitadel/zitadel#7811). So we expect the name and address in
      a removed user's earlier events to stay. Not yet checked on the pinned
      v4.19.2: remove a test user on the OTA stack and query its events.
      With no period, does the row meet Art. 17 and Art. 5(1)(e)? The owner
      decides whether those events are purged by hand at erasure (Zitadel does
      not support it), or given a period.
  20. §9: two more rows keep personal data after erasure with no period: an
      operator's search by address and a download of the audit log (the read
      log records both without an organisation), and the background tasks'
      records, which carry organisation and migration identifiers that a
      problem-report mail (organisation identifier plus the reporter's
      address) can link back to a person, and the reason an operator types
      when a switch-over is undone. Storage limitation and the duty to state a
      period or its criteria (Art. 5(1)(e) and 13(2)(a), as we read them;
      please confirm) make both a risk. The owner decides: purge the searches
      at erasure, or give a period; and set a period for the task records
      (0139, For the owner, items 4 and 8).

  For the owner before publication (facts, and code that must match):

  - «HOSTING_REGION», filled 2026-09-28: the Netherlands. Still open: does
    any company house the machine or reach it (then it is a §7 row)? Is it
    run by Archico B.V.?
  - «INGRESS_PROVIDER», «INGRESS_REGION», filled 2026-09-28: NetBird GmbH,
    Germany. To confirm: the entity name, from NetBird's terms or
    data-processing agreement; that agreement accepted for the account, with
    its date recorded in 0139 T0, as for Proton; which proxy cluster the
    names point to, and where it runs (the NetBird dashboard); and that the
    services use NetBird's HTTP mode, which ends TLS at NetBird, as
    managed.yml says, rather than TLS passthrough. Two findings from
    NetBird's documentation, not yet in the text: its reverse proxy keeps an
    access log per request, with the visitor's IP address, a location
    derived from it, and the full path, which for a grant or progress link
    includes its secret; so §4.5's "without the secret part of a link" holds
    for our own logs only, and the §7 row could add "It keeps a log of the
    requests it carries, with the IP address and the page asked for." And
    with TLS ending at NetBird, our two nginx logs are not the same. The
    app's (apps/web/nginx.conf.template, format ownpace_combined) records
    only the address that connects to it ($remote_addr, no real-IP
    setting), which is then NetBird's proxy rather than the visitor, and
    the API's log does the same unless live sets TRUST_PROXY. The website's
    (deploy/compose/www-nginx.conf) sets no access_log or log_format, so the
    image's own default applies (nginx:1.31-alpine, www.yml); in official
    nginx images that is the "main" format, which also logs the
    X-Forwarded-For header. The image's nginx.conf was not read here. If
    NetBird sets that header, the website's log holds the visitor's IP
    address. Check each on live (0132 T3 (d)); §4.5 then says, per log,
    whose IP address it records.
  - «UNADMITTED_SIGNIN_RETENTION» and «LOG_RETENTION», filled 2026-09-28
    (above). «SUBPROCESSORS_URL» and «PRIVACY_HISTORY_URL»: the owner asked
    "recommend me what to do." Recommended: make §7's table the complete
    list for now, replacing "The current list is maintained at
    «SUBPROCESSORS_URL»." with "This table is the complete list of our
    sub-processors." / "Deze tabel is de volledige lijst van onze
    subverwerkers.", and publish subprocessors.md, with a Dutch text, when
    the first business customer and the DPA arrive (0086 T5); for the
    Alpha, §7's table already names everyone subprocessors.md names as
    current. And the history of this file in the public repository, per
    language: https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.md
    and .../privacy.nl.md. The history also shows unpublished drafts, each
    marked by its own Version line; keeping each published version on
    www.ownpace.eu itself is a later build change (0139 T10). Not applied:
    the owner decides.
  - §4.5 describes reports by mail: true once the report-by-mail branch is
    merged and live sets no Zammad (0139 Status item 5 still names one).
  - §9 says nothing uses credentials after closing: true once a closed
    organisation gets no new passes, which is not so on main (the
    closed-organisation task, uncommitted).
  - §9's "never longer than 7 days": deploy/compose/dump-idp.sh keeps its
    dumps, with the sign-in service's accounts and password hashes, with no
    limit, and the copy before an update is taken and deleted by hand. Prune
    or delete the dumps within 7 days, and automate the copy, or change §9.
    The owner, 2026-09-28: "deletes only after procen successfull upgrade,
    so we already have one backup copy of what actually works." That is §9's
    "until the next update succeeds", for dump-idp.sh's dumps too. What
    stays to settle is the 7-day cap, which §9, the Alpha conditions §6 (1.0)
    and the erasure date a closing organisation is told all rest on. Read as
    "delete the copy once the update it was made for is proven", it fits:
    proven when deploy-live.sh has logged the deploy as taken and one pass
    has completed, and never later than day 7. Read as "keep the last good
    copy until the next upgrade is proven", the copy becomes a standing
    backup that can last weeks, which needs an Alpha conditions 1.1 and a
    longer period in §9. Recommended: the first reading, built as one
    script and one directory for the whole copy (the app's database, the
    sign-in service's database and the roles, as the runbook's recipe
    already dumps), with a daily duty deleting anything older than 6 days as
    a backstop; dump-idp.sh on live then has nothing left to do.
  - §9's daily copies of the task runner's database: live's daily drill
    (box-duties.sh, trigger-version.sh drill, the newest 7 kept) dumps it,
    with the run records and the encrypted task settings, the key among them.
    Keep the drill on live and the row as it is, or stop it for the Alpha and
    drop the sentence. The Alpha conditions §6 say no backups "of the
    service's own records"; a run's history may be one of them. The owner
    asked: "What about the drill?" Recommended: take the drill off live's
    duties for the Alpha, and keep the OTA stack's nightly drill, which
    proves the same dump and restore at main's Trigger.dev version. Before a
    Trigger.dev upgrade on live, take trigger-version.sh backup
    before-<version> as part of the copy before an update, under the same
    rule. Then this row loses its drill sentence and the paragraph under the
    table its "daily copies", in both languages, and the Alpha conditions §6
    hold as written. Live loses a restorable copy of the task runner's
    database between upgrades, kept on the same machine, and nothing these
    texts promise. Not applied: the owner decides.
  - §9's sign-in history (question 19), and removing the sign-in account by
    hand (idp-strays.sh --subject, 0135 T8).
  - §4.4's sessions: that the sign-in service keeps the browser and IP
    address of a sign-in is from Zitadel's design (login v1's auth requests
    carry the browser's information); check it on v4.19.2, as question 19.
  - Social sign-in on live (0139 T0 fact 4). §4.4's "not at another company"
    and its list of what the sign-in account holds assume email and password
    only; if any IDP_* key is set, §4.4, §7 and §8 name the links and the
    provider. And where NOTIFY_TO, ALERT_TO and REPORT_MAIL_TO point.
  - Telemetry from the parts we run ourselves: managed.yml sets no opt-out.
    Trigger.dev's self-hosting documentation says its webapp sends telemetry
    unless TRIGGER_TELEMETRY_DISABLED is set; whether Zitadel, ClickHouse or
    MinIO send anything by default is not checked. Set the opt-outs, or name
    what is sent, before §8's negative is published.
  - Proton: answered "yes" (2026-09-28). Proton AG and Switzerland stay; the
    agreement is accepted for support@ownpace.eu, which is Archico B.V.'s
    account; the service's sent mail is kept there, so §4.5, §4.6 and §7's
    Proton row say so, and §9's support-mail row covers it (6 months after
    sending: confirm). Nothing prunes the Sent folder yet: by hand at 6
    months, or a Proton setting if Proton has one, until something does.
    Where the agreement says Proton processes stays to check (question 11).
  - §4.4 and §7 say we do not ask for or keep a card number; remove or
    refuse the billing route that accepts a card's brand, last four digits
    and expiry, or keep the weaker sentence.
  - §4.5's sentence on access outside the support screens is ours, not
    yours yet: confirm it, or add a record of database access.
  - The Alpha conditions §10 say access is kept "until you delete the
    connection or the migration"; the code, and §9 here, keep a connection's
    access until the connection is deleted (0139 Status offers a 1.1 wording).
    The owner asked: "what do you recommend?" Recommended: that 1.1 wording,
    so the conditions follow the code: "We keep that access until you
    delete the connection; access a family member gave through a grant
    link, until you delete the migration." / "Wij bewaren die toegang tot u
    de koppeling verwijdert; toegang die een gezinslid via een toegangslink
    gaf, tot u de verhuizing verwijdert." It costs no notice: no tester has
    accepted 1.0. Not applied: the conditions are the owner's.
  - §9's sign-in account nobody let in, 30 days: built by 0135 T8
    (idp-strays.sh), not yet. Until it is, either the owner removes these by
    hand in the sign-in service's console, or the row waits; the owner
    chooses (the owner accepted the 30 days, not a duty by hand). T8's rule
    did not spare an address with an open invitation: a person who
    registered, asked, and was granted has an invitation to their address,
    and no open request, until they first sign in to the app. 0135 T8's rule
    now has that condition (2026-09-28).
  - The app says things this policy contradicts: the grant mail's "Your
    password lives with the sign-in service, never with us"
    (packages/shared/src/notifications.ts), the Alpha note's "nothing is
    backed up" (apps/web/src/i18n/strings.ts, alpha.note.terms, and the grant
    mail), and the request form's "We keep what you type only to answer you"
    (access.privacy). Change them with the texts (README).
-->

# Privacy policy

**Applies to:** the Ownpace **managed service** at `ownpace.eu`, and this website.
**Version:** 1.2 (draft — not yet published)
**Last updated:** 2026-09-28

> **If you run Ownpace yourself**, this policy does not apply to you and there is nothing for
> us to state: the software runs on your infrastructure, your data never reaches us, and we
> receive nothing — no telemetry, no usage counts, no error reports. The source is public and
> that claim is checkable rather than promised.

> **During the Alpha**, the Alpha conditions apply as well. Where they say something different
> from this policy, they prevail.

---

## 1. Who we are

Archico B.V., «REGISTERED_ADDRESS», KvK 73922706, VAT «VAT_NUMBER».

**Contact for anything in this policy, including your rights under the GDPR:
support@ownpace.eu.** A person reads what arrives there. We aim to answer within five working
days and are bound by the GDPR's one-month limit for rights requests.

## 2. What Ownpace does, because it decides everything below

Ownpace moves your mail, contacts, calendars and files from one provider to another, and keeps
the copy in step until you decide to switch over. It reads your source account, writes to your
target account, and keeps a record of what it has moved so that running it again does not
duplicate anything.

**We are not a storage service.** Your messages and files pass through Ownpace to be written to
the target you chose. We do not store them: each one only passes through while it is being
copied, and we keep no copy of it. What we do keep about each item is the record in §4.2.

## 3. Our role, which depends on who you are

For **your account with us** — sign-in, billing, support correspondence — we are the
**controller**, whoever you are.

For the **content of your migration** — your mail, files, contacts and calendar entries — it
depends on who is migrating:

- **If you are an organisation**, you are the **controller** and we are your **processor**. We
  act on your documented instructions, which are the migrations you configure. Our
  data-processing agreement forms part of your contract — **available on request** at
  support@ownpace.eu until it is published here.
- **If you are a private individual** moving your own or your family's accounts, the GDPR's
  household exemption (Art. 2(2)(c)) means *you* carry no controller obligations for what you
  move — and that exemption does not extend to us (recital 18). For your migration's content
  we therefore act as **controller**, on the contract between us (Art. 6(1)(b)), and this
  policy carries the commitments a business customer would get from a data-processing
  agreement: we process the content only to run the migration you configured (§5), the
  sub-processor list in §7 and the retention in §9 apply to you in full, and §2's promises
  hold.

**During the Alpha**, only households take part (Alpha conditions §1). So for your migration's
content the second case applies to you, and no data-processing agreement is involved.

A mailbox also contains **other people** — the correspondents who wrote to you, and the people
in your contacts and calendars — and a migration can involve a family member, or people you
shared files with. They never contracted with us. What we hold that concerns them is what §4
describes (§4.6 lists it) and nothing more, it is protected by the same §7–§9, and the rights in
§10 are theirs too, no account required.

## 4. What we actually hold

Stated at the level the software actually works at, because a vaguer answer would be less
useful and no more honest.

### 4.1 Credentials for your accounts

Whatever is needed to read the source and write the target: an OAuth refresh token, or a
username with an app password, or a service-account key. **Encrypted at rest with AES-256-GCM**
under a key kept apart from the database: in the service's own configuration, and in the
settings of the background tasks that run migrations, both on the same machine.

We ask for the narrowest access each provider offers. Where a provider offers nothing narrow —
Google's IMAP endpoint accepts only a permission that amounts to full access to your mail — we
say so rather than implying otherwise. The connectors that read your mail, contacts and
calendars **cannot write to the source** at all.

You can revoke our access at your provider at any time, without asking us, and the migration
stops.

### 4.2 The migration ledger — metadata, not content

For every item we move we keep a row recording: an identifier the source already assigned it
(for mail, the `Message-ID` header; for a file, its path; for an event or a contact, its UID), a
hash of that identifier, a hash of the content, the size in bytes, the folder, calendar or
address book it is in, the identifiers the source and the target use for it, timestamps, and
whether the copy succeeded. So that the app can show you which item it means, the row also keeps
**the name you know it by**: a message's subject (once the message has been fetched), an event's
or task's title, a contact's name, a file's name. If an item fails, the row keeps the reason as
the provider worded it; that text can name a folder, a file or an address. This record is what
lets a second pass skip what is already there, instead of duplicating your mailbox.

**The ledger holds no message bodies, no attachments, no file contents.** It does hold metadata
that can be revealing on its own — subjects, names, folder and file names, the provider's error
text, and hashes derived from content — and we would rather say that plainly than describe it
as "technical data".

With each migration we also keep the folders it maps, how far each pass got, the decisions you
made about items, and the results of its checks. With your organisation we keep the
distribution lists a migration found, with their members' addresses, and the list of what was
shared (§4.6).

### 4.3 What a preflight keeps

A free preflight reads your source to count what is there. It stores **counts, sizes and
per-folder aggregates** — not an inventory of individual items — and the provider's reason if
something could not be counted. Item identifiers reach the ledger only when a real migration
starts. The counts belong to the migration they were counted for: kept with it, and gone when
you delete it or your data is erased (§9).

### 4.4 Your request for access, and your account

**Your request for access.** During the Alpha, nobody is let into the service without asking us
first, unless someone already in it invites them (§4.6). The request form keeps what you type:
your email address, and if you give them, your name, an organisation, a note and the package you
had in mind; and your language. Then it keeps our decision, who made it, and when. We use it to
decide on your request and to answer you. We get an email about each new request, with your
address and the organisation and package you named, but not your note. Asking creates no
account.

**Your sign-in account.** Signing in runs on a sign-in service we operate ourselves, on the same
machine as the service. Your sign-in account is kept there, not at another company; §7 says what
your connection to it passes through. It holds your first and last name, your email address, a
user name, a hash of your password (never the password itself), and your sessions: when you
signed in, and the browser and the IP address you signed in from. That service also keeps a
history of every change to your sign-in account (§9). Anyone can create a sign-in account at our
sign-in page, but it opens nothing until we let that person in. The sign-in service's mail to
you, such as a sign-in code or a link to reset your password, goes through our mail provider
(§7).

**Your account with us.** Your email address, the identifier our sign-in service gives you, the
organisation you belong to (in the app, your household's space is called an organisation), your
role in it (during the Alpha, owner or admin), and when you were invited and when you joined.

**During the Alpha, your Google address.** If you want to connect a Google account, you give us
its address, and we enter it in the list of test users that Google keeps for our app (§6).

**Invoices** and the usage figures behind them — how many migrations ran at once, and how much
data was moved. **During the Alpha nothing is charged**: there are no invoices, and you register
no payment method. Once there are payments, our payment provider handles them (§7); **we do not
ask for or keep your card number**. If you fill in invoice details on the *Billing* page anyway —
a name, an address, a VAT number — we keep them until your data is erased, and if you ask the
app to check a VAT number, it is checked with the European Commission's VIES service.

### 4.5 Support and operational logs

**Support mail.** Anything you send to support@ownpace.eu. It arrives in a mailbox that our mail
provider holds for us (§7). The same mailbox keeps a copy of the mail the service sends, such as
sign-in codes, progress summaries and the notices you ask us to send.

<!-- NOT YET TRUE ON main: the report by mail is 0130 T5, committed on its branch and not merged;
     on main the form is offered only with ZAMMAD_URL and a token. True once T5 is merged and
     live runs without ZAMMAD_URL (README, "Before the draft markers come off"). -->

**Reporting a problem.** During the Alpha, *Report a problem* in the app's menu sends your
report as an email to support@ownpace.eu, through our mail provider (§7). The mail holds what
you wrote, the page you were on (without the secret part of a link), the reference and kind of
an error if there was one, your organisation's identifier, the app's version, and your sign-in
address, so that we can answer you. If you add a screenshot, it goes too. A screenshot shows
whatever was on your screen, such as subjects, names and addresses, so look at it before you
send it. *Report this link*, on a page reached through a grant link or a progress link, sends
what the person wrote and the facts of that link the same way, such as who made it and for
which accounts, and an address only if they give one.

**Server logs** record that requests happened, for the app and for this website: the time, the
IP address the request came from, the page asked for (without the secret part of a link), the
page you came from, what your browser says it is, and error codes. Logs are written so that
**credentials and message content do not appear in them.** They are not free of names, though.
When a step of a migration fails, the provider's own error text is written to the log of the
process that met it, beside a reference, so that we can help you with it; that text can name a
folder, a file or an address. And a request for access is logged with the email address it
gives, as is our decision on it.

**What the people who run the service can see.** To run and support the service, the people on
our side who operate it — during the Alpha, one person — can view **service metadata** about
your account on our support screens: your organisation's name and status; its members'
addresses and roles, and the identifier our sign-in service gives each of them; the names of
your connections and migrations (a connection is named after the account's user name or
address, unless you rename it); each migration's state and failure category; invoice summaries;
how many items are waiting on a decision from you; and your organisation's log of who did what
and when, without the details. They can also look up which organisation an address belongs to,
and download the log of who did what, with its details, in which every address and file name is
replaced by a pseudonym. **The support screens cannot show your content.** Message bodies and
subjects, folder and file names, calendar entries, credentials and stored error text are not
shown on any support screen — the screens are built without access to them, which you can
verify in the source code rather than take on trust. **Every such view is itself recorded** —
who looked, at whose account, at which screen, and when, and for a search, what was searched for
— in a log the app cannot change. What it records about your account goes when your data is
erased; a search by address and a download of the log are recorded without an organisation, and
stay after that (§9). Ask us, and we send you what that log records about your account. Our
data-processing agreement (§5 there) makes the same commitment to organisations.

**Outside those screens.** The person who runs the machine can technically reach the database,
and the key that protects your credentials. That access is there to keep the service running
and to repair it. When we look into a problem, it can show us what §4.2 keeps, such as a subject
or a file name, and we look no further than the problem needs. Access this way is not recorded
in the log above.

**Nobody at Ownpace reads your mail, files, contacts or calendars.** The exceptions are the ones
§6 lists for Google data, and they hold for every provider: your own explicit request about
specific items (a screenshot you add to a report is one), what security or the law makes
necessary, and aggregated figures that identify nobody.

### 4.6 People who are not our customers

A migration touches people who never signed up with us. This is what we hold about them.

- **A family member whose account you migrate.** If you send them a grant link, they sign in at
  their own provider and give Ownpace access themselves, from a page that says who asked, from
  which account and to where. We keep that access (encrypted, §4.1), the address of their
  account, and when the link was made, used and ended. They can withdraw the access at any time.
  On their progress page, that deletes it here, and revokes it at their provider where the
  provider allows that. At their provider, it makes what we hold useless, and we delete it when
  you delete the migration or your data is erased. To connect a Google account, its address must
  also be on Google's list of test users (§6).
- **People you shared files, folders or calendars with.** When you ask the app to check your
  sharing, it keeps a list of who had access to what at your old provider: their address, the
  name of the file, folder or calendar, and their role. If you ask the app to tell them where
  their shared items went, each of them gets an email from support@ownpace.eu for each kind of
  item shared with them, such as calendars or files, once that kind has been switched over, with
  your note and the names of the items; and again only if you choose to send it again. A copy of
  each such email stays in our support mailbox until 6 months after it was sent (§4.5, §9). The
  list stays until your data is erased, also after you delete the migration.
- **People you invite** into your organisation: their address, their role, and whether they
  joined.
- **People who report a link** they were sent: see §4.5.
- **Correspondents, and everyone else in your mail, contacts and calendars**: only what §4.2
  keeps about each item. Their name or address can appear there in a subject, as a contact's
  name or in an error text, and a distribution list keeps its members' addresses.

## 5. Why we hold it, in GDPR terms

| What | Purpose | Lawful basis |
|---|---|---|
| Credentials, ledger, preflight counts | Performing the migration you asked for | Contract, including steps you request before one (Art. 6(1)(b)) — on your instructions as processor for an organisation; as controller for a household migration (§3) |
| Your request for access | Deciding whether to let you in, and telling you | Steps you ask for before a contract (Art. 6(1)(b)) |
| Your account and sign-in account, invoices, usage figures | Providing the service, letting you sign in safely, and billing for it | Contract (Art. 6(1)(b)); legal obligation for invoice retention (Art. 6(1)(c)). No invoices during the Alpha |
| Your Google address on Google's list of test users (Alpha) | Letting Google allow the connection you ask for | Contract (Art. 6(1)(b)) |
| Other people's data (§4.6): in what you migrate, a family member's access and address, the people you invite, and the mail to people you shared items with | Carrying out the migration you asked for, letting in the people you invite, and telling people, at your request, where their shared items went | Legitimate interests (Art. 6(1)(f)): yours, in moving your household's mail and files, and ours, in doing it; the limits in §4 and §9 protect theirs |
| The audit log of who did what in your organisation, and when | Showing you, and us, what was done in your organisation and by whom | Legitimate interests (Art. 6(1)(f)) |
| The copy made right before an update | Undoing a failed update, so that your data stays intact | Legitimate interests (Art. 6(1)(f)) |
| Server logs, for the app and this website | Keeping the service secure and working | Legitimate interests (Art. 6(1)(f)) |
| Support mail and problem reports | Answering you, and fixing what went wrong | Contract / legitimate interests (Art. 6(1)(f)) |
| Support read-log (which of us viewed which account metadata, and when) | Accountability for our own access to your account | Legitimate interests (Art. 6(1)(f)) — yours as much as ours |

**We do not use your data for advertising, we do not profile you, and we do not sell or rent
your data to anyone.** There is no analytics tracker on the application or on this website. The
app keeps your sign-in in your browser's own storage until you sign out, and remembers your
language and a few choices there; it sets no cookie of its own, and neither does this website.
Our sign-in page sets the cookies that signing in needs. This website loads nothing from other
servers.

We make no decision about you by automated means alone: a person decides every request for
access. To take part, you give us your email address; to connect a Google account during the
Alpha, you also give us its address. Without them we cannot let you in, or connect that account.

## 6. Google user data — the specific commitments

Ownpace's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the **Limited Use** requirements. Concretely, and in our own words:

- We use Google user data **only** to provide the migration you configured — reading your
  source account and writing it to the target you chose — and to show you its progress.
- We **do not transfer** Google user data to anyone, except to the migration target you
  yourself selected; to people you yourself ask us to tell where a shared item went (§4.6); to
  NetBird GmbH, which carries your connections to us, and to the provider that carries the
  service's mail (§7), each only for that; and where the law requires it.
- We **do not use** Google user data for advertising of any kind.
- We **do not allow humans to read** Google user data. The exceptions are the ones the policy
  permits and no others: your own explicit request for specific items, what is necessary for
  security or to comply with the law, and aggregated figures that identify nobody.
- We do not use Google user data to train any machine-learning or AI model, general or
  otherwise.

**Ownpace offers Google as a source only**: there is no Google target to choose.

**During the Alpha: Google's list of test users.** While Ownpace's app at Google is in Google's
test phase, Google lets an account connect only if its address is on that app's list of test
users. So before you connect a Google account, you give us its address, and we enter it in that
list at Google. The same goes for the Google account of a family member you send a grant link
to. We take your address off the list when your data is erased (Alpha conditions §10). In the
test phase, Google also ends a connection after about seven days; you then connect again
(Alpha conditions §9).

You can revoke Ownpace's access to your Google account at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions), or by deleting
the app password you issued.

## 7. Who else touches it

During the Alpha, the service, its databases, our sign-in service and this website run on a
machine we administer ourselves, in the Netherlands.

<!-- The owner, 2026-09-28 (0139 T0 fact 1): "app/site hosting is in The Netherlands, through
     NetBird (Germany) delivers the forward proxy". Read as the service in front of the machine
     that ends TLS for app., id., status. and www.ownpace.eu (managed.yml, "netbird terminating
     TLS on 443"). TO CONFIRM before publication (README): the entity name, NetBird GmbH, from
     NetBird's terms or data-processing agreement (it was read from search results of NetBird's
     terms, not from netbird.io itself); that agreement in place for the account; where the
     proxy cluster the names point to runs; and whether its access log, which records the
     visitor's IP address and the full page asked for, is on (privacy briefing). -->

| Sub-processor | What for | Where |
|---|---|---|
| NetBird GmbH | Carrying your connections to app.ownpace.eu, id.ownpace.eu, status.ownpace.eu and www.ownpace.eu through to our machine. It ends the encryption (TLS) of those connections, so what passes through them, such as what you type when you sign in and what the app shows you, passes through it readable | Germany (EU) |
| Proton AG | Sending the service's mail, such as sign-in codes, our answer to your request for access, progress summaries, and the notices you ask us to send. Holding our support mailbox, support@ownpace.eu, where your mail to us and, during the Alpha, problem reports arrive, and where a copy of each mail the service sends is kept (§4.5) | Switzerland, outside the EU (§8) |

The current list is maintained at «SUBPROCESSORS_URL». If the service moves to a hosting
provider after the Alpha, we name that provider here, and tell you, before any of your data
goes there (Alpha conditions §11). Business customers are notified before a sub-processor is
added, with the right to object as set out in the DPA; everyone else gets the same change
notice through §13.

**Mollie B.V.** (Netherlands, EU) handles card and direct-debit payments. As a licensed
payment institution it processes your payment data under its own responsibility and privacy
policy — an independent controller, not our sub-processor. **We do not ask for or keep your card
number.** During the Alpha nothing is charged, so Mollie receives nothing about you.

**Inside your organisation**, what the service holds is visible to its owner and its admins;
the Alpha conditions ask you to invite nobody (§8 there). A progress link shows whoever holds it
the counts and states of one migration, never its content.

**Your migration's source and target providers are not our sub-processors** — they are your
own accounts, and your relationship with them is yours.

Beyond what this policy names, we give your data to others only where the law obliges us to.

## 8. Where it is, and where it is not

The service runs in the **European Union**. One party in the table above is outside it: our
mail provider, Proton AG, is in **Switzerland**. The European Commission has decided that
Switzerland protects personal data adequately, so the GDPR asks for no further safeguard for
that transfer. During the Alpha there is one more step, which you ask for yourself: to let you
connect a Google account, we enter its address in the list of test users that Google keeps for
our app (§6). **Apart from these, and a target you choose outside the EU (below), there is no
transfer of your data to the United States or any other third country by us.**

That is not a formality but the core of the product: moving off a US-hosted provider makes
little sense through a migration tool that is itself hosted in the US, so ours is not.

If your migration's **target** is outside the EU, your data goes there because you chose that
target. We show you the target before anything is written.

## 9. How long we keep it

<!-- NOT YET TRUE ON main, so the draft marker stays until each holds (README, "Before the draft
     markers come off"):
     - Credentials, "nothing uses any of it from then on": the sync tick (ACTIVE_MAPPINGS_SQL in
       apps/worker/src/jobs/managed-sync-tick.ts) never reads the organisation's status, so a
       closed organisation still gets new passes until the purge. The fix is the
       closed-organisation task, not merged.
     - The copy made right before an update, "never longer than 7 days": the copy of the
       service's databases is taken and deleted by hand (stand-up-live.sh: "no script takes it or
       deletes it yet"), and deploy/compose/dump-idp.sh keeps every dump of the sign-in
       service's database ("none is ever overwritten"). The owner, 2026-09-28: "deletes only
       after procen successfull upgrade" (README).
     - A sign-in account nobody let in, "30 days after it was created": nothing removes one yet.
       0135 T8 (deploy/compose/idp-strays.sh) is proposed, not built. Until T8 is built, either
       the owner removes these by hand in the sign-in service's console, or the row waits; the
       owner chooses (README).
     - A copy of the service's own mail, "6 months after it was sent": nothing prunes the Sent
       folder of support@ownpace.eu at Proton; no script or setting here does it. Until something
       does, it is pruned by hand at 6 months, or by a Proton setting if Proton has one (not
       checked). The 6 months is our reading of the owner's "Until resolved + 6 months" for mail
       that answers no question; the owner confirms it (README).
     - Server logs: the row holds with Docker's default log driver, which keeps a container's
       output until the container is removed (0134 open question 6 (a)). If the machine logs to
       journald instead, as docs/managed-bring-up.md's steps for live still ask, the row is a
       period, not this criterion (README). -->

| What | Kept for |
|---|---|
| Credentials | Until you delete them. The access on a connection goes when you delete that connection; the app lets you once no migration uses it. Access a family member gave through a grant link goes when you delete that migration, or when they withdraw it on their progress page. A finished migration keeps the access you gave us, so that you can resume it. If you close your account, nothing uses any of it from then on, and all of it is destroyed when your data is erased. Each time, we also revoke the access at the provider, where the provider allows that. |
| The migration ledger (§4.2), and what each migration keeps beside it | Until you delete the migration; then deleted with it. Otherwise until your data is erased. |
| Preflight counts | With the migration they were counted for: until you delete it, or your data is erased. |
| What belongs to your organisation rather than to one migration: its members and invitations, the distribution lists a migration found, the list of what was shared (§4.6), and the audit log of who did what, and when | Until your data is erased, also after you delete the migration that found them. |
| The record of each pass: when it ran, and what it counted | During the Alpha: until your data is erased. |
| A pass's log lines | 60 days. |
| The app's own errors and warnings (a category and a reference, no text) | 30 days. |
| Your account, your organisation and your sign-in account | While your account exists. When you close it, you choose when your data is erased: at once, or after 7, 30 or 90 days. On that day we also remove your sign-in account from our sign-in service, and take your Google address off Google's list of test users (§6); these are steps we take by hand. |
| The history our sign-in service keeps of your sign-in account: every change to it, such as your name and email address as they were, and your sign-ins | No period is set yet. Removing your sign-in account adds an entry to that history; it does not remove the earlier ones. |
| Your request for access (§4.4) | While it is open. Declined: deleted 30 days after our decision. Granted: kept with your account, and erased with it. |
| A sign-in account that someone created at our sign-in page but that we never let in, and that therefore opens nothing (§4.4) | 30 days after it was created, unless a request for access with that address is still open. |
| Support mail and problem reports, and the copies of the service's own mail in the same mailbox (§4.5) | Until the question or problem is resolved, and then 6 months more; a copy of the service's own mail, 6 months after it was sent. Then deleted from the mailbox. |
| The record of what we viewed on your account (§4.5) | Until your data is erased. What is recorded without an organisation stays after that: a search by address, and a download of the log of who did what. |
| The copy made right before an update | Until the next update succeeds, and never longer than 7 days. The same holds for the copy of our sign-in service's database, made before that service is upgraded. Such a copy is made only to undo a failed update, and it does not leave the hosting environment. Data erased from the service can remain in it for at most 7 days. |
| Records of the background tasks that run your migrations (identifiers, counts, and a category and a reference for an error; no names, addresses or content, apart from the reason one of us types when a switch-over is undone) | No period is set yet. They are not deleted when your data is erased. A copy of them is made every day, to check that such a copy can be restored, and the newest seven copies are kept. |
| Server logs (§4.5) | Until the part of the service that wrote them is replaced: for the app and this website, at each update of the service; for our sign-in service, when its version or its settings change; for a background task, when its run ends. There is no fixed period. |
| Invoices and the usage figures behind them | **7 years**, because Dutch tax law requires it. During the Alpha nothing is charged: there are no invoices, and the usage figures go when your data is erased. |

**During the Alpha we make no backups**, apart from the copies made right before an update and
the daily copies of the background tasks' records, both in the table above (Alpha conditions
§6). During the Alpha we close your account within 7 days of your request, and tell you the date
on which your data will be erased (Alpha conditions §10). The erasure removes from the service's
database everything this table keeps until your data is erased; your sign-in account and your
Google address follow on the same day, by hand. What the table says stays after erasure stays as
it says. Apart from that, what remains is a record that an erasure took place, with dates and
counts and no name or address. If we ever discontinue the service, §11 of the terms says what
you get.

## 10. Your rights

Access, rectification, erasure, restriction, portability, objection, and withdrawal of consent
where consent is the basis. Write to **support@ownpace.eu**; we will not charge you and we will
not make you explain why. We may ask you to confirm that a request is yours, for example by
writing from the address your account uses. These rights hold against us wherever §3 makes us
controller — and the people in a migrated mailbox, and anyone else §4.6 names, who never held
an account, can write to the same address.

**Your right to object.** Where we rely on legitimate interests (§5) — our logs, the audit log,
the record of what we viewed on your account, the copy made before an update, and the data of
other people in a migration — you may object at any time, on grounds relating to your situation.
We then stop, unless we have compelling legitimate grounds that override your interests, rights
and freedoms, or need the data for a legal claim.

**Portability deserves a note.** This whole product exists because moving your own data between
providers is harder than it should be. If you want your data out of Ownpace, you already have
it — it is in the target account we wrote it to.

You may complain to a supervisory authority, in particular in the country where you live or
work. In the Netherlands that is the **Autoriteit Persoonsgegevens**
(autoriteitpersoonsgegevens.nl).

## 11. Security

Credentials encrypted with AES-256-GCM, under a key kept apart from the database that holds
them: in the service's own configuration, and in the settings of the background tasks, both on
the same machine. Connections to your providers are encrypted with TLS, and the provider's
certificate is checked, unless you switch off SSL/TLS yourself for an account you connect by
server name; that connection may then not be encrypted. Organisations are kept apart in the
database itself through row-level security, for the app's requests. Our support screens read
through views that pass it by design, and each of those views checks that the reader is one of
the people who run the service (§4.5). The background tasks that run migrations do not work
under it yet; there, each query's own filter on your organisation keeps them apart, and they are
being brought under row-level security. Logs written to keep credentials and message content
out (§4.5 says what they can still name).

**If a breach happens.** If a breach of security affects your personal data, we report it to
the Autoriteit Persoonsgegevens where the law requires that, and we tell you.

No system is perfect. If you find a vulnerability, report it privately through
[our form on GitHub](https://github.com/Robbes/Ownpace/security/advisories/new) or, if you have
no GitHub account, write to **support@ownpace.eu**. We confirm that we received it within five
working days. Please ask us before you test against the service itself: it holds other people's
access to their accounts. We will not threaten you for telling us.

## 12. Children

The service is not directed at children under 16 and we do not knowingly create accounts for
them. A household migration a parent sets up may of course move a child's account — that is the
household case §3 describes, and the parent stays the one who sets it up.

## 13. Changes

Material changes are notified by email to account holders at least **30 days** before they take
effect, and every version of this policy stays available at «PRIVACY_HISTORY_URL» so you can
see what changed. The version number and date at the top of this page show which version
applies.

During the Alpha, the Alpha conditions (§11 there) set how you hear about what follows it,
including a move to another hosting provider: at least 7 days ahead, by email. None of your
data goes there unless you accept the new conditions.
