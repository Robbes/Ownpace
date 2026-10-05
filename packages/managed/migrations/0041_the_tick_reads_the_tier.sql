-- The tick reads the tier the month bills (workplan 0157 T2; ADR-0014,
-- Amendment 2026-10-04, evening: Free runs one pass a day).
--
-- The sync tick runs as `ownpace_system` (managed 0033), which reads the three
-- tables a tier is derived from only by the column the purge picks rows with,
-- `tenant_id`. To know whether an organisation is billed Free it now reads, as
-- the Billing page does (`billedTierNow` in packages/managed/src/pace.ts):
--
--   - each yes on record (managed 0037): which kind, which tier, how large a
--     band, and when, which orders them. Never who said yes or the price;
--   - the first-copy meter (managed 0016, 0040): the total and the alpha's
--     share, since what counts is the difference;
--   - this month's peak of migrations at the same time (managed 0015).
--
-- Column grants, added to the ones 0033 and 0037 made; nothing is taken away,
-- and the role still writes none of the three. Granted again whatever was
-- there, so running this twice changes nothing.

GRANT SELECT (tenant_id, kind, tier_id, band_gb, consented_at) ON TABLE public.data_allowance TO ownpace_system;
GRANT SELECT (tenant_id, bytes, alpha_bytes) ON TABLE public.bytes_moved TO ownpace_system;
GRANT SELECT (tenant_id, month, peak_paths, peak_at) ON TABLE public.occupancy_peak TO ownpace_system;
