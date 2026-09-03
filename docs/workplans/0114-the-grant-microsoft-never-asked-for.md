# Workplan 0114 — The grant Microsoft never asked for

## Status — 2026-09-03 (update this block at the end of every session)

**Written this session, nothing built yet.** The owner asked for "the grant
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
| T0 Decide: faces, authority, and what the button asks for | 📋 Proposed below | Recommendation: all four faces, `/common` multi-tenant, read-only delegated scopes. Reasoning under "The design". |
| T1 The deployment's own Entra client | 📋 Not started | `microsoft-deployment-client.ts` beside the Google and Dropbox ones: `MICROSOFT_OAUTH_CLIENT_ID`/`_SECRET` both-or-neither, `resolveMicrosoftClient`, the half-pair refusal at every door. |
| T2 The consent round trip | 📋 Not started | `POST /api/migrations/microsoft/authorize` + `GET /microsoft/callback`, state-signed, `offline_access` for the refresh token, its own headers (the #721 lesson). |
| T3 The `microsoft` account kind | 📋 Not started | One row in `PROVIDER_ACCOUNT_KINDS` and one in `PROVIDER_ACCOUNT_DOMAINS`. The table was built for this. |
| T4 The token reaches the connectors | 📋 Not started | Wire the stored refresh token into `MsalTokenProvider`'s refresh-token flow. No connector changes expected — verify that expectation before assuming it. |
| T5 The button, in both doors | 📋 Not started | Wizard and Connections add-form, folding the client pair away when the deployment carries it, one-go save+test. |
| T6 The refusals speak | 📋 Not started | `AADSTS65001`/`AADSTS90094` rendered as sentences, per #722's treatment of Google's `accessNotConfigured`. |
| T7 Docs and env plumbing | 📋 Not started | `managed.yml`, `set-task-env`, `env.example`, redirect-URIs page, an operator guide and a customer guide. |
| T8 The gate | 📋 Not started | Managed smoke assertions with a sentinel pair never followed to Microsoft, mirroring #729. |
| T9 Microsoft To Do | 📋 Optional, not in v1 | **Yes, Microsoft has a tasks face** — Graph exposes `/me/todo/lists` under `Tasks.Read`, unlike Google, whose CalDAV carries no VTODO at any scope tier (0113 T5/T6). It is deliberately out of the grant's first version; the reasoning is under "What this deliberately leaves out", and the owner asked about it directly on 2026-09-03, which is why it is a row here rather than only a paragraph. |

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
- **Microsoft To Do (T9).** Tasks are a fifth domain since 0113, and Graph
  exposes `/me/todo/lists` under `Tasks.Read`. **This is a real difference from
  Google**, whose CalDAV carries no VTODO at all — 0113 T6 records that there
  is no Google task face to consent to at any scope tier. Microsoft has one.

  It is still out of v1, for a reason that is about sequencing rather than
  capability: a To Do list is not a CalDAV collection, so it needs its own
  source connector — `graph-*-source` covers mail, calendar, contacts and
  OneDrive, and there is no `graph-todo-source`. Adding a fifth face and a
  first consent in one change would mean two unproven things at once, and the
  one that breaks would be hard to tell from the other.

  **So the order is: land the grant over the four connectors that exist, then
  build the To Do source, then add one scope to the map.** By then
  `MICROSOFT_DOMAIN_SCOPES` is the only edit the consent needs — one row,
  which is what T2 derived `MICROSOFT_CONSENT_DOMAINS` from the map to make
  true.
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
