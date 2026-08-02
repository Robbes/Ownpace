# Workplan 0023 — the Graph mail source (ADR-0006's fallback, kept and built)

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The connector: `GraphMailSource` | ✅ **Done — merged (PR #233, CI green)** | `packages/connectors/src/graph-mail-source.ts` implements the mail `SourceConnector` port: folder enumeration with **well-known-folder special-use mapping** (authoritative, name-convention fallback), **delta-query `listSince`** (deltaLink cursor, `@removed` entries skipped by design — the mail port has no removal reporting, see "deliberate limits"), **`unkeyable` counting** (a message with no `internetMessageId` is reported, never silently dropped — the same honesty rule the IMAP source follows), and **binary-safe MIME fetch** via `/messages/{id}/$value` reading `bodyBytes`, never a UTF-8 string round-trip. Throttle handling mirrors the drive source (429/503 + Retry-After through `ThrottleLimiter`). `graph-mail` config type parsed in `@openmig/shared`. Unit tests with a fake HTTP client cover folders/special-use/nesting, missing well-known tolerance, delta paging + cursor resume, unkeyable counting, `@removed` skipping, binary fetch fidelity, and honest auth-failure errors. |
| T2 Wiring: token provider + build-deps | ✅ **Done — merged (PR #234, CI green)** | Both dep builders construct it now. **Appliance** (`build-deps.ts`): `case 'graph-mail'` → `MsalTokenProvider` from the same `OAUTH2_*` env vars the IMAP XOAUTH2 path reads — but REQUIRED here (no static-token fallback; a Graph token expires mid-pass), refusing at build time naming the variable; `OAUTH2_REFRESH_TOKEN` selects the delegated `Mail.Read` flow, else `OAUTH2_CLIENT_SECRET` selects client-credentials `.default`. **Managed** (`build-deps-from-mapping.ts`): `buildGraphMailSourceFromCredentials` from the connection's decrypted credential store (`clientId` + `clientSecret`/`refreshToken`), same flow selection, same named-field refusals; `buildSourceConnectorFromCredentials` exported as a test seam. Discovery and the shadow pass need no separate wiring — both go through these builders. 8 new unit tests (3 env-contract via `buildDeps`, 5+1 credential-branch incl. the untouched IMAP path). |
| T3 Runtime detection + fallback selection | 🟡 **Built, PR open** | `MailSourceWithGraphFallback` (packages/connectors): wraps the IMAP source when Graph-capable credentials ALSO exist (env `OAUTH2_TENANT_ID`+client creds on the appliance; `tenantId`+`clientId`+secret/refresh in the managed connection's credential store — tenantId is the signal, IMAP alone never needs it). Detection is **self-verifying, not string-parsing**: an auth-class IMAP failure (broadened classifier incl. O365's disabled-IMAP shapes — `AUTHENTICATE failed`, `LOGIN failed`, `No supported authentication method`) triggers exactly ONE lazily-built Graph probe; if Graph answers, the run continues on Graph with a LOUD log naming the permanent fix (`type: 'graph-mail'`) and the two honest caveats (path re-baseline → full idempotent re-list; possible move reports). Non-auth failures propagate untouched; a failed probe throws BOTH errors (rule 9); the switch is per-run — the config stays the owner's (§11.2). The trigger point is `listFolders()` only — a pass never mixes transports mid-flight. 15 new unit tests (classifier shapes both ways, lazy construction, flip-and-stay, no-probe-on-network-error, both-failures error incl. constructor failure, pre/post-flip delegation) + 4 wiring tests (wrapped exactly when the Graph credential set exists, both editions). ImapSource's private token-refresh classifier deliberately untouched. |

## Why this exists

Owner decision 2026-08-02 (workplan 0021 T5): ADR-0006's Graph-mail fallback
is **kept** — the mail path today is IMAP+OAuth2 only, and a tenant whose
admin/MSP disabled IMAP (a common hardening step) cannot migrate mail at
all, which fails exactly the no-IT-department customers this product is for.
The expensive halves already exist from the 0008 work (multi-tenant Entra
app model, `MsalTokenProvider` with single-flight refresh, `ThrottleLimiter`,
Graph delta patterns in three other domains); what was missing is the mail
connector itself and its wiring.

## Analysis notes (what shaped T1)

- **Special-use is authoritative from well-known folders**, not names: the
  connector resolves `inbox`/`sentitems`/`drafts`/`archive`/`junkemail`/
  `deleteditems` ids first and maps folder ids to roles, falling back to the
  shared name conventions only for unknowns. This matters because the
  trash/junk **exclusion** (and the bin-as-deletion-signal design, SAD §11.1)
  keys off `specialUse` — a localized "Verwijderde items" must still be
  `trash`.
- **Folder identity**: the mail port's `MailFolder` carries only
  `path`/`name`/`specialUse` (IMAP needs nothing more), so the connector
  keeps an internal path→folder-id map, rebuilt via `listFolders()` when a
  path is unknown — a stale map self-heals instead of erroring.
- **The natural key is `internetMessageId`** — the same RFC 5322 Message-ID
  the IMAP source keys on, so **an item copied over IMAP and re-listed over
  Graph is the SAME ledger row**: switching transport mid-migration cannot
  duplicate a mailbox. A message without one counts as `unkeyable`.
- **Deliberate limits, stated:** (1) Graph's delta responses DO report
  removals (`@removed`), but the mail `SourceConnector` port has no removal
  channel — mail deletion evidence stays on the trash/absence path for now;
  carrying Graph removals through as `reported` evidence (like files did) is
  a possible follow-up, not part of T1. (2) `/me/...` paths (delegated
  token) in T1; application-permission `/users/{upn}/...` addressing joins
  in T2 where the token contract is defined. (3) Message `size` is not
  listed (Graph's message resource doesn't expose it) — the port allows
  its absence.

## Hard rules that bite here

- **Rule 9:** unkeyable messages are counted, never silently dropped; a
  failed Graph call throws with its status + body, never an empty listing.
- **Rule 2:** the source stays read-only; `@removed` entries are skipped,
  not acted on.
