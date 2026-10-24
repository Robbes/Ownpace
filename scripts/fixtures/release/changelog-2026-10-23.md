# Changelog

All notable changes are documented here (Keep a Changelog format; SemVer once released).

## [Unreleased]

### Changed

- **The identity provider is Zitadel v4.19.5, which carries three security
  fixes** (workplan 0135 T7, #1651): device authorizations need the user's
  consent, login v2 signs its proofs with a server secret, and an invalid
  public host header is refused instead of ignored. None of them reaches a
  flow this stack uses, and the upgrade runs no setup step. Live takes it from
  the next release tag.
- **PgBouncer 1.26.1 closes three holes this stack's settings left open, and
  Trigger.dev's Redis leaves Alpine 3.21** (workplan 0119, #1657): each hole
  was open to a client that had not logged in (CVE-2026-19888, CVE-2026-6668
  and CVE-2026-107349), and a fourth, CVE-2026-107350, was probably closed by
  the settings already. 1.26.0 is skipped, because it ignored this stack's
  `ignore_startup_parameters = search_path`. Redis stays on 7.4 and runs on
  Debian 12, since Alpine 3.21's security support ends on 2026-11-01. Mailpit
  v1.31.6, Gatus v5.37.0 and registry 3.1.2 are current.
- **The API, web and appliance images build on Node 24.22.1, the October
  security release, and the Windows appliance ships the same Node** (workplan
  0119, #1658): the packager reads the version from the appliance image's
  `FROM` line, so each bump of that image moves the zip's Node too. pnpm is
  11.28.6.
- **The managed stacks' container output is capped by size** (workplan 0129,
  #1661): every service in `managed.yml` keeps five files of 20 MB, about
  100 MB at most, where Docker's default kept all of it until the container
  was removed. The website's container stays uncapped, because the visit
  count reads its whole log.
- **imapflow 2.5.6** (from 2.4.3), with nodemailer 10.1.7, eslint 10.13.0,
  @tanstack/react-query and its devtools 5.104.4 and lucide-react 1.59.0
  (Dependabot, #1673).
- **CI on the Spark takes the newest Node 24, and the security scan names its
  Trivy** (#1659): every setup-node step asks for the newest 24.x, where the
  Spark's jobs had kept 24.18.0; Security Scan sets up pnpm and Node as every
  other job does and installs from the lockfile; Trivy is held at v0.76.0.
- **Live refuses a sign-in provider's key, so its sign-in page stays email and
  password only** (workplan 0140 T10, #1644): the stand-up and the deploy
  refuse live's settings while a Google, Microsoft, GitHub or Apple sign-in key
  holds a value, as privacy §4.4, §7 and §8 say.
- **Deletions and Moves say what was decided on each row under *Already
  decided*** (workplan 0159 follow-up 6, #1652): kept, deleted on the new
  system too, or, for a moved item, its old copy removed.
- **The Alpha conditions, the terms and the privacy statement, reworded and
  still version 1.0** (workplan 0159 row 24, the owner's approval of
  2026-10-19, #1639): the two deletion switches carry the app's names; the
  Dutch texts say *aanmelden* and *afmelden*; the count before a migration is
  *the count when you review your migration*, no longer a *preflight*; and the
  privacy statement says what two-factor sign-in, passkeys and the lock after
  ten wrong passwords keep, on which basis, for how long, and that you can
  object. #1639 numbered the words 1.1; on 2026-10-21 the owner kept them on
  1.0, edited in place, because no tester had accepted any version yet. They
  apply from publication.
- **On a phone, a migration draws its two tiles once, under its name** (workplan
  0159 row 19, #1638); each data type keeps its icon, name, state and sentence,
  and a computer shows the page as before.
- **The permission report comes in the reader's language** (workplan 0144): the
  Finish page asks for it in the screen's language (`lang=nl` or `lang=en` on
  `GET /api/permissions/report` and the appliance's `/permissions/report`), and
  its headings, table headers and fixed sentences follow, and each blind spot
  is said in Dutch where its sentence has Dutch. Addresses, folder names and
  rights such as FullAccess and SendAs stay as they were found; where a reason or
  a measurement is still English, the Dutch report says so. Without `lang`, or
  with any other value, it is English.

- **The identity provider's mails, in Ownpace's words, in Dutch and English**
  (workplan 0135 T6): the sign-up, address-change and password-reset mails
  (#1604), and now the notice that a password was changed and the link to add
  a passkey. Each names Ownpace and the address to write to.
- **The sign-in page locks an account after ten wrong passwords, offers a
  second factor, and live's organisation is called Ownpace** (workplan 0135
  T4 and open questions 2, 3 and 8, the owner's answers of 2026-10-17): ten
  wrong passwords in a row lock the account until an operator unlocks it; an
  authenticator app or a security key may be added and is never required; and
  the organisation on live's sign-in page is named Ownpace.
- **Every screen of the app and the site, swept for a tester** (workplan 0159,
  #1613 to #1628):
  - each screen names itself once, in the top bar and the browser tab, and a
    migration is called by its name, never its id;
  - the pages before sign-in have an English/Dutch switch, and *Not now* on an
    invitation no longer loops back to sign-in;
  - *Start a migration* says what each step does, step 5's button is *Set up* /
    *Klaarzetten*, and step 6 lists only the data types chosen;
  - the queues, Verify, Confirmed, Team and Billing read on a phone, and links
    inside sentences are underlined;
  - Dutch screens give answers, refusals and numbers in Dutch (18.734, 3,4 GB);
  - the site writes Dutch prices the Dutch way (€2,50), and its legal pages
    stack their tables on a phone.
- **The owner's word choices from the sweep** (workplan 0159 §5, the owner's
  answers of 2026-10-18, #1630 to #1636): Dutch signs in and out with
  *Aanmelden* / *Afmelden*, and says *aanbieder*, never *provider*; the
  check's verdicts and Deletions' chips are words, with the server's token in
  the title; Verify explains its four common findings and keeps the server's
  text in a closed *Technical details*; the queues' *What this means and what
  you can do* is written for the reader, in their language; a new mailbox's
  and a shared address's decision ask in the reader's language, and the new
  mailbox's button says what it does; a share has one name on the sharing
  checklist, the report and Finish; and the site's estimate, pricing and
  archive guide no longer promise a *free preflight* (the privacy statement
  kept the word until #1639). Two items, the tiles on a phone and
  the legal texts' wording, were asked again.

### Added

- **A weekly scan of every image the stacks run** (workplan 0146 T8, #1674):
  Trivy, report only. Findings go to code scanning, and an image whose
  operating system is past its end of life gets an issue of its own. The first
  run found one, the GoAccess image on Alpine 3.20 (#1675).
- **The end of the Alpha empties the task runner's history** (workplan 0139,
  #1667): `docs/ending-the-alpha.md` now has the step privacy §9 promises, on
  live and under the hold: Trigger.dev's database reset, the volumes of its
  ClickHouse, Redis and MinIO removed, and a check before the hold lifts.
- **A daily watch on the dates nothing else warned about** (#1666): the
  production certificates, and, once their repository variables are set, the
  website's `security.txt` and the Entra client secret. One issue stays open
  while any of them is inside its window.
- **Live's daily duties and its disk tell the owner by mail** (workplan 0142
  T3, #1664), once the owner has installed the units on live: a failed run of
  the duties, no pass for 26 hours, free space below its floor, and a summary
  once a day.
- **A weekly watch on every pin Dependabot cannot see** (workplan 0146 T8,
  #1663): Dependabot had read none of the files in `deploy/compose`, so every
  pin it cannot see (the images in `deploy/compose`, the tasks' Node and pnpm)
  is compared every Monday with what it should follow, and an issue stays open
  while one is behind.
- **The operator's log says who deleted a migration or a connection, replaced
  an account's sign-in or prepared a cutover** (workplan 0137 T4, #1648). No
  address, user name or password goes in the record.
- **The grant and progress link pages are opened in a real browser on every
  pull request** (workplan 0141 T12 (b), #1646), in English and in Dutch, and on
  a phone, where neither may scroll sideways.

### Fixed

- **The visit count gives GoAccess nginx's own time, never a visitor's text**
  (workplan 0152, #1676): the time is read only from the end of a log line's
  first piece, in nginx's own shape, and the user field is never handed on,
  so a user name sent in a Basic Authorization header can no longer reach
  GoAccess or backdate a visit.
- **The identity provider's provisioning token gets its first date before the
  provider first starts** (#1660): a new stack, a new runner or live's
  recovery no longer takes compose's fixed 2026-12-31, which from 2027-01-01
  would have kept the provider restarting. A date still ahead is kept.
- **The managed smoke gate's reads of the identity provider ride out a 502
  from the front** (#1672): `smoke-managed.sh` asks a read again on no answer
  or a 502, 503 or 504, on the same `IDP_READ_ATTEMPTS` budget, and still sends
  each write once, the one-time token request included.
- **The managed bring-up's reads of the identity provider ride out a 502 from
  the front** (#1662): `setup-zitadel.sh` asks a read again on a 502, 503 or
  504, as it already did on a dropped connection, and still sends each write
  once. A read asked again no longer puts the retry line in front of its
  answer.
- **Dependency overrides get upper bounds** (#1656): express is back on
  cookie 0.7.2, where the 2.0.1 it had been given has no `serialize` and
  `res.cookie()` would have thrown, and the override no longer lets
  @opentelemetry/core reach 3.0.0, which would have broken the task image. The
  web app drops recharts, croner, autoprefixer and postcss, which it never
  imported.
- **An IMAP account is shown what an IMAP server holds** (workplan 0013): a
  migration from the IMAP card is told about its mail, and no longer about
  calendars, contacts, files or tasks. An Apple account keeps every row it had.
- **Sharing says which shares a folder press could not make, and why**
  (workplan 0136 T3, #1645), in Dutch where the server gave Dutch and in
  English otherwise, under the folder and in each row's card.
- **The line under an answered or set-aside decision is in Dutch on a Dutch
  screen** (workplan 0159 follow-up 12, #1649).
- **An invitation reaches the person whatever capitals or spaces their address
  was typed with** (workplan 0156 T3, managed migration 0059, #1650), and so
  does the organisation a granted access request makes.
- **The managed nightly's sandbox invoice asks Moneybird once more when it says
  try later** (workplan 0111 slice 5d, #1653): it waits out a 429's Retry-After
  of up to two minutes rather than asking early, and never posts a payment
  twice.

## [0.2.0-alpha.2] - 2026-10-11
