# Workplan 0077 — both doors read the examples

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the Connections form asked without showing | ✅ **Fixed 2026-08-19** | Adding a connection from the Connections page asked for an **App key** with no indication of what one looks like — while the same field, two screens away in the wizard, showed `…apps.googleusercontent.com`-style shapes and a `1//…` refresh token. The examples were the wizard's JSX, so only the wizard had them. Since 0075 they live on the descriptor, so this form reads them: placeholders, and the `autoComplete` each field declares rather than a guess made from `secret`. |

## What this is

The follow-on 0075 made free, and the reason that refactor was worth its size.

The pattern is worth stating once: **when the same knowledge is written down in two places,
the second place is always the poorer one** — not because whoever wrote it was careless, but
because the effort of keeping two copies honest is unbounded and nobody has it. The wizard
had the examples because the wizard was written first; the Connections form did not because
copying them would have been a second copy to maintain. Neither choice was wrong at the
time, and the result was still a screen that asked for a value it could have described.

One descriptor, every door. That is now true for what a provider asks for, in what order,
with what example, under what label, marked required by the same rule the gate uses.
