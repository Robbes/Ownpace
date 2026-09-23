-- AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1, the owner's decisions of
-- 2026-09-23).
--
-- The application's own errors and warnings went to the container's output and
-- nowhere else, so no screen could search them. The owner asked for a page that
-- can: *"The audit log plus the application's errors and warnings, both stored
-- in the database so the page can search them"*, showing *"Metadata only: time,
-- level, customer, migration, event, error category, reference number,
-- searchable. No free text"*. This table is where the errors and warnings are
-- stored; the page is 0129 T2.
--
-- METADATA ONLY, AND THE TABLE HOLDS THE LINE. There is no column for a
-- message. `event` is a name from code, and its CHECK admits nothing a sentence,
-- an address or a path could fit: no space, no `@`, no `/`, no capital. The
-- category is held to the same kind of shape, and `reference` is the eight hex
-- characters a failed request has answered with since workplan 0079. The text
-- of an error stays in the container's output, on a line that carries the same
-- reference. `@openmig/shared`'s `recordAppEvent` checks the same shapes before
-- a row is sent, so a caller that passed a message is refused twice.
--
-- NO ROW-LEVEL SECURITY, deliberately, for the reasons `rate_budget` (0024)
-- gives, adapted:
--
--   * It is written by system-level code, often with no tenant context: a
--     request that failed before anybody signed in, a job that failed for every
--     customer at once. Under a policy keyed on `app.current_tenant` those rows
--     could not be written at all, and the log would be silent exactly where it
--     is needed.
--   * It carries no personal data, by construction: the columns below, and the
--     CHECKs on the three that are text.
--   * No customer reads it. `app_user` may INSERT and nothing else, so a tenant
--     session can write an event and cannot read one, not even its own. The
--     operator reads it through the page (0129 T2), as the owner.
--
-- A customer's events go when the customer is erased (the cascade on
-- `tenant_id`). A migration's stay when the migration is deleted, without its
-- id, until they age out at one month (0129 T3).

CREATE TABLE public.app_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    at timestamp with time zone DEFAULT now() NOT NULL,
    level text NOT NULL
        CONSTRAINT app_event_level CHECK (level IN ('warn', 'error')),
    tenant_id uuid REFERENCES public.tenant(id) ON DELETE CASCADE,
    mapping_id uuid REFERENCES public.mailbox_mapping(id) ON DELETE SET NULL,
    event text NOT NULL
        CONSTRAINT app_event_name CHECK (event ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    category text
        CONSTRAINT app_event_category CHECK (category IS NULL OR category ~ '^[a-z][a-z0-9_]{0,63}$'),
    reference text NOT NULL
        CONSTRAINT app_event_reference CHECK (reference ~ '^[0-9a-f]{8}$')
);

-- The page reads newest first, by customer, and by the reference a person quotes.
CREATE INDEX ix_app_event_at ON public.app_event USING btree (at DESC);
CREATE INDEX ix_app_event_tenant ON public.app_event USING btree (tenant_id, at DESC);
CREATE INDEX ix_app_event_reference ON public.app_event USING btree (reference);

-- Insert-only for the application's role. The schema's default privileges would
-- otherwise have given it SELECT, UPDATE and DELETE as well.
REVOKE SELECT, UPDATE, DELETE ON TABLE public.app_event FROM app_user;
GRANT INSERT ON TABLE public.app_event TO app_user;
