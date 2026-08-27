# Workplan 0089 — a consent you can click

## Status — 2026-08-20 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The authorization-code flow, against the customer's own client | ✅ **Done 2026-08-26** | Two routes and a wizard button, exactly as planned. `google-consent.ts` carries every load-bearing constraint as code, each proved by breaking: the `state` is an HMAC-signed, SINGLE-USE (take deletes — reusing one turns a test red), ten-minute id whose secret half waits in process memory and is never in a URL or at rest; `access_type=offline` + `prompt=consent` are pinned on the URL; the granted scope is READ off the token answer and a narrower grant refuses with the missing scope named (making it accept turns a test red); the result page postMessages the token to the configured web origin and never `*`, degrading to copy-paste when none is configured. The wizard's **Connect with Google** button sits beside the fields (which stay), waits for the client id+secret, and the popup's answer lands in the SAME field a pasted token uses — origin-gated (trusting any origin turns the reachability walk red), stored through the same encrypted path (ADR-0037, no special case). `docs/google-workspace-setup.md` steps 3–4 now lead with the button and keep the manual path; the "It is planned" sentence stopped being true and was replaced. |
| T2 The seven-day trap, named everywhere it bites | ✅ **Done 2026-08-26** | `hintFor` in `google-token-provider.ts` now names the External+Testing seven-day expiry FIRST — most likely cause for a recently set-up personal account, and the only one with a one-click fix (publishing status → Production) — before the legacy three. A unit test pins the words, the ordering (seven days reads before "revoked"), and that the hint never says "enable IMAP" (always-on since March 2025, toggle removed). The manual already carried it (T3). |
| T3 The manual's front door | ✅ **Done 2026-08-20** | `docs/google-workspace-setup.md` now branches on *whose account is it* before anything else, and the Internal/External/Testing choice is made for the reader rather than explained to them. |
| T4 The grant link opens a consent screen | ✅ **Done 2026-08-27** — built as [workplan 0108](./0108-the-link-that-grants.md), all five tasks | ADR-0035's link, made real: the migrated person consents in their own browser and the owner never touches their credential. The design: a persisted, hash-at-rest, revocable `mapping_link` row; a middleware that grants nothing; the same consent flow with a link-authenticated beginning and a server-side-stored ending (no browser ever sees the token); decision 4's per-mapping credential home. |
| T5 The managed client | 📋 Unblocked — [ADR-0041](../adr/0041-who-owns-the-oauth-client.md) **accepted 2026-08-26** (as proposed; Drive's assessment intended later; the 2026-08-20 client is the test/OTA one, production splits off before real customers) | First gate, still open: the carddav/caldav scope classification (owner's browser — decides whether the cheap slice is cheap). Contacts and calendar first, mail and files only after an assessment is paid for. Managed-only secret; `no-managed-leakage` is the guard. The submission checklist is [`docs/google-oauth-verification.md`](../google-oauth-verification.md); privacy policy, terms, support address and logo are drafted (0086 T5). |
| T6 A callback for a box reached at an IP | ✅ **Done 2026-08-26** (the no-forward-no-DNS case stays open as planned, both candidates unverified) | `rawIpCallbackRefusal`: the authorize route refuses a non-loopback IP-literal callback BEFORE Google's screen, naming both supported shapes — forward a port and register `http://localhost:<port>/…` (loopback is permitted, and deliberately so: the remedy depends on it), or give the box a hostname (the objection is the IP literal, not the network) — and that the paste-a-token path keeps working meanwhile. The manual's redirect-URI step carries the same two shapes in the same words. | Google forbids raw-IP redirect URIs, so a box browsed at `https://100.97.25.131:3123` needs either a **hostname** (an `A` record at that address is legal — Google never resolves it) or a **port-forward to loopback**. Both are documentation, not engineering, because the appliance uses the customer's own client and so the customer registers their own URI. Only the case where neither is available stays open. |
| T8 "Use Ownpace's connection" as a choice in the managed wizard | 📋 Planned (needs T1, T5) | The owner registered a client 2026-08-20. Two named options on the credentials step, the managed one only in managed builds. Config decisions in [`docs/google-oauth-verification.md`](../google-oauth-verification.md) §4b. |
| T7 Personal Gmail by app password, opt-in | ✅ **Done 2026-08-27** — its precondition landed the same day | The ceiling was verified first, as the plan required: **2 500 MB/day, equal across app passwords and XOAUTH2** (0090 T1), and 0090 T2–T4 shipped the meter — so this second on-ramp points at a **counted** cap rather than the uncounted one the plan warned about. `appPassword` is its own credential key, not a reuse of `password`: the credential's SHAPE is the choice, exactly as `serviceAccountKey` selects domain-wide delegation, so there is no mode flag that can disagree with what is stored and nothing can confuse it with `clientSecret`. **Never the default is a property of the code**, not a promise in a form — `buildGmailSourceFrom` reaches the app-password branch only when DWD is absent AND the OAuth trio is incomplete, so an account carrying both keeps the narrower credential and no interface redesign can quietly reverse that. The **byte meter rides both paths to the same endpoint**, which is what makes "the ceiling belongs to the endpoint, not the credential" true rather than asserted. The five presentation rules are all in place: never offered for Calendar, Contacts or Drive (an app password is an IMAP credential — offering it there would be offering something that cannot work); **Google's discouragement quoted rather than warmed up**, in the field hint, the API refusal and the manual; **2-step verification named as the prerequisite** so it surfaces before the attempt instead of as an unexplained authentication failure hours later; **where it is revoked** — one row in the account's own app-password list, without Ownpace, which is the one real advantage and the honest reason the path exists; and **nothing anywhere says "enable IMAP"** (always-on since March 2025), pinned by a test. It is also described as the **wider** credential, not the narrower one — an app password opens the whole mailbox where a consented token opens one scope — because the reverse is what a reader would assume. Proofs by breaking: the app password preferred over OAuth → 1 red; a blank value accepted → 1; the discouragement dropped → 1; the meter dropped on that path → 1; the endpoint drifting → 1. |

## Why this exists

The owner added a Google Workspace contacts source and found the setup manual *"way too complex
and full of failure and banners"*, asking why it could not be a consent popup or an app
password.

Three findings, and the first is the one that makes this plan cheap.

**Ownpace has no OAuth flow at all.** `redirect_uri`, `authorization_code`, any callback route
— none of them appear anywhere outside built `dist` bundles. The product only ever *consumes* a
refresh token, and `docs/google-workspace-setup.md` §4 accordingly sends the operator to
Google's **OAuth Playground** to mint one by hand. Nothing forces that. The wizard can run the
authorization-code round-trip itself, against the customer's own OAuth client, with no change to
custody: same client id, same secret, same token, three fewer steps and no developer tool.

**An app password works for personal Gmail, and for nothing else.** Contacts go over CardDAV —
`packages/orchestration/src/google-dav-source-factory.ts:51` requests
`googleapis.com/carddav/v1/principals/…` under `.../auth/carddav` — and Google's CardDAV and
CalDAV endpoints have been OAuth-only from the start; Drive has no password protocol at all. Mail
is the exception, and cheaply: the Gmail source is *already* IMAP
(`gmail-source-factory.ts:218`), `imapflow-source.ts:129–132` already carries the plain-password
branch, and `'imap'` is already a connection kind — so it is a credential choice, not a
connector. Google keeps app passwords as the documented fallback *"als Inloggen met Google niet
beschikbaar is voor de app"* while calling them *afgeraden*; that word travels with the feature.
[ADR-0041](../adr/0041-who-owns-the-oauth-client.md) carries both citations and the
account-password-vs-app-password distinction that this repository got wrong twice in one
sitting.

**And the banners are mostly self-inflicted.** The manual already says Internal skips
verification entirely; a Workspace account that picked External gets the unverified warning for
no reason. Worse, and undocumented: **External + Testing expires refresh tokens after seven
days**, so a months-long migration dies weekly with `invalid_grant` — a cause the manual's own
list of four does not mention.

Who owns the OAuth client is a separate question with money attached, and it is
[ADR-0041](../adr/0041-who-owns-the-oauth-client.md). **Everything in T1–T4 and T6 is
independent of how that lands**, which is why the plan is ordered this way.

## T1 — the authorization-code flow, against the customer's own client

Two routes on the API, following the shape of `/google-drive/shared-drives`
(`apps/api/src/routes/migrations/index.ts:857`) — which already accepts credentials in a request
body, calls Google with them, and stores nothing:

- `POST …/google/authorize` — takes `clientId`, the scopes the chosen domains need, and returns
  Google's consent URL with `access_type=offline`, `prompt=consent` and a **signed, single-use,
  expiring `state`** carrying the draft mapping's identity. Without `access_type=offline` Google
  returns an access token only, which expires in an hour and cannot be renewed — the manual
  already warns about this and the code must not be able to forget it.
- `GET …/google/callback` — validates `state`, exchanges the code with `clientId` +
  `clientSecret`, and hands back the refresh token to be stored through
  `SecretStore.encryptCredentials` exactly as a pasted one is (ADR-0037: one credential store,
  no special case).

In the wizard (`apps/web/src/pages/CreateMapping.tsx`, credentials step): a **Connect with
Google** button beside the existing three fields. The fields stay — an operator with a token
already can still paste it, and the appliance's file-configured path is untouched.

**Constraints, all load-bearing:**

- **`state` is a signature, not a nonce in a map.** A callback is a public endpoint; anything
  that trusts an unauthenticated parameter is a mapping-hijack. Single-use, short expiry, bound
  to the session that started it.
- **The `clientSecret` is never in a URL, a redirect or a log.** Only in the token-exchange
  POST body.
- **The granted scope is reported, not assumed.** Google may grant narrower than requested —
  `scripts/drive-export-stability.ts` already reports what was actually granted, and this flow
  should refuse with the difference named rather than storing a token that will fail later at
  a confusing place.
- **No new secret at rest.** The customer's client id and secret already live where they live.

**Cost:** one endpoint pair and a button. Everything it needs — token minting, the credential
store, the refusal vocabulary — exists.

## T2 — the seven-day trap, named where it bites

An External app in **Testing** publishing status has its refresh tokens expired by Google after
seven days. The migration then fails with `invalid_grant`, weeks after anyone was thinking about
consent screens, and the current refusal lists four other causes.

- Add it to the refusal, **first**, because it is the most likely cause for a
  recently-configured personal-account source and the only one with a one-click fix (publishing
  status → Production).
- Add it to the manual (done in T3).
- While there: **never suggest "enable IMAP" as a cause for a personal Gmail.** Google made IMAP
  always-on in March 2025 and removed the toggle, so that advice sends someone looking for a
  setting that no longer exists.
- A unit test asserts the refusal text names it — the house pattern for
  a refusal that has to keep saying a specific thing.

**Cost: one sentence and one test.** The cheapest item in this plan and probably the highest
value per character.

## T3 — the manual's front door ✅

`docs/google-workspace-setup.md` opened with a Cloud-console walkthrough that assumed a Workspace
admin, and buried the Internal/External choice — the one that decides whether the reader sees
warning banners at all — in the middle of section 2.

It now branches on **whose account is it** in the first screen of text, and makes the consent
screen choice for the reader:

- **Workspace account, same organisation** → Internal. No verification, no banner, no test-user
  list. This is most readers and it is free.
- **Personal Google account** → External, and **publish to Production**, accepting the
  unverified warning once, rather than leaving it in Testing where tokens die weekly.

Both paths then converge on the same steps. The `invalid_grant` list gained the seven-day cause,
and DWD moved out of the front matter to its own section, since it is the opt-in second mode
(ADR-0033) rather than something a first-time reader must decide about.

## T4 — the grant link opens a consent screen

[ADR-0035](../adr/0035-who-signs-in-and-who-gets-a-link.md) already decided the model: *"the
owner decides who gets a link to manage and **grant** their own migration"*, and *"only the
migrated person holds their own source credential, never the organisation."*

T1 is what makes that sentence true rather than aspirational. Today, "grant your own migration"
means sending someone a five-section manual and asking them to send back a refresh token —
which, done over chat, is precisely the transport this project exists to avoid. With T1, the
link opens a consent screen in their own browser and the token lands encrypted without the owner
ever seeing it.

Needs one addition beyond T1: the flow must be reachable by a **link holder** rather than only
by an authenticated owner, which is a different auth path and the reason this is its own task.

## T7 — personal Gmail by app password, opt-in and honestly labelled

The one Google product with a path that skips OAuth entirely. Nothing new to build in the
connector: `imapflow-source.ts:129–132` picks `pass` over `XOAUTH2` on `authType`,
`gmail-source-factory.ts:218` already points at `imap.gmail.com:993`, and `GmailFolderView` —
which drops the `\All`, `\Flagged` and `\Important` views so nothing duplicates — sits outside
the auth decision. Same folders, same Message-ID natural key, **no fidelity loss**.

**One thing this task must not be allowed to claim, though.** An earlier draft called the
throughput ceiling "neutral" because Gmail's IMAP bandwidth limit (believed ~2,500 MB/day
download) belongs to the endpoint and so already governs today's OAuth path. That is probably
true and it is **not** reassuring: checking it found that nothing in this repository counts
bytes at all, and no IMAP source consumes a rate budget of any kind. The penalty for exceeding
it is reported to be a temporary account lockout — the customer losing access to their own live
mail, during their migration. That is [workplan 0090](./0090-the-cap-we-do-not-count.md), it
affects shipped code rather than this proposal, and **T7 should not ship before 0090 T1 has
verified the number** — including whether the ceiling differs by credential type, which would
change this task's value in either direction.

What the task is actually about is how it is *presented*:

- **Never the default**, and never offered to a Workspace account, where app passwords are
  withdrawn or admin-disabled and Internal consent is free anyway.
- **Google's own discouragement quoted**, not paraphrased into something warmer. A reader who
  would rather use a consent screen should be able to see that we agree with Google.
- **2SV is a prerequisite** — no 2-step verification, no app password — and the refusal should
  say that rather than reporting an authentication failure.
- **Say where it is revoked:** the account's own app-password list, one row, without touching
  Ownpace. That is a real advantage over a refresh token and worth stating.
- **Do not tell anyone to enable IMAP.** Always-on since March 2025, toggle removed.

Its strategic value is narrowing the expensive question: with contacts and calendar *sensitive*
and personal mail able to skip OAuth, **Drive becomes the only product for which an assessment
could ever be worth buying.**

## T8 — "use Ownpace's connection" as a choice, not a hidden default

The owner registered a Google client on 2026-08-20 (External, 100 users), which turns T5 from a
hypothetical into a configuration. What is left is the *choice*, on the wizard's credentials
step, between two named options:

- **Use Ownpace's connection** — one click, Google's consent screen, nothing to register. Only
  offered in managed builds, because the appliance has no client secret and never will
  (ADR-0041, guarded by `no-managed-leakage`).
- **Use my own Google client** — today's path, kept as a first-class option rather than a
  fallback for experts. It is the one that leaves revocation entirely in the customer's hands:
  delete the client and every token dies, without asking us. **Say that where the choice is
  made**, since it is the real trade and the customer cannot otherwise see it.

The stored shape is the same either way — a per-user refresh token encrypted through
`SecretStore.encryptCredentials` — so this changes which `clientId`/`clientSecret` the exchange
uses and nothing downstream. The managed client's secret is configuration in
`@openmig/managed`, never a column on a connection.

**Two constraints inherited from ADR-0041**, both easy to get wrong in a wizard:

- The scopes are shown **as scopes**, not summarised, whichever option is chosen.
- The option list must state which object types the managed client actually covers. Offering it
  for Drive before the assessment exists produces a refusal at Google's consent screen, which
  is the worst place to discover it.

## T5 — the managed client (blocked on ADR-0041)

Contacts and calendar first — *sensitive* scopes, brand verification only. Mail and files stay
bring-your-own until a third-party security assessment is actually paid for, because they are
*restricted*.

The classification of `.../auth/carddav` and `.../auth/caldav` specifically is **unverified**
and is the first thing to check when this task starts; it decides whether the cheap path is
cheap. `support.google.com` is blocked by this sandbox's egress proxy, so it could not be read
while writing this plan.

The secret is managed-only. `no-managed-leakage` already walks the appliance's transitive import
graph and would catch a regression, so the guard is free — but the assertion should be written
explicitly rather than resting on the absence of a mistake, the same reasoning as workplan
0088's T4.

## T6 — the appliance without a loopback browser

Google will not accept a raw IP address as a redirect URI, and the owner browses to their
appliance at `https://100.97.25.131:3123`. So T1's callback needs somewhere to land.

**The problem is smaller than this task first framed it**, and the reason matters. ADR-0041 says
the appliance never uses an Ownpace client — it uses the **customer's own**, which means the
customer registers their own redirect URI for their own appliance's address. So the constraint
is not "we must solve callbacks for appliances"; it is "an appliance reached at a raw IP cannot
be an OAuth redirect target, and the customer must give it a name or forward a port." That is a
documentation answer with two supported shapes, not an engineering one:

- **Forward the port** and use `http://localhost:<port>/oauth/google/callback`. Google permits
  loopback over plain HTTP, and never connects to the callback itself — it 302s the browser,
  which is where the forward lives. No TLS, no DNS, no certificate.
- **Give the appliance a hostname** under a domain the customer owns, with TLS. A private
  address in public DNS is allowed; Google's objection is to the IP *literal*, not the network.

Both belong in `docs/google-workspace-setup.md` next to the redirect-URI step, and the refusal
for a raw-IP callback should name them.

What remains genuinely open is only the case where neither is acceptable — no port forward, no
DNS control. Two candidates, **both unverified, neither decided here**:

1. **A "Desktop app" client with a `http://localhost:<port>` redirect.** Google permits loopback
   redirects for that client type. Works when the browser and the appliance share a host;
   does not when they do not, which is the owner's case.
2. **Google's limited-input-device flow** (`urn:ietf:params:oauth:grant-type:device_code`) —
   show a code, the user finishes on any device. Ideal in shape for an appliance reached over a
   network. **Google restricts which scopes that flow may request**, and whether Drive, CardDAV
   and CalDAV are among them must be checked before anyone builds on it.

Until one of these is verified, the appliance keeps the paste-a-token path, and that is stated
in the manual rather than implied — the same discipline as ADR-0029's `SKIPPED`.

## Where the cost is

**In this plan: engineering time, and not much of it.** T1 is an endpoint pair and a button.
T2 is a sentence and a test. T3 is done. T4 is one auth path. Nothing here needs money.

**In ADR-0041: possibly real money, and only for mail and files.** Restricted scopes require an
annual third-party security assessment; the figures in circulation range from a few hundred to
tens of thousands and are **all unverified**. That is why T5 is ordered last and scoped to the
sensitive scopes first.

**In doing nothing: the Tiny and Small tiers.** ADR-0014 just priced a €6-first-month tier for
one person moving one thing. Asking that person to create a Google Cloud project is not a rough
edge; it is the tier not existing.

## Not in this plan

- Any change to what a token may read. Same scopes, same read-only posture, same revocation.
- Microsoft's equivalent path (`docs/o365-setup.md`). The same argument probably applies and is
  deliberately not made here.
- Domain-wide delegation, which is ADR-0033's opt-in second mode and already documented.
- Deciding ADR-0041. This plan is written so that everything except T5 lands either way.
