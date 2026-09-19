// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The mapping-status audit helper lives in `@openmig/ledger` since 2026-09-19
 * (ADR-0047): the worker's rollback needed to leave the same `mapping.status`
 * row the API leaves, and the worker cannot import from the API. Everything
 * here re-exports from there, so the API's call sites and their tests are
 * unchanged — and the reasoning that used to sit in this file went with the
 * code, where the reader who needs it will be.
 */

export {
  MAPPING_STATUS_ACTION,
  recordMappingStatusChange,
  type MappingStatus,
  type MappingStatusVia,
} from '@openmig/ledger';
