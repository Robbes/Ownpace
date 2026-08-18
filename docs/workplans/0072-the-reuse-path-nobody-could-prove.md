# Workplan 0072 — the reuse path nobody could prove

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 testing a reused connection could never pass | ✅ **Fixed 2026-08-19** | `runProbe` posted `builtSourceConfig()` — values read out of the FORM. But choosing a stored connection is precisely what hides those inputs, so the form holds empty strings and the probe refused every time with *clientId, clientSecret, refreshToken are not set*: a complaint about fields the person had deliberately not been asked for. **Testing a reused connection could therefore never pass**, which makes the reuse path unproveable at exactly the moment somebody wants to prove it before committing. It now calls `POST /connections/:id/test`, the route that decrypts and probes what is actually stored — the one the Connections page has used since 0062. Mutation-verified: restoring the form-values probe fails the new test by name. |
| T2 deleting a connection asked the wrong question | ✅ **Fixed 2026-08-19** | The refusal counted rows from `mailbox LEFT JOIN mailbox_mapping`, which is not the question it claims to answer. A mailbox row outlives the migration that created it — the ledger hangs off `item.mapping_id`, never off the mailbox — so a connection whose migrations were all removed still answered 409, counting a row nothing referenced, and named no migration to go and remove **because there was none**. An unactionable no in front of a delete that was in fact safe. An `innerJoin` asks the real question. |
| T3 …and then said it in English | ✅ **Fixed 2026-08-19** | The same case is why the owner saw English on older connections and Dutch on newer ones: with no names to quote, `inUseMigrations` returned null and the client fell back to the server's English sentence. That fallback was 0071 T3's own choice and it was wrong — it reverted to English for the case a reader was *most* likely to meet. `mailbox_mapping.name` is genuinely nullable (the appliance writes rows without one), so the client now says *een migratie zonder naam* in its own language instead. |
| T4 a port asked for in a text box | ✅ **Fixed 2026-08-19** | Adding a target connection answered `port: Invalid input: expected number, received NaN` — a zod PATH and a zod SENTENCE, in English, naming a storage key, for a mistake the input could have prevented. The descriptor now carries `numeric`, so every door renders `type="number"` (the wizard's own port input always did), and `invalid_values` carries `fields` exactly as `missing_fields` does — one client localizer covers both. |
| T5 the blue credentials panel, again | ⛔ **Open — carried from 0071 T4** | Confirmed a second time on Dropbox: **App-sleutel**, then *Pad van de hoofdmap*, then a separate blue **Inloggegevens** box holding the account, the client secret and the refresh token. The values that come from one page of the provider's console are split by a field that belongs to neither. `credential-fields.ts` declares the right order and `CreateMapping.tsx` still does not read it. This is now the oldest open item and the next one to take. |
| T6 a connection you cannot name | ⛔ **Open — sharpened from 0069 T7b** | Testing a side in the wizard saves it as `dropbox · anna@acme.example` with no chance to name it and no rename afterwards. The owner asked for the name at the moment of saving, which is also when they know what it is for. Two connections can still take the same auto-name (0071 T7) — one fix answers both. |

## What this is

A third hour on the phone, and the first one that tested the *reuse* path end to end rather than
the create path. Everything it found sits on one seam: **a screen that has deliberately stopped
asking for values, still being driven by those values.**

T1 is the purest case. The wizard hides the credential inputs when a connection is chosen — that
is the feature — and then probed the empty boxes it had just hidden. T2 is the same mistake in
SQL: the delete refusal read a table that outlives the thing it was protecting. Both answered
confidently and wrongly, and both were invisible to tests that only ever walked the *fresh
credentials* path.

The rule this leaves behind: **when a screen stops asking for something, find every place that
was reading the answer.** Hiding an input is not a display change; it changes what the rest of
the code is allowed to assume.
