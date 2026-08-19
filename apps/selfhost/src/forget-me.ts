// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Ending the service on the appliance (workplan 0085 T9).
 *
 * ## Why this is a command and not a screen
 *
 * On the managed service, erasure is a staged flow — close, a window in which
 * to change your mind, then a purge that leaves a receipt. Three quarters of
 * that does not transfer, and pretending otherwise would be theatre:
 *
 *   - **the window** exists so a mistaken click can be caught. The operator of
 *     an appliance has root. They do not need our permission to delete, and we
 *     could not withhold it;
 *   - **the receipt** is evidence WE produce for a customer. Here the operator
 *     is the customer. A receipt we generate proves nothing to them that they
 *     did not already know;
 *   - **invoice retention** is a tax obligation on us as a processor. A
 *     self-hoster has their own, different one, and it is not ours to guess.
 *
 * Hard rule 5 says the editions must not differ. They genuinely do here, and
 * the workplan's instruction was to decide that rather than inherit it.
 *
 * ## What DOES transfer, and is the whole reason this exists
 *
 * `docker compose down -v` destroys our copy of a credential and does nothing
 * whatever to the grant it authenticates with. A Google refresh token still
 * mints access tokens. A Nextcloud app password still logs in. The operator
 * wipes the disk, believes they are finished, and has left working ways into
 * their own accounts behind — which is precisely what 0085 T4a/T4b exist to
 * prevent, and the appliance had no way to do either.
 *
 * ## The ordering is the point, and it is not recoverable
 *
 * Revocation needs the credentials the wipe destroys. Run it FIRST and the
 * tokens are withdrawn at the provider; wipe first and there is nothing left to
 * revoke with — permanently. So this refuses, loudly, when there is nothing to
 * read, rather than printing a cheerful summary of zero connections and letting
 * somebody believe they were done. A refusal that explains the loss is the only
 * useful thing left to say at that point.
 *
 * Usage:
 *   pnpm --filter @openmig/selfhost forget-me            # revoke, then report
 *   pnpm --filter @openmig/selfhost forget-me --dry-run  # report only
 */

import { createPgDb, pgDriver, createPgliteDb, type LedgerDriver } from '@openmig/ledger';
import { HttpTokenRevoker } from '@openmig/connectors';
import { NO_REVOCATION, accessThatOutlivesErasure, summariseRevocations } from '@openmig/shared';
import { revokeStoredCredentials } from '@openmig/orchestration/revoke-stored-credentials';

/** Everything this command needs to know about the appliance's storage. */
async function openStorage(): Promise<{ driver: LedgerDriver; close: () => Promise<void> }> {
  if (process.env.SELFHOST_PERSISTENCE === 'pglite') {
    const made = await createPgliteDb({
      dataDir: process.env.SELFHOST_PGLITE_DIR ?? '/data/pglite',
    });
    return { driver: made.driver, close: made.close };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set, and SELFHOST_PERSISTENCE is not `pglite`. This command has to ' +
        'read the credentials before they are destroyed, so it needs to reach the same storage ' +
        'the appliance uses.',
    );
  }
  const db = createPgDb(url);
  return { driver: pgDriver(db.$pool), close: () => db.close() };
}

export async function forgetMe(argv: readonly string[] = []): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const { driver, close } = await openStorage();
  const conn = await driver.acquire();
  try {
    const tenants = await conn.query<{ id: string; name: string }>(
      `SELECT id, name FROM tenant ORDER BY name`,
      [],
    );

    if (tenants.rows.length === 0) {
      // The wiped-first case. Say what has been lost rather than reporting a
      // tidy nothing — this is the one moment where a reassuring summary would
      // do real harm.
      process.stderr.write(
        [
          'REFUSING: there are no tenants in this appliance.',
          '',
          'If you have already wiped the data (docker compose down -v, or deleting the PGlite',
          'directory), the credentials this command would have revoked are gone with it. They',
          'were the only copy we held — and the GRANTS they authenticate with are not affected',
          'by deleting them. They are still live, in your providers, right now.',
          '',
          'Nothing here can withdraw them any more. You have to do it by hand, in each',
          "provider's own console:",
          '',
          '  Google      https://myaccount.google.com/permissions',
          '  Microsoft   https://entra.microsoft.com -> Enterprise applications -> Permissions',
          '  Dropbox     https://www.dropbox.com/account/connected_apps',
          '  Nextcloud   Settings -> Security -> Devices & sessions (app passwords)',
          '  Proton      Account -> Security -> App passwords',
          '',
          'If instead this is simply the wrong database, set DATABASE_URL (or',
          'SELFHOST_PERSISTENCE=pglite and SELFHOST_PGLITE_DIR) to the one the appliance uses',
          'and run this again BEFORE deleting anything.',
          '',
        ].join('\n'),
      );
      return 2;
    }

    // `NO_REVOCATION` for a dry run: the reporting is identical, and the whole
    // point of asking first is that nothing is withdrawn yet.
    const revoker = dryRun ? NO_REVOCATION : new HttpTokenRevoker();

    for (const tenant of tenants.rows) {
      const kinds = await conn.query<{ kind: string }>(
        `SELECT DISTINCT kind FROM connection WHERE tenant_id = $1`,
        [tenant.id],
      );

      process.stdout.write(`\n=== ${tenant.name} (${tenant.id}) ===\n`);
      if (dryRun) process.stdout.write('(dry run — nothing has been revoked)\n');

      const outcomes = await revokeStoredCredentials(conn, tenant.id, revoker);
      const summary = summariseRevocations(outcomes);
      process.stdout.write(
        `\nrevocation: ${summary.revoked} revoked, ${summary.unsupported} not supported by the ` +
          `provider, ${summary.failed} failed, ${summary.no_credential} had nothing stored\n`,
      );
      for (const o of outcomes) {
        process.stdout.write(`  - ${o.kind}: ${o.status} — ${o.reason}\n`);
      }

      // The half no software can do for them (T4b). Credentials before
      // consents: a consent is a permission sitting unused, a live app password
      // is a working way in.
      const outliving = accessThatOutlivesErasure(
        kinds.rows.map((k) => k.kind),
        'en',
      );
      if (outliving.length > 0) {
        process.stdout.write('\nOnly you can remove these — they are in your own accounts:\n');
        for (const item of outliving) {
          process.stdout.write(`\n  ${item.heading}\n    ${item.body}\n    Where: ${item.where}\n`);
        }
      }
    }

    process.stdout.write(
      dryRun
        ? '\nDry run complete. Nothing was revoked. Re-run without --dry-run to withdraw what can be withdrawn.\n'
        : '\nDone. You may now delete the data (docker compose down -v, or remove the PGlite directory).\n' +
            'Anything listed above as still yours to remove will survive that — it is not ours to reach.\n',
    );
    return 0;
  } finally {
    conn.release();
    await close();
  }
}

// Only when run directly, so the tests can import `forgetMe` without it firing.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=\/)/, ''))) {
  forgetMe(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
