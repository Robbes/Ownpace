# Workplan 0108 — the link that grants

## Status — 2026-08-27 (update this block at the end of every session)

**The build started and finished on 2026-08-27**, on the owner's word, after the design and its
expiry amendment were merged. **All five tasks are built**, as four stacked pull requests
(T1+T2, T3, T4, T5). The design below stands as written; each row records what shipped against
it, and every departure from the plan is named in the row that made it.

**Three findings the build produced, none of them in the plan:**

1. **"Awaiting grant" needs no new `status` value** (T4). The plan left it open. A fifth value
   would touch a database CHECK, `MAPPING_LIFECYCLES` in the contract both editions serve, and
   ADR-0014's billing states — and would go stale the first time a credential was stored
   without clearing it. The condition is an observation about the rows, not a state somebody
   sets, so it is derived at the moment it is asked.
2. **`revoke-stored-credentials.ts` would have left a migrator's token live at Google** (T4).
   It read only the `connection` table, so erasure would have deleted the granted token from
   our database while it kept working — with the receipt reporting nothing to revoke. That is
   the same file's own founding mistake, against the one token in the product that reaches a
   private individual's mailbox rather than an account the customer administers.
3. **The openapi guard was blind one level down** (T3). It read `/api/migrations` as two files,
   but that router mounts three more on itself — and `POST /google/authorize` and
   `GET /google/callback`, one of them the beginning of an OAuth consent, were served and
   checked by nothing.

**Still open for the owner:** ADR-0035's formal status is Proposed while four of its decisions
are recorded as owner-decided (ask 3 below); and the 1/7/30-day expiry presets are adjustable
in review.

| Task | Status | Evidence |
|---|---|---|
| T1 The `mapping_link` table, its RLS, and the link store | ✅ **Done 2026-08-27** | Migration 0031 + `mapping-link-store.ts`, declared in the Drizzle schema WITH the migration (the `rate_budget` invisibility lesson). The table holds a **sha256, never the secret** — a token is `<id>.<secret>`, returned exactly once, and a test asserts no column of the row contains the secret in any form. `verifyMappingLink` compares in constant time (length-checked first, so a malformed stored hash refuses rather than throwing), then checks purpose, revocation, expiry and — **for `grant` only** — single use; `'view'` is the longer-lived half of ADR-0035's pair and is meant to be re-opened. **One sentence answers all eight failure shapes**, pinned by a table-driven test that also asserts the sentence never names the cause. `spendMappingLink` re-checks revocation and expiry IN THE STATEMENT (the owner's kill switch must not lose a race to a consent in flight) and is idempotent on `used_at IS NULL`. Two policies do different jobs: `tenant_isolation_*` for the owner, and `link_sees_itself` for the verification read that happens **before any tenant is known** — bounding blast radius, never authenticating, which the hash does. Those tenant policies are **NULL-safe from birth**: permissive policies are OR'd and all evaluate, so a link-scoped read runs them too, and a bare `''::uuid` would 500 every verification that followed a tenant request down the same connection. 22 unit tests on PGlite **as `app_user`** (policies enforced, not merely present); `mapping_link` joined the offboarding purge list before `mailbox_mapping`. Proofs by breaking: the bare cast turned six tests red (the decay, exactly as documented), storing the raw secret four, and naming the cause in the refusal two. |
| T2 The middleware that grants nothing | ✅ **Done 2026-08-27** | `authenticateMappingLink(purpose, source)` in `auth.ts`, beside the `authenticateSubject` precedent it follows. Reads the secret from a **named path parameter and nowhere else** — never a query string, which lands in access logs, `Referer` headers and history, and never a general `?token=` convention a future route could inherit by accident. Attaches `{linkId, mappingId, tenantId, purpose}` and **no identity**: no `userId`, no role, no email, no `tenantId` on the request — a link holder is not a user, and `MappingLinkRequest` is its own interface so no route can read a field the link never fills. A refusal is 401 + the one sentence; **a database that cannot answer is 503**, never 401, because reporting an outage as a bad link sends the one person who cannot fix anything off to ask for a fresh one (hard rule 9). 8 unit tests against the real PGlite driver — an auth middleware asserted against a mock of the thing that authenticates is asserted against nothing. Proofs by breaking: a query-string fallback → red; collapsing the 503 into the refusal → red. |
| T3 The owner's surface: issue, list, revoke | ✅ **Done 2026-08-27** | `link-routes.ts` (POST/GET/DELETE `…/:mappingId/links`) mounted on the migrations router, plus `GrantLinksPanel` on the mapping's hub. **The refusal comes first and nothing is written on one**: `grant-link-readiness.ts` decides the four ways a grant link is dead on arrival — no source connection, a source that is not one of the four Google kinds, no client id or secret stored, or a deployment with no `WEB_URL` — each naming what to configure, and each answering **409** (well-formed, permitted, cannot be honoured) rather than 400. It takes **booleans, never values**: `hasClientSecret`, not `clientSecret`, so a decrypted secret cannot reach a function whose whole output is a sentence that gets logged. Ordered so the owner's own fixable problem is named before the deployment's. The consent kinds are a **table, not a transliteration**, guarded against `GOOGLE_SOURCE_SCOPES` so a kind can never map to a scope that does not exist. The URL is returned **once** (POST is the only response in the product that carries a bearer secret) with the chosen expiry beside it and ADR-0035's division of labour in the payload, not just the template; GET answers state and dates and **could not** produce a URL. DELETE is idempotent — `revoked: false` for a second press — and a link id belonging to another tenant answers 404 with the row untouched. Writes need owner/admin; the READ does not, because seeing that a door exists is not being able to open it. On the panel: three lifetimes with seven pre-filled, the copy button beside a real selectable input (a browser may refuse the clipboard), an **armed** two-click revoke, refusals rendered **verbatim** (ADR-0024's prose boundary) while the four states go through `StateChip`, and **`expired` deliberately not greyed away** — it is the one row that means somebody was asked and never answered, so it stays loud and carries the re-issue nudge. Renders nothing on the appliance, whose half is unbuilt rather than forbidden. 13 route tests on **PGlite as `app_user`** (the table is read directly after every refusal — a mocked store cannot tell a refused row from a hidden one), 13 decision tests, 11 panel tests. **Found and fixed while wiring**: the openapi guard read `/api/migrations` as two files, so the three sub-routers `migrations/index.ts` mounts on itself were partly invisible — `google-oauth-routes.ts` had served `POST /google/authorize` and `GET /google/callback`, one of them the beginning of an OAuth consent, checked by nothing. The guard now resolves sub-router mounts out of the parent, and all five operations are documented. Proofs by breaking: computing the refusal and dropping it → 8 red; writing the row before the refusal → 8 red; assuming credentials present → 1; the secret in another column → 2; the list handing out addresses → 1; the role gate dropped → 1; the deployment refusal jumping the queue → 1; a fifth Google kind with no scope → 3; and on the panel — rendering on the appliance, a generic refusal, a one-click revoke, the missing nudge → 1, 1, 2, 1. |
| T4 The migrator's page and the second ending of the consent flow | ✅ **Done 2026-08-27** | Migration 0032 gives `mailbox_mapping` a `source_secret_ref` — ADR-0035 decision 4's per-mapping credential home, `source_config_override`'s sibling and the same key-by-key merge, because the split is the same split: the client id and secret are the OWNER's on a connection several mappings may share, and the refresh token is the MIGRATOR's and true of one mapping only. `mergeMappingCredentials` is one function serving **both** credential paths (`buildDepsFromMapping` for mail, `loadDomainConnections` for the rest) so a grant cannot work for somebody's mail and not their calendar. `/grant/:link` is public, outside the chrome, and says who is asking, what is read, that it is read-only, the scope **as a scope** (ADR-0041), when the link stops working, and where the privacy policy is — all before the button. `POST /api/grant/:link/google/authorize` reads the client id **and secret server-side**; unlike the owner's route it refuses to take them from the body, so a link holder cannot aim the consent at a client of their own. **One callback serves both flows** — Google is registered against one redirect URI — and which ending runs is decided by the server's own pending state, never by the redirect. The migrator's ending calls `grantResultPage`, a function with **no parameter that could hold a token**: the owner's page hands the token to a wizard window, this one cannot. `storeGrantedToken` **spends the link before it writes**, in one transaction, so a link revoked mid-flight claims nothing and stores nothing. **Two findings.** (1) The workplan's open edge — a mapping awaiting its grant must not be runnable — needs **no new status value**: `mailbox_mapping.status` is load-bearing in a DB CHECK, in `MAPPING_LIFECYCLES` that both editions serve, and in ADR-0014's billing states, and a stored flag would go stale; waiting-for-a-grant is the *observation* that the credentials are not here yet, derived from the rows and composed exactly as a sync pass composes them. A service-account key satisfies it too — what is refused is having no way in, never a particular way in. (2) **`revoke-stored-credentials.ts` read only the `connection` table**, so a migrator's granted token would have been erased from the database and left live at Google, with the receipt reporting nothing to revoke — this file's own founding mistake, against the one token that reaches a private individual's mailbox rather than an account the customer administers. It now reads both tables. 13 flow tests on **PGlite as `app_user`** with only Google's token endpoint stubbed, 4 start-guard tests driving the real router, 5 decision tests, 9 page tests. Proofs by breaking: the link ending falling through to the owner's page → 3 red; the credential written before the link is claimed → 2; more than the migrator's half stored → 1; a caller-supplied client honoured → 1; internal ids in the read → 1; the start guard computed and dropped → 2; the guard ignoring the mapping's credential → 1; revocation narrowed back to one table → 1; and on the page, the scope shown only as a paraphrase → 1, a self-composed redirect → 1. |
| T5 The words: manual sentences and the invitation-vs-link distinction | ✅ **Done 2026-08-27** | `docs/grant-links.md` — the customer-served guide, written for the owner who has to explain this to somebody: issuing, the four early refusals with what to fix, what the other person actually sees, the four states with **expired-unused named as the one to act on**, and the support path ADR-0035 obliges us to have (*"my link says invalid"* — the message is the same for all four causes on purpose, so the answer is always "look at the list and re-issue", not "diagnose the sentence"). It also states the **three-way revocation split** as a table: you stop the link, they stop the access they granted, deleting the migration stops everything — three different people's switches, which is what layered revocation means in practice. `google-workspace-setup.md` step 4 gains the **third way to get a refresh token**, ahead of the other two, because both of those assume you can sign in as the account being migrated and often you cannot: *"the honest way to get this token is not to ask them for their password, and not to sit beside them while they sign in."* No workplan numbers in either (customer-served guides never cite them); indexed in `docs/README.md`. **The invitation-vs-link distinction is written in code, not only in prose**, because that is where the mistake would be made: `routes/invitations.ts` carries the long version — an invitation is an offer to JOIN, authorised by a verified email claim, carrying **no token at all**, while a grant link IS a bearer credential for somebody who will never have an account — and names the cheap mistake in its actual direction (*adding a token to an invitation "so people do not have to sign in"* would create a bearer credential for a **seat** with none of the machinery one needs). `routes/grant.ts` carries the pointer back. |

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
- **Expiry is the owner's choice, made at issue time** (the owner's steer, 2026-08-26:
  control over comfort-by-default). The issue dialog offers **1 day / 7 days / 30 days**
  with **7 days pre-filled** — long enough to hand a link across a weekend, short enough to
  bound a forwarded or intercepted one — and the chosen date is shown beside the link the
  moment it is created, so the owner sends it knowing exactly what they sent. Re-issue is
  cheap and revocation immediate, whichever expiry was picked.
- **The person granting sees where they stand too**: the grant page states the link's
  validity in plain words (*"this link works until Thursday 4 September"*) before the
  button, so an expiry never lands as a surprise mid-intention — and the expiry bounds
  **beginnings, not completions**: it is checked when the flow starts, and a consent begun
  legitimately in the link's last minute finishes under the OAuth state's own ten-minute
  bound. **Revocation, by contrast, stops everything** — it is re-checked at the callback
  before anything is stored, because it is the owner's kill switch and a kill switch that
  loses to a race is not one.

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
(authenticated, owner's session, expiry chosen in the dialog) → the URL, once, with the
chosen expiry stated beside it and ADR-0035's division of labour made visible: *you* send
this to the person, we never do. Beside it: the list (issued when, expires when,
used/revoked state) and a revoke button — and a link that **expired unused** shows
prominently rather than greyed away, because it means somebody was asked and never managed
to answer: the one-click follow-up is re-issue, and the list should make that the obvious
next move rather than a hunt.

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
2. ~~Seven days as the default expiry?~~ **Steered by the owner, 2026-08-26**: expiry is
   the owner's choice at issue time, for control on both sides — designed above as a
   1/7/30-day picker with 7 pre-filled, validity shown to the migrator on the grant page,
   expiry bounding beginnings while revocation stops everything. The preset values
   themselves are still adjustable in this review.
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
