# ADR-0008: Pluggable TargetProvisioner (manual + API)

- **Status:** **Retracted 2026-08-02** (owner decision, workplan 0021 T5) — accepted 2026-06-20, never built
- **Date:** 2026-06-20

> **Retraction note (2026-08-02).** The `TargetProvisioner` interface,
> `ManualProvisioner` and `ApiProvisioner` were never implemented —
> `packages/provisioner` stayed a one-line stub with zero consumers for the
> project's whole life, and it is now deleted. What the product actually
> settled on: onboarding assumes the target account exists; the owner
> supplies its credentials, connectivity is proven by discovery and the
> first pass (which fail loudly), and the "guide the owner" role is served
> by documentation (`docs/target-providers.md`, the quickstart) rather than
> an interface. **Revisit condition:** an actual hoster/reseller
> partnership, or a requested "create the target account for me" onboarding
> feature — at which point a Nextcloud OCS `ApiProvisioner` is the natural
> first slice (no partnership needed). Until then, this stays a retracted
> promise, not a dormant one.

## Context
Soverin's provisioning API + white-label sit on the hoster/reseller tier, not SMB. We want both no-partnership and zero-touch paths, across multiple targets.

## Decision
Define a **`TargetProvisioner` interface** with `ManualProvisioner` (guides the owner + verifies connectivity; fits self-host and early managed) and `ApiProvisioner` (auto-provision via a reseller/hoster API; zero-touch for the managed service). Same interface for Nextcloud (OCS) and future targets.

## Consequences
- Ship Manual first; add API later without changing callers.
- Maps cleanly onto editions (self-host -> manual; managed -> API).

## Alternatives considered
- Hard-coding Soverin API: rejected — requires a partnership and locks to one target.
