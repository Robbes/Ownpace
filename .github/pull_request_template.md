## What this changes

<!-- One or two sentences. What is different after this merges, and why. -->

## Evidence

<!-- What did you RUN, and what did it say? This project's convention is that a
     claim without evidence is not a claim: paste the counts, the failing-then-
     passing output, the command. "Tests pass" on its own is not evidence. -->

## Definition of done

See [AGENTS.md](../AGENTS.md#definition-of-done). Tick what applies; strike what
genuinely does not, rather than deleting the line.

- [ ] Gates green (`pnpm lint`, `pnpm typecheck`, `pnpm test`; integration/e2e if touched)
- [ ] Docs updated in the same commit as the code
- [ ] Workplan Status block updated with what was proved
- [ ] ADR added or amended, if a decision changed
- [ ] No secrets, and no credentials in fixtures or examples
- [ ] **Idempotency intact** — a re-run converges, it does not duplicate
- [ ] **Non-destructive intact** — nothing deletes outside the gated `apply` path (ADR-0024)
- [ ] **Self-host intact** — no managed-only dependency reaches `packages/` or `apps/selfhost`
- [ ] No docker debris left running

## Anything you are unsure about

<!-- Optional, and genuinely useful. A named uncertainty gets reviewed; a hidden
     one gets merged. -->

---

Commits follow [Conventional Commits](../CONTRIBUTING.md#commits--branches)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
