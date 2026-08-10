// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { runMigrations } from '@openmig/ledger';

// Import types
import type { AuthenticatedRequest, JwtPayload } from './types/api';

// Import routes
// NOTE: there is deliberately no Trigger.dev webhook route (0020 T7). The old
// /api/webhooks/trigger was an unauthenticated no-op sink expecting a payload
// shape the self-hosted v4 platform never sends; job state lands on
// verification_run/apply_receipt rows by the jobs themselves.
import tenantRoutes from './routes/tenants/index';
import mappingRoutes from './routes/migrations/index';
import decisionRoutes from './routes/decisions';
import sharedAddressRoutes from './routes/shared-addresses';
import permissionRoutes from './routes/permissions';
import billingRoutes from './routes/billing/index';
import billingWebhookRoutes from './routes/billing/webhooks';
import scopeManifestRoutes from './routes/scope-manifest';
import { assertProductionAuthConfig } from './middleware/auth';
import { assertProductionUrlConfig } from './config-guards';
import { buildIdentity } from '@openmig/core';
import { renderMetrics, METRICS_CONTENT_TYPE } from '@openmig/shared';
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
  log.error('API Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
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
  runMigrations({ connectionString: databaseUrl })
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
