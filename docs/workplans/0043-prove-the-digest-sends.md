# Workplan 0043 — prove the notification channel actually sends

## Status — 2026-08-15 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 an end-to-end proof that mail leaves the building | ⬜ Not started | — |
| T2 the managed cron task, tested like its self-host twin | ⬜ Not started | — |
| T3 make "notifications are OFF" visible to somebody who is not reading logs | ⬜ Not started | — |
| T4 the all-mappings-done hole 0030 recorded and left open | ⬜ Not started | — |

## What this is

Workplan 0030 built email notifications — the `Notifier` port, EN/NL templates, ad hoc events, and
daily/weekly digests in both editions — and marked T1–T4 done on 2026-08-03/04. That work is real:
`packages/connectors/src/smtp-transport.ts` exists, `nodemailer ^9.0.5` is a declared dependency,
the appliance registers digest jobs at boot (`apps/selfhost/src/index.ts:755`), and managed runs
`managed-digest` as a Trigger.dev cron at `0 8 * * *`.

**What is missing is any evidence that an email is ever actually sent.** This workplan closes
that, plus three smaller gaps found with it.

## The gap, stated precisely

`smtp-transport.ts` is the one file in the workspace that talks to a mail server. It is:

- imported by `notifier-from-env.ts:30`, so it is live in both editions, and
- **referenced by no test file anywhere in the repository.**

Everything around it is well covered — 14 template tests, 13 counting tests, 14 collection-loop
tests, 19 managed-digest-run tests, 22 cadence/schedule tests. Every one of them stops at the
`MailTransport` seam and asserts against a fake. The result is a channel whose *decisions* are
proven in depth and whose *delivery* is proven not at all: if `smtpTransport` never connected,
never authenticated, or threw on every send, the entire unit suite would stay green.

This is the same shape as the two defects found on 2026-08-14 and -15 — a leakage guard that could
lose a whole package and stay green, and an auth middleware test that never imported the
middleware. The pattern is coverage that stops one layer short of the thing that can actually
fail.

## T1 — an end-to-end proof

**The materials already exist.** The integration harness starts a real **Stalwart** mail server
(`vitest.global-setup.ts` exports `STALWART_JMAP_URL`, `STALWART_IMAP_HOST`, …) and the self-host
e2e starts one too. Stalwart speaks SMTP. So a digest can be sent through the real
`smtpTransport` to a real server and read back, without inventing any infrastructure.

Shape:

1. Build a notifier from `readNotifierConfig` pointed at the harness's Stalwart (SMTPS 465 or
   587/STARTTLS — Stalwart binds TLS listeners only; see `docs/stalwart-integration-fix.md`, and
   the self-signed certificate needs the same `rejectUnauthorized: false` treatment the IMAP
   client already uses).
2. Send one digest with known contents.
3. Read the delivered message back over IMAP/JMAP and assert on it: recipient, subject, and that
   the **body carries the counts the digest was built from** — not merely that a send resolved.

The last point is what makes this worth writing. Asserting "send did not throw" would recreate the
problem one layer out.

**Guard it against silently skipping.** The integration tier degrades to green when its
dependencies are absent, which is exactly what `harness-exports-what-tests-guard-on.unit.test.ts`
was written to catch. Any env var this test guards on must be one the global setup exports, or the
proof evaporates the first time somebody sets `SKIP_STALWART`.

## T2 — the managed cron task

`apps/worker/src/jobs/managed-digest-run.ts` holds the decisions and has 19 tests.
`apps/worker/src/jobs/managed-digest.ts` — the `schedules.task` that wires the Pool, the ledger,
the transport and the cron — **has none.**

That is the same wrapper-versus-logic split the whole `apps/worker/src/jobs/` directory has, and
mostly it is defensible: the wrappers are thin, and a mocked test of one asserts the mocks. It is
less defensible here for one reason — **this wrapper emails other people's customers.** A mistake
in which transport it builds, or which tenants it iterates, is not caught by `managed-digest-run`'s
tests and is discovered by a customer.

Decide and record: either test it (naming what the test actually constrains), or state here that
it is deliberately untested wiring and say what covers a mistake in it instead. Do not leave it
implicitly covered — that is what "216 test files" reads as from the outside.

## T3 — make OFF visible

When SMTP is unconfigured the channel is disabled, and it says so:

```
apps/selfhost/src/index.ts:378 → log.info(`[selfhost] ${channel.announcement}`)
```

A single `log.info` at boot. An owner who never reads container logs — which is most owners of an
appliance, and the exact person 0030 describes as *"an SMB owner mid-shadow-sync [who] checks the
UI weekly at best"* — has no way to tell "nothing needs my attention" from "notifications were
never on".

0030 already committed to the principle, in T1's own words: *unconfigured = notifications off,
**said honestly in the UI**, never silently.* The log line is not the UI.

Surface channel state where somebody sees it: the appliance's status/health response and the
screen that renders it, showing enabled/disabled **and the reason verbatim** — the reason string
already exists and already distinguishes *nothing set* (normal) from *half set* (somebody tried
and missed a variable). Both editions.

## T4 — the hole 0030 recorded and left open

0030 T4 records, in its own Status block:

> a tenant whose every mapping is `done` carries its pending decisions nowhere, because the digest
> is a list of mappings […] that case now **warns in the operator log** and the workplan records
> it — a known hole stated out loud beats a quiet one.

Confirm it is still true, then close it. A tenant with a pending decision and no live mapping is
precisely a tenant nobody is watching. Options: a tenant-level section in the digest that does not
belong to a mapping, or a decision-only email. Whichever — the acceptance test is that a tenant
whose every mapping is `done` and which has one pending decision **receives something**.

## What "done" has to show

1. A test that sends a real email through `smtpTransport` and reads it back, asserting on the
   body's contents — failing if the transport is broken, not merely if the digest logic is.
2. The `SKIP_*` guard: the proof in (1) cannot pass by skipping.
3. A stated, deliberate position on `managed-digest.ts` — tested, or documented as untested with
   what covers it.
4. Channel state visible outside the logs, in both editions, with the reason verbatim.
5. A tenant with only `done` mappings and one pending decision receives an email.

## Note on sequencing

T1 first and alone if time is short. The other three are improvements to a feature that works;
T1 is the difference between believing it works and knowing.

T3 is the cheapest and has the best ratio — an owner who can see the channel is off will fix it
themselves, which is worth more than any amount of internal certainty that the code path is
correct.

Independent of workplan 0042.
