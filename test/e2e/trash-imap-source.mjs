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
// out of the LIST response (`mapImapSpecialUse`). A fixture that hardcoded a name
// would pass while the app looked somewhere else entirely — and a fixture more
// forgiving than production is not a test. If the server presents no `\Trash`
// mailbox this exits non-zero and says so, because that is a real finding about the
// server rather than something to work around by creating a folder (a folder we
// created would not carry the flag, so the app would not treat it as a bin either).
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

import imaps from 'imap-simple';

const host = process.env.SEED_IMAP_HOST || '127.0.0.1';
const port = Number(process.env.SEED_IMAP_PORT || '143');
const tls = (process.env.SEED_IMAP_TLS || 'false') === 'true';
const user = process.env.SEED_IMAP_USER || 'source@dev.local';
const password = process.env.SEED_IMAP_PASSWORD || 'source_password';
const messageId = process.env.TRASH_MESSAGE_ID || '<seed-1@dev.local>';

/** Every mailbox in the account, flattened, with its LIST attributes. */
function flatten(boxes, prefix, delimiter, out) {
  for (const [name, box] of Object.entries(boxes ?? {})) {
    const path = prefix ? `${prefix}${delimiter}${name}` : name;
    out.push({ path, attribs: box.attribs ?? [] });
    if (box.children) flatten(box.children, path, box.delimiter ?? delimiter, out);
  }
  return out;
}

/** The bin, by flag. `\Deleted` is accepted alongside `\Trash` as the app does. */
function findTrash(mailboxes) {
  return mailboxes.find((m) =>
    (m.attribs ?? []).some((a) => {
      const lower = String(a).toLowerCase();
      return lower === '\\trash' || lower === '\\deleted';
    }),
  );
}

async function main() {
  const connection = await imaps.connect({
    imap: { user, password, host, port, tls, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false } },
  });

  try {
    const mailboxes = flatten(await connection.getBoxes(), '', '/', []);
    const trash = findTrash(mailboxes);
    if (!trash) {
      console.error(
        '[trash-imap] this account presents no \\Trash mailbox, so there is no bin to ' +
          'delete into and no signal to prove. Mailboxes seen: ' +
          mailboxes.map((m) => `${m.path} [${(m.attribs ?? []).join(' ')}]`).join(', '),
      );
      process.exit(1);
    }
    console.log(`[trash-imap] bin is ${trash.path} (flags: ${trash.attribs.join(' ')})`);

    // Already there? Then a previous run did this, and re-doing it is neither
    // possible nor necessary.
    await connection.openBox(trash.path);
    const already = await connection.search([['HEADER', 'MESSAGE-ID', messageId]], {
      bodies: ['HEADER'],
      struct: false,
    });
    if (already.length > 0) {
      console.log(`[trash-imap] ${messageId} is already in ${trash.path}; nothing to do`);
      return;
    }

    await connection.openBox('INBOX');
    const found = await connection.search([['HEADER', 'MESSAGE-ID', messageId]], {
      bodies: ['HEADER'],
      struct: false,
    });
    if (found.length === 0) {
      console.error(
        `[trash-imap] ${messageId} is not in INBOX, so there is nothing that has been ` +
          'migrated for the owner to delete. Seed the source first.',
      );
      process.exit(1);
    }

    const uid = found[0].attributes.uid;
    try {
      // RFC 6851 MOVE, which is what a modern client uses.
      await connection.moveMessage(String(uid), trash.path);
      console.log(`[trash-imap] moved uid ${uid} (${messageId}) to ${trash.path}`);
    } catch (err) {
      // No MOVE extension: copy, flag, expunge — exactly what an older client does,
      // and the same end state. Worth having rather than failing on a server whose
      // capability list is merely older.
      console.log(`[trash-imap] MOVE unavailable (${err?.message ?? err}); falling back to COPY`);
      await new Promise((resolve, reject) =>
        connection.imap.copy(String(uid), trash.path, (e) => (e ? reject(e) : resolve())),
      );
      await connection.addFlags(String(uid), '\\Deleted');
      await new Promise((resolve, reject) =>
        connection.imap.expunge((e) => (e ? reject(e) : resolve())),
      );
      console.log(`[trash-imap] copied uid ${uid} (${messageId}) to ${trash.path} and expunged`);
    }
  } finally {
    connection.end();
  }
}

main().catch((err) => {
  console.error(`[trash-imap] failed: ${err?.message ?? err}`);
  process.exit(1);
});
