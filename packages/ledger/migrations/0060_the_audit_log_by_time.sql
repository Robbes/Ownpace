-- THE AUDIT LOG, BY TIME (workplan 0129 T2).
--
-- The operator's log page reads the audit log newest first, across every
-- customer, a hundred rows at a time. `audit_log` had one index,
-- `ix_audit_tenant (tenant_id, at DESC)`, which serves one customer's history
-- and not everybody's. Without this one, every page of the log would sort the
-- whole table first, and the audit log is the one table that is never pruned:
-- a customer's rows stay until the customer is erased (0129 D2).
--
-- `app_event` has had the same index since 0059 (`ix_app_event_at`), so both
-- halves of the timeline can now be read in order and stopped at the page's end.

CREATE INDEX IF NOT EXISTS ix_audit_at ON public.audit_log USING btree (at DESC);
