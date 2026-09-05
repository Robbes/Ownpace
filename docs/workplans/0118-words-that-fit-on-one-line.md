# Workplan 0118 — Words that fit on one line

## Status — 2026-09-05 (update this block at the end of every session)

**2026-09-05, later: T2 built — the Connections page**, stacked on T1's PR. Small, as measured:
thirty `connections.` keys with three over budget and thirty-three `probe.` keys with five, three
of which are the invitation-safety sentences that stay verbatim and now sit in the guard's
allowance by name. One key changed its name: `connections.inUse.why` was a visible refusal
frame, not a fold, and a `.why` suffix would have exempted it from the budget; it is
`connections.inUse.reason` now, shortened to thirteen words.

**2026-09-05: T1 built — the wizard and the setup checklist.** The owner read the screens and
said what every reviewer of this product had been too close to see:

> *"I find the UIs having a lot of text. Texts are long and many are visual. Can you make
> them more to the point, and perhaps fold away more that is not yet relevant?"*

Measured before anything was changed: 1 036 English strings, 7 087 words; 62 strings over
twenty words, seven over forty, two over sixty. A third of all words sat on two screens — the
migration wizard and the provider checklist — and the wizard rendered about twenty grey hint
lines and eighteen explanatory panels at once. The longest single hint, under the Gmail app
password box, was 86 words.

Four decisions were put to the owner the same day and answered; they are the rule in §2.
T1 is this document's first slice and the proof that the rule can be kept by a test.

| Task | Status | Notes |
|---|---|---|
| T1 The wizard and the setup checklist | ✅ Done 2026-09-05 | Visible words under `wizard.*` + `setup.*`: **2 671 → 1 363**; longest visible line **96 → 15 words**; 36 strings over twenty words → 0. Nothing deleted that said something: 1 282 words now sit under folds (532 before). The `Hint` component and the budget guard land here. |
| T2 Connections | ✅ Done 2026-09-05 | Intro 36 → 11 words; the rotate hint folds its consequence under *Why?*; the "which side" tail 23 → 14; two labels; two probe sentences (no check for this kind, timed out) to 15. `connections.` and `probe.` under the guard; `probe.scheduling.*` named in `ALLOWED_OVER`. The add form was already behind its button, so nothing to fold there. |
| T3 The migration's own pages — Confirm, MappingDetail, Finish | 📋 Planned | `confirm.noMappings.how` (52), `confirm.snapshot.note` (29), `finish.intro` (29), `finish.step4.body` (30), ten Finish panels. Finish's step bodies are instructions: fold under How?, as the checklist does. |
| T4 Support, billing, sharing, moves, verify, login | 📋 Planned | `sharing.intro` (44), `moves.intro` (30), `verify.intro` (28), `login.noOrganisation.already` (33). Short screens; mostly intros that say what the heading already says. |
| T5 The verbatim set | 🔨 In progress | `grant.readOnly`, `grant.disclosure`, the `failure.*` remedies, the `probe.scheduling.*` lines: **not shortened** (owner, 2026-09-05). Each goes into `ALLOWED_OVER` with that reason as its prefix comes under the guard — `probe.scheduling.*` did in T2. |

## 1. Why this exists

The words were all true. That was the problem: every screen explained the product's stance
— read-only, measured not assumed, nobody sees your password — in full, every time, before
the first control. A hint carried what goes in the box, why, a prerequisite, a caveat, and
what to do instead. Six amber panels on the source step said, in forty to seventy words each,
what a checklist one link below already remembered step by step.

A person who has done this once does not read any of it; a person doing it for the first
time cannot find the sentence that matters. The fix is not fewer facts. It is one line on
screen and the rest one click away.

## 2. The rule (owner decisions, 2026-09-05)

| Question | Decision |
|---|---|
| How strict? | **Strict.** A hint is one sentence of at most 12 words. An intro is at most 15 words, or there is none when the heading says it. A label is at most 5. A placeholder shows the shape of a value, never a sentence. |
| Where do the long explanations go? | **Folded in place**, under the hint, behind a native `<details>` whose summary is one word: *Why?* under a field, *How?* under a checklist step, *More* under a chosen source. Nothing is deleted that said something. |
| May consent, safety and remedy sentences be shortened? | **No.** They are promises and remedies, not explanations. They stay verbatim and are named in the guard's allowance when their screens come under it. |
| What first? | **The wizard and the checklist**, in one PR with the guard. Then one screen family per PR. |

Two rules the owner did not have to be asked about, because the repository already holds them:
both languages change together (the dictionary's key parity is compile-time, and the guard
runs the same budgets over Dutch), and the fold is the one the app already used in six places
— native `<details>/<summary>`, no state, keyboard and screen-reader behaviour for free.

### 2.1 The shape

`apps/web/src/components/Hint.tsx` is the one shape a field hint has: a `<p>` of one line,
and, when there is a `why`, a `<details>` under it. A descriptor-driven field (the credential
descriptors in `@openmig/shared` carry keys, not prose) finds its fold by convention:
`x.hint` folds `x.why` when the dictionary has it, and a hint with nothing to fold renders
no fold. The checklist's step rows fold their how-to under the title, and the first step
still open starts open — the one somebody is on.

### 2.2 The guard

`apps/web/src/i18n/words-that-fit-on-one-line.unit.test.ts` runs the budgets over every key
under `BUDGETED_PREFIXES`, in both languages: `.hint` 12 words and one sentence, `.intro` 15,
`.placeholder` 8, `.title` 8, anything else that stays on screen 15; `.why`, `.more` and a
checklist `.detail` are folded and have no budget. The counter is pinned on its own snippets
first (a thirteen-word hint, a two-sentence hint, a placeholder that is a sentence), so a green
tree cannot be a counter that counts nothing. Each later slice adds its prefix; a sentence
that must run over is named in `ALLOWED_OVER` with its reason.

Proof by breaking, in the order it happened: the guard's first run over the rewritten
dictionary refused two English lines — `wizard.connectionName.taken` at 16 words and
`setup.needsAnotherPerson.hint` at 13 — that had been counted by eye as fitting. Both were
shortened; the Dutch passed first time.

## 3. What T1 changed, concretely

- **The source step.** Six amber panels became one grey line per picked source with *More*
  under it: *Uses your own Box platform app, authorised once by a Box admin.* The paragraph
  behind *More* is the old panel's text, and the checklist link below is unchanged.
- **Field hints.** Every descriptor hint is one sentence; the rest folds. The Gmail app
  password: *Personal Google accounts only; leave empty to use OAuth.* — 86 words became nine,
  and the 77 are one click away. The service-account key keeps its amber line, now
  *This key can read every user in the domain; revoke it at cutover.*, with the scope advice
  under *Why?*.
- **The front-door cards.** The archive card's hint was longer than a hundred words on a card
  the size of a business card; it is eleven now, and what an archive migration does is said on
  the source step once the card is picked. The Apple and Microsoft account cards lost the
  sentences about *other* cards.
- **Removed outright**, because the heading already said it: the wizard's subtitle, the hint
  under *Migration name*, the hint under *Select data types*, and the *Note:* lead on the
  review panel.
- **The checklist.** Each step is its title and what it yields; the how-to opens under *How?*,
  and the step you are on is open when you arrive. The intro went from 43 words to 14.
- **Labels and placeholders.** *Name this connection (so you recognise it later)* is
  *Connection name*; *Use your own Google application instead* is *Use your own Google
  client*; a placeholder like *e.g. 1234567890 — Admin Console → Users & Groups* is
  *e.g. 1234567890*, because the checklist already says where to look.

## 4. Not done, honestly

- **One sentence was dropped rather than folded.** The Google account card used to say that
  Gmail and Drive stay separate cards because they need a Google security review this product
  has not bought. It was about other cards, and a card is the wrong place for it; but it is a
  true reason a person might look for. It can come back as `wizard.about.google` under *More*
  if the owner wants it on screen.
- **Checklist details were not shortened**, only folded. They are console paths and exact
  settings; precision beats brevity there, and a fold costs the reader nothing until asked.
- **The other screens** (T2–T4) still carry their long copy, and the guard does not yet cover
  their prefixes. Each is one PR.
