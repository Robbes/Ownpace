# Security Policy

## Reporting
Report vulnerabilities privately via **GitHub Security Advisories**: open the
repository's **Security** tab and use **"Report a vulnerability"**
(<https://github.com/Robbes/open-migrate/security/advisories/new>). This is
the only reporting channel. Do not open public issues for security reports.

## Principles
- **Secrets** never live in git; `.env` is gitignored. OAuth tokens, API keys and database credentials are stored **AES-encrypted in the ledger, under a key supplied as `SECRET_ENCRYPTION_KEY`** — not in a vault. This line said "a vault" until 2026-08-05 (owner decision, 0026 T3 row 10); no vault integration exists. The difference is real and worth stating: encryption at rest and no plaintext in git, but **no rotation, no per-secret access policy, and no audit trail of secret reads**, and the master key lives in the environment of the process that uses it. A vault (OpenBao/Infisical) remains the intended step; the trigger is a deployment with more than one operator to isolate, or a compliance review that requires it — which is also when it will be clear which vault.
- **Least privilege** for source access (O365 Application Access Policy scoped to in-scope mailboxes; read-only for one-way mirror).
- **Non-destructive defaults**; deletions never auto-propagate.
- **Tenant isolation** in the managed edition (Postgres RLS, per-tenant secret scope, per-tenant rate budgets).
- **Trust boundary:** data-plane workers may briefly hold plaintext during copy - minimize at-rest staging, encrypt spool, short TTL, TLS everywhere. Proton Bridge (if used) is self-host/local only.
- **Self-hosted CI runner:** trusted workflows only (docker socket + root = RCE risk).
- **Supply chain:** dependencies pinned (every CI action by commit SHA) and kept current by Dependabot; published images are signed (cosign keyless, by digest — verifiable against this repo's workflow identity); a CycloneDX SBOM is generated per commit and attached to every release.

A lightweight threat model lives in the architecture document
(`docs/architecture/solution-architecture.md`, §17.1). A full threat-model
artifact does not exist yet — whether one is written is an open owner
decision (workplan 0026 T3 row 11).
