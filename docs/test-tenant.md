# The two O365 tenants, and which one you are allowed to break

**The two-tenant strategy.** One real tenant that proves the product against
reality, one synthetic tenant that coders may freely experiment on. "Test
tenant" is a dangerously misleading name for the first.

## Tenant A — the real tenant (read-only, owner-held)

The tenant behind the O365 harness (`test/e2e/o365-scenario.e2e.test.ts`, workplan 0008 T7)
is **a real SMB's data**. That line in 0008 is the whole policy:

- **Read-only, forever.** The e2e suite asserts no write scopes in the token
  claims and aborts otherwise. No experiment that could touch it is run here
  first.
- **Global Administrator is held by the owner** and is not shared. This is why
  the consent runbook's live proof (0027 T0) is an owner action: not because
  the steps are hard, but because nobody else has — or should have — the role.
- **Its credentials are the owner's alone, and never in CI.** No workflow reads
  this tenant, and its credentials are kept out of the repository's secrets and
  its environments'. The harness runs by hand, on a machine that holds them, as
  below.

### Running the harness by hand

On a machine with Docker and the repository installed (`pnpm install`), with
the variables below exported:

```bash
pnpm test:e2e test/e2e/o365-scenario.e2e.test.ts
```

Without `O365_CLIENT_ID` and `O365_TENANT_ID` the whole suite skips, and a skip
reads as a pass, so check that its tests ran. Which flow you are in is decided
by which credentials are set, not by a flag — the same rule as
`managed.env.example`:

| Variable | Role |
|---|---|
| `O365_TENANT_ID` | Directory (tenant) ID — required |
| `O365_CLIENT_ID` | App registration's client ID — required |
| `O365_CLIENT_SECRET` | APPLICATION flow (app-only; shared mailboxes, directory reads) |
| `O365_REFRESH_TOKEN` | DELEGATED flow (reads only the signed-in mailbox, `/me`) |
| `O365_USERNAME` | Delegated fallback used by the token-refresh leg, with `O365_PASSWORD` |
| `O365_PASSWORD` | The delegated fallback's password |
| `O365_SCOPE` | Optional; defaults to `https://graph.microsoft.com/.default` |
| `O365_MAIL_ENABLED` | Mail is read unless this is `false` |
| `O365_CALENDAR_ENABLED` | Calendars are read unless this is `false` |
| `O365_CONTACTS_ENABLED` | Contacts are read unless this is `false` |
| `O365_FILES_ENABLED` | Files are read unless this is `false` |
| `O365_CONCURRENCY` | Parallel reads; defaults to 4 |
| `SOAK_TEST_24H` | `true` runs the soak test |
| `SOAK_DURATION_MS` | How long the soak runs, in milliseconds; defaults to 86400000 (24 hours) |

`test/e2e/o365-scenario.unit.test.ts` holds this table to the names the suite
reads, both ways. Rotating a credential is the owner's, in the tenant's app
registration; nothing in this repository holds one.

## Tenant B — the coders' tenant (synthetic, break it freely)

A tenant containing **no real data**, where any contributor can be Global
Administrator and every experiment is safe: the consent runbook end to end,
Application Access Policy scoping (including proving the **Denied** half),
`check-access`, the drift detectors, a Pattern S shared-mailbox copy.

### Getting one

1. **Microsoft 365 trial (free, 30 days)** — sign up for a Business Standard
   or E5 trial with a fresh admin address; you are Global Administrator of a
   new `*.onmicrosoft.com` tenant in minutes. Disposable by design: when it
   expires, make another. Fine for exercising the runbook mechanics once.
2. **One-seat Business Basic (~€6/month)** — the durable form: a project-owned
   tenant that keeps its Application Access Policy, test mailboxes and group
   fixtures alive between contributors. Worth it the moment more than one
   person needs Tenant B in the same quarter.
3. **M365 Developer Program sandbox** — instant E5 with 25 users *if* you hold
   a Visual Studio Professional/Enterprise subscription; since early 2024
   Microsoft refuses new sandboxes without one. Use it if you have it.

### Seed it so the features have something to find

- Two licensed users (one is the admin), so there is an in-scope and an
  out-of-scope mailbox for the policy's Granted/Denied proof.
- One **shared mailbox** (Pattern S has something to copy).
- One **distribution list** and one **mail-enabled security group** (discovery
  has something to classify; the access policy needs the security group).
- A handful of mails/events/contacts in each mailbox — enough to see counts
  move, not enough to make runs slow.

### What a Tenant B run proves — and what it deliberately does not

A full runbook pass on Tenant B (registration from zero → consent → policy →
both `Test-ApplicationAccessPolicy` halves → `check-access` exit 0) proves the
**mechanics** and validates `docs/o365-application-access.md` §0 end to end.
It does **not** close 0027 T0: that task's acceptance is a live read against
the tenant the deployment's own `OAUTH2_*` credentials point at, because the
point is the nightly detectors flipping from "cannot look" to real reads with
no code change. That run stays the owner's, on Tenant A — deliberately kept,
not overlooked (the re-anchoring option was considered and declined
2026-08-10). Likewise the §0 guide's *owner validation* (0026 T3 row 14) is
against the owner's own tenant/domain, whatever coders proved before them.
