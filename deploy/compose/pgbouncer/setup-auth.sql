-- The credential-lookup role PgBouncer authenticates clients with
-- (workplan 0082 T4).
--
-- PgBouncer's auth_query needs to read `pg_shadow`, which is superuser-only.
-- The standard arrangement — and the one here — is a dedicated, otherwise
-- powerless role plus a SECURITY DEFINER function that returns exactly one
-- user's verifier and nothing else. The alternative is either handing
-- PgBouncer a superuser (it would then be able to read every credential in the
-- cluster) or keeping a second copy of every password in a userlist file
-- (which then has to be edited and redeployed whenever a role changes).
--
-- Run once against the managed database, as the owner:
--   psql "$DIRECT_DATABASE_URL" -v pw="'…'" -f setup-auth.sql
--
-- :pw is the same password given to PgBouncer in userlist.txt.

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS pgbouncer_auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgbouncer_auth') THEN
    EXECUTE format('CREATE ROLE pgbouncer_auth LOGIN PASSWORD %L', current_setting('my.pw', true));
  ELSE
    EXECUTE format('ALTER ROLE pgbouncer_auth PASSWORD %L', current_setting('my.pw', true));
  END IF;
END
$$;

-- SECURITY DEFINER so the powerless role can read pg_shadow through it, and
-- STRICT so a NULL username returns nothing rather than scanning.
CREATE OR REPLACE FUNCTION pgbouncer_auth.user_lookup(IN i_username text,
  OUT usename name, OUT passwd text)
  RETURNS record AS $$
BEGIN
  SELECT s.usename, s.passwd FROM pg_catalog.pg_shadow s
    WHERE s.usename = i_username INTO usename, passwd;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STRICT;

-- Nobody but PgBouncer's lookup role may call it.
REVOKE ALL ON FUNCTION pgbouncer_auth.user_lookup(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA pgbouncer_auth TO pgbouncer_auth;
GRANT EXECUTE ON FUNCTION pgbouncer_auth.user_lookup(text) TO pgbouncer_auth;
