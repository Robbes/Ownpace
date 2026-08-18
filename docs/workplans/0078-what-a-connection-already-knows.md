# Workplan 0078 — what a connection already knows

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 rotation asked for values it already held | ✅ **Fixed 2026-08-19** (owner decision) | *Inloggegevens vervangen* presented every field empty, so fixing an expired secret meant retyping the server address and the account name that had not changed. The owner chose the boundary: **prefill from `connection.config` only.** That config is plain JSONB written by the create route's builders — which server a migration talks to, where it is rooted — and the encrypted credential record is never opened, so *SECRETS NEVER COME BACK OUT* needs no exception carved into it. `knownConnectionValues()` lives beside those builders because it is where two vocabularies meet: the builders write the ENGINE's names (`user`, `mailbox`), the descriptor and every form speak their own (`username`). One translation, tested. |
| T2 what the boundary does NOT cover | ⚠️ **Recorded, because it is the case that prompted it** | The owner met this on **Dropbox**, and Dropbox is the provider it helps least: its config holds only `rootPath`, so the App key — the field they were retyping — still has to be retyped, because it lives encrypted. IMAP sources and jmap/imap targets get host, port and account prefilled; Box gets its user id; Graph gets its tenant and mailbox; Dropbox and the Google OAuth trio get nothing. That is the chosen boundary working exactly as specified, and it is written down here rather than left to be rediscovered. Widening it means returning non-secret identifiers out of the encrypted record — the option the owner declined 2026-08-18, and the one to revisit if retyping App keys stays annoying. |
| T3 the property that lets it exist | ✅ **Locked 2026-08-19** | No secret can be returned, protected twice: the candidate map names only non-secret keys, and the descriptor filter drops anything marked `secret` whatever the map says. **Mutation-verified, with a non-obvious result worth recording**: removing the descriptor filter alone does NOT fail the test, because the candidate map still holds. What fails it is the realistic future mistake — adding a secret to the candidate map — which passes with the filter present and fails by name without it. The filter is not decoration; it is what makes the map safe to edit. |

## What this is

The smallest of the open findings, and the one whose value is mostly in where the line got
drawn rather than in the code.

The tempting version of this fix reads the encrypted record and hands back "the bits that
are not really secrets" — the OAuth client id, the App key, the account name. Every one of
those is defensible on its own, and together they turn a sentence with no exceptions into a
sentence with a list. `config` has no such problem: nothing in it was ever secret, so
nothing has to be argued about.

The cost is T2, and it is real: the provider that prompted the complaint is the one the fix
does least for. Recording that plainly is the point — a fix that quietly does not address
the reported case is worse than one that says so.
