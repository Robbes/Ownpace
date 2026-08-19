# ADR-0037: One credential store, two key providers, and TLS floors

- **Status:** Accepted 2026-08-19 — owner decisions in conversation, same exchange that
  resolved ADR-0034's open questions. Provenance is stated per decision; the one place the
  owner's instruction was adjusted rather than transcribed is decision 6, and it is flagged
  there for overrule.
- **Date:** 2026-08-19
- **Deciders:** owner
- **Relates to:** [ADR-0034](./0034-appliance-configuration-surface.md) (amended the same
  day — the config-door split this completes), [ADR-0035](./0035-who-signs-in-and-who-gets-a-link.md)
  (grant links are why the store is universal), [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)
  (the boundary-by-walk style decision 1 borrows), `packages/core/src/secrets.ts` and
  `secret-store.ts` (the mechanism, unchanged).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **One credential store in every deployment** (grants arrive from people at runtime — ADR-0035); the four env-indirection auth kinds stay per connection as the no-secret-at-rest escape hatch; files never hold secrets.
- One `KeyProvider` seam, **exactly two providers**: env (`SECRET_ENCRYPTION_KEY`, always wins) and a generated key file for Personal on **every** platform; OS keystores deferred.
- The key is required at **first store, not at boot** — a pure files+env fleet gains no knob; a grant with no key is refused naming the fix.
- **AES-256-GCM stands**; the blob's version byte becomes a **dispatcher, not a rejector** (the whole crypto-agility mechanism); Argon2id if a passphrase mode is ever added; no PQ KEM anywhere (its future home is a KMS envelope wrap).
- TLS floors: named cloud providers (Graph, Google, Dropbox) → **1.3**; customer/legacy endpoints → **1.2 restricted to ECDHE+AEAD**, 1.3 preferred, negotiated version surfaced. `rejectUnauthorized: false` is test-fixture-only plus the existing surfaced opt-out.
- Managed's plaintext `.env` key is a **named open gap**; the exit is platform injection through the same env provider.

## Context, in five verified facts

1. `SecretStore` is AES-256-GCM under one 32-byte key from `SECRET_ENCRYPTION_KEY`; the
   encrypted blob carries a version byte, and today's code **rejects** any version but 1.
2. The appliance imports none of it — zero references in `apps/selfhost/src`.
3. The file-config schema has exactly four auth kinds, all env-indirection
   (`passwordFromEnv`/`tokenFromEnv`); a file never holds a secret.
4. `buildDepsFromMapping` already runs both paths per connection: `secretRef` set → decrypt
   from the store, otherwise construct from the mapping's env indirection.
5. Production connectors verify TLS by default (`rejectUnauthorized ?? true`); the `false`s
   live in test fixtures and one explicit, surfaced per-mapping opt-out.

ADR-0035 makes credentials arrive from *people at runtime* — a migrated person opens a link
and grants their own migration. A runtime grant has no environment variable, so any
deployment that runs the grant flow needs the store. That kills "Organisation has no secret
store", which an earlier draft of the 0034 discussion proposed.

## Decisions

### 1. One credential store, every deployment

Credentials and grants live in the database via `SecretStore`, in Personal, Organisation and
Managed alike. The four env-indirection kinds stay, per connection, as the escape hatch for
an operator who wants **no secret at rest** for that connection — a property fact 4 shows
the code already supports. Files still never hold secrets. This is declaring a seam the code
has, not building one.

### 2. One `KeyProvider` seam, exactly two providers

- **env** — `SECRET_ENCRYPTION_KEY`, which always wins when set. This is Organisation (their
  secret manager injects it) and Managed (today `.env`, later platform injection — every K8s
  mechanism worth naming, ESO / Vault agent / CSI, lands the secret as env or file, which is
  this same provider). No bespoke KMS client.
- **generated file** — Personal. Created on demand into the data directory, `0600` on POSIX,
  ACL'd on Windows to the principals `install-task.ps1` already grants. Mechanics as ADR-0034
  decision 5 wrote them; that decision now lives here.

**On every platform, including desktop Linux.** An OS keystore (DPAPI, Keychain) was
considered and **deferred**: it would be a third provider, the owner fixed the count at two,
and on Linux the keyring exists on one Personal box (desktop) and not the next (home server,
container — no session bus), which would fork one OS into two security postures invisibly.
Revisit if there is real demand for admin-resistant key storage on desktops.

Stated plainly so nobody reads more into the file than is there: **full-disk encryption is
the control that answers device theft** (BitLocker / FileVault / LUKS — a documented
prerequisite, not our code). The key file answers other local users, and database dumps or
backups copied without it.

### 3. The key is required at first store, not at boot

A deployment that never stores a secret — today's entire file+env fleet — runs with **no new
knob and no key**. A grant or UI credential arriving with no key configured is refused with
the fix named. Personal generates its file at that same moment. The env-vs-file mismatch
refusal (0034 d5) is unchanged. This matters because an earlier draft claimed Organisation
"needs no key at all"; under decision 1 that is false, and this is the honest replacement:
storeless is not a mode, it is simply never having stored.

### 4. Crypto agility, not post-quantum theatre

AES-256-GCM stands. Grover halves symmetric strength — ~128-bit quantum margin — and that is
the accepted answer for AES-256; there is nothing to make post-quantum about a symmetric key
file, and the only asymmetric crypto we own is RS256 in the Google JWT-bearer path, which is
Google's requirement, not our choice.

What we do instead: the blob's **version byte becomes a dispatcher, not a rejector** — v1 →
AES-256-GCM, later versions decrypt under their own algorithm during a rotation pass. That
is the entire mechanism an algorithm change ever needs. If a passphrase mode is ever added
on top of the key file, the KDF is Argon2id. A PQ KEM's future home is a KMS envelope wrap
(asymmetric) — the same future as a third key provider, and equally not now.

### 5. TLS floors outbound (owner: "most safe ciphers, TLS 1.3+ with the providers")

- **Named cloud providers** — Microsoft Graph, Google, Dropbox — `minVersion` **TLS 1.3**.
  All three serve it; there is no reason to ever negotiate down.
- **Customer and self-hosted endpoints** (IMAP/JMAP/CalDAV/CardDAV/WebDAV): floor **TLS 1.2
  restricted to ECDHE + AEAD suites** (no CBC, no static RSA), 1.3 preferred, and the
  **negotiated version is surfaced** in connection checks rather than logged and lost.
- Certificate verification stays on by default everywhere; `rejectUnauthorized: false`
  remains test-fixture-only plus the existing surfaced opt-out — never a silent product
  default.

**The flagged adjustment:** the owner wrote "TLS 1.3+". Read literally and applied to every
endpoint, that refuses exactly the servers this product exists to migrate people *off* — a
legacy IMAP host is the normal case, not the edge — and the escape knob it would force into
existence would be flipped routinely, which is worse than a visible 1.2. The instruction's
own phrasing ("with the providers") supports the split above. If the owner wants the hard
floor everywhere anyway, the change is one constant and this section's supersession note.

## Consequences

- ADR-0035's grant flow works identically in all three deployments, which is the point.
- Enforcement is implementation work, not this ADR: a walk asserting the Organisation
  topology path never reaches `SecretStore` writes (0036's pattern), connector TLS options,
  the provider seam itself, and the version-byte dispatch.
- The Managed key gap is **named, not solved**: `SECRET_ENCRYPTION_KEY` sits in plaintext
  `deploy/compose/.env` on the host today. The exit is platform injection when hosting
  moves (K8s-shaped), through the same env provider.
- One lifecycle rule crosses the doors: deleting a file-declared connection revokes or parks
  its stored credential via the existing `revokeStoredCredentials` path — never orphans it.
