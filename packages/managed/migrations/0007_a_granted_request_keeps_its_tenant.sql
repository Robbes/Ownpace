-- The foreign key and the check constraint were saying different things
-- (workplan 0093 T6, found by CI).
--
-- `access_request` has both of these, from migration 0002:
--
--     tenant_id ... REFERENCES public.tenant(id) ON DELETE SET NULL
--     CHECK ((state = 'granted') = (tenant_id IS NOT NULL))
--
-- `ON DELETE SET NULL` says "if the organisation goes away, forget the link".
-- The CHECK says "a granted request ALWAYS names one". Both cannot hold: nulling
-- the column on a granted row is exactly the state the CHECK forbids.
--
-- So deleting a tenant that a granted request points at does not cascade — it
-- fails, with `access_request_granted_tenant_check`. The database was right to
-- refuse; what was wrong was the message, which named a constraint on a column
-- nobody had touched, in a table nobody had mentioned. That cost a CI run to
-- read.
--
-- ## Which of the two is the intent
--
-- RESTRICT. The queue is a record: a request that was granted WAS granted, and
-- deleting the organisation later does not unmake that. Relaxing the CHECK
-- instead would let a row read `granted` while naming nothing, which is the one
-- thing migration 0002 went out of its way to forbid — it originally wrote the
-- rule as `state = 'granted' OR tenant_id IS NULL`, which any granted row
-- satisfies, and tightened it to an equivalence precisely so that could not
-- happen.
--
-- The practical consequence is a rule worth stating: **decide what to do with
-- the requests before you delete a tenant.** Nothing in the product deletes
-- tenants — non-destructive by default (ADR-0024) — so this is for operators
-- clearing up by hand, and for tests, where the fix is to delete the requests
-- first.
--
-- Behaviour is otherwise unchanged. No row moves, and a tenant with no granted
-- request pointing at it deletes exactly as before.

ALTER TABLE public.access_request
  DROP CONSTRAINT access_request_tenant_fkey;

ALTER TABLE public.access_request
  ADD CONSTRAINT access_request_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE RESTRICT;
