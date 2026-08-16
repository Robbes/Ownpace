-- The managed edition's per-mapping throttle config (workplan 0050's noted gap).
--
-- The DAV/file source connectors have taken a `throttleLimiter` since 0050 and
-- `buildDomainDepsFromMapping` accepted the parameter — but this edition had
-- nowhere to STORE a throttle choice, so the limiter was armed and never fed.
-- One nullable jsonb column closes that: NULL means "no throttling configured"
-- (today's behaviour, unchanged), and a value is the SAME shape the appliance's
-- mapping file carries (`throttleConfig`, validated by the shared parser —
-- hard rule 5: one authority, both editions, refusing in the same words).

ALTER TABLE public.mailbox_mapping
  ADD COLUMN throttle_config jsonb;
