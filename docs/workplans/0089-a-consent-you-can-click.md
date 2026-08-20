# Workplan 0089 — a consent you can click

## Status — 2026-08-20 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The authorization-code flow, against the customer's own client | 📋 Planned | Two routes and a wizard button; removes manual steps 3–4 (the redirect URI that exists only for the Playground, and the Playground itself). No decision needed — same client, same custody. |
| T2 The seven-day trap, named everywhere it bites | 📋 Planned | External+Testing expires refresh tokens after 7 days. Add it to the `invalid_grant` refusal **first**, and to the manual. Cheapest fix in this plan. |
| T3 The manual's front door | ✅ **Done 2026-08-20** | `docs/google-workspace-setup.md` now branches on *whose account is it* before anything else, and the Internal/External/Testing choice is made for the reader rather than explained to them. |
| T4 The grant link opens a consent screen | 📋 Planned (needs T1) | ADR-0035's link, made real: the migrated person consents in their own browser and the owner never touches their credential. |
| T5 The managed client | 🚧 Blocked on [ADR-0041](../adr/0041-who-owns-the-oauth-client.md) | Contacts and calendar first, mail and files only after an assessment is paid for. Managed-only secret; `no-managed-leakage` is the guard. |
| T6 Appliance without a loopback browser | 📋 Planned (open question, not a decision) | Google forbids raw-IP redirect URIs; the owner browses to `https://100.97.25.131:3123`. Two candidate answers, both needing verification before anyone builds on them. |
| T7 Personal Gmail by app password, opt-in | 📋 Planned (needs [0090](./0090-the-cap-we-do-not-count.md) T1) | A credential choice, not a connector — the IMAP source already has the branch. Google's own *afgeraden* travels with it, and it is never the default. Blocked on verifying Gmail's IMAP byte ceiling and whether it differs by credential type. |

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

Two candidates, **both unverified, neither decided here**:

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
