// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * JWT Authentication Middleware
 * 
 * Validates JWT tokens and extracts tenant context for RLS.
 * Supports both self-hosted (local JWT) and managed (Auth0/Clerk) providers.
 * 
 * SECURITY: Managed path uses jose with remote JWKS verification. Never decodes without verification.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import type { AuthenticatedRequest } from '../types/api';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import { withTenant as ledgerWithTenant, tenantMember, type PgDatabase } from '@openmig/ledger';
import { log } from '@openmig/shared';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

/**
 * Get the database pool from environment.
 * For managed mode, this should be the APP_DATABASE_URL (app_user role).
 * For self-host mode, this can be the standard DATABASE_URL.
 */
export function getDbPool(): Pool {
  // Prefer APP_DATABASE_URL for managed mode (non-owner app_user role)
  // Fall back to DATABASE_URL for self-host mode
  const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL or APP_DATABASE_URL environment variable not set');
  }
  
  return new Pool({ connectionString });
}

/**
 * Execute a function within a tenant-scoped transaction.
 * This is the critical security gate - all tenant-specific queries must go through this.
 * 
 * @param tenantId - The tenant ID to scope the query to
 * @param pool - The database pool (from getDbPool())
 * @param fn - The function to execute with a tenant-scoped db handle
 * @returns The result of the function
 */
export function withTenantDb<T>(
  tenantId: string,
  pool: Pool,
  fn: (db: PgDatabase) => Promise<T>
): Promise<T> {
  return ledgerWithTenant(pool, tenantId, fn);
}

/**
 * JWKS cache for managed mode - initialized once and reused
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Get or create the JWKS cache for the configured issuer
 */
async function getJWKS(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (jwksCache) {
    return jwksCache;
  }

  const jwtIssuer = process.env.JWT_ISSUER;
  if (!jwtIssuer) {
    throw new Error('JWT_ISSUER not configured');
  }

  // Construct JWKS URL from issuer
  // For Auth0: https://<domain>/.well-known/jwks.json
  // For Clerk: https://<domain>/.well-known/jwks.json
  // For other issuers, they should provide the JWKS endpoint
  let jwksUrl: string;
  if (jwtIssuer.endsWith('/.well-known/jwks.json')) {
    jwksUrl = jwtIssuer;
  } else if (jwtIssuer.endsWith('/')) {
    jwksUrl = `${jwtIssuer}.well-known/jwks.json`;
  } else {
    jwksUrl = `${jwtIssuer}/.well-known/jwks.json`;
  }

  try {
    jwksCache = createRemoteJWKSet(new URL(jwksUrl));
    return jwksCache;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${errorMessage}`, { cause: error });
  }
}

/**
 * Verify a token using the managed (JWKS) path
 */
async function verifyManagedToken(token: string): Promise<JwtPayload> {
  const jwtIssuer = process.env.JWT_ISSUER;
  const jwtAudience = process.env.JWT_AUDIENCE;

  if (!jwtIssuer) {
    throw new Error('JWT_ISSUER not configured for managed mode');
  }

  const jwks = await getJWKS();

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: jwtIssuer,
      audience: jwtAudience,
      requiredClaims: ['sub', 'tenantId', 'role', 'email'],
    });

    // Validate required claims exist
    if (!payload.sub || !payload.tenantId || !payload.role || !payload.email) {
      throw new Error('Missing required claims in token payload');
    }

    return payload as unknown as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new Error(`Token verification failed: ${error.message}`, { cause: error });
    }
    throw new Error('Token verification failed', { cause: error });
  }
}

/** Thrown when neither JWT_SECRET nor JWT_ISSUER is configured in production. */
class AuthNotConfiguredError extends Error {
  constructor() {
    super('JWT verification not configured (JWT_SECRET or JWT_ISSUER required)');
    this.name = 'AuthNotConfiguredError';
  }
}

// ====================== Tenant-membership gate (0020 T1) ======================

/**
 * Signature verification proves who SIGNED a token — not that its subject
 * belongs to the tenant it names. Anyone holding the signing secret (or an IdP
 * that assigns tenant claims without checking) can mint
 * `{tenantId: <any>, role: 'owner'}`, and RLS would then faithfully scope every
 * query to the CLAIMED tenant — the attack, not the defense. So after claim
 * verification, `authenticate` confirms `(tenantId, sub)` is an ACTIVE row in
 * `tenant_member`, and the role comes from that row, never from the token.
 *
 * The lookup runs inside `withTenant(claimedTenantId)`: the tenant_member
 * policies scope it to the claimed tenant, so a claim naming a tenant the
 * subject doesn't belong to simply finds no row and gets a 403.
 */
export type MembershipLookup = (
  tenantId: string,
  userId: string
) => Promise<{ role: string } | null>;

/** One pool for the gate — never one per request (getDbPool constructs a new Pool). */
let _authPool: Pool | null = null;
function getAuthPool(): Pool {
  if (!_authPool) _authPool = getDbPool();
  return _authPool;
}

// The claimed tenantId lands in RLS policies as a ::uuid cast; a non-UUID claim
// must read as "no membership" (403), not as a query error (500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lookupMembership(
  tenantId: string,
  userId: string
): Promise<{ role: string } | null> {
  if (!UUID_RE.test(tenantId)) return null;
  const rows = await ledgerWithTenant(getAuthPool(), tenantId, async (db) =>
    db
      .select({ role: tenantMember.role })
      .from(tenantMember)
      .where(
        and(
          eq(tenantMember.tenantId, tenantId),
          eq(tenantMember.userId, userId),
          eq(tenantMember.status, 'active')
        )
      )
  );
  return rows[0] ?? null;
}

let membershipLookup: MembershipLookup = lookupMembership;

/**
 * TEST SEAM ONLY. Unit tests exercise `authenticate` without a database; this
 * swaps the tenant_member lookup for a fake (pass null to restore the real one).
 * Production code must never call it — the gate has no bypass by construction.
 */
export function __setMembershipLookupForTests(fn: MembershipLookup | null): void {
  membershipLookup = fn ?? lookupMembership;
}

/**
 * Choose the verification mode. The managed **JWKS** path (JWT_ISSUER) takes
 * precedence over a symmetric JWT_SECRET: if an operator configures JWKS, a
 * lingering JWT_SECRET must NOT silently downgrade verification to the shared
 * secret (which the managed compose ships with a known default). Self-host uses
 * JWT_SECRET; with neither configured we're in dev mode. Pure — exported for tests.
 */
export function selectAuthMode(jwtIssuer?: string, jwtSecret?: string): 'managed' | 'local' | 'dev' {
  if (jwtIssuer) return 'managed';
  if (jwtSecret) return 'local';
  return 'dev';
}

function assertRequiredClaims(payload: JwtPayload): void {
  if (!payload.sub || !payload.tenantId || !payload.role || !payload.email) {
    throw new Error('Missing required claims in token payload');
  }
}

/**
 * Verify a bearer token and return its validated payload. Single source of truth
 * for both `authenticate` and `optionalAuth` so neither can accidentally trust an
 * unverified token. Throws on any verification/claim/config failure.
 */
async function verifyToken(token: string): Promise<JwtPayload> {
  const mode = selectAuthMode(process.env.JWT_ISSUER, process.env.JWT_SECRET);

  if (mode === 'managed') {
    return await verifyManagedToken(token);
  }

  if (mode === 'local') {
    // Pin the algorithm — never let the token's own header pick the algorithm.
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
    assertRequiredClaims(payload);
    return payload;
  }

  // Dev mode: no verifier configured. Forbidden in production.
  if (process.env.NODE_ENV === 'production') {
    throw new AuthNotConfiguredError();
  }
  log.warn('JWT verification disabled - development mode');
  const decoded = decodeJwt(token) as unknown as JwtPayload;
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Invalid token format');
  }
  assertRequiredClaims(decoded);
  return decoded;
}

/**
 * Boot-time refusal of known-placeholder auth secrets in production (0020 T2).
 *
 * With the membership gate, JWT_SECRET is the outer wall of the tenancy
 * boundary — a deployment running the placeholder value is a deployment whose
 * signing key is committed to a public repository. Refusing to boot is the only
 * honest failure: every later request would be authenticated theater. Pure and
 * exported for tests; index.ts calls it before starting the server.
 */
const PLACEHOLDER_JWT_SECRETS = new Set([
  'change-this-in-production', // managed.yml's old default (now removed) + managed.env.example
  'your-super-secret-jwt-key-change-in-production', // root .env.example
]);

export function assertProductionAuthConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const mode = selectAuthMode(env.JWT_ISSUER, env.JWT_SECRET);
  if (mode === 'local' && PLACEHOLDER_JWT_SECRETS.has(env.JWT_SECRET!)) {
    throw new Error(
      'JWT_SECRET is a known placeholder value. In production it is the tenancy ' +
        'boundary: generate a real secret (openssl rand -hex 32), set it in .env, ' +
        'and re-mint any tokens signed with the old value.'
    );
  }
}

/**
 * Authentication middleware
 *
 * Validates JWT token from Authorization header and attaches
 * user context to the request object.
 *
 * Security:
 * - Managed (JWT_ISSUER): Verifies signature with remote JWKS, validates iss/aud/exp
 * - Self-hosted (JWT_SECRET): Verifies HS256 signature with the local secret
 * - Dev: Only in non-production, logs warning
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
      return;
    }

    const token = authHeader.substring(7);

    // Verify the token (managed JWKS wins over a local secret — see selectAuthMode).
    const payload = await verifyToken(token);

    // Authorization gate (0020 T1): the signature proved who signed the token;
    // membership proves the subject belongs to the tenant it claims, and the
    // ROLE comes from the tenant_member row, never from the token. Dev mode
    // (no verifier configured; forbidden in production) is the one path that
    // skips it — it already runs on unverified decode with no database wired.
    let role = payload.role;
    const mode = selectAuthMode(process.env.JWT_ISSUER, process.env.JWT_SECRET);
    if (mode !== 'dev') {
      const membership = await membershipLookup(payload.tenantId, payload.sub);
      if (!membership) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'No active membership for this tenant',
        });
        return;
      }
      role = membership.role;
    }

    // Attach user context to request
    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.userId = payload.sub;
    authenticatedReq.tenantId = payload.tenantId;
    authenticatedReq.userRole = role;

    // Set tenant context for RLS
    // This will be used by the database client to set app.current_tenant
    res.locals.tenantId = payload.tenantId;

    next();
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) {
      res.status(500).json({
        error: 'Server Configuration Error',
        message: error.message,
      });
    } else if (error instanceof jwt.TokenExpiredError) {
      // Must be checked BEFORE JsonWebTokenError — TokenExpiredError extends it.
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token expired',
      });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
    } else if (error instanceof Error) {
      // Handle jose errors and other verification failures
      if (error.message.includes('Token verification failed') || 
          error.message.includes('Invalid token') ||
          error.message.includes('Missing required claims')) {
        res.status(401).json({
          error: 'Unauthorized',
          message: error.message,
        });
      } else {
        log.error('Authentication error:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Token verification failed',
        });
      }
    } else {
      log.error('Authentication error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Token verification failed',
      });
    }
  }
}

/**
 * Optional authentication middleware
 * 
 * Attaches user context if token is present, but doesn't require it.
 * Useful for endpoints that work both with and without authentication.
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token, continue without authentication
    next();
    return;
  }

  try {
    const token = authHeader.substring(7);
    // Same verification as authenticate() — never trust an unverified token
    // (the previous jwt.decode fallback attached forged claims in managed mode).
    const payload = await verifyToken(token);

    // Same membership gate as authenticate() (0020 T1) — a token naming a
    // tenant the subject doesn't belong to attaches NO context here, because
    // "optional" means the auth may be absent, not that it may be weaker.
    let role = payload.role;
    const mode = selectAuthMode(process.env.JWT_ISSUER, process.env.JWT_SECRET);
    if (mode !== 'dev') {
      const membership = await membershipLookup(payload.tenantId, payload.sub);
      if (!membership) {
        next();
        return;
      }
      role = membership.role;
    }

    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.userId = payload.sub;
    authenticatedReq.tenantId = payload.tenantId;
    authenticatedReq.userRole = role;

    next();
  } catch (_error) {
    // Token missing/invalid — continue without authentication.
    next();
  }
}

/**
 * Role-based access control middleware
 * 
 * Requires specific roles to access the route.
 * Example: requireRole('admin', 'manager')
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authenticatedReq = req as AuthenticatedRequest;

    if (!authenticatedReq.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(authenticatedReq.userRole || '')) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}

/**
 * Tenant isolation middleware
 * 
 * Ensures the request is made by the tenant specified in the URL/path.
 * Prevents cross-tenant access.
 */
export function requireTenantMatch(paramName: string = 'tenantId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authenticatedReq = req as AuthenticatedRequest;

    if (!authenticatedReq.tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const pathTenantId = req.params[paramName];

    if (!pathTenantId) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Missing ${paramName} parameter`,
      });
      return;
    }

    if (authenticatedReq.tenantId !== pathTenantId) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied to this tenant',
      });
      return;
    }

    next();
  };
}
