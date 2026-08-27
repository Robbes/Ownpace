# Workplan 0106 — the account-shaped connection

## Status — 2026-08-27 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-26** | This document. The owner's question (*"would I be helping our users when one can add a source or target and reuse the credentials for discovered object-types… holds/remembers/qualifies the supported object-types?"*) and its second half: some accounts must be **discovered first**, others are **scope-based** and the user must first pick what to grant through "the stepout". Both are real, they are the SAME feature wearing two qualification modes, and the codebase already carries the precedent (`nextcloud`, one row serving three domains) and the flow plan (0089, ADR-0041). |
| T0 The probe-qualified record | ✅ **Done 2026-08-26** | `packages/orchestration/src/account-qualification.ts` — `qualifyAccount(kind, config, creds)` probes every face the config can express: the DAV family (caldav/carddav/webdav/nextcloud) gets all three DAV faces from one endpoint resolution with the 0105 scheduling verdict folded into a calendar face that ANSWERED; imap gets its LIST; jmap reads the session's capability list — the one face where an honest measured NO exists (an answered session that leaves `urn:ietf:params:jmap:mail` out). The three-state rule is the module's spine and is **proved by breaking**: turning a refusal into `no` turns the Soverin-scenario test red (a 401 may be a per-protocol app-password scope, never absence). Stored on the connection row (`qualification` jsonb, migration 0029, additive/nullable — measurement, deliberately not `config`), audit event `connection.qualified`, re-measured at every create/test/rotate and NEVER a test-killer. The web renders one line per account — `Can carry: Email ? · Calendar ✓ · …` EN/NL, with the `?`-is-unmeasured hint riding whenever one is shown. Both editions: the §14.2 report's target-conduct section now lists the per-domain marks + evidence via the shared `qualificationReportLines`, measured live (the appliance stores nothing — the report is its record). |
| T1 The grant-qualified record | 🟡 **T1a done 2026-08-26**; **T1b's scope machinery done 2026-08-27**, its multi-domain entry point lands with T3b | **T1a, shipped with T0:** `qualifyGoogleGrant(kind, creds)` exchanges the stored refresh token and reads the token response's `scope` field — the grant enumerated, so a scope absent from an enumeration that ARRIVED is a **measured no**, with the grant world's own remedy riding the sentence ("asking is granting: re-consent with that scope to add this domain"). The domain↔scope table is the product's own factory scopes (`https://mail.google.com/`, `auth/calendar`, `auth/carddav`, `auth/drive.readonly` — the broader `auth/drive` also satisfies file). A refused exchange enumerates nothing → every domain unknown carrying Google's words, the same words the headline probe fails with. A service-account key is unknown-with-words (its scopes live in the Workspace admin console's DWD grant, which no token response enumerates). Same storage, audit event, badge line and never-a-test-killer posture as T0. **T1b (2026-08-27):** unblocked by 0089 T1 landing, and the half that carries the invariant is built. `domainsToScopes()` is a pure function from ticked domains to scopes, and the table it reads now names the ask in a field of its own (`asked`) with broader scopes in a second field (`alsoAccepted`) — so widening a consent means editing a field called `asked`, in a diff somebody reads, rather than reordering a list. Over-RECEIVING stays fine and reported (T1a still accepts a pre-existing `auth/drive`); over-ASKING is what is now structurally prevented, proved by breaking: moving `auth/drive` into `asked` turns three tests red naming the domain and the scope. **The second scope table is gone** — `GOOGLE_SOURCE_SCOPES` was four scope strings written out in `google-consent.ts` and four more in `account-qualification.ts` that read the same scopes back out of a token response; two copies disagree in exactly one way (ask for one scope, judge the grant against another) and the symptom would be a connection that consents successfully and qualifies as `no`. One table now, both directions, with a per-source guard proved by mis-wiring gmail to the calendar domain. **Incremental consent shipped with it, not after it:** Google replaces a grant with whatever the newest consent asked for, so a narrow ask WITHOUT `include_granted_scopes=true` would have made adding a second domain silently strip the first — asking narrowly is only safe alongside asking additively. **Still to come with T3b:** the authorize route taking a domain SET rather than one source type (the stepout proper), and asked-beside-granted recorded on the connection; neither has a caller until the wizard tick triggers it. |
| T2 One row, one rotation, honest badges | 🟡 badges shipped 2026-08-26; the one-row-per-account collapse lands with T4 | The connections LIST now returns the stored qualification and `updatedAt`, and every qualified row renders its `Can carry:` line — visible without anybody pressing Test, with each domain's evidence sentence on hover. For a DAV row this already IS the account speaking: one caldav row's badges say what the whole account answered across calendars, contacts and files. What T2 could not deliver before T4 (now landed): a Soverin account occupied three protocol rows (caldav+carddav+imap). With the `soverin` kind, all three collapse to ONE row and one rotation — calendar+contact through the DAV faces (T4a), mail through the stored `mailHost` (T4b). Pretending rows together in the UI without the model would have re-created the #597 class of kind-blind bugs — which is why the collapse waited for the kind. |
| T3 The wizard collapse | 🟡 **T3a done 2026-08-26**; T3b's precondition DECIDED by the owner 2026-08-27 (a `google` kind, cheap slice first, shapes cohabit) | **T3a:** the domain step reads the account's OWN record. The shared `qualification-gate` (`qualifiedAnswerFor` with the email↔mail vocabulary mapping; `measuredNoRefusal`) is the one authority both doors speak: the wizard locks a matrix-allowed tick the chosen target account MEASURED it cannot carry (the account's evidence sentence on hover, the re-test remedy on the line; still deselectable if already selected — no trapped wizard), marks unmeasured domains with a quiet hint, and the create API refuses the same reused-connection combination in the same sentence. THE THREE-STATE SPINE, pinned four ways and proved by breaking: only a well-formed measured `no` constrains — `unknown` never refuses, an absent record never refuses (unqualified is not disqualified), a malformed record reads as unmeasured, never as a wall. The record comes from the reused connection's stored row or, for freshly typed credentials, from what the last Test measured. The static matrix stays the ceiling; the record refines beneath it — capability read off the RECORD, kind untouched (the #597 guard). Asserted where a person meets it too: the reachability suite walks IMAP → Soverin (reusing a stored, qualified connection) onto the migration step and pins the locked measured-no card with its evidence-on-hover, the still-tickable unmeasured card with its hint, and the plain measured-yes card — proved by breaking (turning the lock off turns the walk red). The entry collapse itself needed no new machinery: since T4, one mapping carries several domains through one account row. **T3b — the precondition is decided (owner, 2026-08-27):** ticking a domain on a grant-qualified account TRIGGERING the stepout for exactly that scope. It waited on 0089 T1 (which exists) and then on there being a Google row that can carry several domains at all — every Google source type serves exactly one today (`SOURCE_TYPE_DOMAINS`), so a domain-set consent had nothing to tick. The owner's decision: **a `google` kind on the T4 precedent** (one row, several domains, capability off the record, kind as protocol resolution), carrying the domains the managed client may currently ask for, with `gmail` and `google-drive` **cohabiting** until Drive and Gmail are affordable. His framing, and it is the general point rather than a Google one: *"one can tick 'google' and pick the object types to ask a grant for… since we will have this more often — Soverin will add Nextcloud for files later this year."* So the mechanism is built to be **provider-shaped, not Google-shaped**, and Soverin gaining a file face should be a row in a table rather than a second implementation. **The constraint that sets the first slice:** Google prices calendar and carddav as *sensitive* (brand verification, free) and Gmail and `drive.readonly` as *restricted* (annual third-party security assessment — `docs/google-oauth-verification.md:50-51`), so a single consent inviting all four would push the MANAGED client into the restricted tier for every customer, including one who only wanted contacts. That constraint is the managed client's alone: an appliance registers its own client and does its own verification (ADR-0041), so the code carries no such limit. |
| T4 Kind consolidation, on the Nextcloud precedent | ✅ **Done 2026-08-26** (T4a + T4b, provider-named kinds — owner's call) | **T4a:** `soverin` — dormant in the baseline DB CHECK since 0001 — is now a kind you can CREATE: a wizard target chooser entry and a connections-page type, DAV-shaped at the door (host/port + the 0105 DAV-URL escape hatch), one row for the one app-password. `TARGET_TYPE_DOMAINS.soverin = ['calendar','contact']` — exactly what the engines drive today: the calendar builder is kind-blind (`davEndpointFromCreds`), contact routes via `contactTargetProtocol('soverin')`→carddav, so both domains ride the existing writers with **zero builder changes**. The headline probe answers with the calendar face (the one the scheduling verdict belongs to) and the T0 qualification measures all three DAV faces beside it — capability stays read off the RECORD, kind stays protocol resolution (the #597 guard, kept: no new `switch (kind)` forks anywhere in this slice). The drift locks all extended and proved by breaking: matrix over-promise, headline fallback, qualification boundary — each turned a test red. `docs/feature-matrix.md` names the kind in all three places a reader would look, including the honest gap. **T4b (done, same day):** mail through the account kind. The soverin door gains optional `mailHost`/`mailPort` — the account's IMAP server as the PERSON types it, the 0105 DAV-URL pattern again: a provider directory may one day pre-fill it (T5, parked), but the record stays what was typed and measured. `mailTargetConfigFromConnection` is the ONE seam where connection kind resolves the mail protocol: a protocol row passes through untouched, a soverin row's stored mail face becomes the `imap-dav` shape the existing writer switch already speaks (so `ImapFlowDavMailTarget` drives it with zero writer changes), and an account with no stored mail server refuses BY FIELD NAME — never a guessed host. The create door demands `mailHost` exactly when the email domain is ticked (reused connections are checked at the seam instead, where the stored row is visible); the qualification measures the mail face beside the DAV faces whenever the host is stored, so the badges say all four domains from one row. `email` joined `TARGET_TYPE_DOMAINS.soverin`. Proved by breaking three ways: the seam passing a soverin row through unresolved (3 red), the door dropping its demand (1 red), the qualification skipping the named face (2 red). **Still out:** files (until a qualification measures a file face); `proton` (dormant until measured — never-guess). The generic `dav-account` compound is superseded by provider-named kinds per the owner's decision. |
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
