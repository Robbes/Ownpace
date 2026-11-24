# Workplan 0172 — A place in the alpha, given as a present

> **In one line:** Gift invitations for alpha.21: a person in the alpha makes one gift code for a loved one, prints it on a card, and the code turns into an access request marked as a gift, which the owner approves like any other.

## Status — 2026-11-24 (update this block at the end of every session)

**2026-11-24: planned and built, for alpha.21, in one draft pull request.** The owner decided G1
and G3 on 2026-11-24 and said *"build"*. Everything in §3 is built on the branch
`claude/ownpace-public-readiness-y7orc6-a21-gift-invitations`: managed migration 0064, the gift
store, the routes, the giver's screen with its card, the field at the request-access door, the
operator's screen, the site's page in both languages, and the proofs of §5. It merges after
alpha.20 is tagged. Proved on 2026-11-24: the full unit suite (`pnpm test`, 1426 files) passed but
for two cases, both then fixed and run green alone: the release line's, which needs the release
tags in the checkout (`git fetch origin 'refs/tags/*:refs/tags/*'`), and `llms.txt`'s list of the
pages no visitor reaches, which now names the gift page. `pnpm typecheck` and `pnpm lint` clean.
Not done: the E2E runs (T7, the maintainer's) and the owner's answers to §7. The privacy policy
is not edited: the sentence it needs is proposed in §6, for the owner.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T1 The gift table and its store | builder | ✅ Built | Managed migration 0064, `packages/managed/src/gift-store.ts`. §3.1, §3.2. |
| T2 The giver's routes | builder | ✅ Built | `GET /api/gifts/mine`, `POST /api/gifts`, `POST /api/gifts/:id/revoke`. §3.3. |
| T3 Redeeming | builder | ✅ Built | `POST /api/gifts/redeem`, anonymous, rate-limited; the mark on the access queue. §3.4. |
| T4 The operator | builder | ✅ Built | `GET /api/gifts/operator`, revoke, the limit for everyone and for one person, the alpha's count. English only. §3.5. |
| T5 The screens | builder | ✅ Built | *Give Ownpace* with its card (print or save as PDF), the code field at the door, the operator's *Gifts*. §3.6. |
| T6 The site | builder | ✅ Built | `gift.html` and `nl/cadeau.html`, alpha builds only. §3.7. |
| T7 E2E | maintainer | ⏳ **Maintainer** | Which runs: §5, last paragraph. Not dispatched by the builder. |
| T8 The owner's answers | owner | ⏳ **Owner** | §7, and the privacy sentence of §6. |

## 1. The owner's words (2026-11-24)

- **G1.** Gift invitations now, in the free alpha. Paid gift codes come after the alpha, once
  payments are live; they are not this plan. One gift per person while in alpha. The owner admits
  the alpha's users personally, at most 50 to start: *"We start with Max 50 allowed users by
  myself."* So a redeemed gift lets nobody in by itself: it becomes a request for access, marked
  as a gift from the giver, which the owner approves like any other, and it counts toward those
  places.
- **G3.** A gift is valid for 2 years, unless it is used or revoked first.
- **G2** (later, paid codes only): a paid code buys one of the plans. Not built here.

## 2. What the code already settles

1. **There is no hard cap on how many people the alpha lets in.** Nothing in `apps/api` or
   `packages/managed` counts granted requests or refuses a grant past a number; 0131's *at most 20
   people* is a decision recorded in prose, kept by the owner's own hand. So none is built here
   (as asked), and the operator's screen shows the count instead (§3.5).
2. **Approval already gives the recipient their own organisation.** `POST
   /api/access-requests/:id/grant` creates a tenant and an `origin: 'requested'` owner invitation
   for the request's address, in one transaction. A gift request is an access request, so it is
   granted by that route unchanged and can never become a seat in the giver's organisation. Proved
   in `a-gift-turned-into-a-request.unit.test.ts`.
3. **The site cannot carry a form.** `www.ownpace.eu` is served with `form-action 'none'`
   (`RequestAccess.tsx`'s header), deliberately. So the site's gift page explains the gift and
   links to the app's `/redeem`, the request-access door with the code field open; the code is
   typed there, never on the site. The brief's *"on the site's gift page"* is met by that link.
4. **A grant link's key is not something a person can type from a card.** A grant link is a
   UUID and 43 characters of base64url. A gift code is printed and typed by hand, so it is 16
   characters of Crockford's base 32 in four groups (`K7QM-3XR2-PA9D-W4HN`, 80 bits), read
   case-blind, with `O` taken as `0` and `I` and `L` as `1`. 80 bits behind a rate limit is far
   past guessing.
5. **The patterns reused from grant links** (`docs/grant-links.md`): the code is shown once and
   stored only as a fingerprint (sha256, tagged `gift1:`); one refusal sentence for a code that is
   unknown, used, revoked or expired (`GIFT_REFUSAL`, in English and Dutch); revocation by the
   giver while unused, and by the operator; and *we never send it, you do*: no recipient address,
   no recipient name and no message is asked for or stored when a gift is made.
6. **The redeemer's own address is stored, in the access request, as for any request.** The
   request needs an address to be granted to (the owner invitation is keyed on it). It is typed by
   the recipient at the door, about themselves, and lives in `access_request` with the same
   retention as every request. The gift row names the request, never the address.
7. **The door is anonymous and `access_request` has no SELECT policy for it**, so the redemption
   runs in a gift-scoped transaction (`withGiftCode`, `app.current_gift` = the code's fingerprint),
   in which the gift row sees only itself and the request is inserted under the existing
   `anyone_may_ask` policy. Both writes or neither.
8. **Operator screens are English only** (ADR-0013 as amended 2026-10-11): the operator's
   *Gifts* screen is in `operator-strings.ts`; the giver's screen, the card and the door are in
   `strings.ts` in both languages.

## 3. The design, as built

### 3.1 Tables (managed migration 0064)

- `gift`: `id`, `tenant_id` (the giver's organisation when they gave), `giver_user_id` (their
  subject), `code_hash`, `locale` (the card's language, for the operator), `created_at`,
  `expires_at` (two years on), `redeemed_at`, `redeemed_request_id` (→ `access_request`, `ON
  DELETE SET NULL`), `revoked_at`, `revoked_by`. CHECKs: redeemed iff it names a request, and
  not both redeemed and revoked. No column for an address, a name or a message.
- `gift_rule`: one row, the number of gifts each person may hold (`gifts_per_person`, seeded 1).
- `gift_allowance`: the operator's number for one person (`user_id`), with who set it and why.
- Row security, FORCE'd, with no `::uuid` cast of a setting that can decay to `''` but the
  NULLIF'd tenant one: the giver sees and revokes their own (`app.current_user`); an operator sees
  and changes all (`platform_operator`); the door sees and spends exactly the row whose fingerprint
  is `app.current_gift`. `gift` joins `PURGED_TABLES`, so closing the giver's organisation erases
  their gifts, and `ownpace_system` is granted what the purge needs.

### 3.2 States and the limit

A gift is `unused`, `redeemed`, `revoked` or `expired` (`giftState`, one definition; a redeemed
gift stays redeemed after its date). A person may hold as many gifts as their allowance, or the
rule for everyone, or 1. **What counts:** unused and redeemed gifts. A revoked or expired-unused
gift does not, so a giver who revoked a card can make another (§7 asks whether that is right). The
count and the insert run in one transaction behind a lock on the giver, so two presses make one.

### 3.3 The giver (T2)

`GET /api/gifts/mine` lists their gifts and their limit; `POST /api/gifts` makes one and answers
the code once, with its address and its date; `POST /api/gifts/:id/revoke` revokes an unused one.
All behind `authenticate`: the giver is a member of an organisation, which during the alpha means
someone the owner let in. `POST /api/gifts` takes only `locale`.

### 3.4 Redeeming (T3)

`POST /api/gifts/redeem` takes `code`, `email`, and optionally the request form's own `name`,
`organisation`, `note` and `tier`, with `locale` and the form's trap field. Behind its own knock
limit, 20 an hour (`GIFT_REDEEM_LIMIT`, a constant, sized as the form's is: service-wide unless
`TRUST_PROXY` is set). Answers:

- **201**, the request form's own `received` answer: a request was made and the gift is spent.
- **410** with `GIFT_REFUSAL`, for every kind of bad code: unknown, malformed, used, revoked,
  expired. Nothing is written.
- **409** `already_asked`, when the address already has an open request: nothing is written and the
  gift is not spent, and it says so, so the code can be used once that request is answered. This
  tells a holder of a valid code that the address has an open request; see §7, question 3.
- **429** past the limit; a filled trap is answered 201 and nothing is kept, as at the door.

The operator is told as for any request (`access_requested`, which now says when it came with a
gift; the anonymous door cannot read whose). The access queue's rows carry `gift: { from }`: the
giver's address, read through `support_tenant_members`, or `null` for a request without one.

### 3.5 The operator (T4), English only

`GET /api/gifts/operator`: every gift with its giver's address and organisation, state, and the
request it became (with that request's state); the rule for everyone; every per-person
allowance; and the alpha's count: requests granted, requests open (and how many of those came
with a gift), and unused gifts that could still become requests. `POST
/api/gifts/operator/:id/revoke`; `PUT /api/gifts/operator/rule` (`giftsPerPerson`, 0 to 20); `PUT
/api/gifts/operator/allowance` (`email`, `gifts` 0 to 20 or `null` to clear), which resolves the
address to the active members with it. None of it needs a deploy.

### 3.6 Screens (T5)

- **Give Ownpace** (`/give`, in the menu for every member of an organisation, managed only). Says what a gift is in
  the alpha, makes the one gift, shows its code once on a card with the giver's name (prefilled,
  editable), the recipient's first name and a message (both optional, in the browser only), the
  address where it is redeemed, a few words on Ownpace and the valid-until date, in English or
  Dutch whatever the app's language. *Print or save as PDF* uses the browser's print, with only
  the card printed. Below: the list of their gifts with each state, and *Revoke* on an unused one.
- **The request-access door**: *I have a gift code* opens a code field, open already at `/redeem`
  (the address the card prints) and with `?gift=1`; with a code the form sends to
  `/api/gifts/redeem`, and a refused code is said in the page's language.
- **Gifts** (`/gifts`, operator only in the menu): the count, the rule, per-person allowances,
  and the list with *Revoke*.

### 3.7 The site (T6)

`gift.html` and `nl/cadeau.html`, rendered in alpha builds only (`ALPHA_ONLY`, beside the tester
guide) and kept out of the nav and `llms.txt`, as the guide is: what a gift is in the alpha, that
the owner still says yes, the two years, what is kept, and a link to the app's `/redeem`.
`docs/ending-the-alpha.md` names both pages among what the site drops when the alpha ends, and
says that *Give Ownpace* does not follow `OWNPACE_STAGE`: setting *Gifts per person* to 0 stops
new gifts.

## 4. What is stored about a gift, and what is not

Stored: who gave it (subject and organisation), the code's fingerprint, the card's language,
when it was made, until when it is valid, when it was redeemed and which access request it became,
when it was revoked and by whom. Not stored: the code, the recipient's name, any message, any
address of the recipient's on the gift. The recipient's own address and words are stored in the
access request they make, as for any request (privacy §4.4).
`a-gift-that-keeps-no-recipient.unit.test.ts` holds this over the migration's columns and over
what each route writes.

## 5. Proofs

- `packages/managed/src/gift-store.unit.test.ts`: the code's shape and reading, the fingerprint,
  the four states, the limit's arithmetic.
- `packages/managed/src/gift-under-rls.unit.test.ts`: on PGlite under `app_user`, the giver sees
  only their own, another member sees none, the door sees only the row it names, the operator sees
  all.
- `apps/api/src/routes/gifts.unit.test.ts`: making one, shown once; the limit, for everyone and
  for one person; revoking; each refusal at the door (unknown, malformed, used, revoked, expired)
  answering the same body; the rate limit; the trap; an address with an open request.
- `apps/api/src/routes/a-gift-turned-into-a-request.unit.test.ts`: a redeemed gift is an access
  request with its mark in the queue, and granting it makes a new organisation, not a seat in the
  giver's.
- `apps/api/src/routes/a-gift-that-keeps-no-recipient.unit.test.ts`: the guard of §4.
- `apps/web/src/pages/a-gift-on-every-screen.unit.test.tsx`: the door's field and where it sends,
  a refused code in Dutch, *Give Ownpace* sending only the card's language and drawing the card,
  no button at the limit, and the operator's count and list; `AccessRequests.unit.test.tsx`: the
  mark.
- `apps/api/src/openapi-spec.unit.test.ts` and `scripts/gate-coverage.unit.test.ts`: the eight
  operations are in `apps/api/docs/openapi.yaml`, and the deployed smoke's reason for not asking
  them is written down.
- `site/site.unit.test.ts`: the gift page in both languages, alpha only, out of the nav.
- The docs checks: `workplan-index.mjs --check`, `lessons.mjs --check`.

**E2E (T7, the maintainer's).** The managed E2E smoke on the OTA stack once this merges, for the
access-request path and the new migration; no lane is added.

## 6. The privacy policy, for the owner

Privacy §4.4 covers a request and §4.6 an invitation; neither names a gift. Proposed, not
applied, as a new paragraph at the end of §4.4:

- **EN.** *Gifts.* If someone in the Alpha gives you a place as a gift, we keep who gave it, a
  fingerprint of the code (never the code itself), the language of the card, when it was made,
  until when it is valid, and when it was used and for which request, or when it was revoked. We
  keep no name, address or message of the person it is for. When you use a code, your request is
  kept as any request is, marked as a gift from the giver. A gift is deleted with the giver's
  organisation.
- **NL.** *Cadeaus.* Als iemand in de Alpha u een plaats cadeau geeft, bewaren we wie het gaf, een
  vingerafdruk van de code (nooit de code zelf), de taal van de kaart, wanneer het werd gemaakt,
  tot wanneer het geldig is, en wanneer het werd gebruikt en voor welke aanvraag, of wanneer het
  werd ingetrokken. We bewaren geen naam, adres of boodschap van degene voor wie het is. Gebruikt u
  een code, dan bewaren we uw aanvraag zoals elke aanvraag, gemarkeerd als cadeau van de gever. Een
  cadeau wordt verwijderd met de organisatie van de gever.

## 7. Open questions for the owner

1. **Does a revoked gift give the place back?** Built: yes, a revoked or expired-unused gift no
   longer counts, so the giver may make another. Advice: keep it; the owner approves every request
   anyway, and a lost card is otherwise a lost gift.
2. **Does a declined gift request give the place back?** Built: no, a redeemed gift counts
   whatever became of its request. Advice: keep it, and raise one person's allowance by hand when a
   decline was about timing rather than the person.
3. **An address that already has an open request.** Built: the door says so and leaves the gift
   unspent, which tells a holder of a valid code that the address has asked. Advice: keep it; the
   other choice spends the gift silently or hides that it did nothing.
4. **The 50.** Built: a count on the operator's screen, no cap. Advice: keep counting by hand for
   now; a cap that refuses a grant is one route and one number when wanted.
5. **The address the card prints.** Built: the app's `/redeem` (`app.ownpace.eu/redeem` on
   live), short enough to type, and it opens the door with the field ready. The site's gift page
   links there, and nothing links the gift page yet: not the site's nav (as for the guide), and
   not the card. Advice: keep the card as it is, and link the gift page from *Give Ownpace* in a
   follow-up, beside the tester guide's link.
6. **The card's Dutch says *u*.** Every Dutch screen does. A card from a loved one might rather
   say *je*. Advice: the owner's call; it is one area of strings (`strings/gifts.ts`, `card.*`).
