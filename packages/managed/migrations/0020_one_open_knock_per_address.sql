-- One open knock per address, and the duplicates that already exist
-- (owner decision 2026-08-31).
--
-- Migration 0002 declined to make `email` unique, and gave the reason:
--
--     "Not UNIQUE on email: somebody who asked a year ago may ask again, and a
--      second request from the same address is information rather than an
--      error."
--
-- That is right about SEQUENTIAL requests and says nothing about several being
-- OPEN at once, which is a different thing and is not information. It is noise
-- in the queue an operator reads — and it has a consequence nobody wrote down:
-- granting is an unconditional `INSERT INTO tenant`, so granting two open
-- requests from one address creates TWO ORGANISATIONS with that person as owner
-- of both. `/api/me` then returns two tenants, `resolveTenant` refuses to guess
-- between them, and the app has to ask somebody which one they meant — for a
-- person who asked once and pressed twice.
--
-- Found by the owner reading their own queue on 2026-08-31: duplicate open
-- requests from the same address, including their own.
--
-- ## Why the database and not the route
--
-- The knock is anonymous, and `access_request`'s only policy is
-- `anyone_may_ask FOR INSERT WITH CHECK (true)` — there is no SELECT policy at
-- all, deliberately: knocking is allowed, reading the queue is not. So the
-- route CANNOT look for an existing request, and a `WHERE NOT EXISTS` in the
-- insert would see nothing and always write. A partial unique index is the only
-- place the rule can live without handing strangers a read of the queue.
--
-- ## Case, and whose rule it is
--
-- `lower(btrim(email))`, because that is already how this system decides two
-- addresses are the same person — `auth.ts` compares memberships with
-- `.trim().toLowerCase()`. The index follows that rule rather than inventing a
-- second one; addresses are still STORED exactly as typed.
--
-- ## The duplicates that already exist, and why deleting them is defensible
--
-- A unique index cannot be created over rows that already violate it, so this
-- has to resolve them or fail the deployment. It keeps the OLDEST open request
-- per address — the one that has waited longest, and the one an operator would
-- answer — and removes the later open duplicates.
--
-- DELETION IS THE EXCEPTION HERE AND IS MEANT TO BE. `access_request` grants no
-- DELETE to `app_user` precisely so a DECISION cannot be erased; a migration
-- runs as owner and could erase anything, so the narrowness matters. What goes
-- is strictly undecided knocks — `state = 'open'`, no `decided_at`, no
-- `decided_by` — that duplicate a knock being kept. Nothing anybody decided is
-- destroyed, and the surviving row says the same thing: this address is asking.
-- Granted and declined rows are untouched, including several from one address:
-- that history is exactly what 0002 wanted to keep.

DELETE FROM public.access_request a
 WHERE a.state = 'open'
   AND EXISTS (
     SELECT 1 FROM public.access_request b
      WHERE b.state = 'open'
        AND lower(btrim(b.email)) = lower(btrim(a.email))
        -- Strictly older, with the id as the tie-break so two rows written in
        -- the same instant still leave exactly one standing.
        AND (b.created_at, b.id) < (a.created_at, a.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS ux_access_request_one_open_per_email
  ON public.access_request (lower(btrim(email)))
  WHERE (state = 'open');

COMMENT ON INDEX public.ux_access_request_one_open_per_email IS
  'One OPEN request per address (0002 deliberately allows several over time — this forbids several at once). The knock is anonymous and there is no SELECT policy on this table, so the route cannot check: the database is the only place this rule can live. Case- and space-insensitive, matching how auth.ts already decides two addresses are the same person.';
