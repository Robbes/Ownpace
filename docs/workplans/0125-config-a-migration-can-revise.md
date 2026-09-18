# Workplan 0125 — Config a migration can revise

## Status — 2026-09-18 (update this block at the end of every session)

**2026-09-18, later still: T1 and T3 built, and §5 was wrong about the cost.** It said managed's
edit path meant "writing across `mailbox` / `connection` / `scope_selection` in one transaction".
For the field this plan exists for, it does not. `nativeFilePolicy` is a PER-MAPPING override in
`mailbox_mapping.source_config_override` — `sourceConfigOverride()` builds it at create, and the
column's own comment says why it exists: *"a shared connection cannot answer something that is
true of one mapping only."* So the PUT handler's note is true of a connection's server and
credentials and false of the override fields, and changing the export policy is a merge into one
jsonb column in the transaction that was already there. That also settles a question §3 left
open: the override is per mapping, so a change cannot reach another migration sharing the same
Google connection.

T1's two "needs a decision" rows are both **refused**, and the asymmetry is the argument:
permitting a change that orphans copied items is irreversible for the person it happens to, and
loosening a rule later is a line in a table. Neither refusal claims the change is impossible —
each says this product will not do it to a ledger that already holds items, and names the way
round it. T2 is untouched and §4 needs a decision first (see there). T5 untouched.

**2026-09-18, later: T4 built.** `policy_refused` is the ninth category, and the mechanism beside
it is the half worth reading: an error may now STATE its category, and a stated one beats a
matched one. §6 predicted both; one thing in it turned out to be wrong and the correction is
recorded there — the refinement that would only call it `policy_refused` when another policy is
measured stable **cannot fire**, because the three branches that reach it are all below the
`EXPORTABLE_NATIVE_TYPES` guard and every exportable type has two stable policies. A branch
nothing can execute is a branch no test can prove, so the claim is held by a guard over the
measurement table instead: add a Google type with nothing measured and it goes red, naming the
type. T1, T2, T3 and T5 are untouched.

**2026-09-18: opened.** The owner's live Google migration refused thirty files, and reading why
found three defects stacked on one another. The third is the one that shapes this plan, and it
is his: the two editions **disagree about whether a setting can change**, which is precisely
what hard rule 5 forbids about what a setting can *mean*.

| Task | Status | Notes |
|---|---|---|
| T1 What may change, and what it costs | ✅ Done — §3 | `config-revision.ts` in `shared`, called by both editions. A verdict per field, each refusal naming what to do instead; the export policy carries its consequence rather than hiding it. |
| T2 The appliance honours it at load | ⬜ | **Blocked on a decision, not on work.** The appliance keeps no copy of its previous config — `ensureMappingRecords` persists the tenant, the mapping id, source/target user and pattern, and nothing else — so there is nothing to compare a boot against. §4 |
| T3 Managed's edit path | ✅ Done — §5 | The PUT route applies the export policy (merged over the stored override, validated by the shared parser) and REFUSES what T1 refuses, out loud and all at once, instead of dropping a `sourceConfig` in silence. The form is not built. |
| T4 `policy_refused`, and an error that carries its own category | ✅ Done — §6 | Ninth category, migration 0051 (COMMENT only, as 0048 predicted). `NativeFileRefused` states its category; `classifyFailure` prefers a stated one. The owner's thirty split 21/9 the next time they are attempted. |
| T5 What happens to items refused under the old policy | ⬜ | Offered, never silent. §7 |

## 1. What the owner found

Thirty of his files sit `failed` on a live migration. Every one of them is a Google-native file
and every one carries prose that names the item and explains the trade — the 0042/#215–#219 work
doing exactly its job. Twenty-one of them say:

> *"…is not copied here because this migration is configured with `nativeFilePolicy="refuse"`.
> **Set an export policy on the mapping** — "export-odf", "export-office" or "export-pdf" — to
> migrate these, or move them out of scope."*

**Neither instruction can be carried out.** `nativeFilePolicy` appears in the entire web app in
one file, `CreateMapping.tsx` — the creation wizard. `PUT /api/migrations/:mappingId` parses a
`sourceConfig` and then drops it, saying so:

> *Note: name, sourceType, targetType, **sourceConfig**, targetConfig, syncConfig are not direct
> fields of mailbox_mapping — they would require updating related tables (mailbox, connection,
> scope_selection, collection_mapping)*

So the remedy names two actions the product does not have. That is the third instance of the
same shape in one day, after an Exchange PowerShell cmdlet offered to a Gmail account and a
refusal categorised `unknown` whose remedy is "send it to us".

And all thirty read `last_error_category = unknown`, so the Failures page — which groups by kind
× category and offers a press per group (#223) — puts the twenty-one a setting would fix in the
same bucket as the nine that can never move. Opposite remedies, one button.

## 2. The asymmetry, and why it is a rule violation

The owner's instinct was that the export picker *"should be a shared feature, not only in
appliance"*. The picture is the inverse of that, and the inverse is the stronger argument.

| | A picker | Changeable after creation |
|---|---|---|
| **Appliance** | ✗ none — `nativeFilePolicy` appears nowhere in `apps/selfhost/src` | ✓ it is a line in `mapping.json`; edit and restart |
| **Managed** | ✓ the wizard | ✗ frozen in the database |

The appliance has **changeability with no interface**. Managed has **an interface with no
changeability**. Neither has "change the format later" as a feature; the appliance gets it for
free because its config is a file its operator owns.

`config.ts:1087` already states the rule these two are breaking:

> *Exported, and called by both editions, because **hard rule 5** says they do not differ in
> behaviour: a `nativeFilePolicy` the appliance refuses must not be a `nativeFilePolicy` the
> managed edition silently accepts and then ignores.*

That rule is enforced for what the value **means** — one parser, both editions, and
`index.ts:191` says so from the managed side. It is not enforced for whether the value may
**change**, and there the two editions differ today. This plan extends the same rule one step.

**And the groundwork is already paid for.** ADR-0046 / 0042 T7(d) made the rendering scheme
travel with the content hash so no comparison crosses schemes — work that only matters if a
migration's export policy can differ over its life. Somebody left this door ajar deliberately.

## 3. T1 — what may change, and what it costs

A shared function, beside `parseGoogleDriveSource` and called by both editions: given the config
a mapping holds and the config somebody proposes, answer whether the change is allowed and what
it means for items already copied.

**Not a switch — a table with a reason per field**, because the fields are not alike:

| Field | May change | Why |
|---|---|---|
| `name` | yes | A label. Nothing reads it to decide anything. |
| `syncConfig` (cadence) | yes | The next pass simply happens sooner or later. |
| `sourceConfig.nativeFilePolicy` | **yes** | Safe *because* of ADR-0046: a rendering made under one policy is distinguishable from one made under another, so no later pass reads a policy change as a content change. This is the field the owner needs. |
| `sourceConfig.rootFolderId` | needs a decision | Narrowing scope leaves copied items outside it. Are they still ours? This plan must answer, not assume. |
| `sourceType` / `targetType` | **no** | A ledger full of items keyed against one system, pointed at another. Refused, loudly, with a sentence that says start a new migration. |
| `targetConfig` | needs a decision | Same shape as `rootFolderId`: what becomes of what is already there. |

The two "needs a decision" rows are the plan's real content. Guessing at them is how a config
edit quietly orphans somebody's data.

## 4. T2 — the appliance honours it at load

Today the appliance reads `mapping.json` and runs it. Change `sourceType` on a live migration
with a ledger full of items from the old source, restart, and **nothing stops you**. The
appliance has never had a rule about revision because it has never had a revision *event* — a
file is just read.

T1 gives it one. The appliance compares the mapping it is loading against the state the ledger
records and refuses what T1 refuses, in the appliance's own vocabulary, at boot, before a pass
runs. That is the guard it never had, and it is why this work is not "managed catches up":
**both editions gain something neither had.**

### And the thing that has to be decided before it can be built (2026-09-18)

**There is nothing to compare against.** `ensureMappingRecords` persists the tenant, the mapping
id, the source and target user and the pattern. Not the source type, not the target type, not the
root folder, not the export policy. The mapping file IS the appliance's record of itself, so "the
mapping it is loading" and "what it was last time" are the same string.

Two ways, and the choice is the owner's:

- **Persist the revision-relevant fields at boot** and compare on the next one. Honest, and the
  only one that can see a `sourceType` change — the case §4 leads with. Costs a migration, and the
  first boot after the upgrade has nothing stored, so it must record rather than refuse.
- **Use only what already persists** (`mailbox.address`, for the source and target user). No
  migration, and it cannot detect a source or target type change at all — it would guard the cheap
  case and leave the dangerous one open, which is close to the shape this plan is about.

## 5. T3 — managed's edit path

The same rule, a different arrival. A form and a route that change what T1 permits and refuse
what it does not, writing across `mailbox` / `connection` / `scope_selection` in one transaction.

**The note that stood in the way was half true, and the half that was false was load-bearing.**
It said name, sourceType, targetType, sourceConfig, targetConfig and syncConfig *"would require
updating related tables"*. True of a connection's SERVER and CREDENTIALS. Not true of the fields
that say whose data this mapping moves: those are per-mapping and live in
`source_config_override` on the row the route already updates. So what shipped is narrower than
this section imagined and does more:

- **The export policy is applied**, merged over whatever the override already holds — never
  replaced. That column also carries a Box subject, a Drive root and an archive path, and a fresh
  object would blank them and fall the next pass back to the connection's own subject, undoing
  ADR-0033's one-subject-per-mapping rule with a settings save. It is validated through
  `parseGoogleDriveSource`, so a value the appliance's mapping file refuses is not one this route
  stores.
- **A refused field is refused out loud**, 409, every one of them at once, each with T1's reason.
  Dropping it silently is what the route did, and it is the failure hard rule 9 is about: a caller
  who changed the root folder and got 200 back has been told the change landed.
- **`name` and `schedule` are permitted by the table and not written here.** This route does not
  have them yet, and collecting them into the refusal check would put them through a test they
  pass and change nothing — which reads like support they do not have.

Not built: the FORM. The route is what a form would call, and the remedy sentence
`policy_refused` shows still names a setting with no screen behind it in managed.

## 6. T4 — `policy_refused`, and an error that carries its own category

The owner chose this on 2026-09-18, asked which of two shapes: one category for all thirty, or a
new one separating the twenty-one a setting would fix. He picked the second.

**Adding a category is cheap, and migration 0048 says why.** The column is plain `text` with no
CHECK, deliberately:

> *the six are product vocabulary, expected to be revisited against real incidents (`unknown`
> staying large is the signal), and a database enum makes each revision a migration with a lock.
> The application owns the vocabulary.*

0048 was the first revision and needed no lock: *"two values added to a TypeScript array and a
COMMENT that stops being wrong."* This is the second, and takes the same shape.

**The second half is the mechanism, and 0048 is the precedent there too.** It faced exactly this
problem — a source refusal and a target one read identically, *"so matching harder could not have
found this"* — and solved it by carrying what the throw site knew:

> *the category is now `classifyFailure(error, side)` where it was `classifyFailure(error)`, and
> nothing else moved.*

`classifyFailure` is a regex over message text. `NativeFileRefused` is **our own** error, built
by us, which already knows exactly what it is — it carries `markNeedsDecision(this)` and nothing
else. So a classifier written to guess at other people's error strings is left guessing at ours,
and guesses `unknown`. The error carries its category the way it already carries its decision
marker, and `classifyFailure` prefers a stated category over a guessed one.

The split, by the code that already exists:

- **not in `EXPORTABLE_NATIVE_TYPES`** (forms, maps, the shortcut) → `source_refused`. Drive
  cannot produce a file in any format; no setting changes it.
- **`policy === 'refuse'`, or a policy with no rendering, or measured `unstable`** →
  `policy_refused`. The source would hand it over; this migration declined.

**Rows written before today keep the category they were given**, which is 0048's rule and right
for the same reason: rewriting them would be a claim about a failure nobody re-observed. They
reclassify when they are next attempted, which T5 is how.

### What was built, and the one thing above that was wrong

The split shipped is the **exportable / not-exportable** one and nothing finer. The bullets above
add a condition — `policy_refused` only where another policy is measured stable — and it was
written, and then removed, because **it cannot fire**. All three of its branches sit below the
`!EXPORTABLE_NATIVE_TYPES.has(mimeType)` guard, and every exportable type has at least two stable
policies (`EXPORT_STABILITY`, complete since 2026-09-17). A branch nothing can execute is a branch
no test can prove, and this repository's rule is that every guard is proved by breaking it.

The claim is still worth holding, so it is held where it is checkable: a guard asserts that **every
exportable type keeps a stable policy to switch to, whichever one is in force**. The way it would
break is ordinary — Google releases a type, somebody adds it to `EXPORTABLE_NATIVE_TYPES` so the
refusal stops saying it can never be exported, and nobody runs the instrument — and the guard goes
red naming the type and the policy, rather than a `policy_refused` shipping with a remedy that
names no format.

**The boundary this task did NOT cross: the domain level.** `markFailed` still classifies from the
message and the side. A `NativeFileRefused` is per item and parked on sight, so it cannot reach
there, and building an untested path for a case that does not arise would be the speculative half
of this work. When something does state a category at the domain level, that is the day to plumb
it — one line, beside `failureSideOf`, exactly as here.

## 7. T5 — the items refused under the old policy

Change the policy and the twenty-one should become eligible again. Two ways, and the house has a
strong preference:

- **Automatic** — the change resets them. A silent bulk mutation of the ledger, which this
  codebase consistently refuses to do.
- **Offered** — the change reports *"21 items were refused under the old policy"* and the owner
  presses. The bulk press already exists (#198/#199, "Retry all N matching this"), and
  `policy_refused` from T4 makes them exactly the group it selects.

Offered. And one thing this task must establish rather than assume: whether a
`markNeedsDecision` item is retryable by that press at all. If it is not, that is part of this
work — a decision recorded is not a decision that can never be revisited.

## 8. Gates

Standard: `pnpm lint`, `SKIP_STALWART=true SKIP_NEXTCLOUD=true pnpm test`, then `pnpm typecheck`
**last** — vitest strips types, so a typecheck run before the final file is written has not run.

Every guard proved by breaking the code it guards. For T1 that means a fixture per row of the
table, including both refusals; for T2, a mapping file that changes a forbidden field and a boot
that stops because of it.

## 9. Not in this plan

- **The wizard's chooser** — it exists and works (#988 made it reachable for the Google account
  kind). This plan is about afterwards.
- **A second export measurement.** `EXPORT_STABILITY` is filled (0042 T0 Q3, closed 2026-09-17);
  T1 leans on it and adds nothing to it.
- **Re-reading items to heal old categories.** See §6: rows keep what they were given.
