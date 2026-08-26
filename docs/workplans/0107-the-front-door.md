# Workplan 0107 — the front door

## Status — 2026-08-26 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-26** | This document. The owner's question (*"reason on how people can best be supported in adding connections… among what to consider: icons, groups, pickers, search, sources and targets separate or as one (it's just a connection), other creative way?"*) and the owner's scoping decision on the answer: **do the regrouping/renaming and the icons now**; the address-first door, the merged source/target directory, and the `connection.role` question are *"not yet. perhaps someday later"* — recorded below so they stay decisions, not drift. |
| T1 Regroup and rename | ✅ **Done 2026-08-26** | Two honest groups in every chooser — **"Your provider"** and **"Any server, by protocol"** — with provider sub-groups collecting the cards that are one account to the person (Microsoft 365: `oauth2`+`graph`; Google: `gmail`+`google-calendar`+`google-contacts`+`google-drive`), and renames into the user's vocabulary ("OAuth2" stops being a card name). Presentation ONLY: every id, schema, stored kind and card stays; the grouping lives in shared beside `PROVIDER_DISPLAY_NAMES` so the wizard and the connections add-form read ONE authority; a drift lock pins every connectable id into exactly one group, proved by breaking — a new kind (`proton`, when it wakes) must be PLACED, never orphaned. |
| T2 Icons | ✅ **Done 2026-08-26** | An icon slot on every chooser card and `<option>`-adjacent row, fed by ONE registry keyed by the same type ids, in the same shared module as the grouping. Ships with the zero-trademark floor — a brand-colored tile carrying the provider's initial — so recognition lands without a legal question; real brand SVGs are per-provider content swaps behind the owner's nod. Protocol cards get one generic glyph each from the icon set the web already uses. Wanted now because more provider-named kinds are coming (`soverin` landed with 0106 T4; `nextcloud` precedes it; `proton` sits dormant in the baseline CHECK). |

## The problem, in the door's own words

The wizard's source step offers nine flat cards that mix four different
vocabularies at one level: products (**Gmail**, **Dropbox**, **Box**), an API
(**Microsoft Graph**), a protocol (**IMAP**) — and an auth mechanism
(**"OAuth2"**, which actually means "Microsoft 365 over IMAP+XOAUTH2 with your
own Entra app"; nobody leaving Outlook thinks that word, and nobody can search
for it by intent either). Google is four separate cards for what is, to the
person, ONE account — and 0106 T1b will literally make it one grant-qualified
connection. The target step mixes five protocols with the first provider-named
account kind (`soverin`, 0106 T4). The connections page's add-form renders the
raw ids in a bare `<select>`.

None of these cards is wrong; the LEVELS are. People arrive thinking in
providers ("I'm leaving Google, moving to Soverin"); protocols are the honest
fallback for the long tail ("my server speaks IMAP") and the self-hoster's
first language. A door that presents both without saying which is which makes
the person do the taxonomy in their head — and it gets worse with every
provider kind added, which is exactly the direction 0106 chose.

Icons and search do not fix a taxonomy problem; they decorate one. So the
order is: fix the levels (T1), then make the provider group scannable (T2),
and let search wait until the list is long enough to need it.

## T1 — regroup and rename, one authority for both doors

- **Two top-level groups**, same words in both wizard choosers and the
  connections add-form: **"Your provider"** (Microsoft 365, Google, Dropbox,
  Box, Soverin, Nextcloud where offered) and **"Any server, by protocol"**
  (IMAP, JMAP, CalDAV, CardDAV, WebDAV). The protocol lane stays first-class —
  it is the appliance's whole vocabulary (hard rule 5) and the self-hoster's
  door — but it stops being peer noise between brand cards.
- **Provider sub-groups keep every card.** Microsoft 365 collects `oauth2`
  and `graph` under one heading with method names a person can read: "Via
  IMAP (XOAUTH2)" and "Via the Graph API". Google collects its four product
  cards under one heading. No card is removed, no selection flow changes, no
  id changes — the person who knew exactly which card they wanted still
  clicks it; the person who didn't now reads the door in their own words.
- **The grouping is data in `packages/shared`**, beside
  `PROVIDER_DISPLAY_NAMES` and the descriptors — because the wizard and the
  connections add-form are TWO doors, and one hand-written grouping per door
  is one drift away from the doors disagreeing (the same argument that put
  `TARGET_TYPE_DOMAINS` in shared). The add-form's bare `<select>` becomes
  `<optgroup>`s with display names instead of raw ids — the same authority,
  rendered plainly.
- **The drift lock, proved by breaking:** a test pins that every id
  `connectableTypes()` offers appears in EXACTLY one group — so adding a kind
  without placing it turns the suite red, the way the feature-matrix lock
  makes a new kind name itself in the docs. Waking `proton` will hit this
  lock on purpose.
- **Renames are presentation only.** `sourceType`/`targetType` ids, the
  create API's vocabulary, stored `connection.kind` values and the appliance's
  mapping-file words are contracts and do not move.

## T2 — icons, with the trademark question answered up front

- **One registry, same ids, same shared module** as T1's grouping: each type
  maps to an icon spec. The chooser cards and the add-form rows render it;
  the connections LIST can reuse the same registry beside its qualification
  badges later without a second table appearing.
- **The floor that always ships:** a small tile in the provider's brand color
  carrying its initial. Recognition without a single trademark question, and
  it degrades to nothing worse than today. **The upgrade, per provider,
  behind the owner's nod:** the real brand mark as an inline SVG — each one a
  content swap in the registry, reviewed for that brand's usage terms, never
  a code change.
- **Protocols get one generic glyph each** from the icon set the web app
  already uses (lucide — mail, calendar, contacts, folder, server shapes).
  Generic on purpose: a protocol is not a brand, and drawing it like one
  would re-mix the levels T1 just separated.

## What already exists, so this plan stays small

- `PROVIDER_DISPLAY_NAMES`, `connectableTypes()` and the credential
  descriptors (`credentialFieldsFor`) in `packages/shared` — the id
  vocabulary T1's grouping and T2's registry key on, already shared by both
  doors.
- The qualification badges on connection rows (0106 T2) — the account
  already introduces itself once added; this plan only fixes how it is
  ADDED.
- The provider-named kind precedent (`nextcloud`; `soverin` via 0106 T4;
  `proton` dormant in the baseline CHECK) — the reason the provider group
  will grow and the icons are worth having now.
- The feature-matrix drift lock — the pattern T1's placement lock copies.

## What this deliberately does not do

- **No directory data.** Grouping and icons carry NO endpoints, hosts or
  prefills — that is 0106 T5, parked, and every value in such a directory
  must be measured against the live provider before it is trusted (the
  never-guess rule). Nothing may ride an endpoint in through a group entry.
- **No search or picker yet.** At today's card counts a grouped grid beats a
  searchable combobox because the grid *shows what exists* — half of what a
  first-time user needs. Search earns its place when the provider group
  outgrows a screen, and then as the front of the future directory, not a
  bolt-on here.
- **No address-first door yet** (type your email address, we propose
  candidates from MX/SRV/`.well-known` and MEASURE them — the qualification
  flow entered from the other end). Owner: *"not yet. perhaps someday
  later."* Recorded because it is where this door most naturally goes next.
- **No merged source/target directory yet.** "It's just a connection" is
  true at the model level since 0106, and the right practical shape is one
  directory with role-filtered views — but that is a bigger reshape than
  this plan, and the owner parked it with the same words.
- **No `connection.role` model change.** Removing or dualizing the role
  column deserves its own workplan and an owner decision; nothing here
  depends on it.
- **No id, schema or kind renames, and no edition divergence.** Both
  editions keep refusing the same mistakes in the same words; the appliance's
  mapping files never see any of this.

## Sources

- The owner's question and scoping decision, 2026-08-26 (this plan's brief):
  groups and renames first, icons second because more specific providers are
  coming; pickers/search, the address-first door, the merged directory and
  the role question explicitly *"not yet. perhaps someday later."*
- The assessment answered in-session the same day (taxonomy diagnosis; the
  grouped-grid-before-search argument; the trademark-safe icon floor).
- `apps/web/src/pages/CreateMapping.tsx` (both wizard choosers),
  `apps/web/src/pages/Connections.tsx` (the add-form `<select>`),
  `packages/shared/src/credential-fields.ts` (`PROVIDER_DISPLAY_NAMES`,
  `connectableTypes`, the descriptors).
- Workplan 0106 — the account-shaped connection (the qualification record,
  the provider-named kinds, T5's parked directory and its never-guess
  condition).
- The feature-matrix drift lock
  (`packages/shared/src/feature-matrix.unit.test.ts`) — the placement lock's
  pattern.
