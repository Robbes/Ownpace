// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * `GET /api/provider-clients` — which OAuth applications this deployment
 * carries, one fact per provider (2026-09-02: Connect with Dropbox). The
 * wizard reads it before offering a *Connect with …* button without the
 * client pair. Read from the environment on every request, never cached, and
 * never the values.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { providerClientFacts } from '@openmig/shared';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(providerClientFacts());
});

export default router;
