-- The target handle every item claimed not to have.
--
-- `PgLedger` wrote `target_ref` as `JSON.stringify({ id })` into a drizzle
-- `jsonb` column. Drizzle serialises what it is given, so the JSON *text* was
-- stored as a jsonb string scalar — `"{\"id\":\"abc\"}"` — instead of the
-- object `{"id":"abc"}`. Two consequences, both silent:
--
--   * `target_ref->>'id'` is NULL on every row ever written, so no SQL can find
--     an item by the handle the target gave back;
--   * `mapRowToRecord` reads `(row.targetRef as {id}).id` off a string, gets
--     `undefined`, and hands `''` to everything downstream.
--
-- Found by the managed e2e gate (workplan 0084) the first time its apply half
-- was allowed to run: the ledger held `copied` items that all claimed no target
-- handle. The write is fixed in `ledger.ts`; this repairs what it already wrote.
--
-- Only rows that are actually double-encoded are touched, and only when the
-- decoded text is an object — so this is idempotent, and a row that somehow
-- holds a plain string is left alone rather than crashing the migration on a
-- cast. Re-running changes nothing.
UPDATE item
   SET target_ref = (target_ref #>> '{}')::jsonb
 WHERE jsonb_typeof(target_ref) = 'string'
   AND left(ltrim(target_ref #>> '{}'), 1) = '{';
