# Workplan 0174 — Grant links for every account: sign-in and own-password pages

> **In one line:** alpha.21's grant links for every account a person can grant, sources and destinations: Dropbox and Cirrux Drive on the sign-in seam, and a page where the person types their own password for Apple and every password kind, tested before it is stored.

## Status — 2026-11-25 (update this block at the end of every session)

**2026-11-25, T6 built (draft pull request on T1's branch, merges after T1).** The owner's side
of *They do, with a link*, for every password kind and for destinations (§8.1, §8.2, §4.6):
- `start-plan.ts`: `grantableByLink` answers yes for every password source kind, served or not;
  `destinationByLink` for every password destination. `GrantLinkProvider` gains `cirrux`.
  Dropbox's case is T2's and fits beside the password kinds unchanged.
- **One change of place, not of shape, to §5.1:** `PASSWORD_SOURCE_KINDS`,
  `PASSWORD_TARGET_KINDS`, `PasswordKind` and `isPasswordKind` now live in `@openmig/shared`
  (`password-grant-kinds.ts`), so the screens and the create door read the same lists;
  `grant-providers.ts` re-exports them unchanged, and every import of them still works.
- The create door's `forPerson` (`account-for-a-person.ts`): a password kind only
  (`not_by_link`), no secret taken (`secret_for_person`), every server and account still
  required (D2; Infomaniak's sync user name excepted, as `personFieldsFor` lets the person fill
  it), never probed, the person this organisation's (`person_not_found`).
  `credentialFieldRequired` gains `forPerson`. **Open question 3, answered:** the path that saves
  a Google or Microsoft account by its address alone writes `status: 'error'` (its probe has no
  token and fails), so a row saved for a person is stored `error` too, without a probe; *waiting*
  is observed from the rows, and no shared migration was needed.
- *Start a migration*: a password source by link is saved with its server and account
  (*Save for {person}*); a password destination asks *Whose account is {provider}?*, and the
  person's own is saved the same way; the person is made when the first account is saved for
  them; the last screen counts every account the link asks for, both roles.
- The person's page (§4.6): `GET /api/people/:id/awaiting-grant` answers `waitsFor` per
  migration (role, way, account, and a password's tries on the live link); the page says the
  destination by name, the wrong tries with tries left, and *locked on this link after five*.
- The Accounts page: `GET /api/connections` answers `waitingFor` for a password account saved
  for a person (it holds no password, and a migration of theirs uses it with none); the row says
  *Waiting for {person}* and offers no *Test*.

Proved: unit, `grantableByLink` per kind and `destinationByLink` (failing before, 2 of 40);
`an-account-saved-for-a-person` through the real door over PGlite, both chains (7 of 8 failing
before: saved without a secret and unprobed, refused without its server, refused with a password,
another organisation's person, the Accounts page's *Waiting for*); `credentialFieldRequired`
with `forPerson`; `what-the-owner-sees-while-a-link-waits` (the four lines' data, tries on the
live link, a new link at zero); the person page's four lines (failing before); the Accounts
page's row; *Start a migration* with an iCloud source and a Soverin destination (failing
before). UI smoke in real Chromium over the built bundle: *They do, with a link* with an iCloud
source and a Soverin destination, both posted `forPerson` and neither with a password. Not proved
here: the password route, the grant page and Cirrux Drive (T3 to T5), and anything with a real
provider.

**2026-11-25, T5 built (draft pull request on T1's branch, merges after T1).** Destinations on
the link, as §4.3 and §4.4 say, with §4.4's binding changed before the code (its T5 paragraph:
Cirrux names a workspace and no address, so the first Drive grant on an account records the
workspace and every later one must reach it):
- `grant-providers.ts`: the `cirrux` entry, `targetKinds: ['cirrux']`, served by `cirruxClient`;
  three optional members on the seam (`consentUrl`'s `challenge`, `finish`'s `verifier`,
  `GrantFinish`'s `access` and `shownAs`). `CIRRUX_DRIVE_WORKSPACE_KEY` in `cirrux-drive.ts`.
- `person-grant-subject.ts`: the Drive card read per role from `GRANTED_TARGET_FACES`, offered
  only once the account's password is stored, and kept, connected, once the person connected it.
- `grant.ts`: `POST /:link/cirrux/authorize` takes the card's `ref` and begins the owner's Cirrux
  consent (PKCE, the deployment's public client) with the person's link in its pending state.
- `cirrux-link-ending.ts` (new), from `cirrux-oauth-routes.ts`'s one callback: the link live, the
  migrations still hers, the app password stored, the grant under the row's lock and refused for
  another workspace (`storeCirruxDriveGrantIn`, `another_workspace`), `person_granted_connection`
  written, `mapping.granted` per migration with `role` and `via`, the link spent when every card is
  connected. The owner's own callback records and holds to the workspace too.
- `packages/managed/src/person-granted-connection.ts` (new): the row's write, and the refusals.
  Guarded doors: the create door (`personId` in its body, for T6's wizard), the door that gives a
  migration to a person, the edit door, the rotation door (D6), and the owner's *Connect Cirrux
  Drive* on an account a person connected.
- `consentToFollow('cirrux', …)` already follows `api.cirrux.co` only (0160); the test ties the
  authorize URL to `CONSENT_HOSTS.cirrux`. The page's Drive card and its words are T4's.

Proved: `a-drive-a-person-connects-on-their-link.unit.test.ts` (PGlite, both chains, Cirrux faked):
the Drive card only after the app password; the ending stored with its workspace, the person's
row, the audit rows; refused when the workspace differs (nothing stored, the link live), the
owner's consent too; another person's migration refused at three doors; the rotation and the
owner's Drive sign-in refused. All eight fail on T1's sources. The unit tests of the api,
orchestration, managed, connectors, shared, the appliance's guards and `scripts/` pass. Not proved:
a real Cirrux sign-in (no test account, §11); no integration test was added (T8).

**2026-11-25, T4 built (draft pull request, on T1's branch; merges after T1).** A person's
grant page draws a password card per kind, in two groups, in English and Dutch:
- `Grant.tsx`: the cards grouped under *The accounts your data is copied from* and *…copied to*
  (§4.5), sources first, a group only when it has a card; each card says **Connected**,
  **Waiting** or **Locked on this link**; a destination's lines name where each migration comes
  from. When a password is asked and the organisation gave no phone, the page says to ask some
  other way (§5.8). The sign-in cards are as they were.
- `components/GrantPasswordCard.tsx`: the card (§5.2, §5.7, §5.8). It shows the server line
  before any box, with the registrable domain in bold, or *Apple's own server*. It adds D3's
  warning on `addressMail: 'mismatch'` (a warning, never a refusal), says nobody will see the
  password, and says what Ownpace never does. It shows the owner's values as text and gives
  boxes only for the person's fields, with the descriptor's labels, hints and autofill, *Show*
  where the descriptor offers it, no `name` attribute, and `required`. Apple's and Nextcloud's
  steps fold under a question; Cirrux and Infomaniak keep their descriptor hint; other kinds get
  *Use an app password if your provider offers one.* After each answer the box is emptied and
  the card says the category only: refused with the tries left, unreachable, a face refused,
  locked, connected.
- `grant-service.ts`: the person subject parses T1's card shape (`ref`, `role`, `way`, `server`,
  `fields`, `tries`, `from`, the password kinds as `provider`); `putPassword` sends
  `{ ref, values, locale }` by `fetch` as a `PUT` with a JSON body, no cookie, no referrer;
  `passwordAnswerOf` reads the route's answers as §5.3 now spells them.
- `i18n/strings/grant.ts`: the words, in English and Dutch.
- **Two additions to the fixed interfaces, written into §5.3 above:** the bodies of the route's
  refusals as the page reads them, and D3's two optional `GrantServer` fields, `registrable`
  and `addressMail` (added to `grant-providers.ts` and the OpenAPI spec as optional; T3 fills
  them). The route's shape is unchanged.
- **Where the words differ from §5.9:** the Dutch says *verbinden* and *Verbonden*, as the grant
  page's approved Google and Microsoft cards do, not *koppelen*; *aanbieder*, never *provider*
  (the glossary, and `the-owners-words-at-the-door`); *app-specifiek*, as `account.appleAppPassword`
  says. `grant.password.apple.server` became `grant.password.published`, which names the
  provider and the host. `grant.apple.password` and its hint are not added: the card uses the
  descriptor's own `account.appleAppPassword` and its hint, as §5.2 asks. `grant.password.withdrawn`
  (the progress page), `grant.continue.dropbox` (T2) and `grant.continue.cirrux` (T5) are left
  to the tasks that draw them.

Proved: `a-password-card-per-kind` (34: every password kind in each role it has, the server
line, D3's warning and its absence, no phone, the two groups and the three states, each answer;
34 of 34 fail on T1's page), `a-password-sent-by-fetch` (14: the `PUT` by `fetch`, each answer,
T1's card shape parses; 14 of 14 fail on T1's service), the grant page's existing suites, and
the UI smoke under the CSP nginx serves (`a person types their own password on their grant
link`, 3: by the button and by Enter, a request of type `fetch`, `PUT`, JSON, the password in
its body and in no URL, the page's address unchanged with no navigation, no policy violation;
on a phone in Dutch; all 3 fail on T1's page). Not proved: the page against T3's real route
(it is built in parallel; the page is tested against §5.3's shape).

**2026-11-25, T3 built (draft pull request, on T1's branch, merges after T1).**
`PUT /api/grant/:link/password` as §5.3 says, in `grant-password.ts`, mounted by `grant.ts`:
- **The test** (`password-test.ts`, `PasswordGrant.test`): the create door's probe and
  `qualifyAccount` on the merged config and credentials. The probe now marks the one failure that
  counts, `refusedLogin` (`loginWasRefused`: imapflow's `authenticationFailed` or
  `AUTHENTICATIONFAILED`, an HTTP 401 from DAV or JMAP, Apple refusing an Apple Account password),
  read from the error, never from words. Every other failure is `unreachable`; `face_missing` is a
  needed face's measured `no` (not a `structural` one, nor Cirrux Drive's, which is its own card).
- **Five tries** (`person-link-tries.ts`, on 0064's table): a try is CLAIMED before the login, in
  one statement that adds one only under five and unlocked, and given back for anything but
  `refused_login`; so two tabs racing at four make one login between them, and the sixth is never
  tested. A process that dies mid-test keeps the try counted.
- **The store** (`storePersonPassword`, `person-grant-ending.ts`): one transaction, the link
  `FOR UPDATE` and live, the card read again by `ref`; a source's password merged onto each of its
  migrations' `source_secret_ref` (`grant_withdrawn_at` cleared), a destination's onto the
  connection's `secret_ref` with `person_granted_connection` naming the person (another person's
  is refused); the measured qualification remembered; one `mapping.granted` per migration with
  `via`, `role`, `ref`; the link spent once every card is connected. A destination saved by its
  address alone also keeps the user name the test logged in with, so the pass logs in as the test did.
- **Around it:** JSON only (415), 4 KiB (413), exactly the card's person fields (400); a replay
  answers `already_connected` without a test; an IP-literal server is never tried
  (`server_not_a_name`, D3 (a)); a revoke mid-test stores nothing (401); thirty tests an hour per
  caller (`GRANT_PASSWORD_TESTS_PER_HOUR`); `mapping.grant_refused` per migration with the
  category. The OpenAPI spec says all of it.
- **D3's comparison** (`grant-server-domain.ts`), on the GET: `GrantServer` gains the optional
  `domains` (each host's registrable domain, for the bold) and `notTheAddressMail` (the hosts on
  neither the address's domain nor its MX hosts', read through `verifyMX`'s public resolvers,
  held ten minutes, three seconds at most; absent when no comparison was made). A warning, never a
  refusal.
- **Changes to the fixed shapes:** none removed or renamed. Added: §5.3's answer carries
  `linkSpent` and `progressUrl` (written into §5.3); `GrantServer`'s two optional fields, as T1
  named; `ProbeResult`'s optional `refusedLogin`. Open question 4 is answered in §14.

Proved here: `a-password-typed-on-a-link` (each step of §5.3, the lock, the race, D4, both stores,
replay, revoke, another person, an IP literal), `a-password-the-link-never-says` (seven outcomes,
every log line, response, header and row; shown to fail when the route logs its body),
`password-test`, `grant-server-domain`, `grant-password-limit`, `a-login-the-server-refused`, all
over PGlite with both chains. Written, not run here (no container runtime):
`a-password-tested-against-stalwart.integration.test.ts`, an IMAP source and a JMAP destination
with a right and a wrong password; CI and T8 run it. An IMAP destination is not in it: the
target probe takes no `tlsVerify`, and the harness's IMAPS certificate is self-signed, so it
would answer `unreachable` there; T8's managed smoke covers it on the demo Stalwart.

**2026-11-25, T2 built (Dropbox on the seam), in review.** A grant link connects Dropbox: the
`dropbox` entry in `grant-providers.ts` (fact `dropboxClient`), `dropboxLinkAsk` in the readiness
check, the link branch in Dropbox's callback through one ending lifted out of Microsoft's
(`link-ending.ts`, Microsoft's behaviour and tests unchanged), and `get_current_account` in
`dropbox-consent.ts` binding the grant to the named account: its `email` equal without case and
`email_verified` strictly true, else nothing stored and the link live. The page in Dropbox's words,
EN and NL; `grantableByLink('dropbox')` from `/api/provider-clients`. Two things the plan did not
name, both needed for the wizard's *They do, with a link*: Dropbox's refresh token is no longer
`required` on its descriptor (as Google's and Microsoft's are not; every form still demands it),
and `awaitingGrantRefusal` holds a Dropbox migration without a token. Proven by mock only: no real
Dropbox account exists for a test. T1 adds the same fact `dropboxClient`; the two meet in
`grant-providers.ts` (§10).
**2026-11-25, T1 built (draft pull request, merges after alpha.20's tag).** The seam grows as
§4.1, §4.2, §5.1 and §9 say, and the interfaces T3 to T6 build against are on the branch
`claude/ownpace-public-readiness-y7orc6-a21-grant-t1`:
- `grant-providers.ts`: `GrantRole`, `GrantWay`, `targetKinds` on every entry, the facts
  `dropboxClient` and `cirruxClient`, `PASSWORD_SOURCE_KINDS`, `PASSWORD_TARGET_KINDS`,
  `PasswordKind`, `PasswordGrant` (with `personFields` built from `credentialFieldsFor`; its
  `test` rejects until T3 builds it), `PasswordTest`, `PasswordTestInput`, `PersonField`,
  `GrantServer` (`hosts`, `published`; T3 adds D3's domain comparison as optional fields),
  `passwordGrantOf`, `passwordServerOf`. `cirrux` joins `GRANT_PROVIDER_IDS`; `apple` stays in
  it and never gets an entry. 0171's `tryPassword` is gone.
- `grant-link-readiness.ts`: `targetGrantAsk` (answers `asks`, a list, because Cirrux can ask a
  password and Drive at once; the person's fields are added by the subject, not the readiness
  check, which takes key names and booleans only), `sourceGrantAsk` (a password source on a
  person's link; a migration's own link stays sign-in only, §13), and `awaitingGrantRefusal`
  per role, with optional `sourceCredentialKeys` and `target`.
- `person-grant-subject.ts`: §4.1's `PersonGrantAccount` exactly; `PersonAccountAsk` gains
  `way`, and a password ask carries the kind, the connection and the faces. A password source
  is a card when it has no password or the person gave it one (on the migration); a
  destination when it has none or `person_granted_connection` names the person. Tries are
  read per link (`PASSWORD_TRIES_PER_LINK = 5`).
- `grant.ts`'s GET answers `ref`, `role`, `way`, and for a password card `server`, `fields` and
  `tries`; each migration names `from` too. The OpenAPI spec says so.
- `start-when-granted.ts` and *Start*: a migration starts only when both sides have a way in
  (`hasAWayInOnBothSides`).
- Managed migration **0064** (`person_link_try`, `person_granted_connection`): RLS NULL-safe,
  `link_sees_itself`'s twin on the tries, the granted connection held to the organisation's
  own connections, grants for `app_user` and the purge's role, both in `PURGED_TABLES` and in
  `no-managed-leakage`. The shared chain is untouched.

Proved: the unit tests named in §10's T1 row (`readiness-per-role`,
`every-password-kind-has-a-link`, `a-person-link-asks-for-both-sides`,
`a-password-tried-on-a-link-under-rls`, `start-when-granted`), PGlite over both chains; and
the worker's `a-system-role-that-is-not-the-owner` integration test, which lists both tables for
the purge's role, against a real Postgres 16 from `./scripts/local-pg.sh` (41 passed; CI's run
on the pinned server is still to come). squawk 2.74.0 over 0064 reports `require-lock-timeout`
(met by the runner), `require-statement-timeout` and `prefer-bigint-over-int` (a count that
stops at five), report only. Not proved here: anything T3 to T8 own.

**2026-11-25, later: the owner's decisions.** *"All adviced."*: D1 to D9 as advised, (a) each,
and D3 with the one addition put to the owner with it (§12, D3): a warning beside the server when
it is not on the address's own domain or its mail's (MX). D8: the privacy policy and the terms
change in place, under 1.0, and nobody is asked again (*"terms or the privacy policy: no one but me accepted then, so change them and stay on 1.0"*). The plan is final; T1 to T8
go to builders for alpha.21, and merge after alpha.20's tag.

**2026-11-25: planned, for alpha.21.** Written for the owner's review; builders take its tasks
as parallel pull requests (§10). Nothing is built. Every claim about the code below was read on
`main` at `32b620a`, with file and line. **This plan supersedes workplan 0171's T4 (Dropbox)
and T5 (Apple's app-specific password)**, which did not make alpha.20; 0171's Status block says
so. One managed database change is proposed (§9, D5), and none in the shared chain.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T1 The seam grows: password kinds, destinations, one shape for the page | builder | 🔎 In review (draft PR) | §3, §4.1, §5.1, §9. The interfaces every other task builds against, the person's subject per account and role, readiness per role, the managed migration. M. First, but its interfaces are fixed here so T3 to T6 start beside it. |
| T2 Dropbox on the seam | builder | 🔍 In review | §6. Supersedes 0171 T4. S. Built 2026-11-25 on 0171 T3's seam (#2136): the binding, an unverified email and another account refused with nothing stored and the link live, a refused exchange, `grantableByLink('dropbox')`; every new test shown failing on `main` first. By mock only: no real Dropbox account. |
| T3 The own-password route: test, try count, store, spend | builder | 🔎 In review (draft PR) | §5.3–5.7, §7. `PUT /api/grant/:link/password`. L. On T1's interfaces. |
| T4 The own-password page, per kind, in English and Dutch | builder | 🔎 In review (draft PR) | §5.2, §5.8, §5.9. `Grant.tsx`'s password card and its words. M. On T1's GET shape. |
| T5 Destinations on the link: Cirrux Drive and password destinations | builder | 🔎 In review (draft PR) | §4. Cirrux Drive's sign-in as a target entry; a migration starts when granted only when both sides have a way in. M. On T1. |
| T6 The owner's side: *They do, with a link* for every kind and for destinations | builder | 🔎 In review (draft PR) | §8.1, §8.2. *Start a migration*, the person's page, the account saved for somebody else, the refusal table. M. On T1. |
| T7 The words around it: grant-links doc, guides EN/NL, site, ADR-0035 | builder | 📋 Planned | §8.3–8.6. M. After the owner's D-decisions; text lands with T3 to T6. Privacy and terms after D8. |
| T8 Proofs: integration and the managed smoke | builder | 📋 Planned | §11. Stalwart and Nextcloud fixtures, a real and a wrong password, the lock, the password in no log. M. Last. |
| T9 The managed E2E run | owner | ⏳ **Owner** | Started by the owner on the self-hosted runner, after T8 merges. |
| T10 The owner's decisions | owner | ✅ Answered 2026-11-25 | §12: D1 to D9 as advised; D3 with the MX warning; D8 in place under 1.0. |

## 1. The owner's words

Setting up a migration for a family member, the owner found that Microsoft asked them to connect
instead of offering the grant link (fixed in alpha.20, #2136). The owner then asked, verbatim:
*"I want all sources/targets that supports granting to be able to use the others-grant-page."*

Asked how far and when, the owner answered:
- *"1: b"*: grant links for every account a person can grant. The sign-in accounts: Google and
  Microsoft (done), Dropbox, and Cirrux Drive as a destination. A page where the person types
  their own password, for Apple and for every password-based source and destination: IMAP mail,
  Nextcloud, Soverin, Infomaniak, CalDAV/CardDAV, WebDAV, JMAP, and any other password kind the
  product connects. The point: **no person's password ever has to pass through the one who sets
  up the migration.**
- *"2: a"*: all of it in alpha.21, as one workplan.

## 2. What is there today

### 2.1 The provider seam

`apps/api/src/routes/grant-providers.ts` is the one place that says which providers a link can
connect (0171 T3, #2136).
- `GRANT_PROVIDER_IDS = ['google', 'microsoft', 'dropbox', 'apple']` (:55); entries exist for
  Google and Microsoft only (:211-214). *"A provider without an entry is never grantable"* (:23-25).
- `GrantProvider` (:105-136) carries `sourceKinds`, `served(facts)`, `consentUrl`, `finish`, and a
  `tryPassword(account, password)` reserved for Apple (:131-135) that nothing implements.
- `DeploymentFacts` (:64-67) is two booleans, `googleClient` and `microsoftClient`.
- Every entry is a **source** provider: `sourceKinds` is the only membership, and
  `grantProviderOfKind` (:217-223) is asked of the source's `connection.kind` only.

### 2.2 Readiness

`apps/api/src/routes/migrations/grant-link-readiness.ts`:
- `isGrantableSourceKind` (:93-95) is `grantProviderOfKind(kind) !== null`.
- `grantLinkAsk` (:250-387) decides per migration, in the owner's order: no source
  (`no_source_connection`), not grantable (`source_not_grantable`, :264-276, which tells the owner
  *"any other account is still connected by hand, on the Accounts page"*), no named account, no
  destination, nothing to ask, the client, the restricted scopes. Microsoft has its own tail
  (`microsoftLinkAsk`, :397).
- `awaitingGrantRefusal` (:521-542) is what holds Start: a grantable source with no refresh token
  and no service-account key is waiting. It is an observation of the rows, not a stored state, and
  the comment above it (:500-519) says why: a new mapping status would touch six places and could
  go stale.

**Nothing in it reads the destination**, beyond `hasTarget` (:126): a link never connects one.

### 2.3 One link per person (ADR-0035)

- The row is managed: `person_link` (`packages/managed/migrations/0034_*.sql`), shaped like
  `mapping_link`, with a sha256 of the secret, `purpose` `grant | view`, `expires_at`, `used_at`,
  `revoked_at`, and `asks_again uuid[]` (managed 0036). Its own RLS policy `link_sees_itself`
  lets the unauthenticated verification read find exactly the row presented.
- The secret is 32 random bytes, base64url (`packages/ledger/src/mapping-link-store.ts:164`); a
  person's token is shaped `p.<id>.<secret>` and told apart in `authenticateGrantLink`
  (`apps/api/src/middleware/auth.ts:1393-1400`).
- The subject is read per account: `readPersonGrantSubject`
  (`apps/api/src/routes/migrations/person-grant-subject.ts:142-224`) groups the person's
  migrations by the **source** account each reads (`PersonGrantAccount`, :91-100), each with its
  `provider` and `ask`.
- The grant lands in `storePersonGrant`
  (`apps/api/src/routes/migrations/person-grant-ending.ts:148`): one transaction, the token
  encrypted onto each listed migration's `mailbox_mapping.source_secret_ref` (:205, ledger 0032),
  `grant_withdrawn_at` cleared, one `mapping.granted` audit row each
  (`grant-ending.ts:85`); a refused sign-in is `mapping.grant_refused` (:93), without the address
  that tried. `grantedSecret` (:131) encrypts with `SecretStore.encryptCredentials`
  (`packages/core/src/secret-store.ts`, AES-256-GCM under `SECRET_ENCRYPTION_KEY`).
- The person can take it back per account (`apps/api/src/routes/withdraw-grant.ts:145`).

### 2.4 The grant routes and page

- `apps/api/src/routes/grant.ts`: `GET /api/grant/:link` (:474) answers who asked, the
  organisation, its phone, the VIES-checked company name, and per account what will be read and
  where it goes; `POST /:link/:provider/authorize` (:543) begins a consent, its state held on the
  server (`consentFlows.begin`), never round-tripped through the browser. Mounted at `/api/grant`
  with no session (`apps/api/src/index.ts:274`).
- `apps/web/src/pages/Grant.tsx`: a card per account (`PersonGrant`, :270), words per provider in
  `PROVIDER_WORDS` typed `'google' | 'microsoft'` (:155), and the address the button follows
  checked by `consentToFollow(provider, url)` (:285, :486). Routed managed-only
  (`apps/web/src/AppRoutes.tsx:220-226`, `ManagedOnly`).
- The page's CSP has `form-action 'none'` and `connect-src 'self'` plus the sign-in host
  (`apps/web/nginx.conf.template:153`): no form is ever submitted, every call is `fetch`.

### 2.5 The start flow

- `grantableByLink(card, served)` (`apps/web/src/services/start-plan.ts:258-278`) answers yes for
  Google's cards and the Microsoft account, and `false` for every other card (`default`).
- `StartMigration.tsx:519`: `byLink = who.someoneElse && grantableByLink(card, served)`; a card by
  link is a `LinkedNeedRow` (:2101-2111), any other a `NeedRow`, where the owner types the
  credential. The choice is *"They do, with a link"* (`start.who.someoneElse`,
  `apps/web/src/i18n/strings/start.ts:27`; Dutch *"Anderen, met een link"*, :225).
- **Destinations are never by link.** The owner chooses or adds the destination account and types
  its password.

### 2.6 Waiting and starting

`start-when-granted.ts`: once the owner pressed Start for one of the person's migrations, each
migration of theirs that waited for a grant starts by itself when it lands (`startWhenGranted`,
:206), after the grant's own transaction; `awaitingTheirGrant` (:173) feeds the person page's
*Waits for {person} to connect*. Both read the source only.

### 2.7 The password kinds, and the doors that test them

The field descriptors are one table: `credentialFieldsFor(role, type)`
(`packages/shared/src/credential-fields.ts:910-931`).
- **Sources:** `imap` (:637-650: host, port, username, password); `apple` (:377-389: username, an
  app-specific password, its hint naming the page); `caldav`, `carddav`, `webdav`
  (`davSourceFields`: host, port, DAV URL, username, password, 0169).
- **Destinations:** `TARGET_FIELDS` (:704-723: host, port, username, password) for `jmap`, `imap`;
  with the DAV URL for `caldav`, `carddav`, `webdav`, `soverin`, `cirrux`, `infomaniak`;
  `nextcloud` asks for its DAV URL instead of host and port; `soverin`, `cirrux` and `infomaniak`
  add the mail server (`MAIL_SERVER_ACCOUNT_KINDS`, `packages/shared/src/provider-accounts.ts:81`),
  and `infomaniak` the mailbox's own login (`MAIL_LOGIN_FIELDS`, :867; `MAIL_LOGIN_APART_KINDS`,
  `provider-accounts.ts:114`). Provider lines under the password box: `PASSWORD_HINT` (:811) for
  Cirrux and Infomaniak; Apple's on its own field.
- **Cirrux Drive** is a grant on a destination: `GRANTED_TARGET_FACES`
  (`packages/shared/src/target-domains.ts:143-159`) stores it on the account's encrypted
  credentials under `CIRRUX_DRIVE_GRANT_KEY`, through the owner's PKCE consent
  (`apps/api/src/routes/migrations/cirrux-consent.ts`), which records no account identity.
- **The test the create door runs** (`apps/api/src/routes/connections.ts:613-665`): the probe
  (`probeSourceConnection` / `probeTargetConnection`), then `qualifyAndRemember`
  (`apps/api/src/routes/qualify-and-remember.ts:74`), which measures each face the account
  carries and remembers the answer. The door stores the row **even when the probe fails**
  (`status: 'error'`), which a link must not do (§5.4).
- **Limits on tests:** `refusedOverTestLimit` (`apps/api/src/probe-limit.ts:28`), sixty an hour
  per member; `createKnockLimiter` (`apps/api/src/knock-limit.ts`) keyed by `req.ip`. Neither
  reaches a link holder, who is no member.
- **A host only Apple publishes** is fixed: `PROVIDER_ENDPOINTS.apple`
  (`packages/shared/src/provider-endpoints.ts:64-85`). Every other kind's host is typed.

### 2.8 The appliance

The grant and progress pages are managed-only (`AppRoutes.tsx:220-236`); `person` and
`person_link` are managed rows (ADR-0036). ADR-0035's *Still open* names *"links outside
managed"*. The appliance has one implicit person and no grant links.

## 3. The design in one page

1. **A link asks for accounts, not sources.** Each card on a person's page is one account with a
   **role** (`source` or `target`) and a **way** (`sign-in` or `password`). A migration is ready
   when its source and its destination both have a way in.
2. **The seam gains two shapes.** A sign-in entry may serve destinations (Cirrux Drive), and a
   password entry covers every kind whose credential is a password, sources and destinations,
   through the field table that already exists.
3. **The owner fixes where; the person types the secret.** The server and the account name are
   the owner's, shown on the page and not editable (D2); the person types the password, and only
   what the provider says only they can know.
4. **Tested before stored.** The same probe and qualification the create door runs; nothing is
   written unless the login works and every face the migrations need answers. Five refused logins
   lock that account on that link (D4, D5).
5. **The password goes one way.** Browser to API in a JSON body, into the test, then encrypted at
   rest. Never in a URL, a log line, an audit row, a response, a job payload or an error text.
6. **The page earns trust first.** Who asked, the organisation, its phone, the checked company
   name, the server the password will be tried against, and a sentence that nobody, the one who
   asked included, will ever see the password.

## 4. Destinations on the link

### 4.1 One account, two roles (T1)

`PersonGrantAccount` (`person-grant-subject.ts:91-100`) becomes:

```ts
export type GrantRole = 'source' | 'target';
export type GrantWay = 'sign-in' | 'password';

export interface PersonGrantAccount {
  /** Stable on the page and in the PUT: a hash of (role, provider or kind, connection id, account). */
  readonly ref: string;
  readonly role: GrantRole;
  readonly way: GrantWay;
  /** Sign-in: the provider id. Password: the connection kind (`imap`, `nextcloud`, …). */
  readonly provider: GrantProviderId | PasswordKind;
  /** The account, as the owner named it. */
  readonly account: string;
  /** Password only: where it will be tried, as the owner set it (D2, D3). */
  readonly server?: GrantServer;
  /** Password only: the fields the person fills, from `credentialFieldsFor` (§5.2). */
  readonly fields?: ReadonlyArray<PersonField>;
  /** The migrations it serves: for a source, where each goes; for a target, where each comes from. */
  readonly migrations: readonly PersonGrantMigration[];
  readonly granted: boolean;
  /** Password only: tries left on this link, or locked (§5.5). */
  readonly tries?: { readonly left: number; readonly locked: boolean };
  readonly ask: PersonAccountAsk;
}
```

The grouping key gains the role: one Google account that is both somebody's source and, oddly,
their destination is two cards. A destination account shared by two of the person's migrations
(mail and calendars into one Soverin account) is one card.

**What a destination account the person must grant is.** A target connection that has no
secret for the faces the migration writes, and that the owner saved **for this person** (§8.2).
A target the owner connected with their own password is not on the page: the owner's own
account, or the organisation's, is not the person's to grant.

### 4.2 Readiness per role (T1)

`grantLinkAsk` keeps its source decision and gains `targetGrantAsk(r)`:
- no target: `no_target`, as today;
- the target already has a way in: nothing to ask of it;
- a password kind saved for the person (§8.2): `{ way: 'password', kind, fields }`;
- `cirrux` with files ticked and no Drive grant: `{ way: 'sign-in', provider: 'cirrux' }`
  (§4.4), beside the password card when the app password is missing too;
- otherwise: `target_not_grantable`, with the owner's sentence: *"This destination is not one
  a link can connect. Connect it yourself on the Accounts page."*

A **person's** link is issuable when at least one account on it, of either role, can be asked;
it stays refused with each migration's reason once (`docs/grant-links.md`'s table) when none can.

`awaitingGrantRefusal` (:521) gains the two observations, still from the rows:
- a password source with no `password` (or `appPassword`) in the merged credentials;
- a destination with no password for the faces the migration writes, or, for files on Cirrux,
  no `CIRRUX_DRIVE_GRANT_KEY`.

### 4.3 Where a destination's secret is stored (T3, T5; D1)

A source's person-held secret goes on the migration (`source_secret_ref`, ADR-0035 decision 4),
because the source connection may hold the organisation's application. A destination the person
owns holds nothing of the organisation's: its row **is** the person's account. So:

- **(advised, D1 (a))** the password is merged into the **destination connection's**
  `secret_ref`, as Cirrux Drive's grant already is (`GRANTED_TARGET_FACES`), and a managed row
  `person_granted_connection (tenant_id, person_id, connection_id, link_id, granted_at)` records
  whose it is. The create door and the edit door (managed only) refuse to point **another
  person's** migration, or one with no person, at a connection a person granted:
  *"This account was connected by {person}. It can only receive their migrations."* The rotation
  door refuses a new password on it (D6): *"{person} connected this account themselves. Make them
  a new grant link to change it."*
- The appliance never sees the row: the guard lives in `packages/managed` and the managed doors,
  and `no-managed-leakage.unit.test.ts` gains its specifier (hard rule 5).

Withdrawing (the person's progress page) works per account for destinations too: the secret
keys the person typed are removed from the connection, the managed row is deleted, and nothing
writes to that account until they grant again. There is no provider to revoke a password at; the
page says *"Change this password at {provider} too, if you want to be sure"* (§5.9).

### 4.4 Cirrux Drive on the link (T5)

A sign-in entry with `role: 'target'`:

```ts
const CIRRUX: GrantProvider = {
  id: 'cirrux',
  sourceKinds: new Set(),
  targetKinds: new Set(['cirrux']),           // new field, T1
  served: (facts) => facts.cirruxClient,      // `cirruxDeploymentClient()`, new fact, T1
  consentUrl: (a) => cirruxConsentUrl({ ... a.state, challenge }),
  finish: async (code, redirectUri, client) => ({ ok: true, secret: { [CIRRUX_DRIVE_GRANT_KEY]: … }, signedInAs, grantedScopes }),
};
```

- **The binding.** Cirrux's consent records no account (`cirrux-consent.ts`). The Drive card is
  therefore offered **only after the same account's app password is stored** (by the owner or on
  this page), and the ending accepts the grant only when `qualifyCirruxDrive`
  (`packages/orchestration/src/account-qualification.ts:751`), run with the new token, reads the
  same workspace the stored app password signs in to. Whether Cirrux's API names the signed-in
  user directly is open question 1; if it does, that is compared instead, as Dropbox's is.
- **Where it lands:** the destination connection's `CIRRUX_DRIVE_GRANT_KEY`, in one transaction
  with the spend and a `mapping.granted` row per migration, as §4.3 says.
- `consentToFollow` learns `api.cirrux.co`. The consent's PKCE verifier stays in the server-side
  pending state, as today.

**Changed by T5, 2026-11-25, before its code (open question 1 answered).** Cirrux's API, read
2026-11-25 (`https://cirrux.co/help/api/user`): `GET /v1/user/profile` answers `user` (`uuid`,
`username`, *"the user's login handle"*, names, pictures) and `workspace` (`uuid`, `name`, `type`),
and no email address, mailbox or domain; `GET /v1/workspace` the same workspace and nothing more.
A mailbox's address is read only with `email.read` (`https://cirrux.co/help/api/mail`), a scope
this deployment's Cirrux client is not registered for, and no page says which workspace an app
password signs in to. So the ending cannot read *"the workspace the stored app password signs in
to"*: nothing answers it. What T5 builds instead:
- **The workspace is recorded on the account** (`CIRRUX_DRIVE_WORKSPACE_KEY`, the workspace's
  `uuid`, in the account's encrypted record beside the grant), by the first Drive grant that lands
  on it, the owner's or a link's. Every later grant on that account, on any link or the owner's
  button, must reach the same workspace, or nothing is stored and the link stays live
  (`mapping.grant_refused`, `refused: 'another_workspace'`). A new app password for another
  mailbox drops the record with the grant (`keepingTheDriveGrant`); *Disconnect Cirrux Drive*
  keeps it.
- **The first grant on an account is bound by the app password, not by Cirrux.** The Drive card
  is on the page only once the account's app password is stored, and the person who holds the
  link is the one who signs in; Cirrux's answer cannot tell us more. The page names the login and
  the workspace that signed in, as the owner's window does (0160 open question 14).
- **The interface grows by three optional members**, said in T5's pull request: `consentUrl`'s
  argument takes `challenge` (PKCE), `finish` takes a fourth argument `verifier`, and `GrantFinish`'s
  success may carry `access` (the first access token, so the ending measures the Drive without
  spending a refresh). The `secret` Cirrux's entry answers is `{ [CIRRUX_DRIVE_GRANT_KEY],
  [CIRRUX_DRIVE_WORKSPACE_KEY] }`; `signedInAs` is null, because Cirrux vouches for no address, and
  the Cirrux ending (not the address check other providers use) decides by the workspace.
- **Where the doors' guard sits (§4.3).** A migration is made with no person and given to one
  afterwards (`POST /api/people/:id/migrations`), so the guard is at three doors: the create
  door refuses a granted destination unless its body names the person who granted it
  (`personId`, managed only, for T6's wizard to send); the door that gives a migration to a person
  refuses one into an account another person granted; and the edit door refuses any change to a
  migration into a granted account that is not that person's. The owner's own *Connect Cirrux
  Drive* on an account a person granted is refused with the rotation's sentence (D6).

### 4.5 What the person sees when both are asked (T4)

The page keeps its one header (who asks, the organisation, its phone, the checked company) and
then two groups:

1. **From** — *The accounts your data is copied from.* One card per source account.
2. **To** — *The accounts your data is copied to.* One card per destination account, each naming
   what arrives there and from where.

Each card says **Connected**, **Waiting**, or **Locked on this link**, and has its own button or
form. Order: sources first, because the question *"is the destination yours?"* is easiest to
answer with the source already named. Neither group appears when it is empty. The link is spent
when every card on it is connected, either group.

### 4.6 What the owner sees (T6)

On the person's page, beside each migration that waits, by role:
- *Waits for {person} to connect {account}, then starts by itself* (as today, for any role);
- *Waits for {person} to connect the destination {account}*;
- *{person} tried {n} times; {left} tries left on this link*;
- *Locked on this link after five tries. Make {person} a new link.*

Never the server's refusal text for a password the person typed (ADR-0035 decision 5: the account
is theirs): the category only.

### 4.7 What whoever runs Ownpace sees

The audit log (`audit_log`, never pruned) per account: `mapping.granted` with `via: 'password'`
or `'sign-in'` and the role; `mapping.grant_refused` with the category
(`refused_login | unreachable | face_missing | locked`), the link id and the account's `ref`,
**never** the password, the address that tried, or the server's text. The server log carries the
same, plus the probe's category from `probeAnswers`. A *Report this link* ticket carries the
facts it carries today, and whether a password card was on the page.

## 5. The own-password page

### 5.1 The password entry on the seam (T1)

```ts
/** Every connection kind whose credential is a password, by role. */
export const PASSWORD_SOURCE_KINDS = ['imap', 'apple', 'caldav', 'carddav', 'webdav'] as const;
export const PASSWORD_TARGET_KINDS = ['jmap', 'imap', 'caldav', 'carddav', 'webdav',
  'soverin', 'nextcloud', 'cirrux', 'infomaniak'] as const;
export type PasswordKind = (typeof PASSWORD_SOURCE_KINDS)[number] | (typeof PASSWORD_TARGET_KINDS)[number];

export interface PasswordGrant {
  readonly role: GrantRole;
  readonly kind: PasswordKind;
  /** The fields the person fills, from `credentialFieldsFor(role, kind)`: secret ones, and the ones §5.2 lets them fill. */
  readonly personFields: (stored: Readonly<Record<string, string>>) => ReadonlyArray<PersonField>;
  /** The test: the create door's probe, then the qualification, on the merged config and credentials. */
  readonly test: (a: PasswordTestInput) => Promise<PasswordTest>;
}

export type PasswordTest =
  | { readonly ok: true; readonly secret: StoredSourceSecret; readonly faces: ReadonlyArray<DiscoveryDomain> }
  | { readonly ok: false; readonly category: 'refused_login' | 'unreachable' | 'face_missing'; readonly faces?: ReadonlyArray<DiscoveryDomain> };
```

0171's reserved `tryPassword` is replaced by `PasswordGrant`, and Apple is not special: it is the
`apple` kind with a published endpoint. The two lists are held to `credentialFieldsFor` by a
unit guard: **a kind whose fields carry a `secret: true` password and that is not an OAuth kind
is in one of the lists, or is named in this plan's §13 with its reason.** So a kind added later
cannot be forgotten by the link.

### 5.2 Per kind, what the person fills (T4; D2)

The owner fixes the server and the account; the page shows both and they are not boxes. The
person types the secret, and the fields marked *person* below, which the provider says only the
account holder knows.

| Kind | Role | Owner fixes (shown) | The person fills | The provider's own help on the page |
|---|---|---|---|---|
| `apple` | source | Apple Account address | App-specific password | The steps of `docs/guides/en/apple.md` (account.apple.com → Sign-In and Security → App-Specific Passwords), folded under *How?*; *Not your Apple Account password.* |
| `imap` | source, target | Mail server and port; the mailbox address | Password, or app password | *Use an app password if your provider offers one.* |
| `caldav`, `carddav`, `webdav` | source, target | Server, port or DAV address; user name | Password, or app password | The same. |
| `jmap` | target | Server and port; user name | Password, or app password | The same. |
| `nextcloud` | target | DAV address; user name | App password | Settings → Security → Devices & sessions → *Create new app password* (`docs/guides/en/nextcloud.md:13-20`). |
| `soverin` | target | DAV and mail server; address | Password, or app password | *If Soverin offers you an app password, use it* (`soverin.md:24`). |
| `cirrux` | target | DAV and mail server; address | App password; then **Connect Cirrux Drive** when files arrive there (§4.4) | *Your Cirrux sign-in password does not work here: make an app password on the Passwords tab* (`PASSWORD_HINT.cirrux`). |
| `infomaniak` | target | Sync server, mail server; mailbox address | Sync password; *person:* sync username when the owner left it empty; mail password | Where the sync username is (config.infomaniak.com) and the mail password (the address's Devices tab); *an app password is refused for mail* (`MAIL_LOGIN_HINT.infomaniak`). |

Every box the person fills is `type="password"` with *Show* for secrets, `autocomplete="off"`
for the app passwords a manager would wrongly fill (`new-password` where the descriptor says so),
and the descriptor's own label and hint keys, so the page and the owner's form cannot word the
same field two ways.

### 5.3 The route (T3)

`PUT /api/grant/:link/password`, person links only:

```
{ "ref": "<account ref from GET>", "values": { "password": "…" }, "locale": "nl" }
```

1. `linkAuth`; the link is a person's (a migration's own link answers 404: those were made before
   and expire within 30 days, §13); the organisation is not closed.
2. Body: `Content-Type: application/json` only (anything else 415), at most 4 KiB, `values` keys
   exactly the account's person fields; unknown keys refused, nothing echoed.
3. The per-caller limiter (§7.4) and the account's tries (§5.5): locked → 423 `locked`, no test.
4. Already connected through this link → 409 `already_connected`, no test (a replay tries no
   login, §7.2).
5. The test (§5.4), with the deadline of `DOOR_BUDGET_MS`.
6. On failure: the try counted when the category is `refused_login` (D4), `mapping.grant_refused`
   written, 422 with the category and tries left. Nothing else is written.
7. On success, **one transaction**: the link row locked (`FOR UPDATE`) and checked live again
   (not revoked, not expired, not spent), the secret written (source: each listed migration's
   `source_secret_ref`, merged over what is there, `grant_withdrawn_at` cleared; target: the
   connection's `secret_ref`, merged, and `person_granted_connection`), the qualification
   remembered on the connection, one `mapping.granted` row per migration, the link spent if every
   account is now connected. Revoked between test and write: nothing is written, 401 the one
   sentence.
8. After commit: `startWhenGranted` for the person, as today, and the progress link minted as
   today's ending does.
9. Answer: `{ "connected": true, "faces": [...], "linkSpent": …, "progressUrl": … }`. Never a value.
   *(T3, 2026-11-25: `linkSpent` and `progressUrl` added, so the page can say the link is done
   and hand over the progress page step 8 mints, as a sign-in's ending does. Additions only.)*

**What the route answers and the page reads (T4 wrote them, T3 answers them; settled on one
branch, 2026-11-25).** The route's shape above is unchanged; these are the bodies of the
refusals, which steps 3, 4 and 6 name without spelling them. The route answers exactly these and
the page (`passwordAnswerOf`, `apps/web/src/services/grant-service.ts`) reads exactly these; the
`category` and top-level `left` T4 once also accepted are gone:
- 422: `{ "error": "refused_login" | "unreachable" | "face_missing", "tries": { "left": n, "locked": b }, "faces"?: [...] }`.
  `faces` on `face_missing` names the refused faces.
- 423: `{ "error": "locked" }`. A `refused_login` whose tries are locked, or at 0 left, reads the same.
- 409: `{ "error": "already_connected" }` reads as connected; nothing was tried.
- Every other answer is a refusal with the server's sentence when it sends one, else the page's
  own (`link.unreadable`): 401 at the door (`message`/`messageNl`, `LINK_REFUSAL`); 401
  `link_spent`, revoked while the test ran (`reason`/`reasonNl`, `LINK_SPENT`); 409
  `server_not_a_name` (`reason`/`reasonNl`, T3's `SERVER_NOT_A_NAME`); 400, 413 and 415 carry no
  sentence.

**D3's fields on `GrantServer` (T3, T4; settled on one branch, 2026-11-25).** T1 left D3's
comparison to T3 as optional fields. T3 and T4 named them differently; the shape is T3's, the
facts as the server computes them, and the page reads exactly these, both optional:
- `domains?: string[]`: the registrable domain of each host, in `hosts`' order, set in bold.
  Absent, the page bolds the whole host. It does not guess a registrable domain itself.
- `notTheAddressMail?: string[]`: the hosts whose registrable domain is neither the address's own
  nor one of its MX hosts'. Non-empty shows D3's warning (`grant.password.notAddressMail`); empty
  says every host matches; absent (no comparison, a published server, or a lookup that failed)
  says nothing. A warning, never a refusal.
(T4 had read `registrable` and `addressMail: 'match' | 'mismatch'`; one list of hosts says more
than one word for all of them, so a server with two hosts can be warned about the one that
differs.)

### 5.4 Tested before stored, as the create door tests (T3)

The test is the create door's, called with the merged config and credentials (owner's config +
stored keys + the person's values), never a second implementation:
- `probeSourceConnection(kind, …)` or `probeTargetConnection(kind, …)`, then
- `qualifyAccount` (`account-qualification.ts:470`) for each face the person's migrations on that
  account need (an IMAP target for mail only measures mail).

`ok` only when the probe is ok **and** no needed face answers `no`. A face that answers
`unknown` (the qualification could not take it) is not a refusal: the probe's own verdict
stands, as at the door. Categories:
- `refused_login`: the server answered and refused the credentials (401, IMAP `NO
  [AUTHENTICATIONFAILED]`, the probe's `auth` category);
- `unreachable`: no answer, TLS failure, timeout;
- `face_missing`: login worked, a needed face was refused (Infomaniak's mail with an app password).

The difference from the create door is deliberate: **the door stores a failing row (`status:
'error'`) so the owner can fix it; a link stores nothing that failed**, because nobody but the
person can fix it and they are on the page.

### 5.5 Five tries, then locked (T3; D4, D5)

Per link, per account: five `refused_login` answers lock that account's card on that link. Its
other cards go on. Kept in a managed table (D5 (a)):

```sql
-- packages/managed/migrations/00NN_a_password_tried_on_a_link.sql
CREATE TABLE public.person_link_try (
  link_id uuid NOT NULL REFERENCES public.person_link(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  account_ref text NOT NULL,       -- the card's ref: a hash, never the address
  refused integer NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  PRIMARY KEY (link_id, account_ref)
);
-- RLS: the tenant policies NULL-safe, and `link_sees_itself`'s twin on link_id.
```

The count is incremented with `UPDATE … SET refused = refused + 1 … RETURNING`, so two tabs
racing cannot get a sixth try. A new link starts at zero: that is the owner's remedy, and the
owner's page says *Locked on this link* (§4.6). Five also keeps the person's own provider from
locking their account: Apple and most mail providers lock after more wrong passwords than that.

### 5.6 The password in no log, audit row, response or URL (T3)

- **URL:** the route is `PUT` with a JSON body; the page never builds a query string with a value;
  the link token is in the path, as today (`docs/grant-links.md`: *a key in a URL*), and never
  the password.
- **Logs:** the route logs its category and the account's `ref`, never `req.body`. The probe's
  error is passed through `loggableError` and `probeAnswers` (which already say a remote's answer
  from its parts, 0136 T3). The express error handler and the body parser's error must not print
  the body: a malformed JSON body answers 400 with no excerpt.
- **Audit rows:** the category, the ref, the link id, the via; no value.
- **Responses:** no field of the body is echoed, success or failure.
- **Job payloads:** the start-when-granted job carries ids, as today; the secret is read from the
  row by the pass.
- **Memory:** the values object is not kept past the test and the write; nothing caches it.

**A guard test, not a promise** (`a-password-the-link-never-says.unit.test.ts`, T3): the route is
run over PGlite with both chains and a recorded probe, with a sentinel password, for each
outcome (ok, refused, unreachable, face missing, locked, revoked mid-test, malformed body); it
captures every log line, every `audit_log` row, every response body and header, the
`person_link_try` row, and every column of every row written except the two encrypted
`secret_ref`s, and fails if the sentinel or its base64 appears in any of them. The encrypted
columns are decrypted and must hold it exactly once.

### 5.7 When the test fails (T3, T4)

The page says, in the person's language, by category:

| Category | They read | Then |
|---|---|---|
| `refused_login` | *{server} did not accept this password. Check it and try again. {left} tries left.* For Apple, Cirrux, Nextcloud: *…Make sure it is an app password, not the password you sign in with.* | The form stays, empty. |
| `unreachable` | *{server} could not be reached. This is not your password. Try again in a few minutes; if it keeps happening, tell {askedBy}.* | No try counted. |
| `face_missing` | *Your password works, but {server} refused {faces}. {provider hint}* (Infomaniak mail: *use the mail password, not an app password*). | No try counted; the form stays. |
| locked | *Too many tries on this link. Ask {askedBy} for a new link.* | No form. |

The owner sees the category and the count (§4.6), never the server's words.

### 5.8 Anti-phishing (T4; D3)

A password link is shaped exactly like phishing (ADR-0035 *Consequences*, *"the sharpest edge
here"*). The page answers with what it already has, and two things new:

- **Who sent it:** the organisation's name, the asking member's sign-in address, the
  VIES-checked company name where there is one, and the **organisation's phone number** (set
  under Team & organization → Organization → Phone number), each before any box. When no phone is
  set, the page says *{organisation} has not given a phone number. If you are not sure this link
  came from {askedBy}, ask them some other way before you type anything.*
- **Where the password goes**, new: the server it will be tried against, its registrable domain
  in bold (`imap.**example.com**`), and *Type your password only if this is your own provider's
  server.* For Apple the server is Apple's published one and the line says *Apple's own server*.
- **Who will see it**, new: *Your password is checked once with {server} and stored encrypted.
  Nobody can see it again: not {askedBy}, not {organisation}, not Ownpace's staff.*
- **What Ownpace never does:** *Ownpace never emails you a link and never asks for your
  password by email or phone.*
- **Report this link**, as today, beside it.
- The question from today's page stays: *do you know who asked, and is the destination yours or
  your organisation's? Only then continue.*

**The host the owner typed is the new risk.** A Google or Microsoft link sends the person to
Google's or Microsoft's own page; a password link sends their password to the server the owner
named. A dishonest owner who names a server they run would receive the password at the probe's
login. D3 decides the answer; the advice is (a): the server is shown as above; a kind whose
provider publishes its server (Apple today; Soverin, Cirrux and Infomaniak added to
`PROVIDER_ENDPOINTS` with their published hosts, read from their help pages and cited) is tried
**only** against that server, whatever the row says; a generic kind is tried against the owner's
host, which must be a DNS name (never an IP literal, as `rawIpCallbackRefusal` refuses one for
callbacks) and is refused when it resolves to a private or loopback address. The page asks the
question and the person decides.

### 5.9 The words (T4)

Keys in `apps/web/src/i18n/strings/grant.ts`, both languages in the same pull request; the
`words-that-fit-on-one-line` guard holds.

| Key | English | Dutch |
|---|---|---|
| `grant.group.from` | The accounts your data is copied from | De accounts waaruit uw gegevens worden gekopieerd |
| `grant.group.to` | The accounts your data is copied to | De accounts waarnaar uw gegevens worden gekopieerd |
| `grant.password.title` | Connect {account} with your password | Koppel {account} met uw wachtwoord |
| `grant.password.server` | Your password is checked with {server}. Type it only if this is your own provider's server. | Uw wachtwoord wordt gecontroleerd bij {server}. Typ het alleen als dit de server van uw eigen provider is. |
| `grant.password.apple.server` | Your password is checked with Apple's own server. | Uw wachtwoord wordt gecontroleerd bij Apples eigen server. |
| `grant.password.nobody` | It is stored encrypted. Nobody can see it again: not {askedBy}, not {organisation}, not Ownpace's staff. | Het wordt versleuteld bewaard. Niemand kan het nog zien: niet {askedBy}, niet {organisation}, niet de medewerkers van Ownpace. |
| `grant.password.never` | Ownpace never emails you a link and never asks for your password by email or phone. | Ownpace mailt u nooit een link en vraagt nooit per e-mail of telefoon om uw wachtwoord. |
| `grant.password.noPhone` | {organisation} has not given a phone number. If you are not sure this link came from {askedBy}, ask them some other way before you type anything. | {organisation} heeft geen telefoonnummer opgegeven. Weet u niet zeker of deze link van {askedBy} komt, vraag het dan op een andere manier voordat u iets typt. |
| `grant.password.appPassword` | Use an app password if your provider offers one. | Gebruik een app-wachtwoord als uw provider dat aanbiedt. |
| `grant.password.submit` | Check and connect | Controleren en koppelen |
| `grant.password.checking` | Checking with {server}… | Bezig met controleren bij {server}… |
| `grant.password.connected` | Connected. You can close this page. | Gekoppeld. U kunt deze pagina sluiten. |
| `grant.password.refused` | {server} did not accept this password. Check it and try again. Tries left: {left}. | {server} accepteerde dit wachtwoord niet. Controleer het en probeer het opnieuw. Pogingen over: {left}. |
| `grant.password.refused.app` | Make sure it is an app password, not the password you sign in with. | Controleer of het een app-wachtwoord is, niet het wachtwoord waarmee u inlogt. |
| `grant.password.unreachable` | {server} could not be reached. This is not your password. Try again in a few minutes; if it keeps happening, tell {askedBy}. | {server} was niet bereikbaar. Dat ligt niet aan uw wachtwoord. Probeer het over een paar minuten opnieuw; blijft het gebeuren, laat het dan {askedBy} weten. |
| `grant.password.faceMissing` | Your password works, but {server} refused {faces}. | Uw wachtwoord werkt, maar {server} weigerde {faces}. |
| `grant.password.locked` | Too many tries on this link. Ask {askedBy} for a new link. | Te vaak geprobeerd met deze link. Vraag {askedBy} om een nieuwe link. |
| `grant.password.withdrawn` | Removed here. Change this password at {provider} too, if you want to be sure. | Hier verwijderd. Wijzig dit wachtwoord ook bij {provider} als u het zeker wilt weten. |
| `grant.apple.how` | How do I make an app-specific password? | Hoe maak ik een appspecifiek wachtwoord? |
| `grant.apple.password` | App-specific password | Appspecifiek wachtwoord |
| `grant.apple.password.hint` | Not your Apple Account password: one you make at account.apple.com. | Niet uw Apple-wachtwoord: een dat u maakt op account.apple.com. |
| `grant.continue.dropbox` | Continue with Dropbox as {account} | Doorgaan met Dropbox als {account} |
| `grant.continue.cirrux` | Connect Cirrux Drive | Cirrux Drive koppelen |

The provider-specific help lines reuse the existing `account.*.hint` keys (`credential-fields.ts`)
so the page and the owner's form say the same.

**As shipped (T4, and the six tasks on one branch, 2026-11-25).** The Dutch above says
*koppelen*; the page says *verbinden* / *verbonden*, as the approved Google and Microsoft cards and
the glossary do, and `one-dutch-for-a-grant-link.unit.test.ts` holds it, with the link a
*toegangslink* and a card locked *voor deze link*. `grant.continue.cirrux` is *Cirrux Drive
verbinden*, the owner's own button's words. The table in the pull request is the one to read.

## 6. Dropbox on the seam (T2; supersedes 0171 T4)

As 0171 §3.5 designed it, on the seam that merged:
- an entry `dropbox` with `sourceKinds: ['dropbox']`, `served: facts.dropboxClient`
  (`dropboxDeploymentClient`, `packages/shared/src/dropbox-deployment-client.ts:35`, a new fact
  in `deploymentFacts`), `consentUrl` from `dropbox-consent.ts` (`token_access_type=offline`, the
  read scopes and `account_info.read`; Dropbox takes no login hint);
- `finish`: the code exchanged, then `POST /2/users/get_current_account`; `email` must equal the
  named account without case and `email_verified` must be true, else `another_account` or
  `unconfirmed`, nothing stored, the link live;
- `grantableByLink('dropbox')`, `consentToFollow('dropbox', …)` for `www.dropbox.com`,
  `PROVIDER_WORDS.dropbox` (*Continue with Dropbox as …*, *Dropbox: read your files*), and the
  readiness check's Dropbox tail (the connection's whole pair, else the deployment's, half a pair
  refused, as Google's and Microsoft's).

## 7. Security review points

### 7.1 Brute force

- **The link:** 32 random bytes (§2.3); guessing one is not the attack.
- **The password, with a link in hand:** five `refused_login` per account per link (§5.5),
  durable across restarts and replicas (D5 (a)); the owner's page shows each try.
- **Through us at the provider:** the cap also keeps Ownpace from being the tool that locks the
  person's account at their provider.

### 7.2 Replay

A captured request body is useless without TLS being broken; with the link spent the route
answers the one sentence; while the link is live and the account is connected it answers
`already_connected` **without testing**, so a replay makes no login at the provider and counts
no try. The test and the write are one decision: the link is checked again inside the write's
transaction (§5.3 step 7).

### 7.3 CSRF

There is no ambient credential to ride: no cookie, no session; the link is in the path and must
be known. The route still takes `application/json` only, which a cross-site form cannot send
without a preflight, and the API answers no CORS for `/api/grant`. The page's CSP has
`form-action 'none'` (§2.4), so the password form is never submitted by the browser: the page
calls `fetch`.

### 7.4 Rate limits

- Per caller: `createKnockLimiter` on `PUT /:link/password`, keyed by `req.ip` (with its stated
  caveats: one process, the ingress's address unless `TRUST_PROXY`), sized at 30 tests an hour.
- Per account per link: the five tries.
- Per organisation: the live-link limit already caps how many links can be out.
- Outbound: every test is a connection to a host; §5.8's DNS-name and private-address refusals
  keep the route from being a scanner of our own network (0136's concern).

### 7.5 Link lifetime and revocation

Unchanged presets: 1, 7 or 30 days, spent when every account on it is connected. **Revoke**
stops a password test in flight from being stored (checked in the write's transaction).
Deleting the person deletes their links, their tries and their `person_granted_connection` rows.
Revoking a link does not remove a password already stored: that is the person's *Withdraw*, or
the owner deleting the migration or the account, as for a token today.

### 7.6 Encryption at rest

The product's existing credential encryption, nothing new: `SecretStore.encryptCredentials`
(AES-256-GCM under `SECRET_ENCRYPTION_KEY`, SECURITY.md), the same blob shape the create door
writes, merged key by key. No other copy: not in the try table, the audit log, a job.

### 7.7 What the owner, and whoever runs Ownpace, can and cannot see

| | Owner (and admins) | Whoever runs Ownpace |
|---|---|---|
| The password | Never: no door hands a secret back, the rotation door refuses a person-granted one (D6). | Never through the product. The ciphertext and the key sit on the same machine (§4.1 of the privacy policy says so); the promise stays *"your admin cannot read this"*, never *"nobody can"* (ADR-0035 *Honest about Managed*). |
| That a card is connected, waiting, or locked; the number of tries | Yes | Yes, in the audit log |
| Why a test failed | The category | The category, and the server log's probe category |
| The server's own refusal text | Never (ADR-0035 decision 5: the person's account) | Not stored |
| The account and the server | Yes: the owner set them | Yes |

## 8. Around it

### 8.1 *Start a migration* (T6)

- `grantableByLink(card, served)` answers yes for every password source kind (no deployment
  fact needed) and for Dropbox when served. `ServedFacts.grantProviders` gains `dropbox` and
  `cirrux`; the password kinds need nothing served.
- **The destination step gains the same question** when *They do, with a link* is chosen and the
  destination is a password kind or Cirrux: *Whose account is the destination?* — *Mine, or the
  organisation's: I connect it* / *{person}'s own: they connect it with the link*. The second
  saves the destination with its server and account and no password (§8.2), and the review
  screen says *{person} connects it themselves, with the link you make on the last screen*.
- The last screen's link section counts both roles: *The link asks {person} for 2 accounts: their
  iCloud mail, and their Soverin account.*

### 8.2 An account saved for somebody else (T6)

The create door takes a `forPerson: <personId>` flag (managed only) that:
- accepts the row **without** its secret fields (`credentialFieldRequired` answers false for the
  secret fields when `forPerson` is set, never otherwise);
- does not probe (there is nothing to log in with) and adds **no status**: the CHECK allows
  `connected | error | revoked` (`packages/ledger/migrations/0001_baseline.sql:139`), and waiting
  is an observation of the rows, as `awaitingGrantRefusal` is. The row is stored as a Google or
  Microsoft account saved by its address alone for a link is today (`ready: false`,
  `StartMigration.tsx:221-224`); the build reads which status that path writes and writes the same;
- requires every non-secret field the kind needs (server, account), because the person cannot
  type them (D2);
- writes the `person_granted_connection` row only when the person grants, not now.

The Accounts page shows such a row as *Waiting for {person}*, with no *Test* until it is granted.

**One field on both create doors (settled on one branch, 2026-11-25).** T5 had given the
migration door `personId`, read by its guard only; T6 gave the account door `forPerson`. They are
one idea, the person a thing is made for, so both doors take `forPerson: <personId>`: the account
door as above, and `POST /api/migrations`, where the guard (§4.3) reads it and the save gives the
migration to that person in the create transaction (`person_not_found`, 404, refuses the whole
create). The wizard sends it on both.

### 8.3 Both editions (T7; D7)

**The appliance offers nothing in alpha.21, and says so** (D7 (a)). Reasons: the grant and
progress pages are managed-only and their rows (`person`, `person_link`) are managed (ADR-0036);
an appliance is usually reached on a home or office network, not by the person on their phone;
it serves no CSP yet (0158 T3); and on an appliance the person whose password it is and the
machine that holds it are in one household or office anyway, which is ADR-0035's *"On self-host
the customer's machine holds them"*. The appliance's account forms stay as they are; its guide
says *To let somebody type their own password, use the managed service's grant link; the
appliance has none.* The shared changes (field descriptors, `awaitingGrantRefusal`, the test
function) reach the appliance's code and must not change its behaviour: the appliance's own
tests run in every task.

### 8.4 ADR-0035's amendment, as draft text (T7)

Not applied by this plan; applied by T7 once the owner says yes, with `adr-operative --write`.

> **Operative rules**, fourth bullet, replaced:
>
> - **One link per person** (owner, 2026-09-29, 2026-10-03, 2026-11-25; ADR-0050): a grant link
>   and a progress link for all their migrations, granting per account, source or destination,
>   what the page showed: a sign-in, or the person's own password, tested before it is stored.
>   Replaces the per-migration link; one already sent is honoured until it expires.
>
> **Amendment log**, new entry:
>
> - **2026-11-25** — **Amended**, by the owner (*"I want all sources/targets that supports
>   granting to be able to use the others-grant-page"*; *"1: b"*, *"2: a"*): from alpha.21 a
>   person's grant link also connects **destinations** the person owns, and every account whose
>   credential is a password, through a page where the person types it themselves (workplan
>   0174). The password is tried with the create door's own test before it is stored, five
>   refused tries lock that account on that link, and it is never shown, logged or audited.
>   Category B (decision 3) keeps its meaning: it is a reusable password we hold, now typed by the
>   person and never seen by the owner. *Consequences*' *"the sharpest edge here"* is answered by
>   the page's server line and its Apple, Soverin, Cirrux and Infomaniak pinned hosts (0174
>   §5.8), not removed. The appliance still has no links. Record: *Operative rules*, fourth
>   bullet.

The bullet is 54 words, inside ADR-0051's 60 a bullet, and about nine more than the one it
replaces. The section is near its 300-word budget, so `adr-operative --write` may refuse it;
then T7 shortens another bullet of the section without changing what it says (the reporting
bullet's parenthesis is the likeliest), and says so in the amendment log.

### 8.5 The privacy policy and the terms, as a draft for the owner (T7; D8)

`site/legal/privacy.md` (and `privacy.nl.md`), **§4.1**, the first sentence becomes:

> Whatever is needed to read the source and write the target: an OAuth refresh token, or a
> username with a password or an app password, or a service-account key. A password can be typed
> by you, or by the person whose account it is on a page we show them through a grant link; then
> nobody else ever sees it, you included.

**§4.6**, the family-member bullet, after its first sentence:

> Or, for an account that signs in with a password (Apple, a mail server, a Nextcloud and the
> like), they type that password themselves on the page. We try it once with the server the page
> names, and keep it only if it works, encrypted (§4.1). We count wrong tries on the link, without
> the password, and stop the link for that account after five. We never write the password in a
> log or a record, and we never show it to anybody, you included. They can withdraw it on their
> progress page, which deletes it here; changing the password at their provider makes ours
> useless.

**§9** (retention) gains one row: *the count of wrong tries on a grant link: until the link is
deleted with its person, or your data is erased.*

`site/legal/terms.md` (and `terms.nl.md`), **§5 Acceptable use**, one sentence added:

> A grant link that asks somebody for a password must name their own provider's server: sending
> one that names a server you run, to receive somebody's password, is an attack on them and we
> will close the account.

§1's sentence (a person who grants through a link is not a party) stands. **No version bumps
(D8, answered 2026-11-25):** nobody but the owner has accepted either text, so both change in
place under 1.0 and nobody is asked again (*"terms or the privacy policy: no one but me accepted then, so change them and stay on 1.0"*). T7 re-pins the new words under 1.0 in
`scripts/a-version-the-tester-accepted.unit.test.ts`, with a dated note in its header in the owner's
words, as the re-pin of 2026-10-21 did. Workplan 0173's T5 changes terms §2 and alpha §8 in the
same release, under the same answer.

### 8.6 The guides, the doc and the site (T7)

- `docs/grant-links.md`: the refusal table's *source is not an account a link can connect* row,
  rewritten (every password kind and Dropbox connect; Box, a company's own Microsoft app and
  Google's domain-wide delegation do not); a new section *A password, typed by the person*;
  *What the other person sees* gains the two groups and the server line; *Managing them
  afterwards* gains *Locked on this link*.
- Guides EN and NL: `start.md` (*They do, with a link* now covers every account and the
  destination), and in `apple.md`, `imap.md`, `dav.md`, `jmap.md`, `nextcloud.md`, `soverin.md`,
  `cirrux.md`, `infomaniak.md`, `dropbox.md`: a short *If the account is somebody else's* section,
  as `google.md:10` and :90 have.
- The site: the *Sources* and *Where to* pages' line on grant links (`site/copy.mjs`, both
  languages), checked with `node site/build.mjs --check`.
- `llms-docs` regenerated if the guides it indexes change (`node scripts/llms-docs.mjs --write`).

## 9. The database change

One managed migration, none in the shared chain:
- `person_link_try` (§5.5), D5 (a);
- `person_granted_connection` (§4.3), D1 (a).

Both are managed rows hanging off managed tables and the shared `connection`, as hard rule 5
asks (*"a managed thing hanging off a core table becomes a ROW of its own, never a column"*);
erasure purges both before `person` (`PURGED_TABLES`). T1 writes the migration; whichever task
merges second regenerates nothing (the chain is numbered at merge, the build checks the next
free number).

## 10. The tasks, as pull requests

Sizes: S a day or less, M two to three, L more. Each pull request brings `main` in by merging,
never a rebase, and names this plan's section it builds. The interfaces in §4.1, §4.4 and §5.1
and the route's shape in §5.3 are fixed here; a build that must change one says so in this plan
first.

| Task | Pull request touches | Size | Depends on | Proves it with |
|---|---|---|---|---|
| T1 | `grant-providers.ts` (`targetKinds`, `PasswordGrant`, `PASSWORD_*_KINDS`, facts `dropboxClient`, `cirruxClient`), `grant-link-readiness.ts` (`targetGrantAsk`, `awaitingGrantRefusal` per role), `person-grant-subject.ts` (`role`, `way`, `ref`), `grant.ts`'s GET shape, `start-when-granted.ts` (both sides), the managed migration, `no-managed-leakage` | M | none | Unit: each readiness answer per role and kind; the field guard (every password kind listed); `awaitingGrantRefusal` for a password source, a password target and Cirrux files; the GET shape for a person with a source and a destination. PGlite: the migration on both chains, RLS of both new tables. |
| T2 | `grant-providers.ts`'s Dropbox entry, `dropbox-consent.ts`'s `get_current_account`, `start-plan.ts`, `Grant.tsx` words and host | S | 0171 T3 (merged) | Unit: the binding, unverified email refused, another account refused with nothing stored and the link live, a refused exchange; `grantableByLink('dropbox')`. |
| T3 | `grant.ts`'s `PUT /:link/password`, the test function over the probe and `qualifyAccount`, `person-grant-ending.ts`'s password store for both roles, the try table, the limiter | L | T1's interfaces (may start on them before T1 merges) | Unit on PGlite: each step of §5.3; five refusals lock, the sixth is not tested; `unreachable` and `face_missing` count nothing; revoked mid-test stores nothing; replay tests nothing; the merged secret; the guard `a-password-the-link-never-says`. Integration: Stalwart IMAP and JMAP, a real and a wrong password. |
| T4 | `Grant.tsx` (the two groups, the password card per kind from the descriptors, the anti-phishing block, the states), `i18n/strings/grant.ts` | M | T1's GET shape | Unit: the card per kind (fields from `credentialFieldsFor`, the owner's values shown not editable); `words-that-fit-on-one-line`; UI smoke under the CSP: the form posts by `fetch`, nothing in the URL after a submit. |
| T5 | the `cirrux` entry, `cirrux-consent.ts`'s link ending, `consentToFollow`, `GRANTED_TARGET_FACES` read per role, `person_granted_connection` writes, the create and edit doors' guard, the rotation door's refusal | M | T1 | Unit: the Drive card only after the app password; the ending refused when the workspace differs; another person's migration into a granted account refused; the rotation refused. |
| T6 | `start-plan.ts`, `StartMigration.tsx` (the destination question), the create door's `forPerson`, `credentialFieldRequired`, the person page's lines, `connections.ts` *Waiting for* | M | T1 | Unit: `grantableByLink` per kind; a row saved for a person without secrets, refused without its server; the person page's four lines. UI smoke: *They do, with a link* with an iCloud source and a Soverin destination. |
| T7 | `docs/grant-links.md`, the guides EN/NL, `site/copy.mjs`, ADR-0035 (after D-decisions), `site/legal/*` (after D8) | M | T3–T6 in review; the owner's decisions | `adr-operative --check`, `llms-docs --check`, `site/build.mjs --check`, `leaving-pages-say-what-the-app-says`. |
| T8 | integration cases spanning tasks; `deploy/compose/smoke-managed.sh` | M | T1–T6 | §11. Run by the owner (T9), never dispatched by a build session. |

**What runs at once.** T1, T2 start at once; T3, T4, T5 and T6 start against T1's fixed
interfaces as soon as T1's branch has them (a day), and merge after T1. T7 writes as T3 to T6
review. T8 last. **If time runs short** (D9): T1, T3, T4 with Apple and IMAP sources first; then
password destinations (T5's half and T6); then Cirrux Drive; then Dropbox.

## 11. Proofs

- **Unit**, in each task (§10), including the password guard (§5.6).
- **Integration**, through Testcontainers in CI and `./scripts/local-pg.sh` where no container
  runtime is: the Stalwart fixture (`docs/stalwart-integration-fix.md` followed as written, no
  accounts in `config.json`) for an IMAP source and a JMAP and an IMAP destination; the Nextcloud
  fixture of `deploy/compose/dev.yml` for a CalDAV source and a `nextcloud` destination; each with
  a real password (stored, the migration ready) and a wrong one (nothing stored, a try counted).
- **E2E (managed)**, a new section of `deploy/compose/smoke-managed.sh`, on its demo Stalwart and
  demo Nextcloud: the owner's API makes a person, an `imap` source on the demo Stalwart saved for
  them without a password, and a `nextcloud` destination on the demo Nextcloud saved for them
  without a password; issues the person's grant link; `GET /api/grant/:link` shows two cards, one
  per group, each `way: password`, each naming its server; `PUT` a wrong password for the source
  five times, the sixth answers `locked` without a login (Stalwart's own log shows five, not six);
  a new link; the right passwords for both; both cards `Connected`, the link spent, the migration
  no longer waiting; the API's and worker's container logs, the `audit_log` rows and the try table
  grepped for both sentinel passwords, found nowhere. Run by the owner (T9).
- **What no test here proves**, said in each pull request: a real Apple app-specific password
  against Apple's servers (no test account), a real Dropbox grant, a real Cirrux Drive grant, and
  a real Soverin or Infomaniak login.

## 12. The owner's decisions

**Answered 2026-11-25:** *"All adviced."* Each decision below is taken as advised, (a); D3 with
its addition and D8 in place under 1.0 (*"terms or the privacy policy: no one but me accepted then, so change them and stay on 1.0"*), as their answers say.

- **D1. Where a destination's password is kept.** (a) On the destination account's own row, as
  Cirrux Drive's grant is, with a managed row saying which person granted it, and that account
  refused for anybody else's migration; (b) a new column on the migration
  (`mailbox_mapping.target_secret_ref`), in the shared chain. **Advice: (a).** The account is the
  person's own, one row serves all their migrations into it, it follows the Cirrux precedent, and
  the shared chain stays untouched; the managed row is what stops an owner writing someone else's
  data into it.
- **D2. What the person types.** (a) The owner fixes the server and the account; the person types
  the password, and only the fields the provider says only they know (Infomaniak's sync username
  when the owner left it empty); (b) the person types everything, server included. **Advice:
  (a).** A page that asks a stranger for a server is harder to answer and easier to fake; the
  page can name what it binds to; and the owner set the migration up knowing where it goes.
- **D3. The server a password is tried against.** (a) Shown with its domain in bold; pinned to
  the provider's published server for Apple, Soverin, Cirrux and Infomaniak; for generic kinds the
  owner's host, a DNS name only, never private or loopback, and the person decides; (b) links only
  for kinds with a published server; (c) generic hosts only when the host's domain is the
  account's domain. **Advice: (a).** (b) leaves out IMAP, DAV, JMAP and Nextcloud, half the
  owner's ask; (c) refuses every hosted provider whose server is not on the address's domain,
  which is most of them. The page, the terms' sentence and *Report this link* carry the rest.
  **Answer, 2026-11-25: (a), with one addition.** For a generic kind whose account is an email
  address, the server's registrable domain is compared with the address's own domain and with the
  registrable domains of that domain's MX hosts, read once through the public resolvers Finish's
  MX check already asks (0171 T10). When it matches none, the page adds a line beside the bold
  domain: *This server is not one your address's mail uses, as far as we can tell. Type your
  password only if you know it is your provider's.* (NL: *Deze server hoort niet bij de mail van
  uw adres, voor zover wij kunnen zien. Typ uw wachtwoord alleen als u zeker weet dat het de
  server van uw aanbieder is.*) A warning, never a refusal: a provider may serve IMAP or DAV from a
  domain its MX hosts do not name. A lookup that fails says nothing either way. T3 answers the
  match with the page's read, T4 shows it, T8 proves a match and a mismatch.
- **D4. What counts as a try.** (a) Only the server refusing the login; (b) every failed test.
  **Advice: (a).** A down server or a refused mail face is not a guess at the password, and
  counting it would lock people out for our or their provider's fault.
- **D5. Where tries are kept.** (a) A managed table (one migration, with D1's row); (b) in process
  memory, like the knock limiter. **Advice: (a).** A restart, or a second replica, must not hand
  out five more tries at somebody's password.
- **D6. The owner changing a password the person typed.** (a) Refused, with *make them a new grant
  link*; (b) allowed, and recorded. **Advice: (a).** Otherwise an owner can replace the person's
  password with one they know, and the promise that it never passes through the owner holds only
  until the first rotation.
- **D7. The appliance.** (a) Nothing in alpha.21, said in its guide (§8.3); (b) build links there
  too. **Advice: (a).** It has no person rows, no public address for a phone to reach, and no CSP
  yet; ADR-0035 left it open on purpose.
- **D8. The privacy policy and terms.** **Answer, 2026-11-25: as drafted in §8.5, in place under
  1.0, and nobody is asked again** (*"terms or the privacy policy: no one but me accepted then, so change them and stay on 1.0"*). The options as put: (a) As drafted in §8.5, a new version of each, and **not**
  asked again of existing customers (the change adds a way for the account holder to type their
  own password and a rule against misuse; it takes nothing from anyone); (b) as drafted, and asked
  again; (c) changes. **Advice: (a)**, for the owner to judge: it is the owner's legal text.
- **D9. The order if time runs short.** (a) Password sources (Apple, IMAP, DAV), then password
  destinations, then Cirrux Drive, then Dropbox; (b) destinations first; (c) Dropbox first
  (smallest). **Advice: (a).** It is the case the owner met (a family member's account), and
  Apple has no other way at all; Dropbox is the least used and already has the owner's own
  connect.

## 13. What is not in it

- **A migration's own link** (made before 2026-10-03): no password page. Those links expire within
  30 days of being made; the page they open keeps its sign-in cards.
- **Box, a company's own Microsoft app (`graph`, `oauth2`), Google's domain-wide delegation**:
  category C (ADR-0035 decision 3), organisation-held by design; no person grants them.
- **Gmail's app password** (`gmail`'s `appPassword`): Gmail is granted by Google's sign-in; the
  app password is the owner's fallback for IMAP and stays the owner's.
- **An export archive**: it has no credential (`secretFieldKeys('source', 'archive')` is empty).
- **Withdrawing at the provider** for a password: there is no API for it; the page says to change
  the password there (§5.9).
- **Sending the link**: still the owner's (ADR-0035 decision 2). Ownpace sends nothing.
- **The appliance** (D7).
- **Telling the person which try failed in the server's own words**: categories only (§5.7).

## 14. Open questions

1. Whether Cirrux's API names the signed-in user or workspace on a token, so the Drive grant
   binds to it directly rather than through the stored app password (§4.4). Read
   `https://cirrux.co/help/api` when T5 starts, and cite it.
   **Answered by T5, 2026-11-25:** it names the user (`uuid`, login handle) and the workspace
   (`uuid`, `name`, `type`), never an address; the binding is as §4.4's T5 paragraph says.
2. The published servers of Soverin, Cirrux and Infomaniak, for `PROVIDER_ENDPOINTS` (D3 (a)):
   read and cited per provider; a provider whose page cannot be read stays generic, its host
   shown for the person to judge, as 0171 T10 did for MX hosts.
3. Which status the path that saves a Google or Microsoft account by its address alone writes
   today (§8.2). The CHECK has no *waiting* value and this plan adds none; if the build finds the
   observation cannot be made from the rows, it says so here before writing a shared migration.
4. Whether `probeAnswers` can be handed an error whose text carries the password (an IMAP
   library that echoes the `LOGIN` command): the guard (§5.6) answers it for the recorded probes;
   T3 also reads `imapflow`'s and the DAV client's error paths and says what it found.
   **Answered by T3 (2026-11-25), read in `imapflow` 2.12.2 and this repository's clients:**
   `imapflow` sends LOGIN's password as a `sensitive` argument, and the command it logs and puts
   on an error as `executedCommand` reads `(* value hidden *)` in its place (`commands/login.js`,
   `imap-flow.js`); `imapRefusalDetail` quotes that masked command. The DAV clients' refusals
   carry the method, the status and the body (`davRefusalBody`), and the JMAP probe and session
   loader the status and the body; neither puts a header in an error, and the Basic header is
   built only at the request. So no error path read here carries the password, unless a server
   echoes it in its own body; that text is logged under a reference by `probeAnswers` (0136 T3),
   never answered, and the guard `a-password-the-link-never-says` holds the route to it.
