# Workplan 0114 — The grant Microsoft never asked for

## Status — 2026-09-05 (update this block at the end of every session)

**T9 is BUILT: Microsoft To Do is the account kind's fifth face.** The order this plan set
held exactly — the grant landed over the four connectors that existed, then the To Do source,
then one row in the scope map — and the claim under "What this deliberately leaves out" that
`MICROSOFT_DOMAIN_SCOPES` would be the consent's only edit was true to the line:
`task: 'Tasks.Read'`, and `MICROSOFT_CONSENT_DOMAINS` grew with it because T2 derived it from
the map.

**What the source is.** `graph-todo-source` answers in `CalendarSource`'s shape, because that
is what the task domain reads (0113): a To Do list is a folder at `/todo/lists/{id}`, a task
is a `RawCalendarEvent` whose `icalendar` is a VTODO built here from Graph's JSON — Graph
offers no iCalendar for tasks, unlike events. Title, notes (HTML flattened), status (five onto
three, the original kept in `X-MICROSOFT-TODO-STATUS`), importance, due and start as calendar
DATEs so a midnight never slides a day across a zone, completion, categories, the checklist as
lines in the description, the reminder as a VALARM, the recurrence as an RRULE. A full listing
per pass rather than Graph's delta: a To Do list is hundreds of items, not hundreds of
thousands, and one code path CI can exercise beats two it cannot. A 403 names `Tasks.Read`,
because the usual cause is a consent granted before the tasks face existed.

**Both editions.** The managed account kind resolves `microsoft.task → graph-todo` in the
face table; the appliance gets a `graph-todo` source type beside `graph-calendar`, the same
registration from `OAUTH2_*`, the same optional `mailbox` under application permissions.

**Unmeasured against a live tenant, and said so.** Every test here is against Graph's
documented shapes; nothing in CI can press a delegated consent (the coverage table's
`uncoverable` row says why). The first real To Do list through this source is the measurement
the matrix row is waiting for.

### Earlier — 2026-09-03

**T1 to T4 are on PR #759; T5a on #760; T2b, T5b and T5c on #761; T7 on #762.
The button exists, and an operator can configure it without asking anybody.** T5 was split into three and T2 into two — see "What the survey missed" below for the first and
the T2b row for the second. Both splits are corrections to this plan rather
than new scope: T2 was written as "the consent round trip" and delivered the
consent MODULE, which has no consumer; T5 was written as "the button" over a
build path that cannot yet serve three of the four faces. T0's recommendations were taken in
the owner's absence and are recorded below; he asked one question against them
on 2026-09-03 — whether Microsoft has a tasks kind — and the answer is yes,
now T9 rather than a paragraph.

Three things worth carrying forward:

- **The domain guard caught a second list in T2** and was right to.
  `MICROSOFT_CONSENT_DOMAINS` was a hand-written array of four domains beside
  a scope map that already named them. It is now derived from the map's keys,
  so there is one fact — a face has a Graph scope or it does not — which is
  also what makes T9 a one-row edit.
- **T3 turned a two-provider `if` into a table.** `providerAccountFacts`
  answered `client` with `if (kind !== 'google')`; that is a condition with two
  providers and a fan-out with three. Probe table now.
- **Nothing has touched a connector**, which is what the survey predicted.
  T4 was written to wire the token through and found the wiring already
  there — `buildGraphMailSourceFromCredentials` takes a `refreshToken`, and
  both Graph factories choose the delegated flow when one is present, for all
  four domains. **So T4 became the risk the survey had not named**: the scope
  strings live in three files, and if they drift the consent still succeeds
  while the sync fails at its first pass, hours later. That is now pinned in
  both directions.

**The owner asked** for a Microsoft grant button covering O365 mail, OneDrive,
calendar and the other kinds we support, with a workplan, worked
autonomously.

**Original survey.** The owner asked for "the grant
button for Microsoft like o365 mail, OneDrive, calendar, and the other kinds
we support", to work autonomously, and to use a workplan.

**The survey came back better than expected, and that is the whole shape of
this plan: almost everything already exists.** Four Graph connectors — mail,
calendar, contacts and OneDrive — are built and already read `/me/…` under
DELEGATED permissions, which is exactly what a user-consent grant produces.
The MSAL token provider already implements the refresh-token flow. The
`o365.migration` redirect-URI entry, the `microsoft` standing grant, the
`graph`/`oauth2` credential fields and the `microsoft365` front-door family
are all in place.

**What is missing is only the grant half**: a deployment-carried Entra client,
a consent round trip that returns a refresh token, a `microsoft` provider
account kind, and the button in the two doors. That is the Google and Dropbox
pattern for a third time, over connectors that need no change at all.

| Task | State | Notes |
|---|---|---|
| T0 Decide: faces, authority, and what the button asks for | ✅ Taken in his absence, recorded | Recommendation: all four faces, `/common` multi-tenant, read-only delegated scopes. Reasoning under "The design". |
| T1 The deployment's own Entra client | ✅ Done | `microsoft-deployment-client.ts` beside the Google and Dropbox ones: `MICROSOFT_OAUTH_CLIENT_ID`/`_SECRET` both-or-neither, `resolveMicrosoftClient`, the half-pair refusal at every door. |
| T2 The consent, as a module | ✅ Done | `microsoft-consent.ts`: the authorize URL, `microsoftScopesFor`, `exchangeMicrosoftCode`, the AADSTS refusal sentences, `offline_access` as a scope. Twelve tests. |
| T2b The two routes that use it | ✅ Done | `microsoft-oauth-routes.ts` beside the Google and Dropbox ones, mounted, documented in `openapi.yaml`, listed in the sub-router guard. The TENANT rides the pending state so the callback exchanges at the same authority the authorize half used. |
| T3 The `microsoft` account kind | ✅ Done | One row in `PROVIDER_ACCOUNT_KINDS` and one in `PROVIDER_ACCOUNT_DOMAINS`. The table was built for this. |
| T4 The token reaches the connectors | ✅ Done, and it was already wired | The expectation held: no connector, factory or token-provider change. What the task produced instead is `a-consent-that-asks-for-a-different-scope`, pinning `MICROSOFT_DOMAIN_SCOPES` against `DELEGATED_SCOPES` and the inline mail scope, both directions, plus no writers. |
| T5a The four faces the managed path never wired | ✅ Done | **Four, not three — the mail face was found while testing the other three.** One face table (`source-face-builders.ts`), four seams reading it, the Graph refusals threaded with the managed vocabulary, `MicrosoftAccountSource` as the config type, `googleDavServes`/`googleDriveServes` retired into the table, and a guard pairing it against `PROVIDER_ACCOUNT_DOMAINS` in both directions. Proved by restoring each old path, which reproduced both defects verbatim. |
| T5b The kind in the tables a kind lives in | ✅ Done | Fourteen tables, and the guards named every one: credential fields, provider-client facts (derived from `GRANT_PROVIDERS` now), the front-door family/lane/icon/card, the source config, the create enum + validator branch, `sourceKindFor`, the drizzle enum, migration 0037, `WizardSourceType` + its two constraint tables, revocation, standing grants, the feature matrix, and the gate-coverage verdict. |
| T5c The button, in both doors | ✅ Done | Both `grantProvider === 'dropbox' ? … : …` ternaries are per-provider tables; `isAccountKind` reads `PROVIDER_ACCOUNT_KINDS`; strings en+nl; a door test proved by restoring the old fall-through, which sent the Microsoft customer to Google. |
| T6 The refusals speak | 📋 Not started | `AADSTS65001`/`AADSTS90094` rendered as sentences, per #722's treatment of Google's `accessNotConfigured`. |
| T7 Docs and env plumbing | ✅ Done | `managed.yml`, `set-task-env.sh` (both places), `managed.env.example`, the redirect-URIs table, `docs/microsoft-setup.md` for customers and a bring-up section for operators. **`MICROSOFT_OAUTH_TENANT` travels with the pair** — the two halves of a consent must use one authority. Both guides lead with the multi-tenant radio button, because it is the setting that works for the operator and fails for their first customer. |
| T8 The gate | 📋 Not started | Managed smoke assertions with a sentinel pair never followed to Microsoft, mirroring #729. |
| T9 Microsoft To Do | ✅ **Built 2026-09-05** | `graph-todo-source` (VTODO built from Graph's JSON), `microsoft.task → graph-todo` in the face table, `task: 'Tasks.Read'` in the scope map, `task` in `PROVIDER_ACCOUNT_DOMAINS.microsoft`, and a `graph-todo` source type for the appliance. Unmeasured against a live tenant: nothing in CI can press the consent. |

## What the survey missed

**Found on 2026-09-03, opening T5.** The survey's table said "Graph calendar
source — exists", "Graph contacts source — exists", "Graph OneDrive source —
exists". Every one of those is true, and every one of them is wired in
`build-deps.ts` — **the appliance's file-config path, from `OAUTH2_*`
environment variables.**

The MANAGED path is `build-deps-from-mapping.ts`, which builds a source from a
stored connection's decrypted credentials. What it can build for Microsoft is
`graph-mail`, and nothing else:

| Seam | What it asked | Microsoft's answer |
|---|---|---|
| mail | `sourceConfig.type === 'graph-mail'` | ❌ refused: *"only supports imap-oauth2, graph-mail, gmail and google mail sources, got: microsoft"* |
| calendar | `googleDavServes(kind, 'calendar') ? Google : DAV` | ❌ falls to DAV |
| contact | `googleDavServes(kind, 'contact') ? Google : DAV` | ❌ falls to DAV |
| file | `dropbox / box / googleDriveServes / DAV` | ❌ falls to DAV |

**The mail row was wrong when this section was first written** — it said
"✅ built", because `graph-mail` is wired and the survey stopped there. A
`microsoft` account row's config type is `microsoft`, not `graph-mail`, so it
never reached that branch. Found by writing the test file for the other
three, which is the argument for writing them.

A `microsoft` account row reaching any of the last three would be handed to
`davEndpointFromCreds`, which would refuse it for a missing username and
password — **credentials that do not exist for this provider**, named inside a
sync pass. That is the #597 symptom, verbatim, and it is the same sentence
`buildFileSourceFromConnection` already has written at the top of it about
Google Drive.

**Why nothing is broken today:** no connection of kind `microsoft` can exist
yet, because T5b has not run. This is latent, not live. It becomes live the
moment the button lands, which is precisely why T5a comes first.

### The shape of the miss, which is the part worth keeping

The survey asked *"does a Graph calendar source exist?"* and the answer was
yes. The question that would have caught this is *"can a stored connection
build one?"* — and the difference between those two questions is a whole
edition.

**Every one of those three seams is a two-way condition with a third provider
arriving**, which is the family this repository has now met eight times
(0113 T1 counted seven; `providerAccountFacts` was the eighth, in T3 above).
The seam does not fail to compile when a provider is added — it takes the
`else` branch, does the wrong work, and reports success. So T5a's deliverable
is not three `if`s: it is **one table of which builder speaks for which face
of which provider account, and a guard that the table covers every face
`PROVIDER_ACCOUNT_DOMAINS` claims.** A face a provider account advertises and
cannot build is then a failing test rather than a support ticket.

## Why this exists

**Today a customer migrating off Microsoft 365 must register their own Entra
application.** `credential-fields.ts` asks them for a tenant ID, a client ID
and a client secret:

```ts
function o365Fields(): ReadonlyArray<CredentialField> {
  return [USER, { key: 'tenantId', … }, { key: 'clientId', … }, …];
}
```

Its own comment says why: *"oauth2 and graph authenticate with the customer's
OWN Entra app registration (0037 T6, ADR-0006's row-14 model)"*.

That is a reasonable model for an IT department and an unreasonable one for
the family and SME audience the product is now aimed at. It is the same
friction the Google grant button removed in #706–#724, and the same friction
the Dropbox button removed in #728. Microsoft is the last of the three big
sources still demanding an app registration from the person leaving.

## What happens today — measured in the code, 2026-09-03

| Piece | State | Where |
|---|---|---|
| Graph mail source | **exists** | `packages/connectors/src/graph-mail-source.ts` |
| Graph calendar source | **exists** | `graph-calendar-source.ts` |
| Graph contacts source | **exists** | `graph-contacts-source.ts` |
| Graph OneDrive source | **exists** | `graph-drive-source.ts` |
| Delegated `/me/…` addressing | **exists, is the default** | `graph-scope.ts` |
| MSAL refresh-token flow | **exists** | `token-provider.ts` |
| `o365.migration` redirect URI | **exists** | `redirect-uris.ts` |
| `microsoft` standing grant | **exists** | `standing-grants.ts` |
| `microsoft365` front-door family | **exists** | `front-door.ts` |
| Deployment-carried Entra client | **MISSING** | — |
| Consent route + callback | **MISSING** | — |
| `microsoft` provider account kind | **MISSING** | `PROVIDER_ACCOUNT_KINDS` is `['google','soverin']` |
| The button | **MISSING** | — |

**The single most useful fact**, from `graph-scope.ts`:

> *"Every Graph connector built so far reads `/me/...` — the signed-in user's
> own mailbox, under DELEGATED permissions. That is the right default and
> stays the default."*

A delegated refresh token from a consent button is precisely what those
connectors already expect. **This plan should change no connector.** If it
turns out to need to, that is a finding worth stopping for, not a task to
quietly widen.

## The facts, checked 2026-09-03

- **Microsoft's delegated read scopes do not carry Google's restricted-tier
  cost.** Reading the signed-in user's own mail, calendar, contacts and
  OneDrive uses `Mail.Read`, `Calendars.Read`, `Contacts.Read` and
  `Files.Read` — delegated permissions a user can normally consent to for
  themselves, with no annual third-party security assessment of the kind
  `docs/google-oauth-verification.md` records for Gmail and Drive.
- **So the asymmetry runs the other way from Google's.** `google` offers two
  faces by default because mail and files are restricted;
  `microsoft` can offer four. That is a real product difference and it should
  be visible in the table rather than smoothed over.
- **A tenant can still refuse.** An organisation may set *Users can consent to
  apps* to No, in which case an administrator must consent instead. That is a
  TENANT POLICY, not a scope tier, and it surfaces as `AADSTS65001`
  (no consent) or `AADSTS90094` (admin consent required) — errors that must be
  rendered as sentences with a way forward, exactly as #722 did for Google's
  `accessNotConfigured`.
- **The app registration must be multi-tenant** (`/common` or
  `/organizations` authority) for a deployment-carried client to serve any
  customer. A single-tenant registration works only for the operator's own
  tenant. This is the Microsoft counterpart of Google's publishing-status
  question and belongs in the operator guide, not in code.

## The design

### One row, because the table was built for it

`provider-accounts.ts` says so in its own header:

> *"So this is a TABLE. A provider gaining a face is a row edit here, reviewed
> in a diff, with no new branch anywhere."*

`microsoft` joining `PROVIDER_ACCOUNT_KINDS` and gaining a four-face row is
that edit. No `switch (kind)` anywhere, which is the #597 defect the table
exists to prevent.

The existing `graph`/`oauth2` wizard types and the stored `o365` kind **stay**.
They cohabit with the account kind exactly as `gmail` and `google_drive`
cohabit with `google`: an IT department with its own Entra app and an
Application Access Policy is a real customer whose path must not be removed to
make room for the easy one.

### What the button asks for, and why read-only

```
offline_access Mail.Read Calendars.Read Contacts.Read Files.Read
```

`offline_access` is what returns a refresh token. The other four are read.
`Files.Read` rather than `Files.Read.All` — the signed-in user's own OneDrive,
not the tenant's. The reasoning is already written down in
`google-token-provider.ts` and applies unchanged:

> *"A migration reads; nothing in this product writes to a Google Drive, and a
> token that cannot write is the cheapest possible guarantee of that."*

### What this deliberately leaves out

- **Application permissions and admin consent.** `graph-scope.ts` already
  supports `{ kind: 'user', address }` for shared mailboxes under application
  permissions, and `docs/o365-application-access.md` records the Application
  Access Policy that bounds it. That path is for an operator migrating a whole
  tenant and it keeps its own credentials. A consent button is for one person
  consenting for themselves, and conflating the two would put a tenant-wide
  credential behind a one-click button.
- **Microsoft To Do (T9) — out of v1, built after it.** Tasks are a fifth
  domain since 0113, and Graph exposes `/me/todo/lists` under `Tasks.Read`.
  **This is a real difference from Google**, whose CalDAV carries no VTODO at
  all — 0113 T6 records that there is no Google task face to consent to at
  any scope tier. Microsoft has one.

  It was kept out of v1 for a reason about sequencing rather than capability:
  a To Do list is not a CalDAV collection, so it needed its own source
  connector, and adding a fifth face and a first consent in one change would
  have meant two unproven things at once. **The order was: land the grant over
  the four connectors that existed, then build the To Do source, then add one
  scope to the map** — and that is how it went (2026-09-05, the Status block):
  `MICROSOFT_DOMAIN_SCOPES` was the consent's only edit, one row, because T2
  derived `MICROSOFT_CONSENT_DOMAINS` from the map.
- **Writing into Microsoft 365 as a TARGET.** This plan is about a source. The
  scopes above are read-only and say so.

## The owner's decisions

**T0 is the only thing needing an answer before T1**, and the recommendation
is above: four faces, `/common`, read-only delegated scopes. Taken in his
absence unless he says otherwise, on the same footing as 0113 T0 — the
reasoning is recorded here so a different answer is a change to a written
decision rather than a surprise.

**One thing he will have to do himself**: register the Entra application and
supply `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET`, the
way he did for Google and Dropbox. T7 writes the guide that tells him exactly
where, including the multi-tenant setting that a single-tenant registration
gets wrong silently.

## Sources

- `packages/connectors/src/graph-scope.ts` — delegated `/me/…` is the default
- `packages/connectors/src/token-provider.ts` — MSAL, refresh-token flow
- `packages/shared/src/provider-accounts.ts` — the table and its rules
- `packages/shared/src/credential-fields.ts` — what O365 asks for today
- `packages/shared/src/google-deployment-client.ts`,
  `dropbox-deployment-client.ts` — the pattern, twice
- `docs/o365-application-access.md` — the application-permissions path this
  plan does not touch
