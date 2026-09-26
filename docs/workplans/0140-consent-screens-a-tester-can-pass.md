# Workplan 0140 — Consent screens a tester can pass

> **In one line:** Provider consent for testers on `ownpace-live`: its own Google OAuth client, test users, Testing or Production, a Microsoft registration ADR and publisher verification, read-only Dropbox scope, Box and Apple as experimental, the sign-in buttons.

## Status — 2026-09-26 (update this block at the end of every session)

**2026-09-26, build: T2 (b), T3 (a), T6 (b) and T7 (b), the consent screens' own lines,
decided by the owner on 2026-09-25 and built on branch
`claude/ownpace-public-readiness-y7orc6-consent-screens-a-tester-can-pass`, not merged.** The owner was asked
*"The rest of group R2 is still Proposed in the plans. Which should I build now, before the first
invitation?"* and chose all three: 0144 T3 (a) and (c), this plan's consent-screen lines, and
0141 T10 (a). This is 0131 §6's group R2, step 7. The branch was built on
`claude/ownpace-public-readiness-y7orc6-read-only-where-it-is-true` (0144 T3), because the lines
sit beside that branch's line in its `ConsentLines` component. That branch merged into `main` as
#1188 on 2026-09-26, and `main` is merged into this one.

The branch carries two commits, in this order, so that T7 (b) can go as its own PR, as §5 item 6
asks:

1. `feat(api): a Dropbox consent that asks only to read (workplan 0140 T7 (b))`: T7 (b) alone,
   with the docs and comments it made false. It touches nothing the web lines touch, and applies
   to `main` by itself.
2. `feat(web): consent screens a tester can pass (workplan 0140 T2 (b), T3 (a), T6 (b))`: the web
   lines and the review's fixes to them. It needs 0144 T3's `ConsentLines` beneath it, which is
   on `main` since #1188.

§3 gives T2, T3 and T6 no letters. The letters 0131 §6 uses are read in §3's order: T2 (a) is
the steps for the tester and (b) the build; T3 (a) is the sentence and (b) the optional
detection; T6 (a) is the two consents and (b) the sentence before *Connect with Microsoft*. T7
carries its own.

- **T2 (b), a reconnect the page can find.** On the Connections page, the row of a connection
  whose kind has a consent button labels its button *Reconnect* / *Opnieuw verbinden*, and it
  opens the same panel. Those are Google's five kinds, Dropbox and Microsoft, read from the
  descriptor's `consent` as the panel already does (`rotateConsent.isGrantKind`), with the
  deployment's app or the connection's own. Every other row keeps *Replace credentials*. The
  label follows the kind, not what the row stores, so a Gmail row that signs in with an app
  password says *Reconnect* too. `failure.authExpired` names both buttons verbatim and leaves
  the choice to the row. EN: *"… On the Connections page, press Reconnect or Replace
  credentials, whichever its row shows, and this will carry on …"*. NL: *"… Druk op de pagina
  Verbindingen op Opnieuw verbinden of Inloggegevens vervangen, welke van de twee er bij dit
  account staat; daarna …"*. The three pins in `LiveProgress.unit.test.tsx` follow the new
  English. The glossary has a row for *Reconnect*. T2 (a),
  the steps, is the owner's to give and is not built, and neither is its step 4's check of a
  second grant link for a source that already holds a grant.
- **T3 (a), open it in Safari or Chrome.** The grant page carries §3's sentence, whole, between
  the sign-in line and *Continue with Google* / *Doorgaan met Google* (`grant.inAppBrowser`). The
  lines under *Connect with Google*, in the wizard and the Connections panel both
  (`ConsentLines`), carry `wizard.google.inAppBrowser`: the same sentence, ending *"…, then
  sign in to Ownpace there."* / *"…, en meld u in die browser aan bij Ownpace."* instead of
  *"The link still works."* It is always shown for Google, on every Google card, and never
  for Dropbox or Microsoft, whose behaviour in an embedded browser §1 does not know. It comes
  after the button there, so the button points at it (`aria-describedby`) and a screen reader
  hears it before pressing.
  `docs/grant-links.md` has the paragraph under "Issuing one" and under "My link says it does
  not work". Not built: the optional user-agent detection. The owner's check from WhatsApp and
  a mail app is still open.
- **T6 (b), the sentence before *Connect with Microsoft*.** §3's two sentences, in both
  languages (`wizard.microsoft.orgApproval`), in `ConsentLines`, so under *Connect with
  Microsoft* on the wizard's *Microsoft 365 account* card and in the Connections panel. The
  button points at it (`aria-describedby`), as it does at T3's line. T6 (a), the two consents, is not
  done, so the second sentence is still Microsoft's documented default as understood in §4.3,
  not a measurement.
- **T7 (b), a consent that asks only to read.** `dropboxConsentUrl` puts
  `scope=account_info.read files.metadata.read files.content.read` on the URL.
  `exchangeDropboxCode` refuses a grant carrying any scope outside those three and
  `sharing.read`, before it checks for a missing one: the refusal names the scope, says to
  remove it from the app, and nothing is stored. This reverses the file's header and the pinned
  "no scope" case on purpose, and both now say why. `sharing.read` is accepted back but not asked
  for (open question 5). T7 (a), the console read, stays the owner's, and the first real consent
  after the change is still to be recorded here.

Guards, shown failing on the unchanged branch:
`apps/web/src/pages/a-reconnect-the-page-can-find.unit.test.tsx` (10 cases, 8 failed; the two
password-row cases passed, as they should), `apps/web/src/pages/a-grant-page-that-names-a-real-browser.unit.test.tsx`
(14 cases, all failed), `apps/web/src/components/a-microsoft-consent-that-warns-an-organisation.unit.test.tsx`
(8 cases, all failed), and two cases in `dropbox-consent.unit.test.ts` (both failed, 4 passed).
Each was then shown to fail by a mutation, each restored: no in-app line beside *Connect with
Google* (8 fail), the in-app line beside every provider (4), the grant page's line below its
button (2), the Microsoft line beside every provider (4), no Microsoft line (4), every row
saying *Reconnect* (2), the old Dutch failure sentence (1), no scope on the Dropbox URL (1),
`sharing.read` asked for too (1), and a write scope accepted (1).

The review's fixes (2026-09-26), each guarded and shown failing before the fix: a Gmail row
with an app password in the T2 guard (2 new cases, both failed on the first build's sentence,
which tied *Replace credentials* to a password); the Connect button's `aria-describedby` in the
T3 and T6 guards (12 cases failed until the buttons pointed at the lines); and
`account_info.read` in the Dropbox URL case (failed while the URL asked for two scopes).

Where the build departs from §3:

- **One place for the lines under a Connect button.** §3 puts T3's line in
  `ProviderConsentPanel`, but the wizard's source step draws its own button, so both lines sit
  in `ConsentLines`, which both doors render, beside 0144 T3's line and under the button's own
  hint. 0148 T2 (a)'s about-line stays where the wizard says what the card is, one line higher,
  and nothing under the button repeats whose app it is.
- **The panel's ending.** §3 says the last sentence reads *"then sign in to Ownpace there"*. It is
  built as the end of the one sentence, in place of *"The link still works."*. The Dutch uses
  the product's *aanmelden* (`login.title`), and names the browser rather than a second *daar*:
  *"en meld u in die browser aan bij Ownpace"*.
- **The Microsoft line with a pair the person typed, too.** §3 does not say, and its guard
  renders the deployment's app. An organisation's consent settings decide for a registration
  of its own as well, and the line says "may".
- **`account_info.read` on the Dropbox URL as well.** §3 names the two file scopes, and the
  build first asked for exactly those, reading `account_info.read` as something Dropbox answers
  beside them. Dropbox's OAuth guide says the opposite: without `include_granted_scopes`, the
  grant holds only the scopes the URL names. The Test's *Measured* line calls
  `users/get_space_usage`, whose scope is `account_info.read` (`users.stone` in Dropbox's API
  spec), so every token from the button would have lost the space-usage figure it has today,
  and §3's *"loses nothing it has today"* would not have held. Dropbox keeps
  `account_info.read` on every user-linked app, so asking for it is never refused. Dropbox's own
  pages could not be reached from the build: the guide's wording was read in a search engine's
  excerpts of it, and each route's scope in `dropbox-api-spec` on GitHub.
- **The failure sentence leaves the choice to the row.** §3 says it names both buttons. The
  first build tied each to a kind of credential (*"or use Replace credentials for a
  password"*), and the labels, chosen by kind, contradict that for a Gmail row with an app
  password.
- **Docs kept true after T7 (b), beyond §3's letter.** `docs/dropbox-setup.md` says what the
  button asks for, and that a token from it cannot run the shared-folder browse; so do two
  bullets of `docs/guides/en/dropbox.md` and of `docs/guides/nl/dropbox.md` (the Dutch guides
  reached this branch from `main` after the first build). `apps/api/docs/openapi.yaml` said
  *"No scope on the URL"*, and comments said Dropbox asks for no scope or that the app's
  permissions are the ask (`CreateMapping.tsx`, `dropbox-token-provider.ts`,
  `mapping-service.ts`, `openapi-spec.unit.test.ts`); the shared-folder browse's comment in
  `routes/migrations/index.ts` now says a button token gets Dropbox's refusal too.
- **The guards read more than §3 names.** T2's also reads the Dropbox and Microsoft rows; T3's
  and T6's also read the wizard, and that the other providers' buttons carry no line.

Expectations changed on purpose: `dropbox-consent.unit.test.ts`'s URL case pinned no `scope`,
and now pins exactly the three read scopes. The three `LiveProgress.unit.test.tsx` pins read the
new English sentence. `Connections.unit.test.tsx` opened the panel by the
text *Replace credentials* in six places whose rows are consent kinds (the required-fields table
over every kind, the consent table, the Google consent run, Gmail's pair, Dropbox's example and
Dropbox's missing field); they now open it by *Reconnect*, the table through a helper that reads
the same descriptor.

Still open from these four: the wizard's `wizard.about.dropbox.more` and the Dropbox setup step
still offer `sharing.read` for the browse, which holds for a pasted token and not for one from the
button (open question 5). A Google row holding a whole-domain service-account key also says
*Reconnect*, by the same rule of kind; its panel takes a new key, but no consent renews one. The Dutch of the four lines and of *Opnieuw verbinden* is this
build's, and nobody has read it against the first tester's screens yet.

**2026-09-24, build: T8 (a) and T9 (a), the labels, built with 0131 T2 (a) on branch
`claude/ownpace-public-readiness-y7orc6-a-card-that-says-it-is-unproven`, not merged.** The Box and Apple account cards carry *Experimental* / *Experimenteel* at
both doors, with the why folded beside the card; so do the Dropbox card and every face of the
Microsoft 365 account. The rest of T8, the hint's and `docs/box-setup.md`'s sentences, is not
built.

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that
every provider an alpha tester connects puts a consent screen or a password between the tester
and the first pass, and that each one has a limit the alpha runs into. Google's client is in
Testing. The operator guides say to register the deployment's Microsoft app as multi-tenant,
which contradicts ADR-0006's operative rule, and nothing in the repository records publisher
verification for it. Nobody has recorded the Dropbox app's status, and its consent asks for
whatever the app carries. Box needs the tester's own Box app, approved by a Box administrator.
The Apple source has never been run against a live iCloud account. The owner's
answers that bear on this are in §2, and the owner asked for Microsoft to be explained (§4).
Nothing in this plan is built. The grant page already links to the privacy policy and the terms,
which Google's in-product disclosure needs. It linked them at paths the site does not serve
(`/privacy` and `/terms`, where the site writes `.html` files). That is fixed in #1137, merged
2026-09-24: the grant page now links the `.html` pages on `www.ownpace.eu`, in the reader's
language (`LEGAL` in `Grant.tsx`).

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137 merged.**
Testers connect on `ownpace-live`, which uses the production Google client, not the OTA stack's
test client, and Microsoft and Dropbox need live's redirect addresses: that is the new T11, done
before any tester connects (§5). T0's test users and T1's Testing-or-Production choice now apply
to the production client. #1137 also corrected the verification checklist's home-page row, so §1
and T1 no longer ask for it.

**2026-09-24, later still: the owner read the Google client's redirect URIs, and this plan had
them wrong.** The client holds two, both the OTA stack's. One is the identity provider's callback
for sign-in with Google. The other is the migration consent's callback, at the shipped path (D5).
§1 and T11 said that the production entry registered on 2026-08-20,
`https://app.ownpace.eu/oauth/google/callback`, still sat on the test client at a path the shipped
route never matches, and T11 asked the owner to remove it. That came from
`docs/google-oauth-verification.md` §4b, which records what was registered on 2026-08-20, not what
the console holds now. §1 and T11 are corrected, with dated notes in §1 and at T11 step 3. The
owner's open choice, *"add one for app.ownpace.eu or create a new oauth-client"*, is answered in
T11: a new client for live, carrying live's consent address. Live's sign-in address goes on it
only if T10 keeps a Google sign-in, because ADR-0041's decision gives production *"exactly one
redirect URI"* (T10). What decides where the client goes is that the publishing status and the
user cap belong to the Google Cloud project, not to a client (Google's model as understood here,
T11). So: a project of its own if live is to leave Testing. While live stays in Testing, as D1
chose, a second client in the test client's project is enough for the alpha. T0, T1, T10, §5 and
open questions 6 and 7 are reworded to match.

**Before the first invitation.** This is the minimum, for 0131 T5's go/no-go (§5):

- T11: live's own Google client, and live's addresses at Microsoft and Dropbox, each reaching
  its consent screen with the owner's own account;
- T1's measurement and choice, then, under T1 (a), T0 for each tester's Google accounts;
- T10 decided (email and password only is proposed, which is live's starting state);
- Dropbox, Box and Apple carry 0131 T2's label (D3).

**Before the first tester of each kind**, and only if one is invited: T2 and T3 for Google, T6's
two consents and its sentence for Microsoft, T7 (a) and (b) for Dropbox, the owner beside the
first Box run (T8), and 0141 T4's walk before the first Apple tester (T9).

**After, or alongside:** T4's ADR and T5's publisher verification (advised to start now, but a
tester does not wait on them), T3's optional in-app detection, and T8's rewording of
`docs/box-setup.md`.

| Task | Status | Notes |
|---|---|---|
| T0 Each Google account a tester connects is a test user of the production client first | ⏳ **Owner**, per tester (D1) | §3. The tester's own account and every account a grant link goes to, listed as test users for the client `ownpace-live` uses (T11). As Google's model is understood here, the list belongs to that client's Google Cloud project, so in the test client's project it is one list for both stacks (T11). |
| T1 Testing or Production for the production Google client | ⏳ **Owner** (D1 chose Testing) | §3. Measure first, on the OTA stack's history; then confirm Testing knowing it costs a weekly reconnect, or publish to Production unverified with the sensitive scopes only. Recommendation stated. The choice also decides T11's project: leaving Testing means a project of its own. |
| T2 What a Google tester is told, and a reconnect the page can find | 🔨 **(b) the reconnect built on branch `claude/ownpace-public-readiness-y7orc6-consent-screens-a-tester-can-pass`, not merged** (2026-09-26). 📋 **(b) Decided 2026-09-25 (owner)**; (a) **Proposed** (D1) | §3. The steps for the tester, and the word on the failure line matching a button that exists. (a), the steps, is the owner's to give. |
| T3 An "open it in Safari or Chrome" line before Google's screen | 🔨 **(a) the line built on branch `claude/ownpace-public-readiness-y7orc6-consent-screens-a-tester-can-pass`, not merged** (2026-09-26). 📋 **(a) Decided 2026-09-25 (owner)**; the optional detection **Proposed** | §3. Google is reported to refuse consent inside an embedded browser (outside knowledge, §1); nothing on the page says what to do. The owner's check from WhatsApp and a mail app is open. |
| T4 An ADR for the deployment's Microsoft registration | 📋 **Proposed**, recommended now (D2) | §4. ADR-0006's operative rule says the multi-tenant app is retired; the code carries a deployment registration whose authority defaults to `common`. |
| T5 Microsoft publisher verification | ⏳ **Owner** (Partner Center), recommended to start now (D2) | §4. It has a lead time, and an organisation's consent policy may depend on it. |
| T6 One foreign organisation and one personal account, before the first Microsoft tester | 🔨 **(b) the sentence built on branch `claude/ownpace-public-readiness-y7orc6-consent-screens-a-tester-can-pass`, not merged** (2026-09-26). 📋 **(b) Decided 2026-09-25 (owner)**; (a) **Proposed** (D2) | §3. Plus the sentence a tester reads before *Connect with Microsoft*. (a), the two consents, is not done. |
| T7 Dropbox: the app's limits read in the console, and a consent that asks only to read | 🔨 **(b) the read-only consent built on branch `claude/ownpace-public-readiness-y7orc6-consent-screens-a-tester-can-pass`, not merged** (2026-09-26). 📋 **(b) Decided 2026-09-25 (owner)**; (a) **Proposed** (D3), the owner's | §3. The limit must be read in the Dropbox App Console, for the app live uses. The code change reverses a pinned test on purpose. |
| T8 Box: experimental, and for organisations with a Box administrator | 🔨 **(a) the label built on branch `claude/ownpace-public-readiness-y7orc6-a-card-that-says-it-is-unproven`, not merged** (2026-09-24). 📋 **Decided 2026-09-24** (D3) | §3. The label is 0131 T2 and is decided. Rewording the guide's "read-only by construction" is **Proposed**. |
| T9 Apple: experimental, with the password's own steps | 🔨 **(a) the label built on branch `claude/ownpace-public-readiness-y7orc6-a-card-that-says-it-is-unproven`, not merged** (2026-09-24). 📋 **Decided 2026-09-24** (D3) | §3. The label is 0131 T2. Never measured against a live account. |
| T10 Which sign-in buttons the alpha offers | 📋 **Proposed** | §3. Email and password only on live's identity provider, unless the owner's own sign-in needs one. 0133 waits on this. The OTA stack's Google client already carries that stack's sign-in address (D5); live's gets live's only if a Google sign-in stays, recorded in ADR-0041 (T11). |
| T11 Live's own Google client, and live's addresses at Microsoft and Dropbox | ⏳ **Owner** (0132 D7, D5), before T0 | §3. A new Google client for live, with its own secret and live's consent address, `https://app.ownpace.eu/api/migrations/google/callback`. Live's sign-in address, `https://id.ownpace.eu/ui/login/login/externalidp/callback`, is added only if T10 keeps a Google sign-in, and then recorded in ADR-0041, whose decision gives production exactly one redirect URI (T10). The test client holds the OTA stack's two and no production address (D5; corrected 2026-09-24, §1). Its project: the test client's is enough while live stays in Testing; a project of its own if live leaves Testing (T1, open question 7). Microsoft and Dropbox get live's two callbacks. Whether they get registrations of their own is open question 8. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, and again on `main` after #1137
merged the same day. Where a claim is about Google, Microsoft or Dropbox rather than about this
repository, it says whether anyone has read it from the provider. For this plan, nobody has read
the providers' documentation. Those pages could not be reached from where it was written, the same
limit `docs/google-oauth-verification.md` states for Google. The owner's own reads of the Google
console are marked where they are used ("Scopes" below, and D5).

### Google

**One client for the deployment.** The managed edition can carry one Google OAuth client
(`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, ADR-0041 option B). A connection on
that client stores only its refresh token. Grant links use the same client when the connection
has no pair of its own (`googleDeploymentClient()` in `apps/api/src/routes/grant.ts`). ADR-0041's
status line records that the client registered on 2026-08-20 is *"the **test (OTA) client**,
with production getting its own client before real customers exist"*.
`docs/google-oauth-verification.md` says: *"The client is currently **External + Testing** with
test users added in advance."* No document records a change since then.

**Two stacks, two clients (0132 D7).** Each stack reads the pair from its own `.env`, so
`ownpace-live` and the OTA stack each carry their own. The same file, §4b: *"**Test and production
get separate clients**, not two paths on one origin."* The client that exists is the test client.
No document records a production client yet (T11).

**What is registered, and where.** The owner read the client's redirect URIs on 2026-09-24 (D5).
It holds two, both the OTA stack's:

```
https://id.ota.ownpace.eu/ui/login/login/externalidp/callback    sign-in with Google
https://app.ota.ownpace.eu/api/migrations/google/callback        migration consent
```

- The second is the shipped route. `callbackUri` in
  `apps/api/src/routes/migrations/google-oauth-routes.ts` builds `/api/migrations/google/callback`
  on `API_URL`. The owner registered it on 2026-09-01 (the header of
  `packages/shared/src/redirect-uris.ts`).
- The first is the identity provider's own address, where Google returns a person who signs in
  with Google. `setup-zitadel.sh` names it for Google as
  `${ISSUER}/ui/login/login/externalidp/callback` in the message it prints when a sign-in provider
  cannot be added, and writes it into `.env` as
  `IDP_UPSTREAM_CALLBACK_URL`, and the app's Redirect URIs page shows it as `social.upstream`
  (`redirect-uris.ts`). So on the OTA stack one client is registered for both the consent and the
  sign-in, which `managed.env.example` allows: *"One Google OAuth client may serve both if both
  redirect URIs are on it."* Whether the OTA stack's `.env` also names it as `IDP_GOOGLE_CLIENT_ID`
  is a value in that `.env`, not in the repository.
- No production address is on it: not `app.ownpace.eu`, and not `id.ownpace.eu`. Live's own
  client carries live's (T11).

**Corrected 2026-09-24.** Until the owner's read, this paragraph said, from workplan 0091 §1 and
`docs/google-oauth-verification.md` §4b, that `https://app.ownpace.eu/oauth/google/callback` was
registered on the test client on 2026-08-20, at a planned path the shipped route never matches.
T11 asked the owner to remove it. §4b records what was registered on 2026-08-20, and its own
warning asks for the `/oauth/…` entries to be replaced with the shipped path. The owner's read
shows the OTA stack's consent entry at the shipped path now. Neither `/oauth/google/callback` entry is among the two the
client holds now, and the production address at the shipped path is not on it either. T11 no
longer asks for a removal. §4b still lists the `/oauth/…` entries as registered on 2026-08-20,
and T11 step 5 adds a dated line there saying what each client holds now.

**What Testing costs, in the repository's own words.**

- ADR-0041, operative rule: *"**Never "External + Testing" for a real migration.** Google expires
  refresh tokens after **seven days** in that publishing status, which reads as a random
  `invalid_grant` weeks in."*
- The same ADR carves out one case: *"the reference deployment's own client, in Testing status
  with listed users, where the population the restricted tier would be imposed on is the owner
  and people they named"*.
- `docs/google-oauth-verification.md`, "Testing vs Production": in Testing, refresh tokens last
  *"~7 days"* and users *"must be added in advance, 100 max"*. In Production, unverified, the
  lifetime is *"normal — until revoked"*, there is *"no pre-registration; ~100 user cap"*, and
  both show the warning screen. The same section adds: *"⚠️ **Both the seven-day expiry and the
  unverified user cap are UNVERIFIED here**"*. Nobody re-read them for this plan either.
- The review added one claim from outside knowledge, marked as unverified: that Google counts the
  unverified cap over the project's whole lifetime and does not reset it. It was not verified.

**What day eight looks like, as the code has it.** The token request fails, and
`google-token-provider.ts` throws *"Google refused the token request (…)"* with Google's body and
the `hintFor` sentence. That sentence names the Testing cause first and tells the reader to *"set
the publishing status to Production (one click) and re-consent"* (0089 T2). `failure-category.ts`
files `invalid_grant` under `auth_expired`. The progress strip shows the category's sentence
first, and the provider's line verbatim under it (`LiveProgress.tsx`):

- EN `failure.authExpired`: *"The connection to this account has expired. Reconnect it on the
  Connections page and this will carry on from where it stopped — nothing is lost."*
- NL: *"De verbinding met dit account is verlopen. Herstel de verbinding op de pagina
  Verbindingen; daarna gaat dit verder waar het gestopt is — er gaat niets verloren."*

So the product does say "reconnect". Two things do not fit:

1. **No button on the Connections page says reconnect.** A new token for an existing connection is
   minted under **Replace credentials** (*Inloggegevens vervangen*). Since 2026-09-08 that panel
   carries the same consent button as the add form (`rotateConsent` in `Connections.tsx`).
2. **The line under the sentence is written for whoever owns the Google client.** A tester cannot
   change a publishing status.

A person who reads a progress link sees `view.failure.authExpired`: *"The connection to your
account needs renewing. Whoever set this up can do it."*

**Test users.** In Testing, only listed Google accounts can consent. That includes every account a
grant link is sent to, such as a family member's, because the link runs the same consent against
the same client.

**Scopes.** The owner read the console's Data Access page on 2026-09-20 and again on 2026-09-23.
Calendar (`calendar.readonly`), contacts (`carddav`) and tasks (`tasks.readonly`) are sensitive.
Drive and every Gmail scope are restricted (`docs/google-oauth-verification.md` §2). That read was
of the test client's project. A client for live in the same project shares that page; one in a
project of its own has a Data Access page of its own, read again (T11). Which class a stack
declares (`GOOGLE_ACCOUNT_SCOPE_CLASS`) is a value in that stack's `.env`, not in the repository,
and live's is set with T1's choice. Through the stack's own
client, a Google account's mail and files faces, and a grant link that asks for them, are refused
unless that value is `restricted` (`providerAccountDomains`, `grant-link-readiness.ts`). The `gmail`
and `google-drive` source cards each ask for their own restricted scope, and that route does not
read the class. A personal Gmail account can also be read with an app password (0089 T7), which
needs 2-step verification on the account (`docs/google-workspace-setup.md`).

**A row #1137 corrected.** `docs/google-oauth-verification.md` §1 listed the application home
page as *"⬜ Not built"*, though the site generator has built it since 0091 T2 (done 2026-08-20).
Since #1137 (merged 2026-09-24) the row reads *"🟡 Built, not yet published on `ownpace.eu`"*. It
is not published on the verified domain because `site/build.mjs` refuses a `--public` build while
the legal pages carry unfilled placeholders, which is 0139's work.

### In-app browsers

The grant page goes to Google by full navigation (`globalThis.location.assign(url)` in
`Grant.tsx`). The wizard and the Connections page open Google in a popup (`window.open` in
`ProviderConsent.tsx`). No text anywhere tells a person what to do if the page is open inside
another app's browser. A search of `apps/`, `packages/`, `docs/` and `site/` for `webview`,
`disallowed_useragent`, "in-app browser" and "open in browser" finds only the desktop packaging
notes (WebView2) and the Google Tasks field `webViewLink`. Opening a grant link spends nothing:
*"Deliberately a GET that changes nothing … Opening is repeatable right up until somebody
actually grants"* (`grant.ts`). So opening it again in a real browser works, but nobody is told
to.

The review states, from outside knowledge, that Google refuses consent in an embedded web view
with *"Error 403: disallowed_useragent"*, while Safari's and Chrome's in-app tabs are allowed.
Which messaging and mail apps fall on which side has to be tried on real phones. Microsoft's and
Dropbox's behaviour here is not known.

### Microsoft

The deployment can carry its own Entra registration, and its authority defaults to `common`
(`MICROSOFT_DEFAULT_TENANT = 'common'` in `packages/shared/src/microsoft-deployment-client.ts`).
`docs/managed-bring-up.md` tells the operator to register it with *"Supported account types:
multitenant + personal Microsoft accounts"*, and `docs/microsoft-setup.md` names the same radio
button in Entra's own words. ADR-0006's operative rule, `docs/adr/OPERATIVE.md` (generated from
it), the ADR register's row for 0006 and `AGENTS.md` still say the multi-tenant app was retired
on 2026-08-09. Publisher verification is mentioned nowhere for this registration: not in either
guide, not in 0114, not in the consent code. §4 explains all of this, because the owner asked for
it.

The consent's redirect address is `API_URL` plus `/api/migrations/microsoft/callback`
(`callbackUri` in `microsoft-oauth-routes.ts`). Live has its own `API_URL`, so whichever
registration live names must carry live's address as well (T11).

### Dropbox

**The deployment's app.** The deployment can carry one Dropbox app (`DROPBOX_OAUTH_CLIENT_ID` and
`_SECRET`, "The deployment's own Dropbox app (2026-09-02)" in `docs/managed-bring-up.md`), with
`files.metadata.read` and `files.content.read` enabled and nothing else. No document records the
app's development or production status, or how many accounts may link to it. The nightly gate
writes `DROPBOX_OAUTH_CLIENT_ID=gatedropboxappkey` into the OTA stack's `.env` when no value is
present (`e2e-managed.yml`, `env-upsert.sh --if-absent`). The repository therefore cannot say
whether the reference machine carries a real Dropbox app. The placeholder stays on the OTA stack
while the gate writes it: 0132 T5, which would take it out, is parked for that stack until it
stops being a demo. Live's `.env` is its own and CI never writes to it (0132 D7, T1b), so live
carries a Dropbox app only if the owner enters one. Its redirect address is `API_URL` plus
`/api/migrations/dropbox/callback` (`dropbox-oauth-routes.ts`), so that app must carry live's
address (T11).

**The consent asks for whatever the app has.** `dropboxConsentUrl` in
`apps/api/src/routes/migrations/dropbox-consent.ts` sets `client_id`, `response_type`,
`token_access_type=offline`, `redirect_uri` and `state`. It sets no `scope`, and the file's header
explains why: *"Least privilege is set once, at the app"*. A test pins this: *"carries the App
key, offline access, the redirect and the state — and no secret, no scope"*
(`dropbox-consent.unit.test.ts`). `exchangeDropboxCode` refuses a grant that lacks a read scope,
and it accepts one that carries more. The same URL is built for the deployment's app and for a
tester's own app (`dropbox-oauth-routes.ts` resolves either). Yet `docs/dropbox-setup.md` calls
read-only *"an enforced guarantee, not a promise in a document"*. That holds only if the app was
created the way the guide says.

Dropbox is ⏳ in the feature matrix. 0055 records its real-endpoint proof as unproven.

### Box

There is no deployment Box app: `GRANT_PROVIDERS` in `packages/shared/src/provider-clients.ts` is
`google`, `dropbox` and `microsoft`. A tester creates their own Box Platform app with the Client
Credentials Grant, App + Enterprise Access and the read scope only. `docs/box-setup.md` §2 adds:
*"CCG apps must be approved by an enterprise admin before any token is minted"*. The wizard then
asks for the client id, the numeric user id and the secret. Box is ⏳ in the matrix (0056).

### Apple

One app-specific password, and no consent screen (`docs/apple-setup.md`). The behaviour of a live
iCloud account is *"not yet measured"* (the same guide, "What is measured, and what is reasoned";
0115). Part 1 of `docs/apple-supervised-run.md`, the live account, is still open. The product
cannot revoke the password. The tester does that at `account.apple.com`, and the guide says so.

### Sign-in buttons

These are separate from the consents above. `managed.env.example` has values for Google,
Microsoft, GitHub and Apple sign-in (`IDP_GOOGLE_*`, `IDP_MICROSOFT_*`, `IDP_GITHUB_*`,
`IDP_APPLE_*`). Its comments say one Google client or one Entra registration may serve both the
sign-in and the migration consent. `setup-zitadel.sh` adds a provider only when its values are
set. It adds Microsoft with `emailVerified: false`, so the identity provider still sends its own
verification mail. The nightly gate writes a placeholder `IDP_GOOGLE_CLIENT_ID` into the OTA
stack's `.env` when none is present, and keeps it there (0132 T5 parks its removal). Live's
`.env` starts from the example, where every `IDP_*` value is empty, so live's identity provider
offers no other provider until the owner sets one. A sign-in provider's redirect address is at the identity provider
(`$JWT_ISSUER/ui/login/login/externalidp/callback`, the table in `docs/managed-bring-up.md` §8b),
which for live is `id.ownpace.eu` (0132 T1d). The OTA stack's Google client carries that stack's
sign-in address beside its consent address (D5).
The privacy policy says nothing about signing in with another provider (review; 0139).

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and then the answer as given, typos included.

**D1 — Google stays in Testing, and the owner adds people by hand.** *For Google: publish the
consent client to Production, unverified, with the sensitive scopes, or keep it in Testing with
testers registered in advance?* — *"Ill add people by hand"*. On the blocker, *the Google client is
in Testing, whose refresh tokens expire after about seven days*: *"I add people, controlled small
test Group."*

D1 was answered about the one client there was. Since 0132 D7, testers connect on `ownpace-live`,
which gets the production client (T11). So D1 is read as: the production client is External +
Testing, and the owner lists each tester's Google account as a test user for it before they
connect (T0). The test client stays with the OTA stack, for the owner's own testing there. What
Testing costs is set out in T1, and the owner confirms it there.

**D2 — Microsoft is explained before it is decided.** *Should the deployment's multi-tenant
Microsoft app get its own ADR, and should publisher verification start now?* — *"Explain"*.

§4 explains, and T4 to T6 follow its advice. None of them is decided.

2026-09-25: the owner decided T6 (b), the sentence before *Connect with Microsoft*, with the
rest of 0131 §6's group R2 (Status, 2026-09-26). T4, T5 and T6 (a) stay undecided.

**D3 — unproven sources are labelled.** *For sources nobody has run against a real account: prove
them first, hide them, or label them experimental?* — *"Label"*.

The label itself is 0131 T2. T7 to T9 cover what else Dropbox, Box and Apple need before a tester
meets them.

**D4 — the size, the length, and who is the gate.** *What is the test: free or paid, for how many
people, how long, in which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On
the blocker, *the test's posture is undecided*: *"Free. A few weeks. No obligations both
sides."* And, asked *what a member and a viewer may do, and whether only an owner or an
administrator may invite*: *"I am the gate for letting people in the test."*

Those are the numbers every cap below is measured against. The caps count provider accounts, not
testers: a tester who also connects two family members' Google accounts counts as three.

**From 0132 D7 — testers on `ownpace-live`.** The owner asked: *"check, can't i just (as a start)
host a 'ownpace-live' as production, next to the current 'ownpace-managed' on OTA-domain? What
would i need to do to keep alle seperate from each other?"* Asked whether that should be the
decision, with testers on `ownpace-live`: *"Yes! The spark has a lot free memory and disk, it will
fit."* 0132 records the whole decision. For this plan it means that every consent a tester meets
runs against the registrations live names, at live's addresses: `app.ownpace.eu` for the consents
(T11), and `id.ownpace.eu` for any sign-in provider (T10).

**D5 — what the Google client holds, and a client for live still to choose (2026-09-24, later).**
*Which redirect URIs does the Google client carry today, and what does live need there?* —
*"1) google redirect URI: Now holds https://id.ota.ownpace.eu/ui/login/login/externalidp/callback
and https://app.ota.ownpace.eu/api/migrations/google/callback
I'll need to add one for app.ownpace.eu or create a new oauth-client"*

Read as: the one client there is holds the OTA stack's two addresses. One is the identity
provider's callback for a sign-in with Google (`id.ota.ownpace.eu`). The other is the migration
consent's callback at the shipped path (`app.ota.ownpace.eu`). It holds no production address.
This is a fact from the console, and it corrects what §1 and T11 said about a `/oauth/…` entry
(the dated note in §1). The choice at the end is open. T11 gives the advice: a new client for
live, with live's consent address, and its sign-in address only if T10 keeps a Google sign-in, in
a Google Cloud project that follows from T1's choice.

## 3. What each task does

### T0 — each Google account a tester connects is a test user of the production client first (owner, per tester)

Before a tester presses *Verbinden met Google*, the owner adds each Google account they will connect
as a test user for the client `ownpace-live` uses (T11). That means the tester's own account, and
every account a grant link will be sent to. As Google's model is understood here, the list sits on
the consent screen of that client's Google Cloud project, not on the client (T11). So while live's
client is in the test client's project, as T11 advises for as long as live stays in Testing, there
is one list for both stacks: an account listed for live can consent through the OTA client too,
and the OTA stack's own test users count against the same limit. The owner keeps that list outside
the repository, and at the end of the alpha removes the testers' accounts (0131 T4). The limit is
100, a figure the repository marks as unverified. At 20 testers with up to four accounts each, that
is 80, which leaves room for about twenty more: the owner's own accounts and anyone else already
listed for the OTA stack. How many that is sits in the console, not in the repository, so the owner
counts it once before the first invitation.

No code, so there is no guard.

### T1 — Testing or Production for the production client (owner)

The choice is made for the client live uses (T11). The test client stays with the OTA stack. The
publishing status is set on the project's consent screen, not on a client (T11). So while live's
client shares the test client's project, one choice covers both stacks. Choosing (b) therefore
means a new client for live in a project of its own (T11).

**Measure first.** This is cheap, and it can change the answer. The only history is on the OTA
stack, through the test client; live has none until its first connection. Read the owner's own
Google connections there:

- Were they made through the deployment's client, or with a client pair of their own?
- When was the current token minted? The repository keeps no mint time as such. The
  connection's `updated_at` is the nearest record, and the owner may know the date.
- Has any pass since failed with `auth_expired`? The run history (`run` and `run_event`, kept 60
  days) keeps each failed pass and its message, where Google's `invalid_grant` would appear.
  Since 2026-09-23, on a stack running that code, so does the operator's log page filtered to
  category `auth_expired` (0129 T2).

If a connection on the test client has run for more than seven days without a reconnect while
that client was in Testing, the figure does not hold for it, and D1 costs nothing. Record the
result here, with the dates.

**Then choose, for the production client.**

- **(a) Keep Testing, as D1 says.** Test users can grant the restricted scopes. This is Google's
  documented behaviour as the repository understands it, and ADR-0041's carve-out assumes it. So
  Gmail and Drive through the consent stay available to listed testers: through the `gmail` and
  `google-drive` cards, and through a Google account or a grant link where live declares
  `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted` (§1). Every Google-sourced migration stops with
  `invalid_grant` about a week after its consent, until the tester reconnects (T2). Nothing is
  lost, and the pass resumes where it stopped. For an account connected through a grant link, the
  person who granted it has to grant again. The warning screen stays.
- **(b) Publish the client to Production, unverified, with the sensitive scopes only.** There is no
  seven-day expiry and no test-user list at Google. The warning screen stays the same, and so does
  the ~100-user cap. Both figures are unverified. The service itself stays invite-only through
  live's access queue, so the owner is still the gate (D4). `GOOGLE_ACCOUNT_SCOPE_CLASS` is left
  blank in live's `.env`, so a Google account offers calendar, contacts and tasks. Gmail comes in by
  app password (0089 T7). Whether an unverified Production client can grant a restricted scope at
  all has not been tried. Try it with one account before relying on it; if it cannot, Drive is out
  of the alpha. As understood, tokens minted in Testing do not change their lifetime when the status
  changes, so every tester reconnects once after the switch. A switch to a new client in a project
  of its own (T11) needs a reconnect too, and it is the same one if both happen together.

**Recommendation: (a) for the alpha, as the owner answered, on three conditions.** It keeps Gmail
and Drive, the parts most worth testing, open to listed testers. The alpha lasts a few weeks, so
a tester reconnects each Google account about three or four times.

1. T2 is in place before the first Google tester.
2. Testers are told that a family member connected by grant link must grant again each week. If
   that is too much to ask of them, testers migrate only their own Google account in the alpha
   (open question 2).
3. **A switch trigger.** If, in the first two weeks, reconnecting is the main thing testers write
   to the owner about, move to (b), with live's client in a project of its own (T11).

Either way, the owner records the choice as a dated update to ADR-0041. The operative rule
*"Never 'External + Testing' for a real migration"* stays, and the update names the alpha as the
exception and says when it ends. The same update records that the production client ADR-0041
asked for now exists, and that live uses it (T11). `docs/google-oauth-verification.md`'s "Testing
vs Production" section says which status the production client has; its home-page row needs no
edit, because #1137 corrected it (§1).

No code, so there is no guard. The evidence is the measurement above, and then either the first
reconnect recorded (a) or the first tester's connection still working on day eight (b).

### T2 — what a Google tester is told, and a reconnect the page can find

**The steps, for the tester.** The owner gives these to each Google tester. They move into a
tester guide once there is one (0144 T1, whose sections 2 and 3 take them). The Dutch text
is written with the first tester's real screens, using Google's own Dutch words as they appear on
them.

1. **Before connecting:** send the owner every Google address you will connect, both your own and
   any family member's you will send a link to. Wait until the owner says they are added (T0).
2. **Connecting:** press *Verbinden met Google*. Google shows a page saying it has not verified
   the app. This is expected during the alpha: open the advanced option and continue to Ownpace.
   Leave every permission ticked (`docs/grant-links.md` already says this to a grant-link reader).
3. **About a week later**, the migration stops with *"De verbinding met dit account is verlopen
   …"*. Under (a) this is expected, and nothing is lost. Open *Verbindingen*, press the reconnect
   button beside the Google account (below), then *Verbinden met Google*, then *Controleren en
   vervangen*. The migration carries on where it stopped. The second line under the message, the
   one about a "publishing status", is for the owner.
4. **A family member's account:** they grant again with a new link. The issuing decision
   (`grantLinkAsk` in `grant-link-readiness.ts`) has no refusal for a source that already holds a
   grant. Whether the rest of issuing and granting accept it was not checked for this plan. T2
   checks it before the step is written down, and if a link cannot be issued, the step says what
   to do instead.

**The build: a reconnect the page can find.** On the Connections page, the row of a connection
whose kind has a consent button (Google, Dropbox and Microsoft, with the deployment's client or
the connection's own) labels its button **Reconnect** / **Opnieuw verbinden**. It opens the same
panel as today. Rows for password connections keep *Replace credentials*. `failure.authExpired`
names that same button in both languages. The category also covers a refused password
(`AUTHENTICATIONFAILED`, `401`, in `failure-category.ts`), whose row keeps *Replace
credentials*, so the sentence names both buttons. This is two string pairs and one branch in the
row. There is no second consent implementation: the panel is `rotateConsent`, unchanged.

**Guard.** `apps/web/src/pages/a-reconnect-the-page-can-find.unit.test.tsx` renders the Connections
row of a Google account connection and of a password connection in EN and NL. It checks that each
row's button label appears verbatim inside `failure.authExpired`, and that the password row still
says *Replace credentials*. It fails today, because the sentence says "Reconnect" and no button
does, and the NL sentence names no button at all.

### T3 — "open it in Safari or Chrome" before Google's screen

**The sentence.** One plain line, always shown. Sniffing for in-app browsers is not needed for
this. It sits above *Doorgaan met Google* on the grant page and under the consent button in
`ProviderConsentPanel`:

- EN: *"If this page opened inside another app, such as a chat or mail app, use that app's
  'Open in browser' option or copy the link into Safari or Chrome. The link still works."*
- NL: *"Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar 'Openen in
  browser' of kopieer de link naar Safari of Chrome. De link blijft werken."*

In the consent panel the last sentence reads *"then sign in to Ownpace there"*, because the
wizard has no link to copy. `docs/grant-links.md` gets the same paragraph under "Issuing one" and
under "My link says it does not work".

**Optional, and not needed for the alpha:** detect the common in-app user agents and show the line
more prominently, with a button that copies the link.

**The check.** Before the first grant link goes out, the owner opens one link from WhatsApp and one
from the mail app they use, on their own phone, and records here what Google did. The full device
list, with the in-app browsers the first testers use, is 0145 T10's walk on two phones.

**Guard.** `apps/web/src/pages/a-grant-page-that-names-a-real-browser.unit.test.tsx` renders
`Grant` and a Google `ProviderConsentPanel` in EN and NL and finds the sentence in each. It fails
today, because no string says it.

### T4 — an ADR for the deployment's Microsoft registration

§4.2 says what it decides and why it has to be an ADR. Once written:

- ADR-0006's first operative bullet is amended in place and its narrative gets a dated update
  pointing to the new ADR;
- `docs/adr/OPERATIVE.md` is regenerated (`node scripts/adr-operative.mjs --write`);
- `AGENTS.md`'s O365 line, the ADR register's row for 0006, `solution-architecture.md` §25 item 1
  and 0026 row 14 say the same thing;
- `docs/o365-setup.md` opens with one line sending managed users to `docs/microsoft-setup.md`.

The number is the next free one, 0050 at the time of writing.

**Guard.** `scripts/a-registration-the-rules-call-retired.unit.test.ts` reads
`microsoft-deployment-client.ts`. While it exports a deployment client whose default authority is
`common`, `docs/adr/OPERATIVE.md` and `AGENTS.md` must not say the multi-tenant app is retired,
and `docs/adr/OPERATIVE.md` must name `MICROSOFT_OAUTH_CLIENT_ID`. It fails today on both counts:
both files say "retired", and no ADR names that variable.

### T5 — Microsoft publisher verification (owner)

§4.3 says what it is and §4.4 why to start now. The steps are the owner's, in Partner Center and in
the *Branding & properties* of the registration live uses (T11), since that is the one testers
consent to. The legal entity's facts it needs are the same ones the owner supplies to 0139. When it
is done, `docs/microsoft-setup.md` and the bring-up section on the deployment's Entra registration
gain one step each, and T6's sentence is read again against the verified consent screen.

No code, so there is no guard. The evidence is the verified badge on the consent screen, recorded
here with the date.

### T6 — one foreign organisation and one personal account, before the first Microsoft tester

**The test.** Two consents, a Test and one pass, on `ownpace-live`, through the registration live
uses (T11):

- a personal Microsoft account (outlook.com, hotmail.com or live.com);
- a work or school account in a tenant that is not the one the registration lives in, and whose
  administrator is not the owner. The first alpha tester who has one is a natural choice, with
  their agreement, and with the owner present.

For each, record the tenant's user-consent setting (read by its administrator), the screens shown,
whether the app was marked unverified, the error code if refused, and whether an administrator's
consent then let the person connect. Record it here and in `docs/microsoft-setup.md` under "When
the consent is refused". That section describes `AADSTS90094` only as a tenant that allows no user
consent at all. If the test shows the publisher is the reason, it says so too. 0114 T9 and T10
remain *"Unmeasured against a live tenant"* until this is done. 0114's green Test was on the
owner's own account.

**The sentence before Connect.** Beside *Connect with Microsoft*, one line in both languages that
holds whether or not T5 is done:

- EN: *"A work or school account may need its organisation's administrator to approve Ownpace
  first. A personal Microsoft account does not."*
- NL: *"Voor een werk- of schoolaccount kan eerst goedkeuring van de beheerder van uw organisatie
  nodig zijn. Voor een persoonlijk Microsoft-account niet."*

The second sentence is Microsoft's documented default as understood here. T6's personal account
confirms it or corrects it before a tester reads it. The sentences shown after a refusal
(`microsoftConsentRefusal` for `AADSTS65001` and `AADSTS90094`) already ask for an administrator.
This line says the same thing before the button, not after the refusal.

**Guard.** `apps/web/src/components/a-microsoft-consent-that-warns-an-organisation.unit.test.tsx`
renders the Microsoft consent with the deployment's client in EN and NL and finds the line. It
fails today.

### T7 — Dropbox: the app's limits, and a consent that asks only to read

**(a) Read the console (owner).** First, does a real Dropbox app exist? The OTA stack's
`DROPBOX_OAUTH_CLIENT_ID` may be the gate's placeholder, which the gate keeps writing (§1), and
live's starts empty. If there is no real app, the owner decides whether to register one for live (open
questions 5 and 8). If there is, and live will use it, read in the Dropbox App Console:

- the app's status, development or production;
- the linked-user limit the console shows for that status;
- the permissions actually enabled;
- the redirect URIs, which must include live's (T11).

Record all four with the date in `docs/dropbox-setup.md` and here. The review gave figures from
outside knowledge: in development, 500 linked users, and two weeks to apply for production once
50 have linked. Nobody read them from Dropbox, so they are not used here. The number that counts
is the one the console shows. Count linked Dropbox accounts, not testers.

**(b) Ask only to read.** `dropboxConsentUrl` adds `scope=files.metadata.read files.content.read`.
`exchangeDropboxCode` refuses a grant carrying any scope outside `account_info.read`,
`files.metadata.read`, `files.content.read` and `sharing.read`, and the refusal names the scope and
says to remove it from the app. This deliberately reverses the file's header (*"No `scope` on the
URL"*) and the test that pins it. The reason: the app's permissions live in a console the product
cannot read, and the guides promise an enforced guarantee. As Dropbox documents the parameter
(not re-read here), it asks for a subset of the app's permissions and cannot widen them. So the
change can only narrow. The pinned test's own comment says a scope list *"could only widen or
narrow them"*; if widening were possible, the refusal at the exchange would still hold the line.
`sharing.read` is not asked for. The bring-up guide tells the operator to enable the two read
scopes and nothing else, so a deployment's app set up that way loses nothing it has today. A
tester's own app is different: `docs/dropbox-setup.md` and the wizard's hint offer `sharing.read`
for the shared-folder browse, and through the button that app would lose it (open question 5).
The first real consent after the change is recorded here.

**Guard.** Two cases in `dropbox-consent.unit.test.ts`:

- the URL carries exactly the two read scopes, which replaces the "no scope" case;
- an exchange whose granted scope includes `files.content.write` is refused, naming it.

Both fail today.

### T8 — Box: experimental, and for organisations with a Box administrator

The card carries 0131 T2's label. Its hint and the opening of `docs/box-setup.md` each gain a
sentence on who the route is for. It needs the tester's own Box Platform app, approved in their
Box enterprise's Admin Console. It suits an organisation with a Box administrator. A household is
unlikely to have one, and whether a personal Box account can complete the steps has not been
tried.

`docs/box-setup.md` §1 says *"Read-only by construction: with only the read scope this product
could not write to a Box even if it wanted to."* The condition is there, but not the half that
matters: the product cannot check which scopes the app has, and the Box connector never reads
them.
The sentence gains that half. That is the same gap T7 closes for Dropbox, but there is no consent
URL here to narrow.

In the alpha, Box is for a tester who is a Box administrator in their organisation, and the first
run is supervised by the owner.

No code, so there is no guard.

### T9 — Apple: experimental, with the password's own steps

The card carries 0131 T2's label. Nothing else is built. The tester's steps are the guide's:

1. Make an app-specific password labelled Ownpace.
2. Paste it once.
3. Revoke it at `account.apple.com` when the alpha ends. The product cannot revoke it for them.

The password opens mail, calendars and contacts over IMAP, CalDAV and CardDAV. Read-only is a
property of the product's connectors, which have no write path (privacy policy §4.1). It is not a
limit of the password, and the tester is told so in those words.

Walking Part 1 of `docs/apple-supervised-run.md` with the owner's own Apple Account, and the first
pass it asks for, is 0141 T4, before a tester who uses the Apple card is granted.

No code, so there is no guard.

### T10 — which sign-in buttons the alpha offers

**Proposed: email and password only.**

- Every tester is invited by address and supported by the owner.
- Each extra button is one more consent screen with its own registration and status. A Google
  sign-in client in Testing admits only its test users. A Microsoft sign-in registration raises
  the same publisher question as §4.
- The privacy policy does not mention signing in with another provider yet (0139).

The exception: if the owner's own sign-in uses one of these providers, it stays, and testers see
it too. The identity provider shows every provider it has to everyone. That is open question 6.

The chosen state is the `IDP_*` pairs in live's `.env`, and live's identity provider's login
policy read back afterwards. Live starts with none (§1), so email and password only means leaving
them empty. Step 7 of 0133 T4 then knows whether a Microsoft sign-in's verification mail is part
of its walk.

If T10 settles on email and password only, live's Google client carries the consent address
alone, and nothing here departs from ADR-0041: `setup-zitadel.sh` adds Google only when
`IDP_GOOGLE_CLIENT_ID` and its secret are both set.

If a Google sign-in does stay, live's client can serve it, as the OTA client is registered for
both on its stack (D5). T11 then adds live's sign-in address at `id.ownpace.eu` beside the
consent's, and live's `.env` names the same pair in `IDP_GOOGLE_CLIENT_ID` and
`IDP_GOOGLE_CLIENT_SECRET` (`managed.env.example`: *"One Google OAuth client may serve both if
both redirect URIs are on it."*). That is a second redirect URI on the production client. The
owner's acceptance of ADR-0041 on 2026-08-26 (its *Decision*, item 2) says production gets *"its
own client — with its own secret and exactly one redirect URI"*, and
`docs/google-oauth-verification.md` §4b repeats it. The rule both state is one client per
environment, and both addresses are production's, so the split between test and production
holds. Still, it changes the words of an accepted decision, so it is recorded as a dated update
to ADR-0041, the one T1 already asks for, and in §4b (T11 step 5). The other way, a second
production client for the sign-in alone, keeps one URI per client at the cost of a second
secret. If a Google sign-in stays, the recommendation is the second URI, the shape the OTA stack
already uses.

No code, so there is no guard.

### T11 — live's own Google client, and live's addresses at Microsoft and Dropbox (owner)

0132 D7 makes `ownpace-live` production, so it is the stack ADR-0041 meant when it said production
gets its own client *"before real customers exist"*. Every console below is the owner's; the exact
strings come from live itself, not from this plan.

**The addresses.** Once live runs with its own `API_URL` (0132 T1b), `GET /api/redirect-uris` on
`app.ownpace.eu` lists every address it needs registered, built from the same variables the code
uses (`packages/shared/src/redirect-uris.ts`). With live's `API_URL` set to
`https://app.ownpace.eu`, the three consent addresses are:

```
https://app.ownpace.eu/api/migrations/google/callback
https://app.ownpace.eu/api/migrations/microsoft/callback
https://app.ownpace.eu/api/migrations/dropbox/callback
```

The same page lists the identity provider's address for a sign-in with Google (`social.upstream`,
read from the `IDP_UPSTREAM_CALLBACK_URL` that `setup-zitadel.sh` writes). With live's issuer at
`https://id.ownpace.eu` (0132 T1d) it is
`https://id.ownpace.eu/ui/login/login/externalidp/callback`, the path `setup-zitadel.sh` names for
Google, Microsoft and GitHub when it cannot add one of them. It is registered only if a Google
sign-in stays (T10).

**Google: add to the test client, or a new client? (D5)** The owner's choice is between adding
live's address to the one client there is and creating a new one. The advice is a new one.
`docs/google-oauth-verification.md` §4b: *"**Test and production get separate clients**, not two
paths on one origin."* One reason the same paragraph gives: *"separate clients also mean a leaked
test secret is not a production incident"*. ADR-0041's status line says the client registered on
2026-08-20 is *"the **test (OTA) client**, with production getting its own client before real
customers exist"*. Adding `app.ownpace.eu` to the test client would put live's consent on the
secret the OTA stack holds, which is what both sentences rule out.

1. Create live's OAuth client: a web client with its own secret, no JavaScript origins (§4b), and
   one authorised redirect URI, live's consent address:

   ```
   https://app.ownpace.eu/api/migrations/google/callback        migration consent
   ```

   Only if T10 keeps a Google sign-in on live, add the identity provider's address beside it, as
   the OTA client carries its own (D5), and record it as T10 says:

   ```
   https://id.ownpace.eu/ui/login/login/externalidp/callback    sign-in with Google
   ```

   Copy each from live's Redirect URIs page once live runs, since Google matches byte for byte
   (§4b).
2. Enter its pair in live's `.env` only (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   and `IDP_GOOGLE_CLIENT_ID` and `IDP_GOOGLE_CLIENT_SECRET` only if T10 keeps a Google sign-in).
   The OTA stack keeps the test client.
3. Leave the test client as it is. It carries no production address (D5), so there is nothing to
   remove. *Corrected 2026-09-24: this step asked for `https://app.ownpace.eu/oauth/google/callback`
   to be removed from the test client; the client does not hold it (§1).*
4. Give live's client the publishing status T1 chooses, in the project chosen below, and list T0's
   test users on that project's consent screen.
5. Record in `docs/google-oauth-verification.md` §4b, with the date: that live's client exists,
   the redirect URIs it carries (and, if T10 added the sign-in address, why two where §4b says
   one, as T10 sets out), what the test client holds now (D5), and the publishing status of each.
   Values never go there.

**Which Google Cloud project, and why it matters more than the client.** A new client separates
the secret. It does not, by itself, separate what testers meet: the publishing status and the
user cap. As Google's model is understood here, those belong to the consent screen, and the
consent screen belongs to the Google Cloud project, not to one client. So do the test-user list,
the scopes on the Data Access page, the branding and the verification. The
repository's own documents follow that model without stating it as Google's rule.
`docs/google-workspace-setup.md` sets the publishing status and the test users on the consent
screen (§2, "The consent screen") before any client is made (§3, "The OAuth client"). The scopes
the owner read on 2026-09-20 were on *"the project's Google Auth Platform → Data Access page"*
(`docs/google-oauth-verification.md` §2). ADR-0041 calls the restricted-scope assessment
*"per-project"*. Nobody re-read Google's pages for this plan, and the repository marks Google's
own figures as unverified: the box "Read this before quoting anything on this page" and the ⚠️
under "Testing vs Production", both in `docs/google-oauth-verification.md`. The first thing the
owner checks in the console is whether the model holds.

If it holds:

- **A second client in the test client's project** is a separate client with its own secret, so
  it meets §4b. It shares the rest with the OTA stack: the Testing status, one test-user list and
  the ~100-user cap (T0). Publishing one to Production publishes both.
- **A new project** gives live its own publishing status, its own list and its own cap. The cost
  is setting the consent screen up once more: branding, the scopes on its Data Access page (read
  and recorded as on 2026-09-20), the APIs switched on for each face
  (`docs/google-workspace-setup.md` §1), and, later, verification (0089 T5).

**Recommendation.**

- **While live stays in Testing**, as D1 chose and T1 (a) recommends, a second client in the test
  client's project is enough for the alpha. Both stacks are in Testing anyway, and at D4's numbers
  the shared list should stay under the cap, which the owner counts once (T0).
- **If live is to leave Testing**, by T1 (b) now or by T1's switch trigger later, live's client goes
  in a new project. Otherwise publishing live to Production also publishes the OTA stack's client.
  Live's cap, and later its verification, would then be shared with the test stack.

Changing client later costs one reconnect per Google account. A refresh token belongs to the
client it was issued to (OAuth 2.0, RFC 6749 §6), and the token request sends the deployment's
client pair with it: `withDeploymentGoogleClient` in `packages/shared/src/google-deployment-client.ts`
fills the pair from `.env`, and `google-token-provider.ts` sends it. That file's `hintFor` already
names *"issued to a different client id than the one configured here"* among the causes of
`invalid_grant`. So a new client pair in live's `.env` means every Google account connected on
live consents again. T1 (b) costs that reconnect already (T1). If the
new project's client replaces the old one at the moment live moves to Production, testers
reconnect once for both, not twice. This is open question 7.

**Microsoft and Dropbox: live's addresses.** Whichever registration live's `.env` names
(`MICROSOFT_OAUTH_*`, `DROPBOX_OAUTH_*`) must carry live's callback, or the consent fails at the
provider with a redirect mismatch. There are two ways to do it:

- **(a) Registrations of live's own**, as for Google. A leaked OTA secret is then not a production
  incident (a reason `docs/google-oauth-verification.md` §4b gives), publisher verification (T5)
  is done on the registration testers meet, and the Dropbox app's linked-user count (T7) holds only
  live's accounts.
- **(b) Live's address added** to the registrations the OTA stack already names, if they are
  real. It is quicker, and it is the same secret on both stacks.

Recommended: (a), for the same reason Google's client is split. Open question 8.

**The check.** On live, *Connect with Google*, *Connect with Microsoft* and *Connect with Dropbox*
each reach the provider's consent screen without a redirect mismatch, with the owner's own
account, before the first tester. Recorded here with the date.

No code, so there is no guard. `GET /api/redirect-uris` already derives the addresses from live's
own values.

## 4. Explaining the risk: the deployment's Microsoft registration (D2)

The owner asked for an explanation before deciding. Four parts: what exists, what the ADRs say,
what publisher verification is, and the advice.

### 4.1 What the deployment's Entra app is today

Since 0114 (2026-09-03 to 2026-09-06), the managed edition can carry one Microsoft app
registration for the whole deployment (`MICROSOFT_OAUTH_CLIENT_ID`, `_SECRET` and an optional
`_TENANT`), just as it carries Google's and Dropbox's.

- **Delegated scopes only, read-only, one per ticked face.** The faces are `Mail.Read`,
  `Calendars.Read`, `Contacts.Read`, `Files.Read` and `Tasks.Read`, plus `offline_access`
  (`MICROSOFT_DOMAIN_SCOPES` in `packages/shared/src/microsoft-scopes.ts`). The person being
  migrated consents for themselves.
- **Authority `common`**, unless the operator sets a tenant. The code's comment explains why:
  *"`common` is that default and it is the one a shared deployment needs"*.
- **Registered as multi-tenant plus personal accounts.** Both operator guides say so. What the
  reference deployment's registration is actually set to is a console setting, not recorded in
  the repository. 0114's status names *"a personal account against an organisational-only
  registration"* as one of three stops on the way to the Microsoft **sign-in** button working,
  so at least one registration was organisational-only for a while. Whether that one is also
  the consent's registration is not recorded (`managed.env.example` allows one to serve both).
- **One per stack, or one for both.** Since 0132 D7 there are two stacks, each reading its own
  `.env`. Whether live names a registration of its own or the OTA stack's with a second redirect
  address is T11's, and open question 8.

The per-customer route stays beside it: the `oauth2` and `graph` cards, where a customer brings
their own registration. That route is still needed for application permissions (shared mailboxes,
reading a whole organisation).

### 4.2 What ADR-0006 says, and why the reversal needs its own ADR

ADR-0006's operative rule is the first thing an agent or contributor reads
(`docs/adr/OPERATIVE.md`, ADR-0038):

> **Each customer registers their own single-tenant Entra app** and consents in their own tenant
> — the central multi-tenant app is retired (2026-08-09). The credential never leaves customer
> custody; deleting the registration is their kill switch.

Its 2026-08-09 update gives the reason. Publisher verification *"turned out to be the expensive
part, an external Partner Center process with lead time that gates every foreign tenant's
consent"*. Under per-customer registration, *"no tenant ever is"* asked to consent to Ownpace's
app (0026 row 14), so verification became moot.

0114 brought back exactly what that rule retired: one registration, owned by the deployment, that
people in other organisations consent to. It did so for good reasons, the same ones ADR-0041 gave
for Google. But no ADR records it. Grepping `docs/adr` for `MICROSOFT_OAUTH`, the deployment
client or 0114 finds nothing. Four problems follow:

- **The rules contradict the code.** An agent that follows `OPERATIVE.md` first, as `AGENTS.md`
  tells it to, is told the registration it is looking at should not exist.
- **The reasoning that dropped publisher verification no longer holds,** and nothing says so.
  `solution-architecture.md` §25 still marks it *"resolved … there is no multi-tenant app to
  verify"*.
- **"The credential never leaves customer custody"** is no longer true for the default button.
  The client secret is the deployment's, not the customer's. The refresh token sits in the
  service's encrypted store, as it does for Google; on the managed edition it did under the
  per-customer model too (0026 row 14 says the managed edition reads the pair and the token from
  the per-connection encrypted store). That is a statement the privacy texts in 0139 have to
  match.
- **`AGENTS.md` rule 7:** decisions go into ADRs, append-only, and a later decision supersedes an
  earlier one; only the operative section is amended in place. A reversal with no ADR at all is
  what the rule exists to prevent.

So T4 is small, and it is only documentation:

- a new ADR that records the deployment-owned registration for the delegated `microsoft` account
  kind;
- it keeps the per-customer registration as the route for application permissions;
- it states the publisher-verification position (§4.4);
- it says which registration production uses, once T11 has settled it;
- ADR-0006's operative bullet is amended in place to point at it.

### 4.3 What publisher verification is, and why it matters

What follows is Microsoft's documentation as understood here. It was not re-read for this plan,
and T6 checks it against real tenants.

**What it is.** A registration is linked to the publisher's Microsoft AI Cloud Partner Program
account. That account's business verification must be complete, and the registration's publisher
domain must be verified in the tenant and match the partner account. Consent screens then show
the publisher's name with a verified badge. Without it, the screen marks the app as unverified.

**Why it matters: an organisation decides who may consent.** Each Entra tenant has a user-consent
setting. Roughly:

- **No user consent.** Only an administrator can consent, whether the app is verified or not.
- **User consent for apps from verified publishers, for permissions the administrator marked as
  low impact.** This is the setting Microsoft recommends. An unverified app needs an
  administrator. A verified app can still need one for any permission the administrator did not
  mark as low impact, and a mailbox read (`Mail.Read`) is not usually among those.
- **User consent for all apps.** Even here, Microsoft has said since November 2020 that users
  cannot consent to a newly registered multi-tenant app from an unverified publisher where its
  risk-based checks apply. An administrator is asked instead.

**Personal Microsoft accounts** (outlook.com, hotmail.com, live.com) have no tenant policy. As
Microsoft documents its default, they see the consent screen with the app marked unverified, and
they can accept. This is the default and must be checked (T6).

**What it means for the alpha.**

- A tester with a personal account can most likely connect.
- A tester with a work or school account will most likely be asked for their administrator.
  Today the product then shows `microsoftConsentRefusal`'s sentence: *"Microsoft requires an
  administrator to approve this application for the organisation before anyone in it can connect
  …"*. In a small business the tester may be that administrator, and can approve once for the
  organisation.
- Verification makes the wall lower. It does not remove it.

### 4.4 The advice

1. **Write the ADR now (T4).** It is a short document, and every day without it the rules tell
   contributors the opposite of what runs.
2. **Start publisher verification now (T5).** It has a lead time, set by the partner account's
   business verification, and nothing in the repository can shorten it. It is the step that makes
   the button usable for organisations that follow Microsoft's recommended setting. It needs the
   same entity facts the owner is already supplying for the legal pass (0139).
3. **Until it is done:**
   - a tester from an organisation asks their administrator to approve, or uses a personal
     Microsoft account;
   - the tester reads that before pressing Connect (T6's sentence);
   - the owner asks each Microsoft tester, before inviting them, which kind of account they have
     and whether they administer it.
4. **Test before the first Microsoft tester (T6):** one foreign organisation and one personal
   account. Until then, what §4.3 says about Microsoft's defaults is reasoning, not measurement.

## 5. Order

1. **T1's measurement**, on the OTA stack's history, **then T1's choice**. The measurement is
   cheap and decides T1.
2. **T11**, once live runs with its own `API_URL` (0132 T1b): live's Google client created with
   T1's publishing status, in the project T1's choice points to, and live's addresses at Microsoft
   and Dropbox. Before any tester connects, and before T0, because the test users are listed for
   that client's project.
3. **T0 for the first testers**, and **T2 and T3**, before the first Google tester.
4. **T4 now**, as its own documentation PR. **T5 started now** by the owner, on the registration
   T11 settles.
5. **T6** before the first Microsoft tester.
6. **T7 (a)** now, because it is a console read. **T7 (b)** as its own PR, before the first
   Dropbox tester.
7. **T8 and T9** with 0131 T2's labels.
8. **T10** decided before the first invitation. The gate's placeholders are the OTA stack's, and
   stay there while it is the demo (0132 T5); live never has them.

0131 T5 (go/no-go) carries this plan's minimum:

- live uses the production Google client, and Microsoft and Dropbox carry live's addresses (T11);
- each tester's Google accounts are listed as test users of the production client (under T1 (a));
- testers know about the reconnect;
- a Microsoft work or school tester knows before pressing Connect what their organisation may ask;
- Dropbox, Box and Apple carry the label;
- T10 is decided.

The gates before the first tester of each kind (T2 and T3 for Google, T6 for Microsoft, T7 for
Dropbox, the owner beside the first Box run in T8, and 0141 T4 before the first Apple tester) are
part of the minimum only when such a tester is invited. 0131 T5's row for this plan names T11,
T1 with T0, T10, the reconnect and the Microsoft sentence; the rest of those gates are listed here
and in the Status block.

## Not in this plan

- The label itself and the table behind it: 0131 T2.
- Live runs that would move a source from experimental to proven: 0141, where Apple's Part 1 and
  first pass are T4.
- Standing up `ownpace-live` with its own `.env`, identity provider and production names: 0132
  T1b to T1e.
- Removing the gate's placeholder client pairs from the OTA stack: 0132 T5, parked with 0026 row
  24 while that stack is the demo.
- The identity provider's verification mail: 0133.
- The privacy policy's sentences on sign-in providers and on who holds a Microsoft credential:
  0139. The grant page's legal links are fixed in #1137, merged 2026-09-24.
- The grant page's "Read-only" box sitting above a scope Google describes more broadly: 0144 T3.
- The in-app guides that still tell managed testers to create their own Google or Dropbox app:
  W15, which the owner answered the same day (*"Contradict: self-hosters need to make those, but
  endusers dont, or not in the ownpace-managed deployment. Stop the false hints on managed."*) and
  which 0148, *A guide written for the person using it*, plans (its T2). The sentences T2 and T6
  to T9 write for a tester land in 0148's customer guides once its T1 has split them from the
  operator documents, and T2's steps also go into 0144 T1's tester guide. Records read from a
  console (T7 (a), T11) stay in the operator documents.
- A consent popup that Safari may block because `ProviderConsent.tsx` opens it after an awaited
  call (reported by the review, not verified: nothing runs WebKit): 0145 T0 checks it and T5 opens
  the window on the press. A full device list: 0145 T10.
- Google's verification submission and the restricted-scope assessment: 0089 T5 and ADR-0041,
  unchanged.

## Open questions

1. **Google (T1): (a) or (b), for the production client?** The recommendation is (a), with its
   three conditions and the switch trigger. Whether alpha testers are the "real customers" before
   whom ADR-0041 says production gets its own client no longer needs an answer: 0132 D7 makes
   `ownpace-live` production, and it gets its own client (T11).
2. **Grant links in the alpha under (a):** may testers send them to family members, who must then
   grant again each week, or do testers migrate only their own Google account during the alpha?
3. **Microsoft (T4, T5):** write the ADR and start publisher verification now, as advised?
4. **Microsoft testers from organisations:** accept the administrator's approval as the route
   until T5 is done, or take only personal Microsoft accounts until then?
5. **Dropbox (T7):** if there is no real Dropbox app, register one for live, or leave the Dropbox
   card to testers' own apps? And should the consent also ask for
   `sharing.read`, so the shared-folder browse works? That means enabling it on the deployment's
   app, and it keeps the browse for a tester's own app that already has it.
6. **Sign-in buttons (T10):** email and password only? And does the owner's own sign-in use a
   provider that must therefore stay? The OTA client carries a sign-in address (D5), which
   suggests a Google sign-in was set up or tried on the OTA stack. The repository cannot say
   whether it is in use. If it is Google on live too, live's client carries the sign-in address
   beside the consent's, recorded in ADR-0041 as a second redirect URI, or a second production
   client carries it alone (T10, T11).
7. **Live's Google client (T11, D5):** a new client, as advised, rather than live's address on the
   test client? And its Google Cloud project: the test client's while live stays in Testing, and a
   new one if live is to leave Testing, as recommended? Or a new project from the start, which
   costs setting the consent screen up again but spares a reconnect if T1's switch trigger fires?
8. **Microsoft and Dropbox for live (T11):** registrations of live's own, as recommended, or live's
   address added to the registrations the OTA stack names?
