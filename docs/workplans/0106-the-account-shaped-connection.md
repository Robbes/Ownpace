# Workplan 0106 — the account-shaped connection

## Status — 2026-08-26 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-26** | This document. The owner's question (*"would I be helping our users when one can add a source or target and reuse the credentials for discovered object-types… holds/remembers/qualifies the supported object-types?"*) and its second half: some accounts must be **discovered first**, others are **scope-based** and the user must first pick what to grant through "the stepout". Both are real, they are the SAME feature wearing two qualification modes, and the codebase already carries the precedent (`nextcloud`, one row serving three domains) and the flow plan (0089, ADR-0041). |
| T0 The probe-qualified record | ✅ **Done 2026-08-26** | `packages/orchestration/src/account-qualification.ts` — `qualifyAccount(kind, config, creds)` probes every face the config can express: the DAV family (caldav/carddav/webdav/nextcloud) gets all three DAV faces from one endpoint resolution with the 0105 scheduling verdict folded into a calendar face that ANSWERED; imap gets its LIST; jmap reads the session's capability list — the one face where an honest measured NO exists (an answered session that leaves `urn:ietf:params:jmap:mail` out). The three-state rule is the module's spine and is **proved by breaking**: turning a refusal into `no` turns the Soverin-scenario test red (a 401 may be a per-protocol app-password scope, never absence). Stored on the connection row (`qualification` jsonb, migration 0029, additive/nullable — measurement, deliberately not `config`), audit event `connection.qualified`, re-measured at every create/test/rotate and NEVER a test-killer. The web renders one line per account — `Can carry: Email ? · Calendar ✓ · …` EN/NL, with the `?`-is-unmeasured hint riding whenever one is shown. Both editions: the §14.2 report's target-conduct section now lists the per-domain marks + evidence via the shared `qualificationReportLines`, measured live (the appliance stores nothing — the report is its record). |
| T1 The grant-qualified record | ⬜ proposed | For OAuth account families (Google first; Microsoft, Dropbox, Box follow the shape): capability is not free to discover — **asking IS granting** — so the order inverts: the user ticks the domains they want, and the qualification is what the grant CAME BACK carrying. Two halves. **T1a, independent of any new flow:** the credentials we already hold can be measured — exchanging the stored refresh token yields a token response whose `scope` field says exactly what this grant carries; record that as the qualification instead of assuming the four Google kinds from the wizard type. **T1b, on 0089's flow:** the stepout (0089 T1/T8, ADR-0041's custody) asks for EXACTLY the scopes the ticked domains derive — a pure, tested `domainsToScopes()` whose output is never a superset — and on callback the granted scopes are read from the token response, never from what was asked: a person can un-tick on Google's own screen, and "you granted calendar but not contacts — contacts stays off; tick it again to re-ask" is a stated outcome, not an error. Adding a domain later is **incremental consent** (`include_granted_scopes`), never a re-ask-everything. |
| T2 One row, one rotation, honest badges | ⬜ proposed | The Connections page shows the account ONCE, with per-domain qualification badges (measured / granted / unknown / off), instead of the user reading three protocol rows as three accounts. Rotation (0065) becomes one act: the account's password or grant rotates once and every domain follows, instead of today's three-rotations-for-one-app-password — the failure mode the T3 sitting will feel first-hand. No visual row-expansion needed (the owner's own instinct): the substance is the HELD qualification; badges render it. |
| T3 The wizard collapse | ⬜ proposed | Creating a migration becomes: pick the account (or add one), tick the domains you want — constrained by the qualification for probe-qualified accounts, or TRIGGERING the stepout for grant-qualified ones — and the wizard creates the N thin per-domain mappings in one go. The mapping model does not change: mappings stay per-domain (`TARGET_TYPE_DOMAINS`' truth), the ledger contract is untouched; what collapses is entry and bookkeeping. The domain matrix stops being declared-by-kind and starts being read off the account's OWN record. |
| T4 Kind consolidation, on the Nextcloud precedent | ⬜ proposed | Compound account kinds (`dav-account`; later provider-named where a provider is more than its protocols) so one row can legitimately carry several protocol endpoints, the way `kind: 'nextcloud'` already does for calendar/contact/file. Guarded by the #597 lesson: the capability gate that accepted `webdav` while the seed wrote `nextcloud` was a `switch (kind)` fork nobody saw diverge — so capability decisions read the QUALIFICATION FIELD, and kind stays what it is today: protocol resolution only. Existing protocol-shaped rows keep working unmigrated; consolidation is opt-in shape, not a forced migration. |
| T5 A provider directory | ⬜ parked | Well-known endpoints per named provider ("Soverin" pre-fills hosts), so adding an account starts from the provider's name. Parked: pure convenience, and every value in it must be measured against the live provider before it is trusted (0105's never-guess rule) — the qualification machinery above is what makes such a directory safe to have at all. |

## The two ways an account qualifies

One feature, two orders, both ending in the same stored record:

- **Qualification before choice** (probe-qualified). The user enters one
  credential; we ask every protocol face of the account what it answers, and
  present what the account CAN carry. This works because Basic auth makes
  discovery free and read-only. Soverin is the walking example: one
  app-password, and whether it spans IMAP/CalDAV/CardDAV/SMTP is the
  provider's scoping choice — which is exactly why the record is measured
  per face, never copied from a brochure.
- **Choice before grant** (grant-qualified). Discovery is not free when the
  question is a consent screen: asking for a scope IS asking the user to
  grant it, so the user picks first, the stepout asks for exactly that, and
  the record holds what the grant actually carries — which can be LESS than
  asked, and saying so plainly is the feature.

The symmetry matters for T2/T3: the UI renders one thing (an account with
qualified domains), whatever order produced it.

## Least privilege, as an invariant rather than an intention

The owner's ask, verbatim: *"grant access to what they want and not
more/all."* Made structural:

- `domainsToScopes()` is a pure function from ticked domains to scope set,
  and a test pins that its output is never a superset of what the ticked
  domains need — the guard proves it by breaking (add a scope, watch red).
- The stepout URL is built from that function's output and nothing else. No
  code path may widen it; a provider preset may NARROW a request (read-only
  variants) but never broaden one.
- Granted is read from the token response, recorded beside asked, and a gap
  is a stated outcome with a remedy ("tick contacts again to re-ask"), never
  a silent degradation and never a silent broadening.
- A later domain is incremental consent. Revocation observed at re-measure
  time (T1a's exchange fails or comes back narrower) downgrades the
  qualification and says so — the record tells what was last true.

## What already exists, so this plan stays small

- **The account-shaped precedent:** `kind: 'nextcloud'` — one row, one
  credential, three domains resolving their own endpoints
  (`fileEndpointFromCreds`, well-known discovery per domain).
- **Reuse and rotation:** connections are already reusable across mappings
  (0064) and rotatable in place (0065); this plan multiplies their value
  rather than building either again.
- **The verdict pattern:** 0105 T0 measures-and-records what a target will
  DO (scheduling) at test time, three-state, audit-backed. T0 here is that
  pattern widened from one question to "which object types answer at all".
- **The stepout's skeleton:** 0089 T1 (authorization-code flow, "the scopes
  the chosen domains need" already in its contract), T4 (the grant link),
  T8 ("use Ownpace's connection" as a wizard choice), and ADR-0041's custody
  rules (managed brings its own verified client; **the appliance never
  carries an Ownpace client secret** — bring-your-own stays its only mode).
  0106 consumes those; it reopens none of them.
- **The per-domain mapping model:** `TARGET_TYPE_DOMAINS` and the thin
  per-domain mappings are correct and stay; the sitting's three-connections
  friction is at the CONNECTION layer, which is where this plan stays too.

## What this deliberately does not do

- **Never ask a scope no ticked domain needs, and never store a broader
  grant silently.** Both directions of drift are refused: over-asking by the
  superset guard, over-receiving by recording granted-vs-asked and saying
  the difference out loud.
- **No qualification by assumption.** Measured (probe) or granted (token
  response), never inferred from a provider's marketing, a preset, or our
  memory — and UNKNOWN is reported as unmeasured-not-safe, never rendered
  as either yes or no (0105's rule, unchanged).
- **No reopening of settled custody.** ADR-0041 (who owns the OAuth client)
  and ADR-0006 row 14 (the per-customer app registration for O365) stand;
  the appliance keeps bring-your-own-client as its only OAuth mode and
  `no-managed-leakage` keeps the managed secret out of it (rule 5).
- **No mapping-model change.** Mappings stay thin and per-domain; the
  ledger, the passes, and the cutover machinery see nothing new. This plan
  consolidates the front door, not the migration.
- **No forced migration of existing connections.** The qualification field
  is additive; protocol-shaped rows keep working exactly as today, and T4's
  compound kinds are a shape new connections can take, not a rewrite of old
  ones.
- **No new `switch (kind)` forks for capability.** The #597 lesson is the
  standing guard: capability questions read the qualification record; kind
  resolves protocols.
- **Discovery probes stay read-only.** Every T0 question is `listFolders`-
  class; qualification never writes to anybody's account.

## Sources

- The owner's questions, 2026-08-26 (this plan's brief): reuse credentials
  across discovered object-types; hold/remember/qualify supported types;
  scope-based accounts pick-then-grant through the stepout, "not more/all".
- Workplan 0105 (the verdict pattern T0 widens; the never-guess rule) and
  the T3 sitting, whose three-connections walk is this plan's live
  validation.
- Workplan 0089 + ADR-0041 + `docs/google-oauth-verification.md` — the
  stepout's flow, custody, and the verification checklist T1b inherits.
- Workplans 0063 (the credential descriptor), 0064 (reuse), 0065 (rotation).
- `packages/shared/src/target-domains.ts` (`TARGET_TYPE_DOMAINS`) and the
  `nextcloud` kind's resolution path — the model T3/T4 generalise.
- The #597→#599 defect (kind-fork divergence) — the reason capability reads
  a field.
