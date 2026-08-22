// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import type { AuthenticatedRequest } from '../types/api.ts';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import {
  withTenant as ledgerWithTenant,
  withSubject as ledgerWithSubject,
  type PgDatabase,
} from '@openmig/ledger';
import { tenantMember } from '@openmig/managed/schema-managed';
import { log } from '@openmig/shared';
import { serverFault } from '../server-fault.ts';

export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * OPTIONAL, and deliberately so (ADR-0042).
   *
   * A token carries `sub` and `email` and nothing Ownpace-specific, because
   * that is what lets any plain OIDC issuer be enough — and being enough is
   * what makes the issuer replaceable. Which tenant a session acts on is
   * resolved from `tenant_member` (`resolveTenant`), and the ROLE has never
   * been taken from the token at all: `authenticate` overwrites it from the
   * membership row on every request, which it must, because a signature proves
   * who signed a token and not what its subject may do.
   *
   * Still READ where present, for the self-host edition's own HS256 tokens and
   * for any issuer already minting it — a claim that agrees with the database
   * costs nothing, and one that disagrees loses to the database.
   */
  tenantId?: string;
  role?: string;
  /**
   * Whether the ISSUER says it verified `email` (OIDC Core §5.1).
   *
   * Read for exactly one purpose: binding an invitation addressed to that
   * address (migration 0006). Absent or false means no binding — an issuer that
   * does not assert this is not one whose email claim can carry an
   * authorisation, and guessing in the other direction would mean whoever can
   * create an account bearing an address inherits what was invited to it.
   */
  email_verified?: boolean;
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
 * The discovered JWKS, keyed by issuer.
 *
 * Keyed rather than a bare singleton so that reconfiguring the issuer — which
 * tests do, and a deployment does when it switches provider — cannot be served
 * a previous issuer's keys out of a stale cache.
 */
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Drop the cache. Exported for tests; nothing in the request path calls it. */
export function __resetJwksCacheForTests(): void {
  jwksByIssuer.clear();
}

/**
 * Where an issuer actually publishes its keys — asked, never guessed.
 *
 * **This was `${issuer}/.well-known/jwks.json`**, with a comment naming Auth0
 * and Clerk and adding "for other issuers, they should provide the JWKS
 * endpoint". That path is an Auth0/Clerk convention and not a standard, and the
 * consequence was concrete: it works with neither issuer this project actually
 * considered (ADR-0042).
 *
 *   Zitadel   `{domain}/oauth/v2/keys`
 *   Keycloak  `{host}/realms/{realm}/protocol/openid-connect/certs`
 *
 * OIDC Discovery is the standard every compliant provider implements: fetch
 * `/.well-known/openid-configuration` and read `jwks_uri` out of it. Doing that
 * is what makes ADR-0042's "the issuer is REPLACEABLE" true rather than
 * aspirational — swapping provider becomes two environment variables, because
 * nothing here knows any provider's URL shape.
 *
 * **The document's `issuer` must equal the one we configured.** OIDC Discovery
 * §4.3 requires it, and the reason is not pedantry: without the check, anything
 * that can answer at the discovery URL — a hijacked DNS record, a
 * misconfigured proxy — can point verification at a key set it controls, and
 * every token it mints then verifies.
 */
async function discoverJwksUri(issuer: string): Promise<string> {
  const base = issuer.replace(/\/+$/, '');
  const discoveryUrl = `${base}/.well-known/openid-configuration`;

  // `Awaited<ReturnType<typeof fetch>>`, not `Response`: this file imports
  // Express's `Response` type, which shadows the fetch one.
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(discoveryUrl);
  } catch (error) {
    throw new Error(
      `Could not reach the issuer's discovery document at ${discoveryUrl}. ` +
        'JWT_ISSUER must be the issuer URL, not the JWKS URL or the login page.',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `The issuer's discovery document at ${discoveryUrl} answered ${response.status}. ` +
        'JWT_ISSUER must be the issuer URL exactly as the provider publishes it.',
    );
  }

  const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };

  if (document.issuer !== issuer) {
    throw new Error(
      `The discovery document at ${discoveryUrl} declares issuer ` +
        `${JSON.stringify(document.issuer)}, but JWT_ISSUER is ${JSON.stringify(issuer)}. ` +
        'These must match exactly (OIDC Discovery §4.3) — a mismatch means the URL is ' +
        'not this issuer, and trusting its keys would verify tokens it did not mint.',
    );
  }
  if (typeof document.jwks_uri !== 'string' || document.jwks_uri === '') {
    throw new Error(
      `The discovery document at ${discoveryUrl} carries no jwks_uri. Set JWT_JWKS_URI ` +
        'explicitly if this provider genuinely does not publish one.',
    );
  }
  return document.jwks_uri;
}

/**
 * Get or create the key set for the configured issuer.
 *
 * `JWT_JWKS_URI` short-circuits discovery, as the escape hatch for a provider
 * that does not publish a discovery document or publishes a wrong one. It is
 * NOT the normal path: set it and you have pinned a URL that key rotation or a
 * provider upgrade can move underneath you.
 */
async function getJWKS(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const jwtIssuer = process.env.JWT_ISSUER;
  if (!jwtIssuer) {
    throw new Error('JWT_ISSUER not configured');
  }

  const cached = jwksByIssuer.get(jwtIssuer);
  if (cached) return cached;

  const jwksUrl = process.env.JWT_JWKS_URI || (await discoverJwksUri(jwtIssuer));

  try {
    const created = createRemoteJWKSet(new URL(jwksUrl));
    jwksByIssuer.set(jwtIssuer, created);
    return created;
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
      requiredClaims: ['sub', 'email'],
    });

    // Validate required claims exist
    if (!payload.sub || !payload.email) {
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

/** Every tenant a subject is an active member of, with the role each gave them. */
export type MembershipsLookup = (userId: string) => Promise<Array<{ tenantId: string; role: string }>>;

/**
 * Which tenants is this subject in?
 *
 * Runs inside `withSubject`, not `withTenant`, because the whole question is
 * which tenant — and every other policy on this table keys on a tenant we do
 * not yet have. Migration 0003 adds the one SELECT policy that answers it, for
 * your own rows only; `own-membership-under-rls.unit.test.ts` proves it opens
 * nothing else.
 */
async function lookupMemberships(userId: string): Promise<Array<{ tenantId: string; role: string }>> {
  return await ledgerWithSubject(getAuthPool(), userId, async (db) =>
    db
      .select({ tenantId: tenantMember.tenantId, role: tenantMember.role })
      .from(tenantMember)
      .where(and(eq(tenantMember.userId, userId), eq(tenantMember.status, 'active'))),
  );
}

let membershipsLookup: MembershipsLookup = lookupMemberships;

/**
 * Every tenant this subject may act on. The route surface of the lookup above,
 * so `GET /api/me` does not reach past the middleware into a private binding —
 * and so the test seam swaps for it too.
 */
export function membershipsForSubject(
  userId: string,
): Promise<Array<{ tenantId: string; role: string }>> {
  return membershipsLookup(userId);
}

/** TEST SEAM ONLY, as `__setMembershipLookupForTests`. */
export function __setMembershipsLookupForTests(fn: MembershipsLookup | null): void {
  membershipsLookup = fn ?? lookupMemberships;
}

/**
 * Bind any invitation addressed to this subject's VERIFIED email (0093 T6).
 *
 * Called at one moment only: when tenant resolution is about to refuse somebody
 * for having no membership anywhere. That is precisely the state a person is in
 * the first time they sign in after their access request was granted — the
 * organisation exists, the owner row exists, and it is addressed to their email
 * with a `pending:` placeholder where their subject will go.
 *
 * **The database decides what may be claimed**, not this function: migration
 * 0006's policy requires the row to be an open invitation to `app.current_email`
 * and requires the result to name this subject and be active. All this does is
 * refuse to set that setting at all unless the issuer asserted the address, and
 * run the statement.
 *
 * Returns how many invitations were bound, which the caller uses to decide
 * whether re-resolving is worth a second round trip.
 */
async function claimInvitations(payload: JwtPayload): Promise<number> {
  // Not "trust it if it looks fine": absent is not verified, and `true` is the
  // only value that means verified.
  if (payload.email_verified !== true || !payload.email) return 0;

  const bound = await ledgerWithSubject(
    getAuthPool(),
    payload.sub,
    async (db) =>
      await db
        .update(tenantMember)
        .set({ userId: payload.sub, status: 'active', joinedAt: new Date() })
        .where(and(eq(tenantMember.email, payload.email), eq(tenantMember.status, 'invited')))
        .returning({ tenantId: tenantMember.tenantId }),
    { verifiedEmail: payload.email },
  );

  if (bound.length > 0) {
    log.info(`[auth] ${payload.sub} accepted ${bound.length} invitation(s) on first sign-in`);
  }
  return bound.length;
}

/** What a request may say when its subject belongs to more than one tenant. */
export const TENANT_HEADER = 'x-ownpace-tenant';

/**
 * Which tenant this request acts on.
 *
 * In order, and the order is the point:
 *
 *  1. **The `X-Ownpace-Tenant` header**, when the caller named one. It is a
 *     REQUEST for a tenant and not a grant of one — the membership gate still
 *     has to find an active row before anything is served, exactly as it does
 *     for a claim. Nothing here is trusted; this only decides which tenant gets
 *     checked.
 *  2. **The token's `tenantId`**, where an issuer still mints one. The
 *     self-host edition's own HS256 tokens carry it, and so will any managed
 *     deployment that has not yet moved — so this keeps working rather than
 *     breaking every existing session on the day the claim stops being required.
 *  3. **The subject's ONE membership**, which is the ordinary case: invite-only
 *     means almost everybody belongs to exactly one tenant, and asking them to
 *     say so would be asking a question with one possible answer.
 *
 * Several memberships and no explicit choice is the one case that cannot be
 * guessed. Picking the first would silently serve somebody the wrong
 * organisation's mail; so it refuses, and the refusal NAMES the choices, because
 * a client that has to ask which tenant needs to know what the options are.
 */
export async function resolveTenant(
  payload: JwtPayload,
  requested: string | undefined,
): Promise<
  | { tenantId: string }
  | { refusal: { status: number; body: Record<string, unknown> } }
> {
  const asked = requested?.trim();
  if (asked) return { tenantId: asked };
  if (payload.tenantId) return { tenantId: payload.tenantId };

  const memberships = await membershipsLookup(payload.sub);
  if (memberships.length === 1) return { tenantId: memberships[0]!.tenantId };

  if (memberships.length === 0) {
    return {
      refusal: {
        status: 403,
        body: {
          error: 'Forbidden',
          message: 'No active membership for this tenant',
        },
      },
    };
  }

  return {
    refusal: {
      status: 400,
      body: {
        error: 'Tenant required',
        message:
          `This account belongs to ${memberships.length} organisations. Name one in the ` +
          `${TENANT_HEADER} header.`,
        tenants: memberships.map((m) => ({ tenantId: m.tenantId, role: m.role })),
      },
    },
  };
}

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

/**
 * `sub` and `email`, and nothing else (ADR-0042).
 *
 * It used to demand `tenantId` and `role` too. `role` was already dead weight —
 * `authenticate` overwrites it from `tenant_member` eleven lines after reading
 * it — and `tenantId` is not a fact about the user at all: it is which tenant
 * the session is acting on, which the database can answer from the subject.
 * Requiring either meant every issuer had to be taught Ownpace's tenancy model,
 * which is exactly the coupling that would have made the provider unswappable.
 */
function assertRequiredClaims(payload: JwtPayload): void {
  if (!payload.sub || !payload.email) {
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

    // Which tenant, before whether. See `resolveTenant`: the token may no
    // longer say (ADR-0042), so it can come from the header, the claim where
    // one exists, or the subject's single membership — and none of those is
    // trusted, because the gate below still has to find an active row.
    const requested = req.headers[TENANT_HEADER] as string | undefined;
    let resolved = await resolveTenant(payload, requested);

    // The first sign-in after an access request was granted looks exactly like
    // somebody with no business here: the organisation exists, but the owner row
    // still carries a `pending:` placeholder instead of this subject. So before
    // refusing for having no membership, see whether there is an invitation
    // addressed to a VERIFIED email — and only then, because binding on an
    // unverified one would hand the organisation to whoever registered the
    // address (workplan 0093 T6).
    //
    // Narrow on purpose. Only the 403 triggers it: a 400 means the subject has
    // several memberships and simply has not said which, and claiming there
    // would be a write on a request that is already answerable.
    if ('refusal' in resolved && resolved.refusal.status === 403) {
      if ((await claimInvitations(payload)) > 0) {
        resolved = await resolveTenant(payload, requested);
      }
    }

    if ('refusal' in resolved) {
      res.status(resolved.refusal.status).json(resolved.refusal.body);
      return;
    }
    const tenantId = resolved.tenantId;

    if (mode !== 'dev') {
      const membership = await membershipLookup(tenantId, payload.sub);
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
    authenticatedReq.tenantId = tenantId;
    authenticatedReq.userRole = role;
    authenticatedReq.userEmail = payload.email;

    // Set tenant context for RLS
    // This will be used by the database client to set app.current_tenant
    res.locals.tenantId = tenantId;

    next();
  } catch (error) {
    respondToAuthError(res, error);
  }
}

/**
 * Turn a verification failure into the right refusal.
 *
 * Extracted so `authenticate` and `authenticateSubject` cannot drift: two
 * copies of this ladder is two chances for one of them to answer 500 where the
 * other answers 401, and the difference between "your token is bad" and "our
 * server is bad" is the whole of what a caller can act on.
 */
function respondToAuthError(res: Response, error: unknown): void {
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
      serverFault(res, 'auth_failed', 'verifying your session', error);
    }
  } else {
    serverFault(res, 'auth_failed', 'verifying your session', error);
  }
}

/**
 * Authenticate a SUBJECT, and stop there (workplan 0093 T6).
 *
 * `authenticate` answers "who are you, and which organisation are you acting
 * on" — and refuses when the second half has no answer. That refusal is right
 * for every tenant-scoped route and wrong for the two kinds of caller that
 * legitimately have no tenant yet:
 *
 *  - a **platform operator**, whose whole job happens before any tenant exists;
 *  - somebody who has just **signed in and belongs to nothing yet**, for whom
 *    "where may I go" has the valid answer "nowhere", and for whom a 403 is
 *    indistinguishable from "your token is bad".
 *
 * So this verifies the token exactly as `authenticate` does — same
 * `verifyToken`, same JWKS path, same refusals — and attaches the subject
 * without resolving or requiring a tenant. It grants NOTHING: every policy in
 * the database keys on `app.current_tenant` or `app.current_user`, and a route
 * behind this middleware still has to set one to see a row.
 *
 * It is not a lighter `authenticate`. A tenant-scoped route behind this would
 * run with no tenant at all — which is a refusal from the database rather than
 * a leak, but a confusing one. Use it only where having no tenant is the
 * expected case.
 */
export async function authenticateSubject(
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

    const payload = await verifyToken(authHeader.substring(7));

    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.userId = payload.sub;
    authenticatedReq.userEmail = payload.email;
    // Deliberately no tenantId and no userRole: there is no tenant here, and a
    // role read off the token has never been trusted anywhere in this file.

    next();
  } catch (error) {
    respondToAuthError(res, error);
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

    // Resolved the same way as in `authenticate`, and a refusal here is simply
    // NO CONTEXT rather than an error body: optional means the authentication
    // may be absent. An ambiguous tenant is one it cannot resolve, so it does
    // not — it must not pick one, for the same reason `authenticate` refuses to.
    const resolved = await resolveTenant(payload, req.headers[TENANT_HEADER] as string | undefined);
    if ('refusal' in resolved) {
      next();
      return;
    }
    const tenantId = resolved.tenantId;

    if (mode !== 'dev') {
      const membership = await membershipLookup(tenantId, payload.sub);
      if (!membership) {
        next();
        return;
      }
      role = membership.role;
    }

    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.userId = payload.sub;
    authenticatedReq.tenantId = tenantId;
    authenticatedReq.userRole = role;
    authenticatedReq.userEmail = payload.email;

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
