# Workplan 0031 — JMAP as a full target (calendars, contacts, files)

## Status — 2026-08-05 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 The spike: do our natural keys survive the transport switch? | ⬜ **Not started — and NOTHING below it starts until this answers** | See "Why T0 comes first" |
| T1 Calendars as a JMAP target | ⬜ Blocked on T0 | |
| T2 Contacts as a JMAP target | ⬜ Blocked on T1 | |
| T3 Files as a JMAP target | ⬜ Blocked on T1 | |
| T4 Surface + manifest truth | ⬜ Blocked on T1 | |

## Why this exists

**Owner decision 2026-08-05 (0026 T3 row 18): BUILD it.** ADR-0018 said "mail
leads" and workplan 0007 deferred the rest *until DAV is proven*. DAV is proven
— it runs in the nightly e2e on both persistence backends — so the deferral
expired, and the standing recommendation in this repo was to retract the
promise and declare JMAP deliberately mail-only.

The owner overruled that, and the reason is worth recording because it changes
what "done" means here: **JMAP is judged more future-proof, and is therefore
the preferred protocol.** This is not a capability gap being filled. Stalwart
already serves calendars, contacts and files over DAV and those paths work.
What this plan buys is *one protocol per target* — one credential, one failure
mode, one set of semantics per migration — and a bet that JMAP is the surface
worth investing in as it grows.

Two consequences follow, and both are constraints rather than preferences:

- **DAV is not being replaced.** Every DAV target stays: Nextcloud, openDesk
  and Soverin do not speak JMAP for these domains, and a Stalwart customer
  already mid-migration on DAV must not be moved. JMAP becomes an *additional*
  target for the one server that speaks it.
- **A mapping must be switchable between them without duplicating anything.**
  That is the whole risk, and it is what T0 exists to settle.

## Why T0 comes first, and why nothing else starts until it answers

The engine's idempotency rests on one property: **the natural key for an item
is the same whatever transport carried it.** It is why switching a mail mapping
between IMAP and Graph cannot duplicate a mailbox, and it was hard-won —
`hash.ts` computes those keys in one place precisely so two transports cannot
drift apart.

Three of them are load-bearing here, and one has a fresh scar:

- **Calendars.** A recurring series and its modified occurrences share a UID
  under RFC 5545; `naturalKeyForCalendar` distinguishes them with
  `RECURRENCE-ID`. That fix landed on 2026-08-04 after the key collided and
  silently lost modified occurrences. **If JMAP's calendar object model does
  not expose a recurrence identifier in a form that hashes identically, a
  mapping switched from DAV to JMAP re-copies every modified occurrence** — and
  the failure is silent, because a duplicate is a successful write.
- **Contacts.** The DAV path keys on the vCard UID. JMAP ContactCards may
  or may not preserve it across a write.
- **Files.** The DAV path keys on a normalised path
  (`trashbinPathToKeyPath` + `fileNaturalKeyHash`), and normalisation has
  already caused four silent-mismatch bugs in this repo. A JMAP file surface
  with a different identity model is a fifth waiting to happen.

So T0 is not a warm-up. It is a **go / no-go with three possible answers**, and
the plan branches on which one comes back:

1. **The keys survive.** Build T1–T4 as scoped.
2. **The keys survive only with a documented transformation** (e.g. JMAP
   exposes the recurrence id under another name). Then the transformation, not
   the connector, is the first thing built and tested — in `hash.ts`, with both
   transports asserted equal.
3. **The keys cannot be made to agree.** Then a mapping is NOT switchable, and
   the honest shape is a one-way door: a mapping is JMAP or DAV at creation and
   changing it requires a reindex. That is a different product decision and
   comes back to the owner rather than being absorbed quietly.

**Answer 3 is a real possibility, and the plan is written so that discovering
it costs a day rather than three connectors.**

## Tasks

### T0 — the spike (a day, and it may end the plan)

Against the real Stalwart in the dev stack, not a specification: create a
calendar event with a modified occurrence, a contact, and a file over **DAV**;
read the same three back over **JMAP**; compute the natural key from each side
with the EXISTING `hash.ts` functions and compare.

Done when: a written answer to the three-way question above, with the actual
identifiers observed pasted in, and — whichever answer — a test that pins it.
Not done when: "the JMAP spec says it should work."

### T1 — calendars as a JMAP target

First because it is the smallest surface AND carries the sharpest key risk, so
the thing most likely to invalidate the plan is met earliest. Implements the
calendar target port against JMAP, including removal (`apply` needs it),
verification counts and discovery counts. Wired into the nightly e2e on both
backends, beside the DAV calendar target rather than instead of it.

### T2 — contacts, T3 — files

Same shape. T3 is the largest: the file domain carries path normalisation, the
delta/removal channel, and the trashbin signal, none of which transfer for
free.

### T4 — surface + manifest truth

The target picker offers JMAP for these domains only where the server speaks
it; the scope manifest says which protocol carries which domain; ADR-0018's
"mail leads" line gets its dated update recording that the rest followed.

## Hard rules that bite here

- **Rule 1 (idempotency)** is the entire risk. A natural key that differs by
  transport is not an error — it is a duplicate, and a duplicate is a
  successful write nobody notices until a mailbox is twice its size.
- **Rule 9:** if the spike cannot establish a key equivalence, it says so.
  "Probably fine" is the answer that costs three connectors.
- **Rule 5:** the appliance ships this too; nothing here may become
  managed-only.
