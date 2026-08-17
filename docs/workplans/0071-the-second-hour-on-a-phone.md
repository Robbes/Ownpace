# Workplan 0071 — the second hour on a phone

## Status — 2026-08-18 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 rotating a credential was impossible for almost everything | ✅ **Fixed 2026-08-18** | `Connections.tsx` re-asked `f.secret \|\| f.key === 'username'`; the rotate route validates every `f.required`. Dropbox's App key is required and **not** secret, so the panel could not supply it and the refusal read `Still needed: clientId.` beside a form with no such box. Rotation was a dead end for `box`, `dropbox`, `graph`, `oauth2`, `imap` **and every target** — it worked only for the four Google types, and only because their client id happens to be optional. Now `f.required \|\| f.secret`, which is the route's own rule; the non-required extras still stay out, which was the original point. **This is the fourth time a gate has demanded a field its screen does not render** (0037 T1, 0067 T1, 0067 T2), and the first three were each fixed for the one provider that surfaced them — so this one is pinned by a table over every stored `connection.kind`. Mutation-verified: restoring the old filter fails **9 of 13** rows, naming the provider and the field each time. |
| T2 a refusal that named a database column | ✅ **Fixed 2026-08-18** | `Still needed: clientId.` was wrong twice over in front of a Dutch operator: English, and naming the STORAGE key rather than the label on screen (*App-sleutel*). The route now answers `{ error, fields: ['clientId'], reason }` — the keys are the stable handle, `reason` stays English for callers with no dictionary. The client resolves each key through `credentialFieldsFor` to the label the input already carries, and renders the same `wizard.missing.lead` sentence the wizard's blocked-Next line renders. Both doors — add and rotate — go through it. |
| T3 the delete refusal, in two lines and in Dutch | ✅ **Fixed 2026-08-18** | 0068 T4 was right that this refusal must answer **why**, **what to do first** and **where**, and wrong about where those words live: as one English string on the route it reached the owner as five clauses of untranslated English. The 409 now carries `migrations: string[]` and `used`; the frame is `connections.inUse.*` in the dictionary, authored in both locales. Same rule as T2 — **the names are the finding and render verbatim, the sentence around them is ours**. It also had no test at all, which is how a paragraph nobody could read shipped; it has two now. |
| T4 the blue credentials panel splits a provider's own values | ⛔ **Open — this is the next one** | On a Drive source the order a person meets is Client-ID → Hoofdmap-ID → Serviceaccount-sleutel → *[blue box]* Gebruikersnaam → Clientgeheim → Refresh-token. The three OAuth values that come from **one page of the Google console** are split across two visually different panels with two unrelated fields wedged between them. `credential-fields.ts` already declares the sensible order (username, clientId, clientSecret, refreshToken, then the optional extras) and the wizard does not use it — it has its own hand-written JSX per provider plus a generic credentials panel bolted on the end. 0070 moved that panel to the right *step* and stopped there. The fix is to render the source step FROM the descriptor, one panel, in its order. |
| T5 asterisks that are not the gate | ⛔ **Open** | On a Google source both **Client ID** and **Refresh token** render `<Required />` unconditionally, while `sideStepMissing` requires them only when no service-account key is pasted (ADR-0033's either-flow). The red asterisk lies the moment somebody chooses domain-wide delegation. Same fix as T4 — a descriptor-driven field list can carry the condition; hand-written JSX has to remember it. |
| T6 the created-then-vanished migration, REPRODUCED | ⛔ **Open, now actionable** | 0068 T10b was a report with no diagnosis. The owner reproduced it 2026-08-18 and this time the screen answered with reference `e133a809` — 0068 T10c's correlation id doing exactly what it was built for. The migration was genuinely never created (the create route 500'd), so "I could not find it afterwards" is correct behaviour; what is wrong is that a red box and a confirm page are hard to tell apart on a phone. **Do not guess at the cause — read the log line.** |
| T7 two connections, one name | ⛔ **Open** | Testing the same side in two separate wizard sittings creates two connections with the identical auto-name (`dropbox · anna@acme.example`). `draftConnection` is component state, so a second sitting has no memory of the first and **adds** where 0069 T3 intended a rotate. 0069 T7b already noted the names are plain and unrenameable; this is the sharper version of it. |
| T8 the setup checklist speaks in type names | ⛔ **Open** | `Setup.tsx` titles the page `{t('setup.title')} — {data.provider}`, i.e. the raw wizard type. Nobody can guess `oauth2` means Entra ID. The provider cards need display names, and the same names belong in the chooser. |
| T9 back goes somewhere you were not | ⛔ **Open** | The setup checklist's back link is a hardcoded *← Back to the migration wizard*, so reaching it from **Connections** (which links there per 0065) sends you to the wizard instead of back. |
| T10 the dashboard counts are not links | ⛔ **Open** | Total / active / paused / cutover / done are plain `<div>`s. They are the obvious way into a filtered Migrations list and do nothing. Small, and an owner decision about what each should filter to. |

## What this is

A second hour of the owner testing on a real Android phone, against the build that
merged 0068, 0069 and 0070 — and the first chance to confirm 0068's own fixes with the
person who reported them.

**0068's fixes hold.** T1's readable refusals, T2's provider chooser, T3's admin question,
T7's field-that-followed-you, T9's Android layout: all confirmed by the reporter. That is
worth recording, because a fix nobody confirms is a claim.

What this round found is a different shape from 0068's. 0068 was mostly *screens that
never rendered what the server said*. This is mostly **prose authored on the wrong side of
the wire** (T2, T3) and **a form that cannot satisfy its own route** (T1) — and the two are
related, because T1 was only visible at all through the refusal T2 fixes. A dead end that
answers `Still needed: clientId.` reads as a translation gap; a dead end that answers *Nog
invullen om verder te gaan: App-sleutel* reads as a form missing a box, which is what it was.

The rule this leaves behind, and the one T4 will apply next: **the descriptor already knows
what a provider needs — every screen that asks for credentials should be reading it rather
than restating it.** `Connections.tsx` reads it and had one filter wrong. `CreateMapping.tsx`
does not read it at all, and T4/T5 are what that costs.
