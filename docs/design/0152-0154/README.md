# Drawings for workplans 0152, 0153 and 0154

Drafted on 2026-09-28 by the session that wrote the three plans. The owner asked for them: *"you
draft the workplans and UX/visual image elements we might need or explain in the workplans
how/with what the other session should make those."* Session R builds from them as group R8
(0131 §6).

They are references for layout, order and wording, not specifications to the pixel. Where a
drawing and its plan disagree, the plan wins, and the drawing is corrected in the same pull
request.

## The drawings

| File | What it shows | Tasks | Built as |
|---|---|---|---|
| [`tiles.svg`](tiles.svg) | The provider and destination tiles: our own, neutral, no logos | 0152 T4, T5; 0153 T3, T4, T7 | Site: HTML and CSS from `build.mjs`. App: one `ProviderTile` component (0153 §5). |
| [`icons.svg`](icons.svg) | Six data-type icons: mail, calendar, contacts, files, photos, tasks | 0152 T3–T5; 0153 T3–T5 | Site: one inline sprite. App: components in `apps/web/src/components/icons/`. |
| [`hero-move.svg`](hero-move.svg) | The old account, Ownpace, the new home | 0152 T3 (a) | Inlined by `build.mjs`. |
| [`wf-site-home.svg`](wf-site-home.svg) | The home page, in order | 0152 T1–T5, T6 (c) | `build.mjs`, `copy.mjs`. |
| [`wf-pricing.svg`](wf-pricing.svg) | The pricing page with the yearly / monthly switch | 0152 T6 | `build.mjs`, `prices.mjs`, `pages/*/pricing.md`. |
| [`wf-migrations-page.svg`](wf-migrations-page.svg) | *Migrations*: one card per person | 0153 T3; 0154 T1–T3 | The landing page after sign-in. |
| [`wf-migrations-phone.svg`](wf-migrations-phone.svg) | The same at 390 pixels | 0153 T3 | The same page. |
| [`wf-start-a-migration.svg`](wf-start-a-migration.svg) | *Start a migration*: six screens | 0153 T4, T7; 0154 T3 (a) | The new flow. |
| [`wf-person-page.svg`](wf-person-page.svg) | A person's page | 0153 T5; 0154 T1–T5 | `/people/:id`, from `GET /api/people`. |

## Reading a wireframe

- **Bold dark-orange text is a note to the builder, and never reaches a screen.** It names the
  task a detail comes from, such as *0145 T7 (a)*.
- **A plan number appears only in dark orange.** Every other text inside a screen's frame is what
  a person reads there. A plan number in a string the product shows is a bug.
- **On the two specification sheets** (`tiles.svg`, `icons.svg`), every explanation is a note in
  the same orange. What is not orange is the tile, the icon and its name.
- **«…» marks a placeholder** that the build fills in, the way the site already marks unfilled
  passages. An example is the company's details in the footer.
- **Names, counts and addresses are invented.** Addresses use reserved domains (`example.org`,
  `example.com`), as the app's own tests do.
- **The words are proposals.** 0152 T0 and 0153 T0 and T6 decide them with the owner. The stage
  words (*Copying*, *Kept in step*, *Ready to switch*…) are 0154 T1's table. Dutch follows 0153
  D6: *migratie*, never *verhuizing*.
- **Each wireframe is drawn in English.** The Dutch screen has the same layout, with room for
  longer words.

## Tokens

- **The site** keeps its own palette: `TEAL #0E4F4A` and `MINT #7FD4C1` from `build.mjs`, which
  `scripts/make-logo.py` also draws the mark in. `--ink`, `--muted`, `--line`, `--bg` and
  `--panel` are `build.mjs`'s custom properties, with its dark values.
- **The app** keeps its Tailwind tokens. Primary buttons are `blue-600` (`#2563EB`). State chips
  keep StateChip's tones. The one new pair in the app is the site's teal and mint, for the tiles.
  0152 T9 already brings it to the sign-in pages.
- **Type** is the system UI stack both products already use. Sizes in the wireframes are
  approximate.
- **The notes' colour** (`#9A3412`) belongs to the drawings only.

## `tiles.svg`

- **Two kinds.** A tile for an account a person leaves is teal with a white letter. A tile for
  where the data goes is mint with a teal letter.
- **The letters:**

  | Leaving | Letter | Going to | Letter |
  |---|---|---|---|
  | Google | G | Soverin | S |
  | Microsoft 365 | M | Nextcloud | N |
  | Apple iCloud | A | A JMAP server | J |
  | Dropbox | D | Any other provider | + |
  | Box | B | | |
  | Another mail provider | @ | | |
  | An export archive | E | | |

- **The letter comes from a table keyed by provider,** never from the connection kind. `gmail`,
  `google_drive` and `google` all draw *G* (0153 §5).
- **Sizes:** 48 pixels on the site and in the flow's choices, 28 in rows, 20 to 22 inside text.
  The corner radius is 22% of the size. The letter is 45% of the size, bold and centred.
- **The tile is `aria-hidden`.** The name is always written beside it, so a screen reader reads
  the name once, never the letter.
- **No third-party logos** (0152 D4).
- **In the app,** `ProviderTile` (`apps/web/src/components/ProviderTile.tsx`) draws the tile and
  its name. Its test holds the two colours equal to `site/build.mjs` and to this drawing.

## `icons.svg`

- **The drawing rules:** a 24 by 24 box, a 2-pixel stroke, round caps and joins, no fill, and
  `currentColor`. That is lucide's style, so the icons sit beside the app's `lucide-react`
  icons.
- **The path data** is in each `<symbol id="i-…">`. The site and the app copy the same paths, so
  both draw the same six. One guard can hold them equal.
- **An icon never stands alone.** The data type's name is always written beside it, and the icon
  is `aria-hidden`.
- **On the site,** `build.mjs` writes one inline sprite and uses `<use href="#i-mail">`. Nothing is
  fetched, so the CSP needs nothing new.
- **In the app,** `DataTypeIcon` and `DataTypeLabel`
  (`apps/web/src/components/icons/data-type-icons.tsx`) draw them from the same elements.
  `an-icon-drawn-twice` reads this drawing and fails when the two differ, so a redraw changes
  both in one pull request.

## `hero-move.svg`

- **`build.mjs` inlines it,** never as an `<img>`. So there is no image request and nothing new
  in the CSP.
- **Its classes carry an `hm-` prefix.** A `<style>` inside inline SVG applies to the whole page,
  so a plain `.card` would restyle the site's own cards. The marker id `hm-ah` must also be
  unique on the page.
- **Dark mode is in the file.** Its colours read the site's custom properties, with fallbacks.
  A `prefers-color-scheme: dark` block swaps the teal strokes for mint, because teal on
  `build.mjs`'s dark background cannot be seen. No second file is needed.
- **Every arrow points from the old account to the new home.** Ownpace never copies back
  (*"It does not sync backwards"*, `copy.mjs`). A redraw that adds a loop keeps that direction.
- **Its words come from `copy.mjs`** in both languages: the `<title>`, the `aria-label`, the two
  card headings, *copies*, *then keeps in step, until you switch*, and six data types. Those are
  the app's five, tasks among them since 2026-10-05, and the Takeout's photos. The key-parity
  case in `site/site.unit.test.ts` covers them.
- **On a phone** it sits below the buttons and scales to the column. The `viewBox` is kept, with
  width 100% and height auto.

## The wireframes

- **`wf-site-home.svg`** sets the order:
  1. the alpha line;
  2. the hero with its drawing, and the six *Leaving…* names under its buttons;
  3. three facts;
  4. the three steps;
  5. *Where to*;
  6. the sections that stay;
  7. one price line with its buttons.

  The dashed box means *What makes this different* and *What it will not do* keep their place
  and words.
- **`wf-pricing.svg`** draws a paid card on yearly:
  - the price per month, large;
  - the year's total, in bold on its own line;
  - *paid yearly, in advance*;
  - the comparison, *half the monthly price*.

  On monthly the same card shows the monthly price. The guardrails are 0152 T6 (e)'s, and the
  lawyer confirms the words.
- **`wf-migrations-page.svg` and `wf-migrations-phone.svg`** draw one card per person:
  - Each row is one of that person's migrations, named by its data type.
  - The line under the title replaces the Dashboard (0153 D7).
  - The menu is *Migrations · Needs you · Accounts · Help · Team · Billing*.
- **`wf-start-a-migration.svg`** draws six screens, and each gate checks only what its screen
  shows (0067):
  1. who it is for;
  2. which accounts are left, with nothing preselected;
  3. what moves, chosen before any consent;
  4. connecting, with one sign-in per provider for exactly what was ticked. On a deployment
     that declares Google's restricted scopes, Google's one sign-in covers mail and files
     too (0153 T4);
  5. where each data type goes;
  6. one screen that checks, then starts.
- **`wf-person-page.svg`** draws:
  - the stage in one line;
  - one row per data type, with totals and a time range;
  - the steps before switching, as one list with counts and state;
  - the person's links.

## Changing a drawing

The files are plain SVG, one element per line, so a change shows in a diff. Edit them in any text
editor and check them in a browser. A change to a drawing goes in the same pull request as the
plan text it follows.
