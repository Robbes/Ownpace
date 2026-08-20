// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Open Migration API Server
 * 
 * Express-based REST API for the managed edition.
 * Provides tenant management, migration control, and billing endpoints.
 */

import express from 'express';
import type { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { runMigrations, migrationConnectionString, poolerInFront } from '@openmig/ledger';

// Import types
import type { AuthenticatedRequest, JwtPayload } from './types/api.ts';

// Import routes
// NOTE: there is deliberately no Trigger.dev webhook route (0020 T7). The old
// /api/webhooks/trigger was an unauthenticated no-op sink expecting a payload
// shape the self-hosted v4 platform never sends; job state lands on
// verification_run/apply_receipt rows by the jobs themselves.
import tenantRoutes from './routes/tenants/index.ts';
import mappingRoutes from './routes/migrations/index.ts';
import decisionRoutes from './routes/decisions.ts';
import sharedAddressRoutes from './routes/shared-addresses.ts';
import permissionRoutes from './routes/permissions.ts';
import billingRoutes from './routes/billing/index.ts';
import billingWebhookRoutes from './routes/billing/webhooks.ts';
import scopeManifestRoutes from './routes/scope-manifest.ts';
import setupRoutes from './routes/setup.ts';
import connectionRoutes from './routes/connections.ts';
import { assertProductionAuthConfig } from './middleware/auth.ts';
import { assertProductionUrlConfig } from './config-guards.ts';
import { serverFault } from './server-fault.ts';
import { buildIdentity } from '@openmig/core';
import { renderMetrics, METRICS_CONTENT_TYPE } from '@openmig/shared';
import { runManagedMigrations } from '@openmig/managed';
import { log } from '@openmig/shared';

// Re-export for backwards compatibility
export type { AuthenticatedRequest, JwtPayload };

// Configuration
const app: Application = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3123',
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json());
// Mollie posts webhooks as application/x-www-form-urlencoded (id=<paymentId>).
app.use(express.urlencoded({ extended: false }));

// Health check — also under /api so the web image's same-origin proxy (which
// forwards only /api/*) can reach it; the smoke script asserts that path.
const health = (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
app.get('/health', health);
app.get('/api/health', health);

// What build is this? Unauthenticated on purpose, like /health: version and
// commit are on every release page; the answer starts support conversations.
const version = (req: Request, res: Response) => {
  res.json(buildIdentity());
};
app.get('/version', version);
app.get('/api/version', version);

/**
 * Prometheus metrics (0026 T3 row 19, owner decision 2026-08-05: option A).
 *
 * The appliance has served `/metrics` since workplan 0010; the managed API
 * served nothing at all — an asymmetry that ran backwards from what anyone
 * would expect, since the single-tenant box an operator can SSH into was
 * observable and the multi-tenant service they cannot reach was not.
 *
 * Same `renderMetrics()` as the appliance, deliberately: two renderers would
 * drift, and a dashboard that reads one edition's series names cannot read the
 * other's. The counters are registered by the packages that increment them, so
 * this endpoint exposes whatever the process has actually loaded rather than a
 * list maintained here.
 *
 * **Unauthenticated, like `/health` above, and that is a decision rather than
 * an oversight.** The body carries counts and durations only — no addresses,
 * no folder names, no tenant identifiers (§17). What it does reveal is
 * aggregate volume, so it belongs behind the ingress that already fronts this
 * service rather than on a public route; deployment.md says so.
 *
 * What this does NOT deliver: §19's per-tenant dashboards, alert rules and
 * SLOs. Those were deferred in the same decision — thresholds chosen before
 * there is traffic to measure would be guesses wearing the costume of a
 * service level. The endpoint is what makes them possible later.
 */
app.get('/metrics', (req: Request, res: Response) => {
  res.set('content-type', METRICS_CONTENT_TYPE).send(renderMetrics());
});

// API Routes
app.use('/api/tenants', tenantRoutes);
app.use('/api/scope-manifest', scopeManifestRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/migrations', mappingRoutes);
// The §11.1 drift decision queue (workplan 0028 T1).
app.use('/api/decisions', decisionRoutes);
app.use('/api/shared-addresses', sharedAddressRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/billing', billingRoutes);
// Mount at /webhooks so the route resolves to /api/billing/webhooks/mollie —
// the exact URL advertised to Mollie in createPayment's webhookUrl.
app.use('/api/billing/webhooks', billingWebhookRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  serverFault(res, 'unhandled', 'handling this request', err);
});

// Start server. Self-migrates first (under migrate.ts's advisory lock, idempotent) --
// the managed edition has no separate migration step, unlike apps/selfhost, so this is
// the only thing that ever creates the managed schema on a fresh database.
if (process.env.NODE_ENV !== 'test') {
  // Fail-closed secrets (0020 T2): refuse to boot in production with a
  // known-placeholder JWT_SECRET rather than serve authenticated theater.
  assertProductionAuthConfig();
  // Fail-closed URLs: a localhost API_URL/WEB_URL with billing live means
  // unreachable Mollie webhooks and stranded redirects — refuse at boot,
  // where the operator is looking, not at the first payment.
  assertProductionUrlConfig((m) => log.warn(m));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  // Migrations go DIRECT to Postgres, never through the transaction-mode
  // pooler (workplan 0082 T4). `migrate.ts` holds `pg_advisory_lock`, which is
  // session-scoped, across every migration's own transaction — through
  // PgBouncer in transaction mode the lock would be taken on one server
  // connection and the migrations applied on others, so two replicas booting
  // at once would stop excluding each other. That is the exact situation the
  // lock exists for, and it would fail silently.
  const migrationUrl = migrationConnectionString(process.env);
  if (poolerInFront(process.env)) {
    log.info('[api] a connection pooler is in front of Postgres; migrations bypass it');
  }
  // Both chains, shared first: every table in the managed chain references
  // `public.tenant` (ADR-0036). The API is a MANAGED process, so it applies
  // both; the appliance's entrypoint applies only the shared one, which is the
  // whole mechanism by which it ends up without the managed tables.
  runMigrations({ connectionString: migrationUrl })
    .then(() => runManagedMigrations({ connectionString: migrationUrl }))
    .then(() => {
      app.listen(PORT, () => {
        log.info(`API server running on port ${PORT}`);
        log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      });
    })
    .catch((err) => {
      log.error('API failed to start: migrations failed:', err);
      process.exit(1);
    });
}

export { app };
export default app;
