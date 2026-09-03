// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Managed-edition demo seed (workplan 0011 T7).
 *
 * Seeds two demo tenants — each with an owner member and a source/target
 * connection + mailbox + mapping — so an operator can sign in as either tenant
 * and click through the Definition-of-Done journey against the managed compose
 * stack. It also mints a demo JWT per tenant owner (signed with JWT_SECRET),
 * because there is no password-login endpoint yet (auth is bearer-token only).
 *
 * The demo tenants point at REAL backends so a shadow pass can actually
 * complete (not just fail at "no credentials"), provisioned by
 * `deploy/compose/setup-managed-demo.sh` before running this seed:
 *   - Tenant A: mail only, against the demo Stalwart (IMAP source, JMAP
 *     target) — the same fixed `source`/`target` accounts
 *     `deploy/selfhost/setup-stalwart.sh` always provisions.
 *   - Tenant B: calendar/contact/file only, against the demo Nextcloud
 *     (CalDAV/CardDAV/WebDAV) — two accounts setup-managed-demo.sh creates.
 * They're split this way (not all four domains on both tenants) because the
 * `connection` table has exactly one source + one target row per tenant,
 * shared by every domain — there's no way for one tenant's single
 * source/target pair to point at two unrelated backends (Stalwart AND
 * Nextcloud) at once with today's schema. Real tenants configure their own
 * connections through the API; this split is a demo-seed constraint only.
 *
 * Idempotent: fixed UUIDs. Most tables use `ON CONFLICT DO NOTHING` (re-running
 * is a no-op). The `connection` rows are the one exception — they UPSERT
 * (`ON CONFLICT DO UPDATE`) so config/credentials always reflect what this
 * script currently defines, even against a Postgres volume left over from an
 * older version of this script (e.g. from before demo credentials existed —
 * DO NOTHING would otherwise silently keep serving the stale, credential-less
 * config forever, which is exactly the trap that produced a false "no
 * credentials configured" read on a stale volume during T7 verification).
 * All writes go through `withTenant()` (transaction-scoped `app.current_tenant`),
 * so the script is correct whether it connects as the DB owner or as `app_user`.
 *
 * Usage (from the repo root, with the managed stack + demo backend up — see
 * deploy/compose/setup-managed-demo.sh):
 *
 *   ./deploy/compose/seed-managed.sh
 *
 * That is the whole command, and it is now the only form this file teaches.
 * The hand-typed one it used to print began
 * `DATABASE_URL=postgres://openmigrate:...@localhost:5432/openmigrate`, and
 * 5432 is somebody else's database on any host running more than one thing —
 * on the reference box an unrelated service owns it while this stack's
 * Postgres is published on 55432. The wrapper asks compose which port it
 * actually got, so the guess is not available to get wrong.
 *
 * SECURITY: this is a *demo* seed against a throwaway local backend. The
 * printed JWTs and the hardcoded demo passwords below are for local
 * evaluation only; never run it against a production database.
 */

import jwt from 'jsonwebtoken';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  createPgDb,
  withTenant,
  runMigrations,
  migrationConnectionString,
  tenant,
  connection,
  mailbox,
  mailboxMapping,
  scopeSelection,
} from '@openmig/ledger';
import { tenantMember } from '@openmig/managed/schema-managed';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { log } from '@openmig/shared';
import type { DiscoveryDomain } from '@openmig/shared';

/** One demo tenant's fixed identifiers (deterministic → idempotent re-runs). */
interface DemoTenant {
  readonly tenantId: string;
  readonly name: string;
  readonly owner: { readonly userId: string; readonly email: string };
  readonly sourceConnectionId: string;
  readonly targetConnectionId: string;
  readonly sourceMailboxId: string;
  readonly targetMailboxId: string;
  readonly mappingId: string;
  /** Domains this tenant's single source/target pair can actually serve (see file header). */
  readonly domains: readonly (DiscoveryDomain)[];
  readonly source: { readonly kind: 'imap' | 'nextcloud'; readonly config: Record<string, unknown>; readonly credentials: Record<string, string> };
  readonly target: { readonly kind: 'jmap' | 'nextcloud'; readonly config: Record<string, unknown>; readonly credentials: Record<string, string> };
}

// Demo Stalwart accounts (deploy/selfhost/setup-stalwart.sh always provisions these four,
// fixed, regardless of caller — see that script's PLAN_FILE). Reached by the compose
// network alias "stalwart" that setup-managed-demo.sh joins it to.
const STALWART_MAIL = { host: 'stalwart', imapsPort: 993, jmapBaseUrl: 'http://stalwart:8080' };

// Demo Nextcloud accounts (provisioned by setup-managed-demo.sh via the canonical
// deploy/selfhost/setup-nextcloud-users.sh, run once per tenant with tenant-specific
// usernames). Reached by the compose service name "nextcloud".
//
// MUST be the actual DAV base (".../remote.php/dav/"), not the bare site origin --
// CalDAVTargetWriter/CardDAVTargetWriter (packages/engines) have no well-known/home-set
// discovery of their own (unlike CalDAVSource/CarddavSource, packages/connectors): they
// assume `config.url` IS ALREADY the DAV base and build collection paths directly under it
// (e.g. `${baseUrl}/calendars/${username}/...`), matching the self-host convention where an
// operator configures this url by hand. Confirmed live on the Spark box: with the bare
// origin, MKCALENDAR/MKCOL landed on Nextcloud's plain web-UI routes and got its HTML 404
// page back, not a DAV error.
const NEXTCLOUD_DAV_BASE_URL = 'http://nextcloud/remote.php/dav/';

const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    tenantId: 'a0000000-0000-4000-8000-000000000001',
    name: 'Demo Tenant A — Acme Families',
    owner: { userId: 'seed:demo-owner-a', email: 'owner-a@demo.openmigrate.test' },
    sourceConnectionId: 'a0000000-0000-4000-8000-0000000000c1',
    targetConnectionId: 'a0000000-0000-4000-8000-0000000000c2',
    sourceMailboxId: 'a0000000-0000-4000-8000-0000000000b1',
    targetMailboxId: 'a0000000-0000-4000-8000-0000000000b2',
    mappingId: 'a0000000-0000-4000-8000-0000000000d1',
    domains: ['email'],
    source: {
      kind: 'imap',
      // tlsVerify:false because the dev Stalwart's certificate is self-signed
      // -- a demo opting out in writing, now that verification defaults ON.
      config: { type: 'imap-oauth2', host: STALWART_MAIL.host, port: STALWART_MAIL.imapsPort, user: 'source@dev.local', tlsVerify: false },
      credentials: { password: 'source_password' },
    },
    target: {
      kind: 'jmap',
      config: { type: 'jmap', baseUrl: STALWART_MAIL.jmapBaseUrl, user: 'target@dev.local' },
      credentials: { password: 'target_password' },
    },
  },
  {
    tenantId: 'b0000000-0000-4000-8000-000000000002',
    name: 'Demo Tenant B — Bakerloo SMB',
    owner: { userId: 'seed:demo-owner-b', email: 'owner-b@demo.openmigrate.test' },
    sourceConnectionId: 'b0000000-0000-4000-8000-0000000000c1',
    targetConnectionId: 'b0000000-0000-4000-8000-0000000000c2',
    sourceMailboxId: 'b0000000-0000-4000-8000-0000000000b1',
    targetMailboxId: 'b0000000-0000-4000-8000-0000000000b2',
    mappingId: 'b0000000-0000-4000-8000-0000000000d1',
    domains: ['calendar', 'contact', 'file'],
    source: {
      kind: 'nextcloud',
      config: { baseUrl: NEXTCLOUD_DAV_BASE_URL },
      credentials: { username: 'tenant-b-source', password: 'tenant_b_source_pw' },
    },
    target: {
      kind: 'nextcloud',
      config: { baseUrl: NEXTCLOUD_DAV_BASE_URL },
      credentials: { username: 'tenant-b-target', password: 'tenant_b_target_pw' },
    },
  },
];

async function seedTenant(
  connectionString: string,
  jwtSecret: string,
  t: DemoTenant,
): Promise<string> {
  const db = createPgDb(connectionString);
  try {
    await withTenant(db.$pool, t.tenantId, async (tx) => {
      // Root entity first — RLS insert policy requires id === app.current_tenant.
      await tx.insert(tenant).values({ id: t.tenantId, name: t.name }).onConflictDoNothing();

      // THE OWNER THIS SCRIPT CURRENTLY DEFINES, and not also the one it used to.
      //
      // `onConflictDoNothing` is right while the subject is unchanged — it is
      // what makes a re-run cheap. It is exactly wrong when the subject CHANGES,
      // because the conflict target is `(tenant_id, user_id)`: a new subject
      // conflicts with nothing, so the row is inserted BESIDE the old one and
      // the demo tenant has two owners on every volume that ever ran an older
      // copy. Forever, and growing by one per change.
      //
      // That is the pileup the owner found on 2026-08-31 wearing a different
      // hat — "Demo Tenant A has 31 probe owner users... a bit much!?" — and
      // the smoke's sweep was written for its `@smoke.local` half. This is the
      // seed's own half, and it is the half that would have been created by the
      // very next line, when `demo-owner-a` became `seed:demo-owner-a` (0110's
      // console link: a subject no provider ever minted must be recognisable as
      // one, and the prefix is how).
      //
      // Narrow on purpose: THIS owner's address, on a tenant whose uuid this
      // script owns, under some other subject. It cannot reach a real person, a
      // smoke row, or the other demo tenant.
      await tx
        .delete(tenantMember)
        .where(
          and(
            eq(tenantMember.tenantId, t.tenantId),
            eq(tenantMember.email, t.owner.email),
            ne(tenantMember.userId, t.owner.userId),
          ),
        );

      await tx
        .insert(tenantMember)
        .values({
          tenantId: t.tenantId,
          userId: t.owner.userId,
          email: t.owner.email,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        })
        .onConflictDoNothing();

      // Source + target connections against the real demo backend (see file header for
      // why each tenant only points at one). Credentials are encrypted with the same
      // SECRET_ENCRYPTION_KEY the api/worker containers use, exactly like the real
      // create-mapping API route (apps/api/src/routes/migrations/index.ts).
      //
      // UPSERT, not onConflictDoNothing: this row's id is a fixed UUID, so on a Postgres
      // volume that already has a connection row from an older run of this script (e.g. an
      // earlier session, before credentials were added), DO NOTHING would silently keep
      // the stale config/secretRef forever — every re-run must actually reflect the demo
      // backend/credentials this script currently defines.
      const sourceConn = {
        id: t.sourceConnectionId,
        tenantId: t.tenantId,
        role: 'source' as const,
        kind: t.source.kind,
        displayName: `${t.source.kind} (demo source)`,
        config: t.source.config,
        secretRef: JSON.stringify(SecretStore.encryptCredentials(t.source.credentials).encrypted),
      };
      const targetConn = {
        id: t.targetConnectionId,
        tenantId: t.tenantId,
        role: 'target' as const,
        kind: t.target.kind,
        displayName: `${t.target.kind} (demo target)`,
        config: t.target.config,
        secretRef: JSON.stringify(SecretStore.encryptCredentials(t.target.credentials).encrypted),
      };
      await tx
        .insert(connection)
        .values([sourceConn, targetConn])
        .onConflictDoUpdate({
          target: connection.id,
          set: {
            kind: sql`excluded.kind`,
            displayName: sql`excluded.display_name`,
            config: sql`excluded.config`,
            secretRef: sql`excluded.secret_ref`,
          },
        });

      await tx
        .insert(mailbox)
        .values([
          {
            id: t.sourceMailboxId,
            tenantId: t.tenantId,
            connectionId: t.sourceConnectionId,
            externalId: 'source-primary',
            kind: 'user',
            primaryAddress: t.owner.email,
            displayName: 'Demo source mailbox',
          },
          {
            id: t.targetMailboxId,
            tenantId: t.tenantId,
            connectionId: t.targetConnectionId,
            externalId: 'target-primary',
            kind: 'user',
            primaryAddress: t.owner.email,
            displayName: 'Demo target mailbox',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(mailboxMapping)
        .values({
          id: t.mappingId,
          tenantId: t.tenantId,
          sourceMailboxId: t.sourceMailboxId,
          targetMailboxId: t.targetMailboxId,
          mode: 'mirror',
          status: 'active',
        })
        .onConflictDoNothing();

      // Scope selection: only the domains this tenant's backend can actually serve
      // (see the DemoTenant.domains comment) so the managed-sync-tick task has real work to do.
      await tx
        .insert(scopeSelection)
        .values(
          t.domains.map((domain) => ({
            mappingId: t.mappingId,
            tenantId: t.tenantId,
            domain,
            included: true,
            filters: {},
          })),
        )
        .onConflictDoNothing();
    });
  } finally {
    await db.close();
  }

  // Demo bearer token so the operator can call the API / paste into the web app.
  return jwt.sign(
    { sub: t.owner.userId, email: t.owner.email, tenantId: t.tenantId, role: 'owner' },
    jwtSecret,
    { expiresIn: '7d' },
  );
}

/**
 * THE THREE SETTINGS THE SEED CANNOT FIND ON ITS OWN, AND THE COMMAND THAT
 * SUPPLIES THEM.
 *
 * One fact is behind every way this refuses: THE SEED RUNS ON THE HOST. It is
 * not a container, it inherits nothing from compose, and nothing in `apps/api`
 * loads a dotenv file — so all three come from whatever environment the caller
 * happened to have, which for anyone who has not hand-exported them is none.
 *
 * Until 2026-08-25 the refusal named a variable and stopped there. An operator
 * on the live test host ran the command this file's own header taught, and got:
 *
 *     Seed failed: DATABASE_URL (DB owner connection) is required to seed
 *
 * Every word true, and no use to the person reading it: it answers "what is
 * missing" to somebody who needs the answer to "what do I run".
 * `deploy/compose/seed-managed.sh` had supplied all three for three days by
 * then, and the refusal did not mention it — so the failure went into a chat
 * window instead of a shell.
 *
 * ALL THREE IN ONE MESSAGE, not one refusal at a time. They go missing
 * together, for one reason, with one remedy; naming the first and exiting
 * turns a single fix into three round trips through a failing command.
 *
 * PRESENCE ONLY, AND THAT LINE MATTERS. A key that is set but malformed is a
 * real configuration error, and `SecretStore.validate()` already says so in
 * terms that fit it. Sending that person to the wrapper — which would hand
 * them the same broken value again — is this same unhelpfulness pointing the
 * other way.
 */
function hostSettings(env: NodeJS.ProcessEnv): {
  readonly connectionString: string;
  readonly jwtSecret: string;
} {
  const connectionString = env.DATABASE_URL ?? env.SEED_DATABASE_URL ?? '';
  const jwtSecret = env.JWT_SECRET ?? '';

  const missing: string[] = [];
  if (!connectionString) missing.push('DATABASE_URL');
  if (!jwtSecret) missing.push('JWT_SECRET');
  if (!env.SECRET_ENCRYPTION_KEY) missing.push('SECRET_ENCRYPTION_KEY');

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.\n\n` +
        'The seed runs on the host and reads its settings from the environment.\n' +
        'Nothing in apps/api loads a .env file, so running it directly finds none\n' +
        'of them.\n\n' +
        '  Run this instead:  ./deploy/compose/seed-managed.sh\n\n' +
        'It reads deploy/compose/.env and asks compose which port Postgres is\n' +
        'published on — which is not 5432 on any host running more than one thing.\n' +
        'It is idempotent, and re-running it is also how you mint fresh demo\n' +
        'tokens once the old ones expire.',
    );
  }

  return { connectionString, jwtSecret };
}

async function main(): Promise<void> {
  // Seed as the DB owner (bypasses RLS) — but withTenant makes app_user work too.
  const { connectionString, jwtSecret } = hostSettings(process.env);
  // The SHAPE check, after the presence one above: this fails a key that is
  // set and wrong, before any connection credential is encrypted with it.
  SecretStore.validate();

  // The demo run order (setup-managed-demo.sh's header) runs this seed BEFORE
  // the API has ever booted, so the schema may not exist yet. The migrator is
  // idempotent and advisory-locked, so racing an API boot is safe — whoever
  // arrives first applies, the other finds everything already recorded. This
  // used to be initdb's job via a docker-entrypoint-initdb.d mount, which
  // applied the files WITHOUT schema_migrations bookkeeping — see managed.yml.
  // Direct, not through the pooler, for the advisory-lock reason in
  // `direct-url.ts` — and doubly so here, where the whole point of the call is
  // that it may be racing an API boot doing the same thing.
  await runMigrations({ connectionString: migrationConnectionString(process.env) });
  // The managed chain too, and after: this script seeds `tenant_member` rows,
  // which that chain creates (ADR-0036).
  await runManagedMigrations({ connectionString: migrationConnectionString(process.env) });

  const tokens: Array<{ tenant: string; email: string; token: string }> = [];
  for (const t of DEMO_TENANTS) {
    const token = await seedTenant(connectionString, jwtSecret, t);
    tokens.push({ tenant: t.name, email: t.owner.email, token });
    log.info(`seeded: ${t.name} (${t.tenantId})`);
  }

  log.info('\nDemo owner tokens (Authorization: Bearer <token>) — expire in 7 days:\n');
  for (const { tenant: name, email, token } of tokens) {
    log.info(`# ${name} — ${email}`);
    log.info(token);
    log.info('');
  }
  log.info('Seed complete. Re-running is a no-op (idempotent).');
}

main().catch((err) => {
  log.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
