# Workplan 0092 — what one live sync said

## Status — 2026-08-22 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The mailbox whose role we never looked at | ✅ **Done 2026-08-22** | `JmapTargetWriter.ensureMailbox` matched by NAME and then created with a ROLE, so a source "Sent" against an account already holding "Sent Items" earned Stalwart's `invalidProperties … "A mailbox with role 'sent' already exists."` and took the whole email domain with it. Roles are matched first now (RFC 8621 §2: one per account), with a re-read-and-adopt recovery if the collision only appears at create time. 10 tests in `packages/connectors/src/jmap-ensure-mailbox.unit.test.ts`, one of them the owner's error verbatim. |
| T2 The mailbox id that was never a mailbox id | ✅ **Done 2026-08-22** | Found while fixing T1, one line below it. `Object.keys(created)[0]` is the CREATION id — every mailbox this writer created came back as the literal string `"0"`, which `upsertEmail` then puts in `mailboxIds`. Now `created["0"].id`, the same read `Email/import` already does 400 lines down. Covered by "returns the SERVER's id for a mailbox it created". |
| T2b The id guessed out of a sentence | ✅ **Done 2026-08-22** | Same function again: an `alreadyExists` with no explicit `existingId` fell to `/'([a-z0-9]+)'/i`, "try to find the ID in the description" — which in `Mailbox 'Sent' already exists` finds the NAME. Removed; that case now takes T1's re-read-and-adopt, which answers with an id the server actually gave us. |
| T3 A cadence is not a delay | ✅ **Done 2026-08-22** | Activation now runs the first pass in **both** editions. Appliance: `apps/selfhost/src/first-pass-on-activation.unit.test.ts` proves it on a schedule (`0 5 31 2 *`, the 31st of February) that can never fire, so the run row it asserts could only have come from the activation. Managed: `POST /:mappingId/start` enqueues `run-delta-sync` on the transition into `active`, `concurrencyKey: mappingId` (the tick's own key), reported as `firstRun` on the response. Wizard copy says so, EN and NL. |
| T5 The create path nothing had ever run | ✅ **Written 2026-08-22, not yet run** | `packages/connectors/src/jmap-mailbox-creation.integration.test.ts` — 4 cases against a real Stalwart. Every existing integration test that touched `ensureMailbox` passed it `INBOX`, so all of them exercised ADOPTION and none exercised CREATION; that is the gap T2 lived in. Mailbox assertions go over **IMAP**, deliberately — asking JMAP whether JMAP did the right thing lets one wrong id agree with itself. Needs docker: not run in this sandbox. |
| T6 The choice the JMAP target ignored | ✅ **Done 2026-08-22, proven on a real Stalwart** | `targetFolderPrefix` (owner decision 2026-08-16) is offered by the wizard, validated, stored and honoured by the IMAP and WebDAV targets — and silently dropped by JMAP, which read `folder.name` before `folder.path` where they read `path` first, and never sent a `parentId`. Probed against the real code path before touching it: prefixed `Sent` returned the account's ROOT Sent with no `Mailbox/set` at all; prefixed `Projects` was created at the root with no `Gmail` above it. JMAP now walks the tree, and a source hierarchy nests instead of flattening (`Archive/2024` was becoming a root mailbox called `2024`). 6 more unit cases, 2 more integration cases. |
| T4 A front door with nothing behind it | 📋 Planned (**owner decision**, see below) | `site/build.mjs:412` — the site's only CTA is `mailto:`. `apps/web/src/pages/Login.tsx:44` — the app's sign-in is a textarea you paste a JWT into. `apps/api/src/routes/tenants/index.ts:110` — `POST /api/tenants` answers **501** by design. The only path from visitor to account is the owner running `deploy/compose/seed-managed.sh` and emailing a token that expires in 7 days. |

## Why this exists

The owner ran a real Soverin → Stalwart sync on 2026-08-22, with more than mail selected,
and reported what the screen said. Two of the three things it said were bugs; the third
was the product working exactly as designed and the design being wrong.

### 1. `A mailbox with role 'sent' already exists.`

Verbatim, from the Live progress panel:

```
E-mail  Mislukt  2 gesynchroniseerd
Failed to create mailbox: {"0":{"type":"invalidProperties",
"description":"A mailbox with role 'sent' already exists.","properties":["role"]}}
```

Two messages had copied. Then `ensureMailbox` asked `Mailbox/query` for a mailbox
**named** "Sent", compared the answers by name, found none that matched exactly, and
created one carrying `role: "sent"`. Stalwart refused, correctly: RFC 8621 §2 allows one
mailbox per role per account and that account already had one — under a different name.

The name lookup could not have found it, and would not have found it in any account
whose server localises ("Verzonden items") or spells it differently ("Sent Items").
`trashMailboxId`, forty lines further down the same file, had already written the reason
in a comment — *"filtering by name would depend on the server's language"* — and matched
by role. `ensureMailbox` never got the same treatment.

A role is now matched before a name. A name still matches for the ordinary folders that
carry no role, and still matches **exactly** rather than through JMAP's contains-filter,
which answers "Sent Items" for a query of "Sent" and is how this hid for so long.

Two consequences worth stating because they are not obvious:

**A roleless source folder still adopts a role mailbox by name.** `ImapFlowSource` reads
`specialUse` from the server's LIST attributes ONLY (deliberately —
`imapflow-source.ts:41`), so a source that advertises no SPECIAL-USE gives us `'normal'`
for its own "Sent". Refusing to adopt in that case would create a second "Sent" beside
the first one.

**A name match on a mailbox holding a DIFFERENT role is refused.** A source "Archive"
must not land in the account's Sent because somebody renamed it.

### 2. And the id it would have returned was `"0"`

`createMailbox`'s success path read `Object.keys(created)[0]`. RFC 8620 §5.3 keys
`created` **by the creation id the client sent** — `"0"` — with the server's id inside.
So every mailbox this writer successfully created returned the string `"0"`, and the very
next thing `upsertEmail` does with that value is `mailboxIds: { "0": true }` on an
`Email/import`.

Adopted mailboxes were fine, which is why it survived: the INBOX path returns a real id,
and nothing had ever successfully *created* one against a live server — T1's bug threw
first. `Email/import` in the same file already read its own `created["0"]?.id` correctly.

### 3. `why not set the frequency, and do a first run after the activation`

The owner's question, and the answer is that there was never a reason.

The appliance's `/mappings/{id}/start` called `scheduleMapping`, which hands the cron to
croner, whose first firing is the next one the expression names — then answered *"The
migration is running."* On a quarter-hourly cadence that sentence was true up to fifteen
minutes later. The managed edition was better but not right: `isSyncDue` calls a mapping
that has **never** run due immediately, so a brand-new mapping starts within a tick — but
a mapping that had already run once (which this one had) waits out its full cadence from
the last run's start.

The cadence is how often a sync **repeats**. It was never meant to be how long the first
one is postponed. Both editions now run the first pass at the moment of activation, and
only on the transition into `active` — a second click on an idempotent route is not a
second migration.

The appliance's kick goes through `scheduler.runOnce`, sharing `InProcessScheduler`'s
single-flight key with the schedule armed one line above, so a cron firing landing in the
same moment coalesces instead of running a second pass beside it. The managed enqueue
carries the tick's own `concurrencyKey: mappingId` for the same reason, and carries **no**
`domains` — `run-delta-sync` resolves the mapping's live `scope_selection` itself, and a
copy of the scope taken at activation could name a domain the owner had since switched off.

### 4. The other thing the owner asked, which is not a bug

> `calendar: not selected for this migration — not synced, not checked`

That line is `describeAbsentDomains` (`run-delta-sync.ts:238`) doing its job. It is
accounting for a domain that did not run, so that a pass covering one domain out of four
cannot read as a pass covering everything. It sat next to a real failure in the same
panel, which is what made it look like one.

## T4 — a front door with nothing behind it

The owner asked whether the webpage needs wiring up "to actually registering a client
with its credentials for the App". It does. Here is the whole of the current path from
stranger to signed-in customer:

| Step | Where | What actually happens |
|---|---|---|
| 1 | `www.ownpace.eu` | The only call to action on the site is `mailto:` — `orderHref()`, `site/build.mjs:412`. "Request access" opens an email client. |
| 2 | the owner's inbox | A human reads it. |
| 3 | the reference box | The owner runs `deploy/compose/seed-managed.sh`, which seeds a tenant and **prints a JWT signed with `JWT_SECRET`**. Its own closing line: *"The tokens above expire in 7 days — re-run this to mint fresh ones."* |
| 4 | email, again | The owner sends the customer a JWT. |
| 5 | `app.ownpace.eu` | `Login.tsx` is a **textarea**. The customer pastes the token. It is decoded client-side for its claims and kept in `localStorage`. |
| 6 | seven days later | It expires. Return to step 3. |

**One reading of the question is already built, and it is worth separating.** "Registering
a client with its credentials" could mean the customer's own **OAuth client** — and that
part works: `credential-fields.ts:141` asks an O365 connection for `tenantId`, `clientId`
and a secret, which is ADR-0006's per-customer single-tenant registration exactly, and
Google, Box and Dropbox have their equivalents. A customer can already hand us their app
registration through the wizard. What has no path is one level up: the customer **account**
that the wizard belongs to.

**What already exists, and is more than it looks.** The API's managed auth path is real:
`apps/api/src/middleware/auth.ts` verifies against a remote JWKS with `jose`, honours
`iss`/`aud`/`exp`, and takes precedence over the symmetric `JWT_SECRET` when `JWT_ISSUER`
is set (`:215`). `tenant_member` (`packages/managed/src/schema-managed.ts:138`) keys on a
**`text` `user_id`** — an external subject — with roles, invite status and `invited_at`
already modelled. There is **no password column anywhere in the schema, and that is the
design**: the arch doc puts identity in Zitadel (§7.3, §18), ADR-0035 makes authentication
the prerequisite for Organisation, and the 2026-08-19 restatement is *"owners sign in;
migrated people get links, not accounts"*.

So the server half is built to receive an IdP and no IdP has been stood up. What is
missing is four things, and only the last one is a decision:

1. **An issuer.** Zitadel in `deploy/compose/managed.yml` (nothing in `deploy/` mentions
   it today), with `JWT_ISSUER` / `JWT_AUDIENCE` set on the API — which is all the API
   needs to switch paths.
2. **A sign-in screen** in `apps/web` — authorization-code + PKCE against that issuer,
   replacing the paste box. The token handling downstream (`services/api.ts:31`) does not
   change; only where the token comes from does.
3. **A provisioning path.** `POST /api/tenants` answers 501 *on purpose* — RLS
   (`tenant_isolation_insert`) requires the new row's id to equal `app.current_tenant`,
   which a tenant being created never satisfies. So creating a `tenant` + an owner
   `tenant_member` needs a privileged, non-tenant-scoped route. That route exists as a
   seed script and has never existed as a product surface.
4. **What step 1 on the website leads to** — and this is the owner's call:

> **Decision needed.** Does a visitor **sign themselves up** (site CTA → `/signup` →
> pick a tier → pay → tenant provisioned → signed in), or do they **request access** and
> the owner provisions them (site CTA → a real form → an invite email → the customer sets
> up their own sign-in against the IdP)?

They share items 1–3 and differ in everything after. Self-service is the arch doc's
"self-service onboarding" (§4) and needs ADR-0014's five tiers wired to a Mollie checkout
before an account can exist. Invite-only keeps `mailto:`'s current shape but makes it
honest: a form, a `tenant_member` row with `status: 'invited'`, and an invite link — which
is also the shape `members.ts` already implements for the second and third person in a
tenant. **Invite-only is the smaller step and it is not a detour**: the self-service flow
needs the same issuer, the same login screen and the same provisioning route, and gains
only a checkout in front of them.

Not in scope either way: the appliance. It has no accounts, by design.

## T6 — the choice the JMAP target ignored

The owner asked, on 2026-08-22, that this be a decision rather than a default:
match the source's folder to the target's by role (a source "Sent Mail" lands in
the target's "Sent"), or nest everything under one root folder named for the
source ("Gmail", and the source's own folder names inside it).

**That choice already existed** — `targetFolderPrefix`, decided 2026-08-16, with
a wizard field, a validator, a database column, and the destructive path taught
it separately so an IMAP removal opens the mailbox the copy actually lives in.
Empty means merge; `Gmail` means nest.

**It did nothing on a JMAP target**, which is the primary target protocol
(AGENTS.md) and the one the owner had just synced into. Probed against the real
code path, with `reconcile.ts`'s own composition:

| Source folder, prefix `Gmail` | What `ensureMailbox` received | What happened |
|---|---|---|
| `Sent` (role sent) | `{path: "Gmail/Sent", name: "Sent", specialUse: "sent"}` | Returned the account's **root** Sent Items. **No `Mailbox/set` at all.** |
| `Projects` (ordinary) | `{path: "Gmail/Projects", name: "Projects"}` | Created `{name: "Projects"}` at the **root**. No `Gmail`, no `parentId`. |

One word caused it. JMAP read `folder.name || folder.path` — **name first** —
where `imapflow-dav-target.ts` reads `folder.path || folder.name` and the WebDAV
writer uses `folder.path`. The prefix is only ever composed into `path`, so JMAP
dropped it. And `createMailbox` never sent a `parentId`, so it could not have
built a tree even had it tried.

**A second bug fell out of the same word.** Without any prefix, a source folder
`Archive/2024` became a ROOT mailbox called `2024` — so two folders with the
same leaf name under different parents collided into one.

### Three decisions inside the fix

**A role belongs to a leaf at the ROOT, and to nothing else.** RFC 8621 allows
one mailbox per role per account, so `Gmail/Sent` cannot be the account's Sent —
asking for the role there is asking for exactly the collision T1 was about. A
prefixed special folder is created roleless: a folder that happens to be called
Sent. The wizard hint says so now, in both languages, because it changes what a
mail app does — an app can only have one Sent.

**Split on `/`, and only on `/`.** JMAP has no path property at all; hierarchy is
`parentId`, so the mapping from our path strings to a tree is ours to define. `/`
is the only separator we control — `parseTargetFolderPrefix` enforces it and
rejects a backslash — while a SOURCE path carries the source server's delimiter,
which nothing in this codebase records (`MailFolder` has no delimiter field;
`ImapFlowSource` passes `box.path` through verbatim). So a Gmail or
Dovecot-with-`/` source nests properly, and a Dovecot-with-`.` source yields one
level whose name contains dots — what the source called it, and no worse than
the flattening it replaces.

**Changing the layout cannot duplicate mail**, which is the property that made
this safe to change at all (hard rule 1). `upsertEmail` checks an ACCOUNT-WIDE
snapshot keyed by Message-ID and adopts on a hit regardless of which mailbox the
message is in, so a message already sitting in a flat mailbox is adopted rather
than copied again. Checked before writing a line of it.

### And CI printed the tree

The integration run on PR #494 failed the first time, identically on amd64 and
arm64 — on an over-broad assertion in the new test, not on the code. What it
printed while failing is the evidence this task wanted:

```
+   "Ownpace-IT-p9054-385519",
+   "Ownpace-IT-p9054-385519/Projects",
+   "Ownpace-IT-p9054-385519/Sent",
```

Read over IMAP, from a Stalwart that had just been sent a `parentId` — which
nothing in this codebase had ever done. The prefix is a real parent and the two
folders are real children of it. Every other assertion in that case passed on
the same run: exactly one `\Sent` mailbox on the account, and it is the one that
was there before.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22).
`pnpm test:integration` NOT run this session: no docker daemon in the sandbox
(`dial unix /var/run/docker.sock: connect: no such file or directory`). Two integration
files wait on it, and until they run neither T3 nor T5 is proven end to end:

- `discovery-routes.integration.test.ts`'s start-route case, extended to assert
  `activated` and the `firstRun` outcome (T3).
- `jmap-mailbox-creation.integration.test.ts`, new and entirely unrun (T5). Its
  fourth case asserts a precondition — that the fixture account already HAS a
  `\Sent` mailbox — because without one the collision it exists for cannot occur.
  `shared-mailbox.integration.test.ts` says Stalwart provisions it as "Sent Items";
  if that assertion fails, the fixture changed, and the fix is the fixture.
