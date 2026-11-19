# ADR-0052: A rotating refresh token is written back, one refresh at a time

- **Status:** **Accepted 2026-11-19** by the owner, for Cirrux Drive in alpha.12 (workplan 0160
  T5); built in that workplan, not yet run against a live Cirrux client (T2b).
- **Date:** 2026-11-19
- **Deciders:** owner
- **Relates to:** [ADR-0037](./0037-keys-credentials-and-transport-floors.md) (one credential
  store, which the write-back goes through), [ADR-0041](./0041-who-owns-the-oauth-client.md) (who
  owns the OAuth client: Cirrux's is the deployment's, and public),
  [ADR-0003](./0003-two-editions-one-core.md) (why the appliance has no Cirrux Drive),
  [workplan 0160](../workplans/0160-cirrux-as-a-destination.md) §6 (the two blockers this
  answers)

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **A pass writes a stored credential back only for a provider whose refresh tokens rotate**,
  each refresh retiring the last: Cirrux today. Every other connector reads its credential and
  never writes it, and Box keeps its client-credentials grant (`box-token-provider.ts`).
- **One refresh at a time per connection**: from reading the stored token to storing its
  successor, the refresh holds the connection row's lock (`SELECT … FOR UPDATE`), so two runs
  never spend one token (`cirrux-grant-store.ts`; `two-refreshes-one-token.unit.test.ts`,
  `cirrux-grant-store.integration.test.ts`).
- **The successor goes through the one credential store** (ADR-0037): encrypted by
  `SecretStore`, in the same row, by an UPDATE that compares the ciphertext it read; a mismatch
  stores nothing. No token is logged, put in a URL, or handed to a browser.
- **An access token lives in memory only**, one per writer, refreshed single-flight in a process.
- **A token Cirrux may have spent is never presented again**: a successor that never arrived, or
  `invalid_grant`, removes the stored token in the same transaction, and the person connects
  again. A `429` waits its `Retry-After`; an answer that says nothing happened keeps the token.
- **Cirrux's OAuth client is the deployment's**: one public client per deployment, PKCE `S256`,
  no secret, `CIRRUX_OAUTH_CLIENT_ID` for the API and the worker. Unset, the Drive face is a
  measured no and no button is offered (`a-client-the-worker-never-got.unit.test.ts`).
- **The grant is stored by the consent door's callback, on the server**, onto the account the
  authorize call named (`cirrux-oauth-routes.ts`).
- **The appliance has no Cirrux Drive**: its credentials live in its `.env`, which nothing
  writes back, and it has no consent door.

## Context

Cirrux Drive is reached only through Cirrux's own HTTP API, with a person's OAuth sign-in
(`https://cirrux.co/help/api`, `https://cirrux.co/help/api/drive`, read 2026-11-19). Its tokens:
an access token that lasts 15 minutes, and a refresh token that lasts 30 days, where **every
refresh returns a new refresh token and retires the old one, and using a retired one signs the
person out**. The client is public: no secret, PKCE `S256`, registered by Cirrux on request with
its redirect URLs and scopes.

Until now this product's stored credentials were written once and never written back by a pass.
Connectors read credentials; they do not mutate them. That posture is why Box uses its
client-credentials grant (workplan 0056): a stored Box refresh token would authenticate one pass
and break the next. Cirrux documents no client-credentials grant for Drive, so under the old
posture a Cirrux Drive writer could not exist: its stored token would be retired by the first
refresh, and the second pass would sign the person out.

Two things can spend one token at once: two processes (a pass in the worker and a Test in the
API, or two passes), and two items inside one pass, which run concurrently.

## Decision

**A rotating refresh token is written back after every refresh, and only for a provider whose
tokens rotate.** The rule every other connector keeps is unchanged; this is a named exception,
held by a store a writer has to be handed.

1. **Single-flight per connection, across processes.** The refresh runs inside one database
   transaction that first takes the connection row's lock (`SELECT secret_ref … FOR UPDATE`),
   reads and decrypts the stored token, calls the token endpoint with it, encrypts the
   successor and stores it, then commits. A second refresh for the same connection waits on the
   lock and then reads the successor, never the token just spent. A row lock rather than an
   advisory lock, because it also serialises against every other UPDATE of the row: a person
   replacing the app password, or connecting Drive again, waits for the refresh in flight.
2. **Single-flight inside a process.** A writer holds one token provider; concurrent items share
   one refresh in flight, and the access token is kept in memory until a minute before it
   expires. Nothing but the refresh token is ever stored.
3. **Compare-and-swap on what was read.** The UPDATE carries `WHERE secret_ref = <the ciphertext
   read>`. Under the lock nothing else can have changed it; the comparison is the second lock,
   for a writer that ever forgets the first, and a mismatch stores nothing and fails the pass.
4. **Through the one credential store** (ADR-0037): the same `SecretStore`, the same column, the
   same key. The token is never logged, never in a URL, never in a response.
5. **A token Cirrux may have spent is never presented again.** Presenting a retired token signs
   the person out, so the outcome of each refresh is sorted three ways:
   - **rotated**: a readable successor came back, and it is stored;
   - **spent**: the old token may be retired and no successor is in hand (a `2xx` whose body
     names none, a connection lost after the request was sent), or Cirrux answered
     `invalid_grant`. The stored token is removed in the same transaction, the Drive reads as not
     connected with that reason, and the person presses **Connect Cirrux Drive** again;
   - **kept**: Cirrux said nothing was done (a `429`, retried after its `Retry-After`; a `5xx`;
     a connection that never opened). The token stays for the next attempt.

   No design can store a successor it never received; what this one guarantees is that a token
   which may be spent is never sent a second time.
6. **The client.** One public OAuth client per deployment, registered by Cirrux per redirect URL
   (`<API_URL>/api/migrations/cirrux/callback`), PKCE `S256`, with the scopes `user.profile
   workspace.read drive.read drive.create drive.update drive.delete`. `drive.delete` is used only
   to move a file to the trash when the person approved removing it because it was deleted at the
   source; never a permanent delete. The client ID comes from the deployment's environment
   (`CIRRUX_OAUTH_CLIENT_ID`), read by the API (the consent door, the Test) and by the worker (a
   pass refreshes). It is no secret, but it is the deployment's: the connection stores none.
7. **The grant never reaches a browser.** The consent door's callback exchanges the code and
   stores the refresh token on the account the authenticated authorize call named, held in the
   signed single-use state on the server. The page tells the opening window only that the Drive
   is connected.

## Consequences

- Cirrux Drive can be a destination: the file face of the existing `cirrux` account kind, which
  exists once a Drive grant is stored, on a deployment that has a client.
- Every refresh is a database transaction that holds a pool connection for the length of one
  call to Cirrux's token endpoint, bounded by that call's timeout.
- A Test of a connected account refreshes too, so a Test rotates the token as a pass does.
- The token endpoint is rate limited per IP for requests without a bearer token (60 a minute,
  `https://cirrux.co/help/api`). One refresh per writer per 15 minutes stays far below it on a
  small deployment; a deployment with many connected Drives would meet it first at the start of
  a tick.
- A grant unused for 30 days expires and the person connects again.
- The appliance does not gain the face: it stores no credential in its database, it has no
  consent door, and its owner would need a Cirrux client of their own.

## Alternatives considered

**Write nothing back, as Box does.** Cirrux documents no client-credentials grant for Drive, so
this is no Cirrux Drive at all.

**Ask for a new sign-in every pass.** A headless pass on a schedule cannot open a browser; the
same contradiction ADR-0025 names for Proton Drive.

**An advisory lock instead of the row lock.** It serialises only refreshes that ask for it; an
UPDATE from another door would not wait, and could replace the row between our read and write.
The compare-and-swap would then refuse, but only after Cirrux had already retired the token.

**Store the access token too, and share it between processes.** It lives 15 minutes, a pass
refreshes once or twice, and a stored access token is one more secret at rest for no gain.

**Hand the refresh token to the wizard window, as the Dropbox and Google doors do.** That puts a
30-day bearer credential in a browser, for a page that only needs to know the Drive is connected.

**Retry a refresh whose answer was lost, with the same token.** If Cirrux had retired it, the retry
is the reuse that signs the person out, and a token kept after such a failure would be presented
again by every pass after it.
