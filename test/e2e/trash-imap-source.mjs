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
// THE MESSAGE IS FOUND BY `SEARCH ALL` + a client-side header match, never by
// `SEARCH HEADER MESSAGE-ID`. The latter looked reasonable and failed against a real
// Stalwart on a 500+ message mailbox (run #63 of the self-host e2e): the message had
// definitely been APPENDed and definitely migrated (the appliance's own logs showed
// it created with zero failures), yet the HEADER search came back empty. `SEARCH
// ALL` and a `HEADER.FIELDS (MESSAGE-ID)` fetch are baseline IMAP4rev1 operations no
// compliant server can get wrong; a HEADER *search* criterion is a much less
// exercised code path and evidently not one to depend on here.
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

/** Trim + strip one surrounding pair of angle brackets, so `<foo>` and `foo` compare equal. */
function normalizeMessageId(id) {
  return id.trim().replace(/^<(.*)>$/, '$1').trim();
}

/**
 * Find a message's UID in the CURRENTLY OPEN mailbox by its Message-ID header.
 *
 * `SEARCH ALL` + a client-side header match, not `SEARCH HEADER MESSAGE-ID`. Both
 * should find the same message, but only the former is something every IMAP4rev1
 * server is guaranteed to implement correctly: `ALL` and a `HEADER.FIELDS (...)`
 * fetch are used constantly and by everything, while a HEADER *search* criterion
 * is a much less exercised code path. It looked fine here until it silently
 * returned zero hits for a message that definitely existed, on a real Stalwart.
 */
async function findUidByMessageId(connection, messageId) {
  const wanted = normalizeMessageId(messageId);
  const messages = await connection.search(['ALL'], {
    bodies: ['HEADER.FIELDS (MESSAGE-ID)'],
    struct: false,
  });
  for (const message of messages) {
    const headerPart = message.parts.find((p) => String(p.which).toUpperCase().startsWith('HEADER'));
    const values = headerPart?.body?.['message-id'];
    const value = Array.isArray(values) ? values[0] : values;
    if (value && normalizeMessageId(value) === wanted) return message.attributes.uid;
  }
  return undefined;
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
    const alreadyUid = await findUidByMessageId(connection, messageId);
    if (alreadyUid !== undefined) {
      console.log(`[trash-imap] ${messageId} is already in ${trash.path}; nothing to do`);
      return;
    }

    await connection.openBox('INBOX');
    const uid = await findUidByMessageId(connection, messageId);
    if (uid === undefined) {
      console.error(
        `[trash-imap] ${messageId} is not in INBOX, so there is nothing that has been ` +
          'migrated for the owner to delete. Seed the source first.',
      );
      process.exit(1);
    }

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
