// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Delete ONE already-migrated message in the SOURCE mailbox, the way a mail client
// does it: move it into the bin. Lets the self-host e2e prove the mail deletion
// signal against the real stack.
//
// Everything else in the e2e ADDS items. This takes a message that has already been
// copied and throws it away, which §11.1 calls a lifecycle decision: the source is
// authoritative for an item's content, the owner for whether it should exist. The
// migration must notice, report it at `GET /deletions` with `evidence: "trashed"`,
// and remove nothing from the target.
//
// THE BIN IS FOUND FROM ITS RFC 6154 FLAG, never from its name. Stalwart, Dovecot,
// Exchange and Gmail disagree about whether it is called Trash, Deleted Items,
// Deleted Messages or [Gmail]/Trash, and the app itself reads the `\Trash` attribute
// out of the LIST response (`mapImapSpecialUse`), NOT from imapflow's name-based
// inference, which 0032 T1 deliberately switched off. A fixture that hardcoded a name
// would pass while the app looked somewhere else entirely — and a fixture more
// forgiving than production is not a test. If the server presents no `\Trash`
// mailbox this exits non-zero and says so, because that is a real finding about the
// server rather than something to work around by creating a folder (a folder we
// created would not carry the flag, so the app would not treat it as a bin either).
//
// THE MESSAGE IS FOUND BY a full UID-range header fetch + a client-side match, never by
// `SEARCH HEADER MESSAGE-ID`. The latter looked reasonable and failed against a real
// Stalwart on a 500+ message mailbox (run #63 of the self-host e2e): the message had
// definitely been APPENDed and definitely migrated (the appliance's own logs showed
// it created with zero failures), yet the HEADER search came back empty. A UID range
// and a `HEADER.FIELDS (MESSAGE-ID)` fetch are baseline IMAP4rev1 operations no
// compliant server can get wrong; a HEADER *search* criterion is a much less
// exercised code path and evidently not one to depend on here. That finding survives
// the imap-simple -> imapflow swap (workplan 0032) because it was never about the client.
//
// Config via env (same names as seed-imap-source.mjs):
//   SEED_IMAP_HOST      (default 127.0.0.1)
//   SEED_IMAP_PORT      (default 143)
//   SEED_IMAP_TLS       (default false; set "true" for 993)
//   SEED_IMAP_USER      (default source@dev.local)
//   SEED_IMAP_PASSWORD  (default source_password)
//   TRASH_MESSAGE_ID    (default <seed-1@dev.local>) — the message to delete
//
// Idempotent: a second run finds the message already in the bin and exits 0, so a
// re-dispatched workflow does not fail on a deletion it already made.

import { ImapFlow } from 'imapflow';

const host = process.env.SEED_IMAP_HOST || '127.0.0.1';
const port = Number(process.env.SEED_IMAP_PORT || '143');
const tls = (process.env.SEED_IMAP_TLS || 'false') === 'true';
const user = process.env.SEED_IMAP_USER || 'source@dev.local';
const password = process.env.SEED_IMAP_PASSWORD || 'source_password';
const messageId = process.env.TRASH_MESSAGE_ID || '<seed-1@dev.local>';

/**
 * The bin, by FLAG. `\Deleted` is accepted alongside `\Trash` as the app does.
 *
 * **Reads `flags`, NOT imapflow's `specialUse`.** imapflow also infers special
 * use from folder NAMES against localised tables when the server omits RFC 6154,
 * and workplan 0032 T1 deliberately switched that inference off in the connector
 * — so the app decides what the bin is from the server's own flags and nothing
 * else. A fixture that used the richer inference would find a bin the app does
 * not, and pass while production looked somewhere else entirely. A fixture more
 * forgiving than production is not a test.
 */
function findTrash(mailboxes) {
  return mailboxes.find((m) =>
    [...(m.flags ?? [])].some((a) => {
      const lower = String(a).toLowerCase();
      return lower === '\\trash' || lower === '\\deleted';
    }),
  );
}

/** Trim + strip one surrounding pair of angle brackets, so `<foo>` and `foo` compare equal. */
function normalizeMessageId(id) {
  return id.trim().replace(/^<(.*)>$/, '$1').trim();
}

/**
 * Find a message's UID in `mailbox` by its Message-ID header.
 *
 * A full UID range fetch of `HEADER.FIELDS (MESSAGE-ID)` and a client-side
 * match, not `SEARCH HEADER MESSAGE-ID`. Both should find the same message, but
 * only the former is something every IMAP4rev1 server is guaranteed to
 * implement correctly: a UID range and a `HEADER.FIELDS (...)` fetch are used
 * constantly and by everything, while a HEADER *search* criterion is a much
 * less exercised code path. It looked fine here until it silently returned zero
 * hits for a message that definitely existed, on a real Stalwart (run #63 of the
 * self-host e2e). That finding survives the client swap because it was never
 * about the client.
 */
async function findUidByMessageId(client, mailbox, messageId) {
  const wanted = normalizeMessageId(messageId);
  const lock = await client.getMailboxLock(mailbox);
  try {
    for await (const message of client.fetch(
      '1:*',
      { uid: true, headers: ['message-id'] },
      { uid: true },
    )) {
      const raw = message.headers ? message.headers.toString('utf-8') : '';
      const match = raw.match(/^message-id:\s*(.+)$/im);
      if (match && normalizeMessageId(match[1]) === wanted) return message.uid;
    }
    return undefined;
  } finally {
    lock.release();
  }
}

async function main() {
  const client = new ImapFlow({
    host,
    port,
    secure: tls,
    tls: { rejectUnauthorized: false },
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();

  try {
    const mailboxes = await client.list();
    const trash = findTrash(mailboxes);
    if (!trash) {
      console.error(
        '[trash-imap] this account presents no \\Trash mailbox, so there is no bin to ' +
          'delete into and no signal to prove. Mailboxes seen: ' +
          mailboxes.map((m) => `${m.path} [${[...(m.flags ?? [])].join(' ')}]`).join(', '),
      );
      process.exit(1);
    }
    console.log(`[trash-imap] bin is ${trash.path} (flags: ${[...trash.flags].join(' ')})`);

    // Already there? Then a previous run did this, and re-doing it is neither
    // possible nor necessary.
    if ((await findUidByMessageId(client, trash.path, messageId)) !== undefined) {
      console.log(`[trash-imap] ${messageId} is already in ${trash.path}; nothing to do`);
      return;
    }

    const uid = await findUidByMessageId(client, 'INBOX', messageId);
    if (uid === undefined) {
      console.error(
        `[trash-imap] ${messageId} is not in INBOX, so there is nothing that has been ` +
          'migrated for the owner to delete. Seed the source first.',
      );
      process.exit(1);
    }

    const lock = await client.getMailboxLock('INBOX');
    try {
      // RFC 6851 MOVE, which is what a modern client uses.
      //
      // imapflow reports a refused MOVE by RETURN VALUE rather than by throwing,
      // so the result is checked. A move that quietly did nothing would leave
      // the message in INBOX and the e2e would then fail further downstream,
      // blaming the deletion signal for a fixture that never deleted anything.
      const moved = await client.messageMove(String(uid), trash.path, { uid: true });
      if (moved) {
        console.log(`[trash-imap] moved uid ${uid} (${messageId}) to ${trash.path}`);
      } else {
        // No MOVE extension, or the server refused: copy, flag, expunge —
        // exactly what an older client does, and the same end state. Worth
        // having rather than failing on a server whose capability list is
        // merely older.
        console.log('[trash-imap] MOVE unavailable or refused; falling back to COPY');
        const copied = await client.messageCopy(String(uid), trash.path, { uid: true });
        if (!copied) {
          throw new Error(`the server refused to COPY uid ${uid} to ${trash.path}`);
        }
        if (!client.capabilities.has('UIDPLUS')) {
          // Without UIDPLUS this is a BARE EXPUNGE, which removes every message
          // in INBOX carrying \Deleted — including ones another client flagged
          // and never committed. `ImapFlowDavMailTarget` REFUSES in that case
          // and this says so rather than doing it silently, because a fixture
          // that quietly widens the one destructive operation in the product is
          // how that behaviour gets normalised.
          console.warn(
            '[trash-imap] server has no UIDPLUS: the expunge below is a BARE EXPUNGE and ' +
              'will remove every \\Deleted message in INBOX, not only uid ' +
              `${uid}. Acceptable on a throwaway e2e source; never in the product.`,
          );
        }
        const removed = await client.messageDelete(String(uid), { uid: true });
        if (!removed) {
          throw new Error(`the server refused to remove uid ${uid} from INBOX after the COPY`);
        }
        console.log(`[trash-imap] copied uid ${uid} (${messageId}) to ${trash.path} and expunged`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

main().catch((err) => {
  console.error(`[trash-imap] failed: ${err?.message ?? err}`);
  process.exit(1);
});
