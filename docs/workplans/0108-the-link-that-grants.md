# Workplan 0108 — the link that grants

## Status — 2026-08-26 (update this block at the end of every session)

**This is a design for review, not a build.** The owner chose option A on 2026-08-26: draft
first, review before anything is built. Nothing below exists in code until this plan is merged
and a task is started.

| Task | Status | Evidence |
|---|---|---|
| T1 The `mapping_link` table, its RLS, and the link store | 📋 Awaiting review | Persisted, mapping-scoped, hash-at-rest, revocable. |
| T2 The middleware that grants nothing | 📋 Awaiting review | `authenticateSubject`'s precedent, one narrower still. |
| T3 The owner's surface: issue, list, revoke | 📋 Awaiting review | Refuses to issue a link that cannot succeed. |
| T4 The migrator's page and the second ending of the consent flow | 📋 Awaiting review | The token is stored server-side; no browser ever sees it. Includes ADR-0035 decision 4's per-mapping credential home. |
| T5 The words: manual sentences and the invitation-vs-link distinction | 📋 Awaiting review | Written where the next person will look. |

## Why this exists

[ADR-0035](../adr/0035-who-signs-in-and-who-gets-a-link.md) decided the model in one sentence:
*"the owner decides who gets a link to manage and **grant** their own migration"* — and, more
sharply: *"the link is not merely a status view — it is how the migrated person GRANTS their own
migration, which is the only place their source credential is ever handled."*

0089 T1 built the consent flow, but for the wrong person: it authenticates the **owner's**
session, and the refresh token it produces travels through the **owner's browser** (the popup
postMessages it into the wizard). For the owner setting up their own migration that is exactly
right. For a migrated person it is wrong twice over — they have no session to authenticate, and
their credential must never transit anything the owner operates, because *"only the migrated
person holds their own source credential"* is the sentence the whole ADR stands on.

Today, "grant your own migration" therefore still means a five-section manual and a refresh
token sent back over chat — precisely the transport this product exists to avoid.

**One finding shapes everything below** (established by a full sweep of `apps/api` on
2026-08-26): **there is no link-holder identity anywhere in this codebase.** Every route
authenticates a Bearer header; no token in a URL is ever treated as an identity. The invitation
flow (0095) deliberately carries **no token and no magic link** — an invitee proves their
address at the issuer, and RLS on the verified email claim does the authorising. That rule is
scoped to *membership* (identity belongs to the issuer, ADR-0042) and does not contradict
ADR-0035's migrator link — but this plan is inventing the repository's **first** bearer link,
and the difference must be built and written deliberately rather than drifted into.

## The decided ground (what this plan may not reinvent)

From ADR-0035, all owner-decided even though the ADR's formal status is still Proposed:

- **Owners sign in; migrated people get links, not accounts.** A migrated person is a
  **mapping** — no `tenant_member` row, no password, no session, no seat, in any deployment.
- The vocabulary is **migrator**, never "member".
- **One mechanism: mapping-scoped, signed, expiring, revocable** — with **two lifetimes**:
  credential supply is *short-lived and single-use*; the progress view is *longer-lived but
  revocable*. This plan builds the first and leaves the second a named door.
- **The admin distributes the link. We never do.** Copy-link per migrator; Ownpace sends no
  email carrying it.
- A signed link is a **bearer credential**, with everything that implies: expiry, revocation,
  re-issue, and a support path for "my link says invalid".
- Decision 4 names the concrete blocker verbatim: `secret_ref` exists on `connection` and
  `backup_target` and **not** on `mailbox_mapping` — a per-mapping credential home must exist
  before a migrator can grant one mapping without touching a connection shared by others.

From elsewhere:

- **ADR-0037**: one credential store. The granted token goes through
  `SecretStore.encryptCredentials` like every other credential, no special case.
- **ADR-0041 (accepted 2026-08-26)**: the flow runs against the customer's own client today
  and picks up the managed client automatically if T5/T8 of 0089 land — nothing here waits.
- **0089 T1's consent machinery is reused, not duplicated**: the same signed ten-minute
  single-use OAuth `state`, the same exchange, the same scope-read-off-the-answer refusals,
  the same raw-IP refusal (T6).

## The design

### 1. The link is a row: `mapping_link`

A persisted, mapping-scoped credential — persisted because ADR-0035 requires **revocable**, and
an in-process store (the shape 0089 T1's `ConsentFlowStore` uses for its ten-minute states)
can neither list, revoke, nor survive a restart.

- `id` uuid, `tenant_id`, `mapping_id` (cascade on mapping deletion: a deleted migration has
  no business keeping doors), `purpose` — `'grant'` now, `'view'` reserved (the two lifetimes,
  one table), `secret_hash`, `created_by`, `created_at`, `expires_at`, `used_at`, `revoked_at`.
- **The secret is hashed at rest.** The URL carries `<id>.<secret>`; the table holds only the
  hash, compared with `timingSafeEqual`. A leaked table must not mint working links — the same
  reason a password is never stored readable.
- **Shown once.** Issuing returns the full URL a single time; after that the owner can see
  that a link exists, when it expires, and whether it was used — never the link itself.
  Re-issue is the remedy for a lost one.
- **Single-use means used at the GRANT, not at the open.** `used_at` is set when a refresh
  token is actually stored — never when the page is first fetched. A chat app's link preview
  fetches URLs; a link that died on preview would be a support ticket generator with no
  attacker in sight. Until the grant lands, opening is repeatable; after it, the page says
  "already granted" and offers nothing.
- **Expiry short, because the bearer risk is real**: proposed default **7 days** — long
  enough to hand over a link across a weekend, short enough to bound a forwarded or
  intercepted one. Owner-visible at issue time; re-issue is cheap and revocation immediate.

### 2. A middleware that grants nothing

`authenticateMappingLink`, following `authenticateSubject`'s precedent (a second, narrower
middleware whose doc says plainly that it authorises nothing): parse `<id>.<secret>` from the
dedicated link routes' path parameter only — never a general query-token convention — load the
row, constant-time-compare the hash, check `revoked_at`, `expires_at`, and (for `grant`)
`used_at`, and attach `{ linkId, mappingId, tenantId, purpose }`. Deliberately **no** `userId`
and **no** role: a link holder is not a user.

The **database still authorises**, in the house pattern (the GUC-plus-RLS shape of the
invitation migrations): a link-scoped db context can read exactly its own mapping's row and
write exactly nothing directly — the credential write happens inside one transaction whose
statements are already narrowed to that mapping. The route refuses with one honest sentence
for unknown/forged/expired/revoked/used alike — distinguishing them would teach a forger which
part failed — and the sentence names the remedy that is always true: *"ask the person who set
up your migration for a fresh link."*

The public link routes take the existing knock rate limiter (the one already protecting the
public access-request door).

### 3. The owner's surface: issue, list, revoke

On the mapping's view: **Create grant link** → `POST /api/migrations/:mappingId/links`
(authenticated, owner's session) → the URL, once, with the expiry stated beside it and
ADR-0035's division of labour made visible: *you* send this to the person, we never do.
Beside it: the list (issued when, expires when, used/revoked state) and a revoke button.

**Issuing refuses early when the link could not succeed** — the same principle as 0089 T6's
"refused HERE, not at Google's screen". A grant link needs the mapping's source to be a Google
consent source and its client id + secret already configured by the owner; missing either, the
refusal names what to configure instead of handing out a link that dies in the migrator's
browser, where the error would land on the one person who cannot fix it.

### 4. The migrator's page, and the second ending of the consent flow

`https://<web>/grant/<id>.<secret>` shows the smallest honest surface, **consent-only** (the
recommendation of this plan — the 'view' half stays out until it is its own task):

- who asked (the tenant's name), which object types this migration reads, that access is
  **read-only** and nothing is ever deleted at the source;
- the scopes **as scopes** (ADR-0041's operative rule), with the privacy policy and terms
  beside the button, before any redirect — this is the in-product disclosure the verification
  checklist already requires, built once and shared;
- one button: **Connect with Google**.

The button starts the same consent flow with a different beginning and a different ending:

- **Beginning**: `POST /api/grant/:link/google/authorize` — authenticated by the link. The
  owner's client id and **secret are read server-side** from the mapping's stored
  configuration and decrypted only inside the API; the migrator's browser never receives
  them. (0089 T1's owner-wizard beginning takes them from the request body because the owner
  is entering them; the link beginning must not, because the link holder must not hold them.)
  The OAuth `state` is the same signed, single-use, ten-minute machinery, now also carrying
  which link and mapping the flow belongs to.
- **Ending**: the callback, on a link-flow state, exchanges the code and **stores the refresh
  token server-side** — encrypted through `SecretStore.encryptCredentials` into the
  **per-mapping credential home** that ADR-0035 decision 4 prescribes (a nullable ref on
  `mailbox_mapping`, shaped like `source_config_override`, with `buildDepsFromMapping`
  preferring it over the connection's) — then marks the link used and renders a page that
  says *done, nothing else to do* and contains **no token at all**. The owner-wizard ending
  (postMessage to the wizard window) stays exactly as shipped; the one honest difference
  between the two endings is who may see the token, and in the link ending the answer is
  nobody.
- The granted-scope reading, narrower-grant refusal, no-refresh-token refusal and raw-IP
  refusal are the shipped ones, unchanged.

**One open edge, named rather than designed around**: a mapping awaiting its migrator's grant
exists with an empty credential home and must not be runnable until the grant lands. The
existing mapping status machinery is the tool; wiring "awaiting grant → may activate" is T4's
first job, and if it turns out to need a status value of its own, that is a finding for the
build, not a decision smuggled in here.

### Least privilege, stated as properties

- A grant link authorises exactly two things: starting a consent for **this** mapping's
  ticked domains (the scope derives from the mapping — never a scope no ticked domain
  needs), and having the resulting token stored on **this** mapping. It reads no other row,
  changes no configuration, and answers no tenant question beyond the one mapping it names.
- The owner's client secret crosses nothing new: decrypted server-side for the exchange, as
  the token provider already does at sync time.
- The refresh token is never in a URL, a log, a page, or anyone's browser in the link flow.
- Revocation is layered and each layer is somebody's own: the owner revokes the link, the
  migrator revokes the grant in their own Google settings, and deleting the mapping cascades
  the links away.

## Asks of the owner (the review)

1. **Consent-only first?** The migrator page shows disclosure + one button; the progress
   'view' link stays a reserved `purpose`, built when it is its own ask.
2. **Seven days** as the grant link's default expiry?
3. **ADR-0035's formal status** — it is still Proposed while four of its decisions are
   recorded as owner-decided. This plan builds on it; accepting it (or amending it) in the
   same review would close that gap.

## Where the cost is

Engineering only, and modest: one table and its migration, one middleware, three thin routes,
one web page, and the decision-4 column with its `buildDepsFromMapping` preference. The
consent machinery, credential store, rate limiter, and refusal vocabulary all exist. The real
recurring cost is the one ADR-0035 already admitted: a bearer credential means expiry,
revocation, re-issue and a support sentence, forever.

## Not in this plan

- The **'view' / progress page** — the second lifetime. The `purpose` column reserves it.
- **Any email from Ownpace carrying a link** — ADR-0035: the admin distributes it, we never do.
- **The managed client choice** (0089 T5/T8) — the link flow uses whatever client the mapping
  carries; when the managed option exists on the owner's side, the link inherits it unchanged.
- **Microsoft's equivalent** — the same argument almost certainly applies to the O365 path and
  is deliberately not made here.
- **Any change to what a token may read** — same scopes, same read-only posture, same
  revocation. A link changes who clicks Allow, never what Allow means.
