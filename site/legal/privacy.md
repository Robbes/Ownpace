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
  includes #1302 and #1303's row security; and, since main was merged into
  this branch in c1413b53, #1320's closed organisation and #1323's
  per-tenant tasks under row security), with the owner's decisions of
  2026-09-24 to 2026-09-28, and with the Alpha conditions (alpha.md, v1.0, the
  owner's), which prevail during the Alpha where they differ. A review of the
  first draft the same day checked it against that code and corrected it; the
  list below is the result. Later rounds of answers changed some of it (below).
  What changed from v1.1:

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
    us to tell, NetBird GmbH (§7) and the mail provider; Google is offered as
    a source only.
  - §7, §8: Proton AG, Switzerland, as mail relay and support mailbox (0133,
    2026-09-28); during the Alpha the service runs on a machine we keep and
    run ourselves (0139 D5, T0 fact 6); a row for NetBird GmbH, the service in
    front of it that ends TLS; a later host is named before any data goes
    there (0131 T4 (b)); who inside an organisation sees what; §8's negative
    carves out a target outside the EU the tester chose.
  - §9: rewritten to the owner's decisions and alpha §6 and §10: credentials
    (0139 open question 3 (a)); requests for access (open question 2 (a),
    built); closing and the erasure windows (alpha §10); the sign-in account
    and the Google test-user entries removed by hand on erasure day; the
    sign-in service's own history, which removing the account does not
    remove; the copy before an update; no backups otherwise (0139 D3); the log
    periods of 0129 D2 as built; what of the read log stays after erasure.
    The heading and the row "Credentials" keep their words, because alpha §2
    cites them.
  - §10: the right to object on its own; a check that a request is yours; a
    complaint where you live or work.
  - §11: TLS as the code does it: the one switch a customer has is the
    wizard's "Use SSL/TLS" (useSsl), which turns TLS off altogether, not
    certificate checking (tlsVerify is in no API schema); ADR-0037 §5's floors
    are not built. Row security as SECURITY.md and docs/rls-guide.md state it
    since #1323 (d0138607), merged into this branch in c1413b53: every route
    of the app and the per-tenant background tasks, the support views
    passing it by design with an operator check, the scheduled jobs that span
    organisations not yet (0138 T2 and T3 step 2, not merged). A breach
    paragraph that tells the person, as the owner answered; the
    vulnerability channel as SECURITY.md (0139 open question 5).
  - §13: during the Alpha, alpha §11 sets the notice before what follows.
  - Words: "tenant" and "workspace" became "organisation"; the Dutch
    "beheerders" for our operators no longer collides with the admin role.

  The owner's first answers of 2026-09-28 (0139 Status quotes each in full),
  applied the same day:

  - §7: the machine is in the Netherlands ("app/site hosting is in The
    Netherlands"). The NetBird row, and §6's transfer bullet, name NetBird
    GmbH, in Germany ("through NetBird (Germany) delivers the forward proxy";
    read as the reverse proxy in front of the machine that ends TLS, which is
    what managed.yml says of it). Germany is in the EU, so §8 needs nothing
    for it. That is where NetBird GmbH is. Where its proxy and its log run,
    no NetBird source states (NetBird's own sources, below).
  - §4.5, §4.6, §7 and §9: Proton keeps the service's sent mail in the
    support mailbox (the owner's "yes"). The service mails nobody a customer
    invites (apps/api/src/routes/tenants/members.ts sends nothing; the app's
    tenants.invite.hint: "No email yet; tell them yourself"), so §4.6's
    invitees bullet needs no such sentence.
  - §9: a sign-in account nobody let in goes 30 days after it was created,
    unless a request for access with that address is still open (the owner:
    "30 days is ok"; 0135 T8's rule, which now also spares an address with an
    open invitation). The row says such an account opens nothing.
  - §9: server logs are kept until the part of the service that wrote them
    is replaced, which is what Docker's default log driver does. There is no
    fixed period, and the row says so.

  The owner's answers to the 71 questions, 2026-09-28 (the answer page; each
  answer is named by its question id and the option chosen). Applied the
  same day. The Version line keeps its draft marker: the owner reviews these
  texts in the pull request, and the lawyer's pass stays deferred. What
  changed in this policy:

  - §1: the address is left out during the Alpha, and we correspond by email
    (rec-address (c); a comment beside §1 says when it returns). "Trading as
    Ownpace" (fact-trademark (b)). The VAT number, NL8597.110.06.B01, as the
    owner wrote it (fact-vat (a)).
  - §4.1: the file connectors cannot write to the source either
    (privacy-file-connectors (a)).
  - §4.2, §4.6, §9: the list of what was shared belongs to its migration and
    goes when that migration is deleted (privacy-sharing-list (b); the code
    change is not built, see beside §9).
  - §4.6, §9: the people you migrate for (ADR-0050; managed migration 0031,
    merged in #1332): a name, and an address when one is given, kept until
    that person is deleted or the data erased (PURGED_TABLES in
    offboarding.ts). Deleting a migration leaves the person. The owner
    approved the English sentence on 2026-09-28. The Dutch says *migratie*,
    the owner's word (0152 D6), and since 2026-09-29 the Dutch texts say it
    throughout (the privacy policy, the terms and the Alpha conditions).
  - §4.4: the account also records which versions of the three texts a
    person accepted, and when (terms-acceptance-route (b): the in-app screen,
    0139 T3, built 2026-09-28; see beside §4.4).
  - §4.5: our server logs record the visitor's IP address, which NetBird
    passes on, and NetBird keeps its own log (ops-trust-proxy (b); needs
    TRUST_PROXY and both nginx logs, see beside §4.5). Searches by address and
    downloads of the log are deleted after 12 months
    (privacy-search-records (a)).
  - §4.6: the copy of the share mail stays as long as §9 says for support mail
    (privacy-sent-mail-copies (b)).
  - §6, §9: a family member's Google address comes off Google's test list
    with the tester's, at erasure, or sooner if the tester or the family
    member asks (alpha-s9-family-google (a)).
  - §7: NetBird's agreement is accepted (dpa-netbird-agreement (a)); the row
    adds the WireGuard tunnel to our machine and NetBird's own request log:
    what it holds, and that NetBird's cloud keeps it 7 days (ops-trust-proxy,
    every option; from NetBird's documentation, to confirm). The table is
    the complete list of sub-processors (rec-subprocessors-url (a)), so the
    SUBPROCESSORS_URL token left this text. No hosting row: the owner keeps and runs the machine for
    Archico B.V. (subprocessors-machine-housed (a)).
  - §8: the citation for Switzerland (privacy-switzerland-wording (b)); two
    routes to the US that the reader chooses, not called transfers
    (privacy-other-transfers (b)). A comment says the negative holds once
    usage reports are off (ops-telemetry (a)).
  - §9: the copy before an update is one copy per update, deleted once the
    update is shown to work, never past 7 days, and it includes the task
    runner's database before its upgrade (rec-copies (a)); the daily drill
    copies are gone from live's text (rec-drill (a)); the background tasks'
    records last until the end of the Alpha at the latest
    (privacy-task-records (a)); the sign-in history is kept as long as we run
    that sign-in service (privacy-signin-history (a), NOT YET CHECKED); support
    mail and the service's own mail follow "until resolved, then 6 months"
    (privacy-sent-mail-copies (b)).
  - §10: what we hold ourselves, sent in a common file format on request
    (privacy-portability-note (a)).
  - §12: a grant link for a child under 16 is completed by the parent with the
    child, and the child's Google address goes on the list at the parent's
    request (privacy-children-grant-link (a)).
  - §13: earlier versions stay in the policy's history on GitHub, one link per
    language (rec-privacy-history-url (a)), so the PRIVACY_HISTORY_URL token left this
    text.

  Answered with no change to this text: privacy-db-access-sentence (a), §4.5's
  sentence on direct database access confirmed (DPA §5 is corrected in the DPA
  pass); privacy-read-log-copy (a), the promise stays and is answered by hand;
  privacy-tls-wording (a), §11 as drafted, a line follows once ADR-0037's
  floors are built; ops-billing-form (b), the Billing form, the card code and
  §4.4's and §7's sentences stay as drafted; ops-social-signin (a), email and
  password only, so the text stays as it is (live's .env holds no IDP_* keys,
  below); ops-notify-addresses (a), all three settings point at
  support@ownpace.eu; ops-log-driver (a), Docker's default;
  privacy-tester-list (a), the Proton mailbox is the list of testers;
  dpa-netbird (a), no change now;
  rec-alpha-10 (a), Alpha §10 now follows the code, as §9 here already did;
  alpha-version-number (a), the Alpha conditions stay 1.0.

  NetBird's own sources, read 2026-09-28, after the owner pointed to them
  (dpa-netbird-agreement (a)): its terms, https://netbird.io/terms; its
  privacy policy, https://netbird.io/privacy; its imprint,
  https://netbird.io/imprint; the data behind its trust center,
  https://trust.netbird.io, read from the API that page loads,
  https://api.eu.scytale.ai/views/trust-center/public/page-data, because
  the egress proxy here still refuses trust.netbird.io itself; and its
  documentation, https://docs.netbird.io, read from its source,
  github.com/netbirdio/docs at 33d1b212 (2026-09-28). The comment beside
  §7 quotes each. What changed in this policy:

  - §7: the row's log gains the time and the size each way, which the
    documentation lists ("Timestamp", "Bytes Uploaded", "Bytes
    Downloaded", manage/reverse-proxy/access-logs). The "Where" column
    keeps Germany (EU), where NetBird GmbH is (Berlin, in its imprint and
    privacy policy); no source read says in which country its proxy or its
    log runs.
  - Question 15 (iii) quotes NetBird's terms instead of search results.
  - The to-do on NetBird, below, asks what none of the sources states.

  The owner's answers to the five NetBird questions, 2026-09-28 (0139
  Status quotes each): NetBird's terms and data-processing agreement were
  accepted on 2026-08-01; the agreement covers the proxy and its log; §7's
  "Where" stays Germany (EU), the owner's choice, while the owner asks
  NetBird; no PIN, and NetBird's sign-in (SSO) on for the hosts NetBird
  serves ("No pin, but SSO on"), and off on every ownpace.eu host before
  the first invitation, the owner's choice ("Off everywhere at launch");
  and NetBird is asked in writing about commercial use. No rendered
  sentence changes: the comment beside §7 and the to-do on NetBird, below,
  record them.

  Questions for the lawyer. The numbers are kept from the first draft, because
  other texts cite them. Where the owner answered on 2026-09-28, the answer is
  named; what follows it is what the lawyer still checks.

  1. The household controller role and basis (§3).
     privacy-household-controller (a): left for the lawyer. During the Alpha
     it is the only case.
  2. Correspondents and Art. 14(5)(b), and the people items were shared with.
     privacy-share-mail-notice (a): the share mail gets a privacy line and a
     link to this policy (packages/shared/src/share-announcement.ts, a code
     change before the first tester uses the feature). Please confirm our
     reading of Art. 14(3)(b): the information is due at the first
     communication at the latest. Correspondents in a mailbox stay open.
  3. Mollie as independent controller; 5. the preflight's basis for someone
     with no contract yet; 7. invoices kept 7 years.
     privacy-after-alpha-questions (a): for the lawyer's pass before the first
     paid tier, or before a preflight is offered to someone who is not a
     tester. None arises during the Alpha.
  4. The DPA "on request": settled for the Alpha (households only), and the
     DPA stays unpublished until the first business customer
     (dpa-unpublished-until-business (a)).
  6. Children under 16. privacy-children-grant-link (a): §12 gains the
     parent-with-child line. Terms §3 now asks 18 or older
     (terms-s3-minimum-age (b)); privacy §12 otherwise stays, as that answer
     said. Please confirm §12's "under 16" beside the terms' 18.
  8. The portability note. privacy-portability-note (a): the sentence is
     added. Please confirm it is enough for Art. 20.
  9. Server logs, kept until the part that wrote them is replaced (the owner:
     Docker's default, ops-log-driver (a)). The app's and the website's
     output goes at each update; the sign-in service's lasts until its version
     or settings change, which can be months. As we read Art. 13(2)(a),
     stating the criteria is allowed; is this one enough, and does it meet
     Art. 5(1)(e) for the sign-in service's output?
  10. Entity facts. The address is left out during the Alpha (rec-address
      (c)); the owner accepts the BW 3:15d risk for an invite-only Alpha, and
      the address returns before the first paid tier. For this policy alone,
      Art. 13(1)(a) asks for the controller's identity and contact details;
      is an email address enough during the Alpha? The VAT number and the
      trade name are filled.
  11. Switzerland. privacy-switzerland-wording (b): §8 cites Art. 45 GDPR and
      Decision 2000/518/EC. Please confirm the citation. Proton's agreement
      is accepted for Archico B.V.'s account; where it says Proton processes,
      which the "Where" column should say, is still to check.
  12. Google's test list. privacy-google-testlist-basis (a): left for the
      lawyer. Is entering a Google address in our app's test-user list at
      Google a transfer by us, and is Google a processor or a controller for
      that list? If a transfer, on what basis, which §8 would then name
      (Art. 13(1)(f), as we read it)? When a family member's address comes
      off is answered (alpha-s9-family-google (a); §6).
  13. The basis for other people's data (drafted as legitimate interests), a
      family member's in particular, invitees', and the audit log; and which
      exception covers special-category data passing through, now that
      subject lines are kept. privacy-bases-special-category (a): left for
      the lawyer; subject lines stay stored.
  14. §8. privacy-other-transfers (b): §8 names the GitHub report form and our
      mail to a US mailbox as routes the reader chooses, without calling them
      transfers. Please confirm that wording. Open: in the household case we
      are controller; is writing to a target outside the EEA then a transfer
      by us? The text carves it out of the negative rather than asserting it.
  15. Limited Use (§6). privacy-limited-use (a), with the owner's note: "do
      describe each flow so that we can use it in the verification
      application. The lawyer will only review." The four flows, for the
      verification application (docs/google-oauth-verification.md), as we
      read them; the lawyer reviews:
      (i) The mail to people a tester shared items with. Google data in it:
          the names of shared Drive files, folders and calendars, and the
          recipients' addresses from the sharing list. Sent only when the
          tester asks, from support@ownpace.eu through Proton; a copy stays in
          the Sent folder under §9's support-mail rule. It serves a feature the
          tester starts in the app.
      (ii) Mail carried by Proton. Beyond (i): progress mails to the tester
          (packages/shared/src/notifications.ts: a migration's name, often the
          account's address; counts; and, verbatim, a provider's reason or last
          error, which can name a folder or a Gmail label), problem reports (the
          page, an error's reference and kind, and a screenshot the tester adds,
          which can show subjects, names or labels), and link reports. Proton
          is a sub-processor under a data-processing agreement, carrying that
          mail and keeping it in the support mailbox (§9's support-mail rule).
      (iii) NetBird GmbH. It ends TLS in front of our machine, so the app's
          pages, which show item names, subjects and labels from Google, pass
          through it readable. It keeps a log of each request: IP address and
          path. It is a sub-processor under a data-processing agreement,
          carrying the connection only. Its terms §13: "For personal data
          processing by NetBird on behalf of the Customer the NetBird data
          processing agreement applies"; the owner confirms that it covers
          the proxy, the traffic it decrypts and its log, though it was not
          read here (the to-do on NetBird, (b), below). Its terms §3.1:
          "NetBird does not monitor or control the content of traffic
          transmitted via Reverse Proxy and disclaims responsibility for
          such content, except as required by law."
          (https://netbird.io/terms, read 2026-09-28).
      (iv) A person reading. When a tester reports a problem, the operator can
          read a log line or a ledger row that names a Gmail label, a subject
          or a file name, to answer that report. We read this as the user's
          affirmative request about specific items, which §4.5 and §6 name as
          an exception; please confirm, or say which exception fits.
  16. The notice after the Alpha. alpha-s11-notice (a): Alpha §2 now says that
      for the new conditions after the Alpha, the 7 days in Alpha §11 replace
      the terms' 30 days. §13 here already points to Alpha §11. Please confirm
      that 7 days with explicit acceptance may stand beside §13's 30 days.
  17. Language: the site prints a note above the Dutch privacy and terms
      pages that the English governs (translationNote in site/copy.mjs), and
      terms 1.3 §13 keeps that rule, with an exception for mandatory consumer
      law that the note leaves out (terms question 15 has the words that
      would add it). Can it stand for a Dutch-first Alpha
      (alpha briefing q. 2, terms question 15)? Not on the answer page; open.
  18. The breach paragraph: settled. The Alpha conditions stay 1.0 and their
      §4 drops "where that is required" (alpha-version-number (a)), so both
      texts say "we tell you".
  19. The sign-in service's history. privacy-signin-history (a): check, then
      state the rule; the owner: "still needs to be checked". Zitadel stores
      every change as an event, and a removal appends one; its maintainers
      write "Delete in ZITADEL means a new events org.deleted, all events
      still exist in the eventstore" (zitadel/zitadel#2758), and
      de-identifying the events of deleted users is an open feature request
      (zitadel/zitadel#7811). §9 now states the rule for that expected result:
      kept as long as we run this sign-in service. Is that a period that meets
      Art. 5(1)(e) and Art. 17?
  20. Periods. Searches by address and downloads of the log: 12 months
      (privacy-search-records (a)). The background tasks' records: until the
      end of the Alpha at the latest (privacy-task-records (a)). Both settled.
      New: support mail and the copies of the service's own mail follow
      "until resolved, then 6 months" (privacy-sent-mail-copies (b), the
      owner's own rule, as it stands). A sign-in code or a progress summary
      answers no question, so the rule gives it no clear end. Is it precise
      enough for Art. 5(1)(e) and 13(2)(a)?

  Still to do before the draft marker comes off (facts, checks and code; the
  comments beside §1, §4.4, §4.5, §7, §8 and §9 say the same where they apply):

  - NetBird (0139 T0). What its terms, privacy policy, trust center and
    documentation say, with each address, is in the comment beside §7. The
    owner answered five questions on what none of them states on
    2026-09-28 (0139 Status quotes each answer). (a) and (b) are recorded.
    (d) is the owner's decision, and a step before the first invitation
    (Live, below). (c) and (e) are the owner's questions to NetBird
    (legal@netbird.io, its privacy policy's contact), and what (b) leaves
    is the lawyer's; none of these blocks the first invitation:
    (a) Its terms and data-processing agreement were accepted on
        2026-08-01.
    (b) Its data-processing agreement, the PDF "Data Processing Agreement
        (DPA)" on https://trust.netbird.io (not restricted; it could not be
        downloaded here), covers the Reverse Proxy, that is the traffic it
        decrypts and its access log (the owner: "It's covered"), recorded
        as the owner's confirmation. For the lawyer's pass, not a blocker
        for the Alpha: which sub-processors it names, and where; how a new
        one is announced, and whether we can object; and whether it states
        the documentation's 7 days.
    (c) Where the proxy cluster that app., id. and status.ownpace.eu point
        to (eu1.netbird.services) and its access log run: §7's "Where"
        stays Germany (EU), the owner's choice ("Take Germany, I'll ask
        later on"). The documentation names only the region "eu", and
        terms §3.1 promise no "specific geographic routing". The owner
        asks NetBird in which country, and at which provider, both run;
        whether NetBird commits to keeping both in the EU; and whether any
        of NetBird's own sub-processors receives the proxy's traffic or its
        log, and where. The trust center lists 18 entries, none with a
        location, among them five cloud providers (AWS, Azure, GCP,
        OVHcloud, UpCloud) and three monitoring services (Datadog, Grafana
        Cloud, New Relic); and Cloudflare, Inc. (USA), in NetBird's privacy
        policy but not its trust center, may be in front of the proxy. If
        NetBird's answer puts the proxy, its log or such a sub-processor
        outside the EU, §7's "Where" and §8 name it.
    (d) NetBird's sign-in. The owner: "No pin, but SSO on", that is no
        PIN, and NetBird's sign-in (SSO) on for the hosts NetBird serves.
        With SSO on, NetBird's sign-in sits in the visitor's path and its
        log also keeps the signed-in user's ID; §7's row names neither.
        Asked which hosts sit behind it and whether that changes before
        the first tester is invited, the owner chose "Off everywhere at
        launch": SSO off on every ownpace.eu host, app., id., status. and
        www.ownpace.eu, before the first invitation. No other NetBird
        sign-in (password or PIN) takes its place, so no NetBird sign-in
        sits in the visitor's path, NetBird's log keeps no user ID for
        testers, and §7's row holds as it stands. A precondition for the
        first invitation (Live, below). If SSO were ever kept on for a
        host testers use, §7's row in both languages, subprocessors.md's
        row and dpa.md's Annex B line would have to name NetBird's sign-in
        and the user ID in its log.
    (e) NetBird's terms §3.1 forbid to "Resell, sublicense, or commercially
        exploit Hosted Proxy Services unless explicitly authorized in
        writing by NetBird". The owner asks NetBird in writing (the owner:
        "I need to ask commercial usage."); whether the free Alpha itself
        counts is part of the question. The answer is needed before the
        first paid tier at the latest (site/legal/README.md).
  - Live: TRUST_PROXY set, and both nginx logs recording the address NetBird
    passes on (ops-trust-proxy (b), 0132 T3 (d)); no ZAMMAD_URL, so reports
    go by mail; no IDP_* keys (ops-social-signin (a)); NOTIFY_TO, ALERT_TO and
    REPORT_MAIL_TO at support@ownpace.eu (ops-notify-addresses (a)); usage
    reports off in the task runner, and Zitadel, ClickHouse and MinIO checked
    (ops-telemetry (a)); the log driver checked (ops-log-driver (a));
    NetBird's sign-in off on app., id., status. and www.ownpace.eu before the
    first invitation, the owner's choice, checked from outside the NetBird
    network: a request to each host is answered by the app or the site
    itself, not by NetBird's sign-in page (NetBird (d), above).
  - Build: the close stopping the work already running, so that §9's
    Credentials row holds, or the row reworded to what the code does (terms
    briefing, precondition B); the copy before an update and its deletion
    (rec-copies (a)); the drill off live's duties, with trigger-version.sh
    backup in the copy before a Trigger.dev upgrade (rec-drill (a)); the
    end-of-Alpha step for the task records (privacy-task-records (a)); the
    sharing list deleted with its migration (privacy-sharing-list (b)); the
    12-month clean-up of searches and downloads (privacy-search-records (a));
    0135 T8's daily script for sign-in accounts nobody let in, before the
    first tester (ops-unadmitted-signin-cleanup (a)); the share mail's privacy line
    (privacy-share-mail-notice (a)); the app's three sentences
    (ops-app-sentences (a)); the read-log query in the operator runbook
    (privacy-read-log-copy (a)).
  - Check: the sign-in history on Zitadel v4.19.2, and what a sign-in session
    keeps (browser and IP address, §4.4) (privacy-signin-history (a)).
  - By hand until something does it: pruning the support mailbox and its Sent
    folder at Proton under §9's rule.
  - Proton: where its agreement says it processes (question 11).
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

Archico B.V., trading as Ownpace, KvK 73922706, VAT NL8597.110.06.B01.

<!-- The owner, 2026-09-28: the address is left out during the Alpha, and we correspond by email
     (rec-address (c)). BW 3:15d asks a provider of an online service to show its geographic
     address; the owner accepts that risk for an invite-only Alpha, and the KvK register shows
     the address anyway. The address returns here, and in terms §1 and §15, before the first
     paid tier, after the lawyer's pass. The trade name is added now (fact-trademark (b)); that
     option says the KvK extract already lists Ownpace, which was not checked here. The VAT
     number is written as the owner gave it (fact-vat (a)). -->

**Contact for anything in this policy, including your rights under the GDPR:
support@ownpace.eu.** We correspond by email. A person reads what arrives there. We aim to
answer within five working days and are bound by the GDPR's one-month limit for rights
requests.

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
say so rather than implying otherwise. The connectors that read your mail, contacts, calendars
and files **cannot write to the source** at all.

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
made about items, the results of its checks, and the list of what was shared (§4.6). With your
organisation we keep the distribution lists a migration found, with their members' addresses.

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

<!-- BUILT 2026-09-28 (0139 T3; the owner, terms-acceptance-route (b): "accepting fits in there
     and should record what time/version the accepted of what document"): after sign-in the app
     shows the Alpha conditions, this policy and the terms with their versions, and records, per
     organisation, which version of each a person accepted, the language and the time
     (legal_acceptance, managed migration 0032). Asked while live's OWNPACE_STAGE=alpha and no text
     is still a draft (LEGAL_DRAFTS: a draft's number is the one its final text carries, so nobody
     accepts a draft); nothing is connected before it. Kept with the account and erased with it
     (0139 open question 4, answered 2026-09-29, the owner: "Ok"); a member who leaves keeps their
     rows until the organisation's data is erased (§9's row). "In which language" below was added
     on 2026-09-29 (review of 0139 T3), because the record keeps it; for the owner's review with
     the rest of this draft. -->

**Your account with us.** Your email address, the identifier our sign-in service gives you, the
organisation you belong to (in the app, your household's space is called an organisation), your
role in it (during the Alpha, owner or admin), when you were invited and when you joined, and
which versions of the Alpha conditions, the terms and this policy you accepted, in which language,
and when.

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

<!-- The report by mail, 0130 T5, is merged (#1318; apps/api/src/services/report-channel.ts).
     True on live once live runs without ZAMMAD_URL (README, "Before the draft markers come
     off"). -->

**Reporting a problem.** During the Alpha, *Report a problem* in the app's menu sends your report
as an email to support@ownpace.eu, through our mail provider (§7). The mail holds what you wrote
and your sign-in address, so that we can answer you, and these facts, which the form lists before
you send: the page you were on (without the secret part of a link), the reference and kind of an
error if there was one, your organisation's identifier and status, your role, the version of the
service, the state of the migration on that page and of each data type in it, whether access was
given through a link, which providers its two accounts are with and whether their last test passed,
whether the service is on hold or its scheduler has stopped, the name your browser gives itself,
and what your browser tells the form: the language of the screen, your time zone, the width of the
window, the version of the app in your browser when it is not the service's, the data type, side
and migration of the error line you came from, and the reference of an error the app met in the
five minutes before you opened the form. If you add a screenshot, it goes too. A screenshot shows
whatever was on your screen, such as subjects, names and addresses, so look at it before you send
it. *Report this link*, on a page reached through a grant link or a progress link, sends what the
person wrote and the facts of that link the same way: the organisation and the migration, who made
the link, the two accounts, and whether access was given; and an address only if they give one.
**A report contains the content of your mail, files or calendars, a subject, a folder name or a
provider's error text only if you put it in what you write or in the screenshot.**

<!-- NOT YET TRUE ON live (the owner, 2026-09-28, ops-trust-proxy (b): keep visitors' addresses
     in all our logs). NetBird ends TLS in front of the machine, so the app and the website see
     NetBird as the caller, and NetBird passes the visitor's address on in X-Forwarded-For.
     Built on branch claude/ownpace-public-readiness-y7orc6-the-visitors-address-from-netbird
     (0132 T3 (d), 2026-09-28 and 2026-09-29): the app's nginx (apps/web/nginx.conf.template,
     format ownpace_combined) and the website's (deploy/compose/www-nginx.conf, format
     ownpace_site, where the image's default applied before) record that header as a field of
     their own, last, after NetBird's address; recorded, not believed. Live sets TRUST_PROXY=2
     (the proxies in front of the API: NetBird and the web container's nginx; 3 if NetBird's
     cluster adds one), which stand-up-live.sh requires, so the API reads the address NetBird
     passes on. True on live once live stands with it, and checked with a log line of each there
     (0132 T3 (d)). -->

**Server logs** record that requests happened, for the app and for this website: the time, your
IP address, which NetBird passes on to us (§7), the page asked for (without the secret part of a
link), the page you came from, what your browser says it is, and error codes. NetBird also keeps
its own log of each request; §7 says what it holds. Logs are written so that
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
erased. A search by address and a download of the log are recorded without an organisation;
they stay after that, and are deleted 12 months after they were recorded (§9). Ask us, and we
send you what that log records about your account. Our data-processing agreement (§5 there)
makes the same commitment to organisations.

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

- **The people you migrate for.** To group a person's migrations you give them a name, and if you
  like an email address for their grant links. We keep both until you delete that person or your
  data is erased.
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
  each such email stays in our support mailbox for as long as §9 says (§4.5). The list goes when
  you delete the migration it belongs to, or when your data is erased.
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
to. We take your address off the list when your data is erased. A family member's address comes
off at the same time, or sooner if you or they ask (Alpha conditions §10). In the
test phase, Google also ends a connection after about seven days; you then connect again
(Alpha conditions §9).

You can revoke Ownpace's access to your Google account at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions), or by deleting
the app password you issued.

## 7. Who else touches it

During the Alpha, the service, its databases, our sign-in service and this website run on a
machine we administer ourselves, in the Netherlands.

<!-- The machine (subprocessors-machine-housed (a), the owner, 2026-09-28): no company houses it
     or can reach it; the owner keeps and runs it for Archico B.V., in the Netherlands. So there
     is no hosting row.
     NetBird (dpa-netbird-agreement (a), the owner, 2026-09-28): its terms and data-processing
     agreement were accepted on 2026-08-01. The owner's note: "NetBird GmbH ("NetBird")
     terminates the TLS, and uses WireGuard tunnel with the backend towards the hosting
     provider." Read as: to our machine, which no hosting company holds (above). The owner
     pointed to https://trust.netbird.io and to https://netbird.io/terms §3.1. Read 2026-09-28:
     the terms, https://netbird.io/privacy and https://netbird.io/imprint; the trust center's
     data, from the API its page loads,
     https://api.eu.scytale.ai/views/trust-center/public/page-data (the egress proxy here still
     refuses trust.netbird.io itself); and NetBird's documentation, https://docs.netbird.io, from
     its source, github.com/netbirdio/docs at 33d1b212. What they say:
     - Who: NetBird GmbH, Rosenthaler Str. 36, 10178 Berlin, "Registered with the local court
       of Amtsgericht Berlin (Charlottenburg) under HRB 237529 B" (imprint; privacy policy). The
       terms give no address.
     - TLS: terms §3.1, "Reverse Proxy may include traffic relaying, NAT traversal, TLS
       termination, traffic forwarding, or similar functionality." For HTTP services, "The proxy
       terminates TLS at the edge", and traffic is "forwarded through an encrypted NetBird tunnel
       to the target peer" (docs, manage/reverse-proxy). "NetBird Cloud issues certificates
       through ZeroSSL on all shared proxy clusters, and ZeroSSL certificates are signed by
       Sectigo" (docs, manage/reverse-proxy/custom-domains).
     - Content: terms §3.1, "NetBird does not monitor or control the content of traffic
       transmitted via Reverse Proxy and disclaims responsibility for such content, except as
       required by law."
     - The agreement: terms §13, "For personal data processing by NetBird on behalf of the
       Customer the NetBird data processing agreement applies." The terms do not link it. The
       trust center lists a PDF, "Data Processing Agreement (DPA)", not restricted, uploaded
       2026-06-23. It could not be downloaded here, so it was not read. The owner confirms that
       it covers the Reverse Proxy, the traffic it decrypts and its access log ("It's covered",
       2026-09-28). What it says of sub-processors, of announcing a new one and the right to
       object, and whether it states the 7 days, is for the lawyer's pass.
     - The log (the row's last sentence; ops-trust-proxy: the row gains it in every option):
       "NetBird logs every request and connection that passes through your reverse proxy
       services", with the time, the method, the host and path, the status, the duration, the
       bytes each way, "The client's IP address", "Country, city, and subdivision based on
       source IP geolocation", and, only where NetBird's own sign-in (SSO) is used, "The
       authenticated user's ID". "For the cloud version of NetBird, access logs are retained for
       7 days." (docs, manage/reverse-proxy/access-logs). The path holds a grant link's secret
       (/grant/:link). The owner: "No pin, but SSO on" (2026-09-28), so while SSO is on the
       log also holds the signed-in user's ID, which the row does not name. The owner then chose
       "Off everywhere at launch": SSO off on every ownpace.eu host (app., id., status. and www.)
       before the first invitation, so the log keeps no user ID for testers and the row names none.
     - Where: NOT STATED for the proxy or its log, in any source read. The docs: "`eu` is the
       proxy cluster region", and "NetBird operates multiple proxy clusters in different regions"
       (manage/reverse-proxy/custom-domains); NetBird's own clusters run "Wherever the platform
       runs proxies" (manage/reverse-proxy/bring-your-own-proxy). Terms §3.1: NetBird may
       "Modify, suspend, or discontinue certain proxy endpoints or regions", and "does not
       guarantee uninterrupted availability, latency performance, or specific geographic
       routing." Its privacy policy says "We process your personal data in the EU/EEA", but it
       applies to "this website (netbird.io), netbird.ai, and all subdomains of the domain
       netbird.io" and does not mention the proxy. The owner keeps Germany (EU) ("Take Germany,
       I'll ask later on", 2026-09-28) and asks NetBird.
     - Its sub-processors: the privacy policy, "A current list of our subprocessors is
       maintained on our Trust Center". The trust center lists 18 entries: Apollo, Auth0, AWS,
       Azure, Datadog, GCP, GitHub, Grafana Cloud, HubSpot, Matomo, Microsoft Clarity (twice),
       New Relic, OpenAI, OVHcloud, Plain, Stripe and UpCloud. Each has an empty location, and
       none is said to run or receive anything of the proxy. The privacy policy also names
       Cloudflare, Inc. (USA), for "Bot management, CDN, Website security", which the trust
       center does not list.
     The "Where" column keeps Germany (EU), where NetBird GmbH is: the owner's choice, pending
     the owner's question to NetBird (the privacy briefing's to-do on NetBird, (c)). If NetBird's
     answer puts the proxy, its log, or a sub-processor of NetBird's that receives either, outside
     the EU, "Where" and §8 name it. Before the first invitation, NetBird's sign-in is off on
     every ownpace.eu host, the owner's choice ((d) there). -->

| Sub-processor | What for | Where |
|---|---|---|
| NetBird GmbH | Carrying your connections to app.ownpace.eu, id.ownpace.eu, status.ownpace.eu and www.ownpace.eu through to our machine. It ends the encryption (TLS) of those connections, so what passes through them, such as what you type when you sign in and what the app shows you, passes through it readable. It carries them on to our machine through an encrypted tunnel (WireGuard). It keeps its own log of each request for 7 days: the time, the IP address and a location derived from it, the page asked for, including the secret part of a link, how much was sent each way, and the answer's status and how long it took | Germany (EU) |
| Proton AG | Sending the service's mail, such as sign-in codes, our answer to your request for access, progress summaries, and the notices you ask us to send. Holding our support mailbox, support@ownpace.eu, where your mail to us and, during the Alpha, problem reports arrive, and where a copy of each mail the service sends is kept (§4.5) | Switzerland, outside the EU (§8) |

This table is the complete list of our sub-processors. If the service moves to a hosting
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

<!-- NOT YET TRUE ON live (the owner, 2026-09-28, ops-telemetry (a): switch it off everywhere).
     The negative below holds once the task runner's usage reports are off
     (TRIGGER_TELEMETRY_DISABLED on live and the test stack) and Zitadel, ClickHouse and MinIO
     are checked and switched off too. -->

The service runs in the **European Union**. One party in the table above is outside it: our
mail provider, Proton AG, is in **Switzerland**. The European Commission has decided that
Switzerland protects personal data adequately (Art. 45 GDPR; Commission Decision 2000/518/EC),
so the GDPR asks for no further safeguard for that transfer. During the Alpha there is one more
step, which you ask for yourself: to let you connect a Google account, we enter its address in
the list of test users that Google keeps for our app (§6). **Apart from these, and a target you
choose outside the EU (below), there is no transfer of your data to the United States or any
other third country by us.**

Two things you choose yourself can reach the United States. If you report a vulnerability
through our form on GitHub (§11), GitHub keeps your report, in the US. And if your mailbox, or
that of someone you ask us to write to, is at a US provider, our mail to it is delivered there.

That is not a formality but the core of the product: moving off a US-hosted provider makes
little sense through a migration tool that is itself hosted in the US, so ours is not.

If your migration's **target** is outside the EU, your data goes there because you chose that
target. We show you the target before anything is written.

## 9. How long we keep it

<!-- NOT YET TRUE, so the draft marker stays until each holds (README, "Before the draft
     markers come off"). The owner's choices of 2026-09-28 are named by their question id.
     - Credentials, "nothing uses any of it from then on" (terms.md briefing, precondition B):
       since #1320 (d7868276, 0085 T2), merged into this branch in c1413b53, nothing new starts
       for a closed organisation. The sync tick starts no pass for it
       (AN_OPEN_ORGANISATION_WHERE in managed-sync-tick.ts), a pass already queued halts before
       its credentials are built (organisation_closed, stopping-a-pass.ts), the credential
       builders refuse (refuseAClosedOrganisation), and every door that would start work or use
       the access answers 409 account_closed (apps/api/src/closed-organisation.ts). Work already
       running is not all stopped: the close cancels only the runs whose row names the
       orchestrator's run (a sync pass), best effort (apps/api/src/close-account.ts); a sync
       pass the cancel did not stop stops starting new items within about fifteen seconds and
       finishes the ones it has begun (whyThisDataTypeStops, 2026-09-29); a discovery reads to
       the end of the data type it is on; a verification or a confirmation already running reads
       to its end with the stored access.
       True once the close stops those too, or once the row says what the code does.
     - The copy made right before an update (rec-copies (a)): one copy per update, deleted once
       the update is proven (deploy-live.sh logged it as "took", one pass completed, the hold is
       lifted), and never past day 7; not proven by day 6 means rolling back from the copy.
       Built (0139 T6, 2026-09-28, review fixes 2026-09-29): deploy/compose/
       copy-before-update.sh and one directory, ~/.persistent/ownpace-live/copy-before-update,
       taken by deploy-live.sh right before its checkout, a delete step that refuses an
       unproven update, a daily backstop in box-duties.sh that deletes it once older than 6
       days less an hour, and dump-idp.sh and trigger-version.sh writing only there on live.
       The rollback first writes down what was erased, closed or deleted after the copy
       (copy-before-update.sh since) and does it again in the restored database, so "Data
       erased from the service can remain in it for at most 7 days" holds through a rollback
       too. True on live once live runs a tag that carries it and the daily duties' timer runs
       (take refuses without it); the rollback has not been run on a stack.
     - Records of the background tasks: the drill sentence is gone (rec-drill (a)), and
       the drill is off live's duties (0139 T6): box-duties.sh's second duty is the copy's
       backstop, and trigger-version.sh refuses drill on live. True on live once live runs a
       tag that carries it; until then the tag it runs keeps 7 daily dumps.
       "Until the end of the Alpha" (privacy-task-records (a)) is one step in the end-of-Alpha
       routine, not written yet.
     - The list of what was shared, "goes when you delete the migration" (§4.2, §4.6; the
       owner's privacy-sharing-list (b)): deleting a migration does not yet delete its
       share_grant rows. A small code change; until it lands, the list stays until erasure.
     - A search by address and a download of the log, "deleted 12 months after"
       (privacy-search-records (a)): built, not yet run: deploy/compose/support-read-prune.sh
       (0139 T6), the duty `searches` in box-duties.sh, over the owner's connection, since
       app_user cannot change the log, and after 0138 T3 step 2 the tasks' system role can
       delete from it, for the purge of an erased organisation, but its grant lets it pick rows
       by organisation, never by age. True on live once live's daily duties run. It deletes
       every read recorded with no organisation 12 months after it: besides these two, the
       organisation list, the invoices kept after an erasure and a log page not filtered to one
       organisation.
     - The sign-in service's history, "as long as we run this sign-in service"
       (privacy-signin-history (a), the owner: "still needs to be checked"): NOT CHECKED. Remove
       a test account on the test stack (Zitadel v4.19.2) and look at what stays. If the earlier
       entries go, the row says instead: "Removed with your sign-in account." / "Verwijderd met
       uw inlogaccount."
     - A sign-in account nobody let in, "30 days after it was created": nothing removes one yet.
       The owner chose a daily script, built before the first tester
       (ops-unadmitted-signin-cleanup (a)): 0135 T8, deploy/compose/idp-strays.sh, with the
       machine's daily duties. The row waits for it.
     - Support mail, and the copies of the service's own mail (privacy-sent-mail-copies (b):
       "until resolved, then 6 months", as it stands): nothing prunes the mailbox or its Sent
       folder at Proton; it is done by hand. A mail that answers no question has no clear end
       date under this rule (a question for the lawyer, briefing question 20).
     - Server logs: the row holds with Docker's default log driver (ops-log-driver (a), the
       owner: "needs checking"). Check the machine (docker info --format
       '{{.LoggingDriver}}'), and undo a journald setting if it is there: still the owner's.
       The journald step is out of docs/managed-bring-up.md, and stand-up-live.sh refuses a
       machine whose driver is not json-file or local, on branch
       claude/ownpace-public-readiness-y7orc6-the-visitors-address-from-netbird. -->

| What | Kept for |
|---|---|
| Credentials | Until you delete them. The access on a connection goes when you delete that connection; the app lets you once no migration uses it. Access a family member gave through a grant link goes when you delete that migration, or when they withdraw it on their progress page. A finished migration keeps the access you gave us, so that you can resume it. If you close your account, nothing uses any of it from then on, and all of it is destroyed when your data is erased. Each time, we also revoke the access at the provider, where the provider allows that. |
| The migration ledger (§4.2), and what each migration keeps beside it, such as the list of what was shared (§4.6) | Until you delete the migration; then deleted with it. Otherwise until your data is erased. |
| Preflight counts | With the migration they were counted for: until you delete it, or your data is erased. |
| What belongs to your organisation rather than to one migration: its members and invitations, the distribution lists a migration found, and the audit log of who did what, and when | Until your data is erased, also after you delete the migration that found them. |
| Which versions of the Alpha conditions, the terms and this policy each member accepted, in which language, and when (§4.4) | Until your data is erased, also after that member has left your organisation, so that it stays on record who agreed to what. |
| The people you migrate for: each one's name, and an email address if you gave one (§4.6) | Until you delete that person, or your data is erased. Deleting a migration does not delete the person. |
| The record of each pass: when it ran, and what it counted | During the Alpha: until your data is erased. |
| A pass's log lines | 60 days. |
| The app's own errors and warnings (a category and a reference, no text) | 30 days. |
| Your account, your organisation and your sign-in account | While your account exists. When you close it, you choose when your data is erased: at once, or after 7, 30 or 90 days. On that day we also remove your sign-in account from our sign-in service, and take your Google address, and any family member's, off Google's list of test users (§6); these are steps we take by hand. |
| The history our sign-in service keeps of your sign-in account: every change to it, such as your name and email address as they were, and your sign-ins | As long as we run this sign-in service, because it cannot remove them. Removing your sign-in account adds an entry to that history; it does not remove the earlier ones. |
| Your request for access (§4.4) | While it is open. Declined: deleted 30 days after our decision. Granted: kept with your account, and erased with it. |
| A sign-in account that someone created at our sign-in page but that we never let in, and that therefore opens nothing (§4.4) | 30 days after it was created, unless a request for access with that address is still open. |
| Support mail and problem reports, and the copies of the service's own mail in the same mailbox (§4.5) | Until the question or problem is resolved, and then 6 months more. The same holds for the copies of the service's own mail. Then deleted from the mailbox. |
| The record of what we viewed on your account (§4.5) | Until your data is erased. What is recorded without an organisation stays after that: a search by address, and a download of the log of who did what. These are deleted 12 months after they were recorded. |
| The copy made right before an update | Until the update it was made for is shown to work, and never longer than 7 days. It holds the service's database and our sign-in service's database; before the system that runs the background tasks is upgraded, also its database. Such a copy is made only to undo a failed update, and it does not leave the hosting environment. Data erased from the service can remain in it for at most 7 days. |
| Records of the background tasks that run your migrations (identifiers, counts, and a category and a reference for an error; no names, addresses or content, apart from the reason one of us types when a switch-over is undone) | Until the end of the Alpha at the latest: then the background tasks start with an empty history. They are not deleted when your data is erased. |
| Server logs (§4.5) | Until the part of the service that wrote them is replaced: for the app and this website, at each update of the service; for our sign-in service, when its version or its settings change; for a background task, when its run ends. There is no fixed period. |
| Invoices and the usage figures behind them | **7 years**, because Dutch tax law requires it. During the Alpha nothing is charged: there are no invoices, and the usage figures go when your data is erased. |

**During the Alpha we make no backups**, apart from the copy made right before an update, in the
table above (Alpha conditions §6). During the Alpha we close your account within 7 days of your
request, and tell you the date on which your data will be erased (Alpha conditions §10). The
erasure removes from the service's database everything this table keeps until your data is
erased; your sign-in account and the Google addresses on Google's list follow on the same day,
by hand. What the table says stays after erasure stays as it says. Apart from that, what remains
is a record that an erasure took place, with dates and counts and no name or address. If we ever
discontinue the service, §11 of the terms says what you get.

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
it — it is in the target account we wrote it to. What we hold about you ourselves (§4), we send
you in a common file format if you ask.

You may complain to a supervisory authority, in particular in the country where you live or
work. In the Netherlands that is the **Autoriteit Persoonsgegevens**
(autoriteitpersoonsgegevens.nl).

## 11. Security

Credentials encrypted with AES-256-GCM, under a key kept apart from the database that holds
them: in the service's own configuration, and in the settings of the background tasks, both on
the same machine. Connections to your providers are encrypted with TLS, and the provider's
certificate is checked, unless you switch off SSL/TLS yourself for an account you connect by
server name; that connection may then not be encrypted. Organisations are kept apart in the
database itself through row-level security, for the app's requests and for the background tasks
that run migrations. Our support screens read through views that pass it by design, and each of
those views checks that the reader is one of the people who run the service (§4.5). The
scheduled jobs that span organisations do not work under it yet; there, each query's own filter
on your organisation keeps them apart. Logs written to keep credentials and message content out
(§4.5 says what they can still name).

<!-- The background tasks under row-level security: true since #1323 (d0138607, 0138 T1 step 2),
     merged into this branch in c1413b53. The eight per-tenant tasks and the standalone worker
     connect as app_user on APP_DATABASE_URL (openTaskPools, apps/worker/src/jobs/task-pools.ts).
     The six scheduled jobs that span organisations (the sync tick, retention, the purge of closed
     organisations, the digest, the drift detector, group discovery) still connect as the
     database owner on DATABASE_URL (SECURITY.md; docs/rls-guide.md, "Where row security holds
     today"); 0138 T2 and T3 step 2 move them, on a branch of their own, not merged. -->

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
household case §3 describes, and the parent stays the one who sets it up. A grant link for a
child under 16 is completed by the parent together with the child. The child's Google address
goes on Google's list of test users (§6) at the parent's request.

## 13. Changes

Material changes are notified by email to account holders at least **30 days** before they take
effect, and every version of this policy stays available in
[its history on GitHub](https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.md), so
you can see what changed. That history also shows drafts that were never published; their
version line says so. The version number and date at the top of this page show which version
applies.

During the Alpha, the Alpha conditions (§11 there) set how you hear about what follows it,
including a move to another hosting provider: at least 7 days ahead, by email. None of your
data goes there unless you accept the new conditions.
