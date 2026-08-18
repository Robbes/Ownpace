# Workplan 0069 — testing a connection is what saves it

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the owner's reframing | ✅ **Adopted 2026-08-17** | The ask was "intermediate storing", and the owner supplied the design worth having: store **the source that works and the target that works** as connections, so what remains is finalising the migration between them — a name, a schedule, and so forth. That is better than persisting form state, because the expensive half of this wizard was never the form. It was the trip to somebody's admin console. |
| T2 test, and keep what works | ✅ **Done 2026-08-17** | The probe button was transient: it proved the credentials and then discarded them with the rest of the form at the next navigation. It now calls `connectionsApi.add`, which probes and stores, and a side that passes becomes a stored connection whose id the wizard holds from then on — at which point the credential inputs collapse (existing behaviour) and the pickers on steps 1 and 2 offer it if you walk back. Leaving now costs a name and a schedule. |
| T3 retrying rotates, it does not accumulate | ✅ **Done 2026-08-17** | `POST /connections` stores a FAILING credential deliberately — somebody mid-setup waiting on an admin should not lose it (0063 T4). Left alone, that would leave a broken connection behind every corrected typo. So the first test on a side adds, and every retry **rotates that same row**. Rotation also probes before it replaces, so a worse second attempt cannot destroy a working first one. A side already reusing a stored connection is not saved again — there is nothing of ours to save, so it stays the plain read-only probe it always was. |
| T4 the cheap half, remembered | ✅ **Done 2026-08-17** | Name, accounts, hosts, roots, domains and schedule go to `sessionStorage` on change and are restored on mount; a malformed draft falls back to a blank wizard rather than breaking it, and a successful create clears it so the next wizard does not inherit the last one's name. |
| T5 the secrets, deliberately not | ✅ **Locked 2026-08-17** | Every secret is absent from the draft, and that is the half worth a test rather than a comment. Writing a client secret or a mailbox password into web storage would put a credential where every script on the page can read it, when the product's whole posture is that secrets live encrypted and server-side. The test types into **every** `input[type="password"]` the credentials step renders and asserts on the STORED PAYLOAD — not on the allow-list that produced it — so a field added later cannot drift in unnoticed. Mutation-verified: widening the allow-list to the whole form fails it, by field name. |
| T6 what this cost elsewhere | ✅ **Handled 2026-08-17** | The wizard is now stateful across mounts, so its own tests inherited each other's answers — nine failures, all from one cause. Fixed with a file-level `sessionStorage.clear()`, not a per-describe one: a draft outlives a describe block too. Worth noting rather than quietly patching, because "the tests broke" was the correct signal that the component's contract had genuinely changed. |
| T7 not done, honestly | ⚠️ **(a)(b)(c) done 2026-08-19; (d) stands** | (a) **The step order still splits a side's credentials from its provider.** The natural shape of the owner's design is that each side is self-contained — pick provider, enter credentials, test, saved — and then one step finalises the migration between two connections. That is a restructure of a form a customer's first hour depends on, and it is deliberately not bundled with the behaviour change. (b) **Auto-generated names are plain** (`box · anna@acme.example`) and there is no rename. Fine while the Connections page can delete, worse once a tenant has twenty. (c) **A saved-but-failing connection is invisible in the wizard** — it exists, and the picker will offer it later with its unhealthy status, but at the moment of failing the wizard says only what went wrong, not "we kept this". (d) The draft is per browser tab and dies with it; deliberate, but it means a phone that reaps the tab loses the cheap half anyway. **Update 2026-08-19: (a) is workplan 0070 and then 0075 — each side is self-contained AND asks in the descriptor's order. (b) is workplan 0076 — the name is asked for at the moment testing saves it. (c) is workplan 0079 T4 — a failing credential now says it was kept. (d) still stands and is still deliberate.** |

## What this is

The owner asked for the wizard to stop forgetting, and proposed the right shape for it:
persist the *tested connections*, not the form.

The reason that is better is worth keeping. Workplan 0064 argued that the wizard-draft
problem was "mostly moot" because credentials could be saved once as a connection — and then
left the wizard unable to *produce* one, so the only route to a stored connection was the
Connections page, which nobody visits before their first migration. The feature existed on
the wrong side of the door. Testing was already the moment a person proves a credential
works; making that moment the one that saves it costs a button label and gives the wizard
durability without persisting a single secret.

The rule this leaves behind: **what is expensive to obtain should be stored by the thing
that proves it works, and what is cheap to retype should not be stored anywhere it can
leak.** The split is not "important vs unimportant" — it is "costly to re-acquire vs costly
to have stolen", and those point in opposite directions.
