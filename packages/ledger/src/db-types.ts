// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The drizzle handle type, on its own so the connection seam and the `pg`
 * implementation can both refer to it without importing each other.
 *
 * `drizzle-orm/node-postgres` is named here, but nothing about the TYPE is
 * node-postgres-specific: drizzle's Postgres handles share one query surface,
 * which is why swapping the driver (workplan 0015 T1) is a connection-layer
 * change and not a query rewrite.
 */

import type { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type * as schemaPg from './schema-pg.ts';

export type PgDatabase = ReturnType<typeof drizzlePg<typeof schemaPg>>;
