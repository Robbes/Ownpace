# Workplan 0043 — prove the notification channel actually sends

## Status — 2026-08-15 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 an end-to-end proof that mail leaves the building | ⬜ Not started | — |
| T2 the managed cron task, tested like its self-host twin | ⬜ Not started | — |
| T3 make "notifications are OFF" visible to somebody who is not reading logs | 🟡 **Payload done 2026-08-15; the screen is not** | `StatusReport.notifications` carries enabled + the reason VERBATIM; `/status` supplies it (`index.ts`). 4 tests; mutation-verified — reporting a channel the caller did not supply, and summarising away the reason, each fail exactly one test. **No UI**: no page fetches `/status` today (Dashboard reads mappings), so a screen needs a new data path, not a line. |
| T4 the all-mappings-done hole 0030 recorded and left open | ✅ **Done 2026-08-15 — both editions** | `renderDigest` takes `TenantAttention`; `organisation` is a new `DigestLines` key so EN/NL parity is a compile error, not a promise. Managed sends instead of warning; the appliance gets `collectTenantAttention`, a sibling of `collectAttention` rather than a reshape of it (which would have churned 14 tests to prove nothing). 10 tests. Mutation: restoring the old emptiness rule fails **5 tests across BOTH editions**. One existing test replaced deliberately — it pinned the log-only behaviour. |

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

**Corrected 2026-08-15.** The first draft said the materials "already exist… without inventing any
infrastructure". A read-only audit of this plan found three obstacles that make that false, and a
task written from the original wording would have sent somebody down a dead end:

1. **Stalwart binds SMTPS 465 only**, with a self-signed certificate, and `SmtpSettings` has **no
   field that can carry `rejectUnauthorized: false`**. The IMAP client in the harness gets that
   treatment; the mail transport has nowhere to put it. This needs a **production code change**,
   and it is a security-adjacent one — a TLS-trust escape hatch that exists for tests is a
   TLS-trust escape hatch that exists.
2. **Neither harness publishes an SMTP port.** The testcontainers setup and the self-host e2e both
   expose IMAP/JMAP; SMTP is not mapped out. That is a harness change.
3. **`createTransport` is never even constructed today.** `smtpTransport()` returns a closure and
   nodemailer is only reached inside a real send — so "no test references it" understates it: the
   library is not loaded by the suite at all, including by the appliance-boot test that configures
   SMTP.

So T1 is a production change plus a harness change plus a test, not a test. That is still worth
doing — it is the only way to learn whether this code has ever run — but it must be planned as
three things. The anti-skip guard below does come free.

Shape:

1. Give `SmtpSettings` a way to express TLS trust, and publish Stalwart's SMTPS port from the
   harness — obstacles (1) and (2) above. Scope the trust escape hatch as narrowly as it can be
   made: it exists so a test can reach a self-signed container, and it must not become a
   convenient way to turn off certificate checking in production.
2. Build a notifier from `readNotifierConfig` pointed at that port.
3. Send one digest with known contents.
4. Read the delivered message back over IMAP/JMAP and assert on it: recipient, subject, and that
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

A single `log.info` at boot — and `disabledNotifier` says its piece exactly **once per process**,
so an appliance up for a month said it once, a month ago. An owner who never reads container logs — which is most owners of an
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
