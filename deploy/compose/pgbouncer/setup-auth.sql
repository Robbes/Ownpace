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
-- Run once against the managed database, as the owner. The password comes in
-- as the SERVER-side setting `my.pw`, which the DO block below reads with
-- current_setting() -- not as a psql `-v` variable, which would be spelled
-- `:pw` and is never referenced here:
--
--   PGOPTIONS="-c my.pw=…" psql "$DIRECT_DATABASE_URL" -f setup-auth.sql
--
-- (An earlier version of this comment said `-v pw=…`. That silently leaves
-- my.pw unset, and current_setting('my.pw', true) then returns NULL, so the
-- role is created with a NULL password and every PgBouncer login fails with
-- a message about the password rather than about the role.)
--
-- deploy/compose/bootstrap-managed.sh does this for you, between bringing
-- postgres up and bringing pgbouncer up -- which is the only order that
-- works, because pgbouncer's healthcheck authenticates as this role.
--
-- my.pw is the same password given to PgBouncer in userlist.txt.

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS pgbouncer_auth;

DO $$
BEGIN
  -- Refuse an unset password rather than create a role that cannot log in.
  -- format('… PASSWORD %L', NULL) renders as `PASSWORD NULL`, which Postgres
  -- accepts and which means "no password" — so without this check the script
  -- reports success and PgBouncer fails authentication for ever afterwards.
  IF coalesce(current_setting('my.pw', true), '') = '' THEN
    RAISE EXCEPTION 'my.pw is not set. Run with: PGOPTIONS="-c my.pw=<password>" psql … -f setup-auth.sql (the same password as pgbouncer/userlist.txt)';
  END IF;

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
