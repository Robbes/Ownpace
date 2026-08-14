# `@openmig/shared`

**The leaf.** It depends on no other workspace package, and every other package and app
depends on it — all eleven declare it. That is the rule, and it is the whole boundary:
**if a module needs to import a sibling, it does not belong here.**

## What lives here

Types, contracts and pure functions — things with no I/O and no opinion about which edition
is running:

- **The domain vocabulary** — `mail.ts`, `calendar.ts`, `contact.ts`, `file.ts`,
  `target-domains.ts`, `specialUse.ts`, `keywords.ts`.
- **The contracts between layers** — `ports.ts` (the connector/target interfaces),
  `operating-contract.ts`, `scope-manifest.ts`, `verification-report.ts`, `decisions.ts`,
  `lifecycle.ts`.
- **Pure helpers** — `hash.ts`, `ids.ts`, `cursor.ts`, `cron-schedule.ts`, `concurrency.ts`,
  `throttling.ts`, `dav-canonical.ts`, `generated-message-id.ts`, `jmap-file-path.ts`.
- **Cross-cutting config and reporting** — `config.ts`, `logger.ts`, `metrics.ts`,
  `pricing.ts`, `permissions.ts`, `notifications.ts`.

## What does NOT live here

Behaviour. There is no reconcile loop, no sync, no database access, no network call. Those are
`@openmig/core` — see [its README](../core/README.md) for the other half of this boundary.

## Two things that are load-bearing rather than stylistic

**The operator-facing prose is here on purpose.** ADR-0026 §2 puts `whatThisMeans` /
`howToResolve` in this package so the managed and self-host editions cannot drift *in exactly
the explanations that stop somebody destroying data by accident*. Moving that text into either
edition reintroduces the drift the architecture was designed to prevent.

**`ports.ts` is the most stable file in the repository** — touched in one of the last 151
commits. Interfaces here are consumed by every connector and both editions, so a change is a
change to all of them at once.
