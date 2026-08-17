# Workplan 0064 — reusing a connection, and what the wizard's JSX actually needs

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 reuse at mapping-creation | ✅ **Done 2026-08-17** | `CreateMappingSchema` gained optional `sourceConnectionId` / `targetConnectionId`. When one is set the per-type credential demands are skipped — that guard is the whole feature, since "pick the Box connection you added last week" is impossible if the schema still insists on its client secret. What is NOT skipped: `username` (it names WHICH mailbox this mapping moves, which a shared connection cannot know) and every domain-coherence check (those are about this mapping, not the credential). The handler branches to reuse instead of insert, and **verifies before it trusts**: the row must belong to this tenant and hold the right role, because an id is a client-supplied value and a mapping pointed at another tenant's connection would read their mail. A mismatch is a named refusal, never a silent fall back to creating a new row — falling back would quietly store the credentials the caller was trying not to re-send. 4 coherence tests. |
| T2 the wizard offers it | ✅ **Done 2026-08-17** | The credentials step lists the tenant's existing source connections **of the matching kind** (a client-side `sourceKindOf` mirroring the server's `sourceKindFor`, so the picker never offers a connection the create route would reject). Choosing one hides the credential inputs, because a field that is ignored is worse than one that is absent. Failing to load the list does not block the wizard — it just cannot offer the shortcut. |
| T3 the wizard's per-provider JSX | ✅ **Judged, and the useful half built** | The ask was "what do you think is needed". My answer: **not the rewrite**, at least not bundled here. The duplication looks like the problem and is not — the wizard's per-provider markup also carries behaviour the descriptor does not model (the shared-drive and shared-folder browses, the file/mail domain pinning, the setup panels, the DWD textarea's gating), so switching it wholesale means either modelling all of that in the descriptor or losing it. What actually matters is that the two doors could DISAGREE about which fields a provider needs. That risk is now closed from three sides without touching the markup: the coverage lock (0063 T3) pins the descriptor against the server schema, `create-coherence` refuses a missing credential by name, and a new lock asserts every descriptor label resolves in **both** locales — the one failure nothing else catches, since a missing string renders the KEY and asks somebody for `wizard.dropboxAppKey`. I also wrote the obvious wizard-walk test that renders the real wizard and compares its labels to the descriptor, and **deleted it**: it was brittle against step navigation, and a flaky lock is worse than none. |
| T4 not done, honestly | ⛔ | (a) Reuse is offered for the SOURCE only; the target picker is the same shape and unbuilt. (b) A reused connection's `config` is used as stored, so a mapping reusing a Drive connection inherits its `rootFolderId` — fine for the common case, wrong for "same credentials, different folder", which needs per-mapping config overriding a shared connection's. Not attempted; it is a real design question, not an oversight. (c) Rotation is still unbuilt (`POST /api/connections` minus the insert). (d) The wizard still renders per-provider fields as JSX, deliberately (T3) — when it is eventually switched to the descriptor, the label lock should keep passing unchanged, which is the point of writing it that way. |

## What this is

The feature that makes "the wizard forgets what I typed" mostly moot: the expensive half of that
form is the credentials, and they are now saved once, probed, and picked from a list. What
remains forgettable is a name, a schedule and some checkboxes — seconds to retype, and worth far
less than the security cost of persisting half-typed secrets anywhere.

The T3 judgement is the part worth remembering. Duplicated code between two doors is not
automatically a defect; **duplicated code that can silently disagree** is. Three locks now make
disagreement fail loudly, at a fraction of the risk of rewriting a form that a customer's first
hour depends on.
