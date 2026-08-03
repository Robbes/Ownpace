# Security Policy

## Reporting
Report vulnerabilities privately via **GitHub Security Advisories**: open the
repository's **Security** tab and use **"Report a vulnerability"**
(<https://github.com/Robbes/open-migrate/security/advisories/new>). This is
the only reporting channel. Do not open public issues for security reports.

## Principles
- **Secrets** never live in git. OAuth tokens / API keys / DB creds go in a vault; `.env` is gitignored.
- **Least privilege** for source access (O365 Application Access Policy scoped to in-scope mailboxes; read-only for one-way mirror).
- **Non-destructive defaults**; deletions never auto-propagate.
- **Tenant isolation** in the managed edition (Postgres RLS, per-tenant secret scope, per-tenant rate budgets).
- **Trust boundary:** data-plane workers may briefly hold plaintext during copy - minimize at-rest staging, encrypt spool, short TTL, TLS everywhere. Proton Bridge (if used) is self-host/local only.
- **Self-hosted CI runner:** trusted workflows only (docker socket + root = RCE risk).
- **Supply chain:** dependencies pinned (every CI action by commit SHA) and kept current by Dependabot; published images are signed (cosign keyless, by digest — verifiable against this repo's workflow identity); a CycloneDX SBOM is generated per commit and attached to releases once tags exist.

A lightweight threat model lives in the architecture document
(`docs/architecture/solution-architecture.md`, §17.1). A full threat-model
artifact does not exist yet — whether one is written is an open owner
decision (workplan 0026 T3 row 11).
