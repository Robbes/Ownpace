# Security Policy

## Reporting
Report vulnerabilities privately via **GitHub Security Advisories**: open the
repository's **Security** tab and use **"Report a vulnerability"**
(<https://github.com/Robbes/Ownpace/security/advisories/new>). If you have no
GitHub account, write to **support@ownpace.eu** instead. These are the only
two channels, in that order, and the site's `/.well-known/security.txt` names
the same two. Do not open public issues for security reports.

We acknowledge a report within **five working days**. We do not promise when
a fix lands; we tell you what we found and what we will do about it.

## Scope
- **The code in this repository**, both editions: the appliance and the
  managed service.
- **The hosted service**: `ownpace-live` at the `ownpace.eu` names during the
  alpha, and the test stack at the `ota.ownpace.eu` names.
- **Testing against the hosted service needs the owner's permission first**,
  because it holds testers' credentials for their accounts. Ask through one of
  the channels above. Anyone can bring up a stack of their own to test instead:
  `docs/selfhost-quickstart.md` for the appliance, `docs/managed-bring-up.md`
  for the managed service.

## Supported versions
`main`, and the release the hosted service runs. There is no release line
yet: a fix lands on `main` and reaches the hosted service with its next
release.

## Principles
- **Secrets** never live in git; `.env` is gitignored. OAuth tokens, API keys and database credentials are stored **AES-encrypted in the ledger, under a key supplied as `SECRET_ENCRYPTION_KEY`** — not in a vault. This line said "a vault" until 2026-08-05 (owner decision, 0026 T3 row 10); no vault integration exists. The difference is real and worth stating: encryption at rest and no plaintext in git, but **no rotation, no per-secret access policy, and no audit trail of secret reads**, and the master key lives in the environment of the process that uses it. A vault (OpenBao/Infisical) remains the intended step; the trigger is a deployment with more than one operator to isolate, or a compliance review that requires it — which is also when it will be clear which vault.
- **Least privilege** for source access (O365 Application Access Policy scoped to in-scope mailboxes; read-only for one-way mirror).
- **Non-destructive defaults**; deletions never auto-propagate.
- **Tenant isolation** in the managed edition: Postgres row-level security, per-tenant rate budgets, and each organisation's stored credentials in its own rows, all encrypted under the one `SECRET_ENCRYPTION_KEY`. **Row security is in force on the API's request path, in the per-tenant background tasks and in every organisation's own reads of three scheduled jobs, and not in the three scheduled jobs that span organisations whole, which run as a system role that is not a superuser.** The eight per-tenant Trigger.dev tasks (a sync pass, a discovery, a verification, a confirmation, an apply, a cutover's preparation, a rollback) connect as the application role since workplan 0138 T1. Three scheduled jobs, the digest, the drift detector and group discovery, are split since workplan 0138 T2: they read the list of active organisations, ids only, on a connection that sees every organisation, and read and write each organisation's own rows as the application role, in that organisation's scope. The other three scheduled jobs (the sync tick, retention, the purge of closed organisations), the split jobs' list and every task's audit key connect as the system role (`ownpace_system`, workplan 0138 T3 step 2): it bypasses row security, which questions across organisations need, so there the separation between organisations rests on each query's own tenant filter; it is not a superuser, may create no role or database, belongs to no role and has no role belonging to it, and holds only the grants those statements need, a grant to PUBLIC counted as one of them; the bring-up and the upload of the task environment each refuse to hand out its connection string when Postgres says otherwise, and every bring-up clears any setting left on the role, which an ordinary role may change on itself. No task run receives the database owner's connection string any more. Every task run holds the encryption key and the system role's connection string, because the task platform stores variables per environment. `docs/rls-guide.md` ("Where row security holds today") lists every connection; workplan 0138 T3 step 3, parked until the service admits people the owner has not let in personally, would take the connection across organisations out of the runs altogether.
- **Trust boundary:** data-plane workers may briefly hold plaintext during copy - minimize at-rest staging, encrypt spool, short TTL, TLS everywhere. Proton Bridge (if used) is self-host/local only.
- **Self-hosted CI runner:** trusted workflows only (docker socket + root = RCE risk).
- **Supply chain:** dependencies pinned (every CI action by commit SHA) and kept current by Dependabot, except what `.github/dependabot.yml` ignores by name (the Trigger.dev images and SDK, the identity provider, ClickHouse and MinIO, plus some major versions), each with its reason written there, and the identity provider's pin is compared with its newest release every week (`.github/workflows/idp-pin-watch.yml`); published images are signed (cosign keyless, by digest — verifiable against this repo's workflow identity); a CycloneDX SBOM is generated per commit and attached to every release.

A lightweight threat model lives in the architecture document
(`docs/architecture/solution-architecture.md`, §17.1). A full threat-model
artifact does not exist yet — whether one is written is an open owner
decision (workplan 0026 T3 row 11).
