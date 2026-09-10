# Workplan 0122 — The link that shows

## Status — 2026-09-10 (update this block at the end of every session)

**2026-09-10: opened, and slice 1 built.** The owner asked whether the shareable link exists
and described what he wants it to become:

> *"also check if we build the link one can share towards that someone can grant access to
> there source and/or target, and have overview of the migration. i vision it like this: a dad
> can migrate its elderly parents one by one, remote, by sending them a link to arrange the
> permission/grants and give them insight."*

The first half exists and has since 2026-08-27 — that is workplan 0108, all five tasks done.
The second half does not. `mapping_link.purpose` reserves the word `'view'`, the middleware
already accepts it, `verifyMappingLink` already exempts it from single-use — and **nothing
mints one and no page honours one**, which `link-routes.ts:71` says in as many words:

> *"a purpose the API accepts but no page honours is a link that opens nothing."*

This plan is that page, and the two answers the owner gave on 2026-09-10 shape it:

| Question | Answer |
|---|---|
| How does a person get the progress link? | **Both** — minted when their grant lands, and issuable by the owner at any time. |
| Does the page carry start and pause? | **Counts and states first**, actions in a later slice. |

| Task | Status | Notes |
|---|---|---|
| T1 What may cross, as a type | ✅ Done — §3 | `viewRowFor` in `@openmig/shared`, and the `Required<DomainStatusReport>` fixture that makes a new contract field a **typecheck failure** until somebody decides whether a stranger may see it. |
| T2 The owner mints one | ✅ Done — §4 | `purpose` on `POST /:mappingId/links`, its own longer expiries, and a refusal set that shrinks to one because the page does less. |
| T3 The route that answers a link | ✅ Done — §5 | `GET /api/view/:link`. Counts and states, never content, and **never `lastError`**. |
| T4 The page | ✅ Done — §6 | `/view/:link`, outside the chrome, for a reader with no account. Absence is not zero. |
| T5 The owner's panel tells the two apart | ✅ Done — §7 | It could not: `listMappingLinks` returns both purposes and the panel rendered neither. |
| T6 The gate opens one on a real stack | ✅ Done — §8 | `scripts/gate-coverage.unit.test.ts` made this a decision rather than an omission, and the honest answer was to ask for it. |
| T7 Minted at grant | ⬜ Slice 2 | The success page says "keep this one" and hands over the longer link. §9. |
| T8 Their own start and pause | ⬜ Slice 3 | ADR-0035's *"their own start and pause"*. Owner: later slice. §9. |

## 1. What already exists, and the one line that stops it being enough

0108 built the **credential** lifetime end to end: the row, the middleware, the owner's
issue/list/revoke surface, the migrator's page, the server-side ending. Its own closing
section names what it left:

> **Not in this plan** — The **'view' / progress page** — the second lifetime. The `purpose`
> column reserves it.

So the pieces are already in place and each one already knows about `view`:

| Piece | Where | What it already does for `view` |
|---|---|---|
| The purpose | `mapping-link-store.ts:44` | `MAPPING_LINK_PURPOSES = ['grant', 'view']` |
| Single use | `mapping-link-store.ts:203` | `if (row.purpose === 'grant' && row.usedAt) return refused;` — a view link is *meant* to be opened again |
| The middleware | `auth.ts:1134` | `authenticateMappingLink(purpose: 'grant' \| 'view', …)` |
| The web client | `grant-link-service.ts:39` | `purpose: z.enum(['grant', 'view'])` |

What is missing is the two ends: nothing writes `purpose: 'view'`, and no route or page reads
one.

## 2. The decided ground this plan may not reinvent

From [ADR-0035](../adr/0035-who-signs-in-and-who-gets-a-link.md), §2, accepted:

> The link **does two jobs**: supply the credential, once; and **be their page afterwards** —
> their own progress, their own start and pause. This is what "migrate at your own pace"
> actually requires; without it, pace belongs to whoever holds the admin login.
>
> The two jobs get different lifetimes, because they carry different risk. The credential step
> is **short-lived and single-use**; the progress page is **longer-lived but revocable**, and
> **carries counts and states rather than content**, which is what makes the longer window
> acceptable.

Three consequences, and none of them is this plan's to relitigate:

1. **Longer-lived.** So it gets its own expiry list, not the credential's `[1, 7, 30]`.
2. **Revocable.** Already true — `revokeMappingLink` does not care about purpose, and
   `verifyMappingLink` re-checks revocation at every open, not only at the first.
3. **Counts and states rather than content.** This is the load-bearing one, and §3 is nothing
   but the machinery that makes it true by construction rather than by care.

And from ADR-0035 §2 again, which decides how the link travels: **"The admin distributes the
link. We never do."** Slice 2's minting-at-grant is not a violation of that — the link is
handed to the person who is *already on the page*, in their own browser, in the same breath as
their consent. Nothing is emailed, and no address is stored, here or anywhere.

## 3. T1 — What may cross, as a type

The page's whole justification is one sentence in the ADR, so the sentence is enforced in a
module and not in a reviewer's attention. `packages/shared/src/view-row.ts`:

```ts
export function viewRowFor(report: DomainStatusReport): ViewDomainRow
```

Six of `DomainStatusReport`'s fields are counts, four are states, two are timestamps — and
**two must not cross**:

- **`lastError`** — the provider's own prose. Rule 2 (ADR-0024) keeps it verbatim precisely
  because it is precise, and precise means it can read *"550 5.7.1 rejected: /Documents/tax
  return 2024.pdf"*. That is a file name, and a file name is content. It stays on the owner's
  screen, where the person reading it is the person who is allowed to see it.
  **`lastErrorCategory` crosses in its place**: it is a closed enum, it is what a person can
  act on (0110 T3's whole point), and it names no object.
- **`lastPass`** — `PassMetrics` is where a pass spent its time. Not content, and not a
  secret, but it is an operator's diagnostic and it means nothing to the reader this page is
  for. Left out because everything on this page has to earn its line.

### The guard, and why it is a fixture rather than a test

An allow-list checked by a test is a list somebody adds to. The property actually wanted is
*"a field added to the shared status contract cannot reach a stranger by accident"*, and that
is a **typecheck** property:

```ts
const EVERY_FIELD: Required<DomainStatusReport> = { … };
```

`Required<>` makes the fixture total. Add a field to `DomainStatusReport` and this file stops
compiling, in all four `tsc` passes, until somebody writes a value for it — which is the
moment they have to decide whether it may be shown. The unit test then asserts the *output*
keys against the allowed set, so a `{ ...report }` spread fails loudly rather than leaking
eleven fields at once.

Proved by breaking: spreading the report, passing `lastError` through, and adding a field to
the contract, are three separate reds.

### Absence is not zero

A mapping whose grant landed an hour ago has **no `migration_status` rows at all**. Rendering
that as five domains reading `0 items` says *finished, and it moved nothing*, which is the
worst available lie on a page whose reader is waiting. The payload therefore carries
`started: boolean` alongside `domains`, derived from whether any row exists — the same
distinction 0117 §7c makes about omitted rows and 0121 §4b makes about pruned months, for the
same reason: **absence and zero are different facts and only one of them is reassuring.**

## 4. T2 — The owner mints one

`POST /api/migrations/:mappingId/links` gains `purpose`, defaulting to `'grant'` so every
existing caller keeps its meaning.

**The expiries are the link's own.** `MAPPING_VIEW_LINK_EXPIRY_DAYS = [30, 90, 180]`, default
90, beside the credential's `[1, 7, 30]` in `mapping-link-store.ts`. A first copy plus a
settling period plus a cutover is measured in weeks; asking the owner to re-issue in the
middle of it would make the link useless for the case the owner described, where the person
holding it is the one least able to ask for a new one. 180 is the ceiling because a bearer
credential nobody is thinking about any more is a bearer credential nobody revokes.

**The refusal set shrinks to one, and that is the interesting part.** `grantLinkRefusal`
refuses four ways, and three of them exist because a grant link must be able to run a **Google
consent**: no source connection, a source that is not Google, a client that is not configured.
A view link runs no consent. It renders counts, and a Microsoft mapping, an Apple mapping, an
IMAP mapping and an archive import all have counts. So `viewLinkRefusal` keeps exactly one
check — `web_url_unset`, because a link is nothing but a URL and 0095 T3's lesson is that a
link built without a base address goes out looking exactly like a working one.

This is the first surface in the product that can hand a link to somebody being migrated off a
**non-Google** source, and it is worth saying plainly: the *credential* still comes to the
owner by hand for those (0114 and 0115 are where that changes), but the *insight* does not
have to.

## 5. T3 — `GET /api/view/:link`

Its own file, `apps/api/src/routes/view.ts`, beside `grant.ts` and for the same reason
`grant.ts` is not inside `migrations/`: it authenticates a caller with **no identity at all**.

What it answers:

| Field | Why it is there |
|---|---|
| `organisation` | Watching an anonymous organisation move your mail is not insight. Same field, same reason, as the grant page. |
| `state` | The migration's own lifecycle word, narrowed through `MAPPING_LIFECYCLES` — the vocabulary that **throws** on an unknown value rather than coercing it. |
| `started` | See §3. False means no pass has ever touched this mapping. |
| `domains[]` | `viewRowFor` over `buildDomainStatusReports(...)` — the same builder both editions already serve, so this page cannot drift from the owner's. |
| `expiresAt` | When the page stops working. A person who bookmarked it is owed the date. |

What it does not answer: the mapping id, the tenant id, the mapping's name, the owner's email,
any address, any folder, any file, any subject line, any other migration, and `lastError`.

`GET`, changing nothing — the same property the grant route needed for chat previews, and here
it is not a nicety: this page is *meant* to be opened repeatedly.

## 6. T4 — The page

`/view/:link`, outside `Layout` and outside `ProtectedRoute`, next to `/grant/:link` and for
the identical reason: the reader has no account and will never have one. It carries
`BuildStamp` for the same support conversation.

It is written for the person the owner described — somebody's parent, who was sent a link and
wants to know whether their mail has arrived. So:

- **The headline is the state**, in a whole sentence, not a chip. "Your migration is running."
- **One row per domain**, named in the words the rest of the app already uses
  (`DOMAIN_STRING_KEY`), with the count and when it last moved.
- **A paused domain says why**, through `PAUSE_KEY` — the sentences already written for the
  customer's own progress strip, so the person who phones the owner about it and the owner are
  reading the same words.
- **Nothing has run yet** is its own state with its own sentence, never five zeroes.
- **Failures are counted, not described.** "3 items need attention" and the category; never
  the provider's prose (§3).

### The finding this task turned up: the remedies are addressed to somebody else

`failure-key.ts` exists so *"the customer and the person they phoned read the same
sentence"* (0110 T4), and that argument is right for the two readers it was written for. It
does not extend to a third. Read out on 2026-09-10, those six sentences say things like
*"Reconnect it on the Connections page"* and *"The provider's own message is below"* — and the
person holding a progress link has **no Connections page, no account to reach one with, and no
message below**, because the prose is exactly what §3 refuses to send them.

Handing somebody a remedy they cannot perform is worse than telling them less: it reads as an
instruction, and the only thing it can produce is a phone call that opens with the wrong
question. So `view-failure-key.ts` says the same FACT and names the person who can act. Same
categories, exhaustive by type, different addressee — which is also why it is a second map
rather than an edit to the first: changing those sentences would break them for the two
readers they are correct for.

The side crosses for the same reason and gets the same treatment: `failure.side.*` says *"the
source side"*, which is the product's word for somebody who has been reading the product's
screens. Both accounts belong to **this** reader, so it is *"your old account"* and *"your new
account"* — and that is the most useful thing on the line.

## 7. T5 — The owner's panel tells the two apart

`GrantLinksPanel` renders `listMappingLinks`, which **does not filter by purpose** and never
did. So the moment a view link exists it appears in the grant-link list, wearing the grant
list's words ("Access was granted on…", "this link is spent") about a link that grants nothing
and is never spent. That is not a new defect this plan introduces; it is an old one this plan
would trip over.

The panel becomes `MappingLinksPanel`, with two sections over one query and one revoke — the
same mechanism, its two lifetimes, side by side, which is exactly how ADR-0035 describes it.
Revoking is unchanged, because revoking a door is one action whichever room it opens.

## 8. T6 — The gate opens one, with no session at all

`scripts/gate-coverage.unit.test.ts` derives the route families from `index.ts` and requires
each one to be **either asked for by the managed smoke or carry a written reason**. Mounting
`/api/view` turned it red, which is the guard doing its job — *"'not covered' with no sentence
beside it is how a gap becomes permanent"*.

The reason `/api/grant` carries does not transfer: it is excused because reaching it needs a
real Google client written from a script (hard rule 3) and because the flow ends at Google's
own consent screen, which no gate can press. A progress link has **neither obstacle**, and the
reason is the same one §4 gives — it runs no consent, so it can be issued against the APPLY
half's ordinary DAV source. Writing an excuse would have meant writing *"we did not get to
it"*, so the gate asks instead.

What it asks, and none of it is observable without a live stack:

1. The owner issues one for a **non-Google** mapping, and gets a `/view/` address.
2. It is opened with **no `Authorization` header at all** — which is why this cannot go
   through the smoke's `http()` helper, since that refuses to send anything that is not a JWT.
3. The answer carries `organisation`, `state`, `started`, `domains`, `expiresAt` — and **not**
   `lastError`, the mapping id, or the tenant id, asserted against the payload of a migration
   that has really run, which is the only place they could leak.
4. A **credential** token presented at the progress address is refused on its purpose.
5. Revoking it stops the page answering **at the next open**, which is the property that makes
   a ninety-day window acceptable at all.

## 9. The slices after this one

**Slice 2 — minted at grant (T7).** `storeGrantedToken` runs one transaction that spends the
grant link and stores the credential. A view link minted in that same transaction is the
honest place for it: the person is in their browser, on the success page, having just done
their part, and the sentence to write is *"keep this one — it is where you can watch your
migration."* Two open questions for the build, both real:
  - The success page is server-rendered (`grantResultPage`), which was deliberate — 0108 T4:
    it "cannot render a token because its signature has nowhere to put one". A view token is
    not a credential for reading data, but it *is* a bearer secret, and widening that
    signature is a decision to take with the reason in view rather than in passing.
  - Which expiry a machine-minted link gets, when the owner did not choose one.

**Slice 3 — their own start and pause (T8).** ADR-0035 asks for it and the owner has deferred
it once, deliberately. When it comes, it is not a new API: `operating-routes.ts` already has
the actions, and the question is entirely about **authority** — whether a link holder may pause
a migration the organisation is paying for, and what the owner sees when they do.

## Not in this plan

- **Any email from Ownpace carrying a link.** ADR-0035: the admin distributes it, we never do.
  Slice 2's minting hands it to the person already on the page; nothing is sent.
- **A view link for a mapping the holder does not already know about.** The link is
  mapping-scoped, like the grant link, and there is no listing route and never will be.
- **Content, in any slice.** Not a folder tree, not a file name, not a subject line, not an
  address. If a future slice needs one of those it needs an ADR first, because it is a
  different product decision from the one ADR-0035 made.
- **Item-level detail from the confirmed list (0117 T2).** That list is handed to somebody
  who is about to **delete**, and it is the owner's surface. Whether a migrated person should
  ever see it is a separate question with a different risk.
