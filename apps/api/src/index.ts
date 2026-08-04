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
import billingRoutes from './routes/billing/index';
import billingWebhookRoutes from './routes/billing/webhooks';
import scopeManifestRoutes from './routes/scope-manifest';
import { assertProductionAuthConfig } from './middleware/auth';
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

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/tenants', tenantRoutes);
app.use('/api/scope-manifest', scopeManifestRoutes);
app.use('/api/migrations', mappingRoutes);
// The §11.1 drift decision queue (workplan 0028 T1).
app.use('/api/decisions', decisionRoutes);
app.use('/api/shared-addresses', sharedAddressRoutes);
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
