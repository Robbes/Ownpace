# Workplan 0066 — deletion, per-mapping config, and which edition gets what

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 deleting a connection | ✅ **Done 2026-08-17** | `DELETE /api/connections/:id`, and **the refusal is the feature**. `mailbox.connection_id` cascades on delete and `item` hangs off the mailboxes, so letting this through for a connection in use would not fail loudly — it would take the mailboxes and the entire migration ledger with them, silently, and the next pass would re-copy everything as though it had never run. Hard rule 2 is about not destroying a customer's data on their servers; this is about not destroying the record of what we already did with it, which is the same promise wearing different clothes. So it refuses while anything uses it and **names the migrations**, because "3 mailboxes" is a number while "Acme mail" is something a person can go and deal with. Deletion proceeds only at zero usage. 2 tests. |
| T2 per-mapping config over a shared connection | ✅ **Done 2026-08-17** | Migration 0021 adds `source_config_override` / `target_config_override` to `mailbox_mapping`, and `loadDomainConnections` merges them **over** the connection's config, key by key. The split they encode is the point: the **connection** answers *as whom do we sign in* (credentials, provider), the **mapping** answers *whose data, and where* (a Box subject user id, a Drive root folder, a Dropbox root path, a Graph mailbox). Every one of those is a decision about that migration rather than a property of the account — ADR-0033 already says a mapping's blast radius is one subject, which a shared connection cannot express alone. Before this, reuse silently inherited the connection's root, so "same account, different folder" required a duplicate connection holding the same secret twice. NULL means nothing to override, so every existing mapping is untouched and the merge is a no-op for them. Create records an override only when a connection is REUSED — a mapping with its own connection already has these on it, and writing them twice would make two places that can disagree. |
| T3 which edition gets what | ⚠️ **Half right, and corrected 2026-08-17 — read the note below the table** | The owner asked whether the new surface should be more generic. **The checklist half stands:** it is edition-neutral and now works on the appliance — creating a Box app and getting an admin to authorise it is the same work either way, so `apps/selfhost` answers the same two routes over the same table, scoped to the one tenant every configured mapping shares, and the shared UI needed no edition branch. `/docs` works on the appliance for free, being static. **The connections half was justified with reasoning I invented and presented as settled**, and is now the subject of [ADR-0034](../adr/0034-appliance-configuration-surface.md). What actually shipped is unchanged — Setup and Guides for everyone, Connections for managed — but it is now an *unbuilt gap with a proposed decision behind it*, not a principle. |
| T4 not done, honestly | ⛔ | (a) ✅ **Closed 2026-08-17 in [workplan 0067](./0067-wizard-reachability.md)** — the reuse path now keeps the per-mapping "where" fields visible, which also uncovered that the picker was on the wrong step entirely. (b) Deletion has no UI confirmation step; it goes straight to the server, whose refusal is the safety. That is deliberate for a call the server can always refuse, but a "3 mailboxes use this — really?" dialogue would be kinder if deletion ever becomes possible at non-zero usage. (c) The appliance's checklist has no auth: the appliance is single-operator behind its own perimeter, like every other route there — stated rather than assumed. (d) ~~`sourceConnectionConfig` is reused to build the override … Harmless … a narrower projection would be tidier.~~ ✅ **Closed 2026-08-17 in [workplan 0067](./0067-wizard-reachability.md) — and it was not harmless.** Once the wizard stopped asking for host/port on the reuse path, the full shape would have written `host: undefined` over the shared connection's real host in the key-by-key merge. "Tidier someday" became urgent because a change at the other end of the system altered what reaches it. |

## What this is

The three things the previous PR listed as deliberately absent, now closed — and one of them
turned out to be a question about the product rather than the code.

"Should the surface be more generic?" has different answers for its two halves. A checklist
tracks work a **person** does in someone else's console, which is edition-neutral —
withholding it from appliance operators would have been arbitrary, so it is now shared.
Connections management edits **state this product owns**, and there the answer is a product
decision rather than a code one.

## The T3 correction — what I got wrong, and how

T3 originally read: *"an appliance's connections come from mapping FILES, which are the
operator's source of truth and are version-controlled. A UI editing them would either lie
(the file wins on restart) or quietly rewrite a file somebody owns."*

Every clause of that is either my own inference or plainly false, and it was written in the
voice of a decision the project had made. The owner asked **"but why??"**, which is the only
reason it was caught.

- **No ADR says it.** Files-as-source-of-truth is workplan 0010's implementation choice for a
  first slice. Nothing ever elevated it, and ADR-0026 ("An MSI that installs an appliance
  whose only operating surface is `curl` does not serve the person the installer exists for")
  and ADR-0027 ("end users never touch bash, a Linux filesystem, or Docker") both point the
  other way.
- **"The file wins on restart" is not what the code does.** The appliance seeds connections
  `ON CONFLICT (id) DO NOTHING`, so an existing row is left alone.
- **The real situation is worse than the one I described.** The appliance's `connection` rows
  are bookkeeping that exists only to satisfy foreign keys from `mailbox` and `group_def`;
  their `config` JSONB holds dev-fixture placeholders, and no code path that opens a
  connection reads them — the sync pass builds connectors straight from the `MappingConfig`.
  `buildDepsFromMapping`, which does read connections out of the ledger, is imported only by
  `apps/worker`. So a connections UI on the appliance would not lie *because a file overwrote
  it*; it would lie because **there is currently nothing there for it to edit**.
- **The persona argument was never made.** "Self-host" is two people: a fleet operator running
  Docker Compose, for whom files are the feature, and a Windows MSI user who is currently asked
  to hand-edit a JSON file and a batch script of `set` lines. The second person is exactly who
  ADR-0027 exists for.

[ADR-0034](../adr/0034-appliance-configuration-surface.md) is the decision this should have
been from the start: the UI becomes a real door on the appliance, files stay first-class and
unchanged, ownership is **per object and never merged**, and the appliance generates its own
encryption key so nobody is asked for one. It is Proposed, not Accepted — which is the honest
status, and the difference between it and what T3 said before.

The lesson is not about editions. It is that **"deliberately"** is a word that should require a
citation. T3 used it to describe a gap that existed because nobody had built the feature, and
the confident tone is what made it survive review — mine included.
