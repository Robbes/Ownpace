# Workplan 0067 — the wizard's dead ends, and what a shared connection may not answer

## Status — 2026-09-05 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Box could not be selected at all | ✅ **Fixed 2026-08-17** | The Box source step renders a client id, a subject user id and a root folder id, and **no host** — but the step's gate fell through to the IMAP branch and demanded `sourceHost`, which nothing on that screen sets. Next was disabled forever and the line beside it named **Host**, a field that is not there. Box has been unreachable in the wizard since it shipped (PR #427); every test covering it went through the API, and the one wizard walk that exists is the IMAP path. Both the gate and the message now derive from one function, `sourceStepMissing()` — the two used to be separate switch statements that agreed by hand until a provider was added to one and not the other. |
| T2 the same bug, quieter, in Dropbox | ✅ **Fixed 2026-08-17** | Dropbox's field is labelled **"App key (from the Dropbox App Console)"**, because that is what Dropbox calls it, while the blocked-reason line said **"Client ID (application ID)"** — the same value under a name that appears nowhere on screen. Not blocking, so nobody would have reported it; just a person hunting for a field that does not exist. Found by the same test that found T1, which is the argument for asserting the property rather than the case. |
| T3 reuse was unreachable | ✅ **Fixed 2026-08-17** | The picker shipped in 0064 sat on the **credentials** step. The client id it exists to make unnecessary is gated on the **source** step, two steps earlier — so to reach the shortcut you first had to find the value it saves you from finding. And on arrival the credentials gate still demanded the secrets whose inputs the picker had just hidden, leaving Next disabled naming invisible fields. Both pickers now live on the step whose fields they replace (`ConnectionPicker`, source step and target step), and every gate drops its demand together with its input. |
| T4 what a reused connection may NOT answer | ✅ **Built 2026-08-17** | With the credential fields hidden, the "where" fields stay: Box's subject and root folder, Drive's root folder, Dropbox's root path, the target's folder prefix. That is 0066 T4(a), and it is what migration 0021's override columns were for. The split the UI now draws is the one the columns encode — **the connection answers *as whom do we sign in*, the mapping answers *whose data, and where*.** |
| T5 the override had to narrow, and it was not optional | ✅ **Done 2026-08-17** | 0066 T4(d) recorded that the override stored the FULL config shape and called it "harmless, a narrower projection would be tidier". It stopped being harmless the moment T3 hid the connection-level inputs: `sourceConnectionConfig` returns `{host, port, user, …}` unconditionally, so a reused IMAP connection would have written `host: undefined` into the override and `loadDomainConnections`' key-by-key merge would have applied it **over the connection's real host**. `sourceConfigOverride` / `targetConfigOverride` now project only the per-mapping keys and drop empty values, so a blank field means *inherit* and never *blank it*. 3 tests, one of which asserts no source type can carry a credential into the mapping row — overrides are plaintext JSONB. |
| T6 the hole T5 opened, closed | ✅ **Done 2026-08-17** | Reuse skipped **every** per-type demand, including Box's `userId`. With no subject the override is empty, the merge falls back to the connection's stored subject, and the migration reads whoever that connection was first created for — silently, with a green light, and with a correct-looking mapping name. ADR-0033's "one subject per mapping" is only true if every mapping states its subject, so the reuse path now demands it by name. Mutation-verified: replacing the guard with `if (false)` fails the test. |
| T7 not done, honestly | ⚠️ **(a) done 2026-09-05; (b)(c) stand** | (a) **The wizard's inputs are not associated with their labels** — no `htmlFor`/`id` pair anywhere in the form, so a screen reader reads ~30 unlabelled boxes. The tests here find a field the way a sighted person does, by looking next to the label, which works and is not what a real user with a screen reader gets. A bilingual product aimed at non-experts should fix this; it is ~30 mechanical edits and deserves its own change rather than riding along here. (b) The reachability table covers **source** types only; the five target types have no equivalent walk, and the target step's gate is simple enough that this is a guess rather than a finding. (c) Reuse still cannot be chosen for a provider whose connection kind the tenant has none of — correct, but the empty state says nothing, so somebody who expects the shortcut sees no explanation of why it is absent. **Board caught up 2026-09-05:** (a) is done, and smaller than it was — most fields had since come to render from the credential descriptor with an id, and most pages wrap the control in its label; the six sites still sitting beside their control (five in the wizard, one on Sharing) are joined by `htmlFor`/`id`, and `a-label-that-labels-nothing.unit.test.ts` reads every screen and component so a seventh cannot arrive. (b) and (c) stand. |

## What this is

Three dead ends in the form a customer's first hour depends on, one of which made a
shipped source type unusable, plus the storage bug that the third one turned from
cosmetic into data-corrupting.

The common cause is worth stating plainly, because it is the second time: **a step's gate
must check only the fields that step renders.** That sentence is already a comment in
`CreateMapping.tsx`, written when the same class of bug was fixed in 0037 T1 — the gates
then required usernames that render two steps later, and Next was disabled forever on the
first screen. It was fixed, the rule was written down, and then Box was added to the
markup and not the gate, and the reuse picker was added to a step that does not own the
fields it excuses. A rule in a comment does not hold. The test does:
`CreateMapping.reachability.unit.test.tsx` walks **every** source type as far as its own
first step and asserts two properties — Next becomes enabled once what is on screen is
filled, and the blocked-reason line never names a field the person cannot see. Adding a
source type without adding its row is the omission the table makes loud.

The second thing worth keeping is the shape of the T5/T6 pair. T5 was on the "tidier
someday" list; it moved to urgent because a UI change altered what reaches it. Storing
more than you need is free only while everything keeps filling it in — and the moment a
form stops asking, an over-wide write becomes an over-wide **overwrite**. Then closing T5
opened T6: narrowing the override made the missing Box subject load-bearing, where before
the full config had carried it by accident. Neither is visible from the other end of the
system, which is why both live in the same slice.

## The defects in one line each

| | What a person saw | What was wrong |
|---|---|---|
| Box | Next greyed out, "Still needed: Host" | The gate demanded a field the step does not render |
| Dropbox | "Still needed: Client ID"; no such field on screen | Gate and message named the value differently |
| Reuse | The shortcut appeared after the work it saves | The picker was not on the step it excuses |
| Reuse | Next greyed out naming hidden secrets | The gate outlived its own inputs |
| Override | *(nothing — yet)* | Would have overwritten a shared connection's host with `undefined` |
| Box reuse | *(nothing — ever)* | Would have migrated the wrong person's files, quietly |
