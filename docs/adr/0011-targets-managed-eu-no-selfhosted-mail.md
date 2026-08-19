# ADR-0011: Targets default to managed EU/CH; self-hosted targets are user-operated

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- Default/recommended targets are **managed EU/CH platforms**; the connector layer stays target-agnostic.
- Self-hosted targets (incl. mail) are permitted but **user-operated** — no responsibility for their hosting, deliverability, reputation or uptime, and docs/UI must say so.

## Context
Self-hosting a mail server brings IP/domain reputation, deliverability and uptime burdens. The stack is standards-based, so any compliant endpoint can be a target.

## Decision
**Default/recommended targets are managed EU/CH cloud platforms** (Soverin + Nextcloud; Proton optional; Mailfence/Mailbox.org/Posteo/Infomaniak). **Self-hosted targets — including self-hosted email (e.g., Stalwart/Mailcow) — are permitted**, because they speak the same standard protocols (IMAP/SMTP, CalDAV/CardDAV, WebDAV). However, **the user operates and hosts them; we take no responsibility for their hosting, deliverability, reputation, or uptime.** The stack migrates into them like any other standards target.

## Consequences
- The connector layer stays target-agnostic; self-hosted mail is just another standards endpoint.
- Pairs naturally with the self-host edition (a hobbyist self-hosting both the tool and their mail).
- Docs/UI must clearly mark self-hosted targets as user-operated and out of our operational responsibility/SLA.

## Alternatives considered
- Forbidding self-hosted mail entirely: rejected — unnecessarily limiting; the stack is standards-based.
- Offering managed self-hosted mail ourselves: rejected — reputation/deliverability burden, off-goal.

