-- nextcloud-counters.sql — every id counter in the demo Nextcloud's Postgres
-- database set past the ids its column already holds (workplan 0150,
-- 2026-09-29; scripted 2026-10-03).
--
-- WHY THIS IS NOT NEXTCLOUD'S OWN STEP. Nextcloud's converter (`occ
-- db:convert-type`) copies every row with its id, so each counter has to be
-- moved past those ids afterwards, or the next row it numbers collides with a
-- copied one. Nextcloud 34 does that in its last step,
-- PgSqlTools::resynchronizeDatabaseSequences, which finds each counter's table
-- through the column whose DEFAULT names the counter. A counter no default
-- names stops it, with `SELECT setval('…', (SELECT MAX() FROM ))`: the tables
-- whose ids Nextcloud makes itself (oc_jobs, oc_previews,
-- oc_preview_locations, oc_preview_versions on a 34 install) and every
-- identity column. It stops after copying every table and before it switches
-- config.php, so the copy is whole and Nextcloud is still on SQLite.
--
-- HOW. A counter belongs to the column pg_depend says owns it (a serial's
-- OWNED BY, an identity column's own), so no default is needed to find it. It
-- is set to the highest id in that column WITHIN THE COUNTER'S OWN RANGE: a
-- column can hold ids Nextcloud generated itself (oc_jobs on the OTA stack held
-- 64-bit ones beside the small ones its int4 counter had made), and those are
-- not the counter's to skip; setval would refuse them as out of bounds. A
-- column with no id in range is set so the counter's next id is its start.
-- Each counter is set on its own: one that cannot be is named in a WARNING and
-- counted, and never stops the rest.
--
-- Run by nextcloud-to-postgres.sh inside the stack's postgres container, as
-- the owner, in the `nextcloud` database. The table prefix (config.php's
-- dbtableprefix) arrives as the setting `ownpace.nextcloud_prefix`, `oc_` when
-- it is not set. The last line it prints is `<set>|<not set>`.
-- scripts/a-counter-no-default-names.unit.test.ts runs it on PGlite against
-- every kind of counter the OTA stack and a fresh install held.
DO $$
DECLARE
  prefix text := coalesce(nullif(current_setting('ownpace.nextcloud_prefix', true), ''), 'oc_');
  r record;
  highest bigint;
  done int := 0;
  failed int := 0;
BEGIN
  FOR r IN
    SELECT s.oid::regclass AS counter, t.oid::regclass AS tbl, a.attname AS col,
           seq.seqmin AS lo, seq.seqmax AS hi, seq.seqstart AS first
      FROM pg_class s
      JOIN pg_namespace ns ON ns.oid = s.relnamespace AND ns.nspname = 'public'
      JOIN pg_sequence seq ON seq.seqrelid = s.oid
      JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid
                      AND d.refclassid = 'pg_class'::regclass AND d.refobjsubid > 0
                      AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE s.relkind = 'S'
       AND left(s.relname, length(prefix)) = prefix
     ORDER BY s.relname
  LOOP
    BEGIN
      EXECUTE format('SELECT max(%I) FROM %s WHERE %I BETWEEN $1 AND $2', r.col, r.tbl, r.col)
        INTO highest USING r.lo, r.hi;
      IF highest IS NULL THEN
        PERFORM setval(r.counter, r.first, false);
      ELSE
        PERFORM setval(r.counter, highest, true);
      END IF;
      done := done + 1;
    EXCEPTION WHEN others THEN
      failed := failed + 1;
      RAISE WARNING 'not set: % (% on %.%)', r.counter, SQLERRM, r.tbl, r.col;
    END;
  END LOOP;
  PERFORM set_config('ownpace.nextcloud_counters', done || '|' || failed, false);
END $$;

SELECT current_setting('ownpace.nextcloud_counters');
