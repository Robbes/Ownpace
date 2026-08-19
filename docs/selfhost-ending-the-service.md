# Ending the service on the appliance

You own the disk. Deleting the data is one command and nobody can stop you —
that is what self-hosting means, and this page is not going to pretend
otherwise.

It exists because of the part that **deleting the disk does not do**.

## The one thing to get right

**Revoke before you wipe.** In that order, and the order is not recoverable.

Revocation needs the credentials stored in the appliance's database. Wipe
first and there is nothing left to revoke *with* — the tokens and app passwords
are gone from your copy, and still working at the provider, and you no longer
have the list of which ones there were.

```sh
# 1. See what would happen. Nothing is withdrawn.
pnpm --filter @openmig/selfhost forget-me --dry-run

# 2. Withdraw what can be withdrawn, and print what only you can remove.
pnpm --filter @openmig/selfhost forget-me

# 3. NOW delete the data.
docker compose -f deploy/selfhost/compose.yml down -v
```

If you have already wiped, `forget-me` refuses and tells you where to go by
hand. That refusal is the whole reason it checks.

## What each step actually removes

| | Removed by `down -v` | Removed by `forget-me` | Only you can remove |
|---|---|---|---|
| The ledger — what was copied where | ✅ | | |
| Your stored credentials (our copy) | ✅ | | |
| Google refresh tokens | | ✅ withdrawn at Google | |
| Microsoft admin consent | | ❌ no revocation endpoint exists | ✅ Entra console |
| Dropbox app link | | partial — the token, not the link | ✅ connected apps |
| Nextcloud / Proton app passwords | | ❌ nothing to call | ✅ their settings |
| Mail in the **source** | | | never touched, by anything |
| Mail in the **target** | | | it is yours, in your system |

The last two rows are the same guarantee the managed service makes: we forget
our record of a migration, we do not reach into either mailbox. Deleting the
appliance does not delete the mail it moved — that mail is in your own account
and stays there.

## Why there is no "close account" flow here

The managed service stages an erasure: close, a window in which to change your
mind, then a purge that leaves a receipt. Three quarters of that does not
transfer, and building it anyway would be theatre:

- **the window** exists so a mistaken click can be caught. You have root. We
  cannot withhold permission you already have;
- **the receipt** is evidence *we* produce for a customer. Here you are both.
  A receipt we generate proves nothing to you that you did not already know;
- **invoice retention** is a tax obligation on us as a processor. Yours is
  yours, and it is not ours to guess at.

What genuinely transfers is the credential problem, and that is what
`forget-me` is. The rest is a command you already have.

## If the appliance will not start

`forget-me` reads the database directly and does not need the server running.
Point it at the same storage the appliance uses:

```sh
# Postgres
DATABASE_URL=postgres://... pnpm --filter @openmig/selfhost forget-me

# PGlite
SELFHOST_PERSISTENCE=pglite SELFHOST_PGLITE_DIR=/data/pglite \
  pnpm --filter @openmig/selfhost forget-me
```

A wrong `DATABASE_URL` looks exactly like an already-wiped appliance — both
have no tenants in them — so the refusal names that possibility too. If you see
it and you have **not** deleted anything yet, check the address before you
believe the bad news.
