<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->

# `site/legal/` — the published legal surface

Source of truth for the documents the managed service publishes. Markdown here, rendered by
the front door ([workplan 0086](../../docs/workplans/0086-a-front-door-for-the-managed-service.md)
T1) once it exists. They live outside every workspace package for the same reason
`site/pricing/` does — nothing in `apps/` or `packages/` may import them, and nothing here may
import anything.

| File | Published at | Required by |
|---|---|---|
| [`privacy.md`](./privacy.md) | `https://ownpace.eu/privacy` | GDPR; Google OAuth verification; Mollie onboarding |
| [`terms.md`](./terms.md) | `https://ownpace.eu/terms` | Taking money; Google OAuth verification |

**Support address: `support@ownpace.eu`.** It appears in both documents and must appear on the
front door and in the Google consent-screen configuration. Google's verification requires a
support contact, and a policy naming an address nobody answers is worse than no policy.

**Brand assets** live in [`../brand/`](../brand/) — `logo-120.png` is the one Google's
verification requires (≥120×120, PNG or JPG). Regenerate with `python3 scripts/make-logo.py`;
never hand-edit the PNGs, because the sizes are generated from shared constants precisely so
they cannot become different drawings.

---

## These are DRAFTS. Do not publish them yet.

Both documents carry `«PLACEHOLDER»` tokens for facts only the owner can supply. **Every
placeholder used in a document must be listed in the table below** — `scripts/legal-docs.unit.test.ts`
fails if one is not, which is what stops a new placeholder being added and quietly forgotten
until a customer reads it.

| Placeholder | What it needs | Notes |
|---|---|---|
| `«LEGAL_ENTITY»` | The trading entity's registered name | **Filled 2026-08-30: Archico B.V.** — the owner's existing BV (spelling verified against public KvK-registry mirrors; a "Ownpace" handelsnaam registration is a lawyer/owner question, flagged in the terms briefing) |
| `«REGISTERED_ADDRESS»` | Registered address | Also goes on invoices. The registry address is public data, but the owner decides the form it takes in print (registry address or postbus) — so it stays a token until supplied |
| `«COMPANY_NUMBER»` | KvK number | **Filled 2026-08-30: 73922706** (Archico B.V.) |
| `«VAT_NUMBER»` | VAT registration | Archico B.V.'s btw-id — owner/accountant; also qualifies VIES checks (0111 T2). `pricing.ts` already knows `VAT_RATE = 0.21` |
| `«COURT_DISTRICT»` | Competent court for disputes | **Filled 2026-08-30: Overijssel** — derived from the seat (Wijhe); the lawyer confirms the forum wording (terms briefing q. 9) |
| `«HOSTING_PROVIDER»`, `«HOSTING_REGION»` | Who runs the servers, and where | Must be EU — the claim in privacy §8 is the product's whole premise. **Owner, 2026-08-20: self-hosted today, landing on OVH (EU).** Do not write "OVH" into the policy until it is actually true there — a privacy policy naming a host the service is not on is the kind of inaccuracy that is worse than a placeholder, because a placeholder is visibly unfinished and a wrong name is not. |
| `«EMAIL_PROVIDER»`, `«EMAIL_REGION»` | Who sends summary and account mail | Must be EU |
| `«LOG_RETENTION»` | How long operational logs are kept | Pick a number and honour it |
| `«DPA_URL»` | The data-processing agreement | **No longer used** since 2026-08-30 — privacy §3 and terms §4 both say "available on request" until the DPA is published; draft exists: [`dpa.md`](./dpa.md) (0086 T5 — **not optional** once a business customer's mail is involved); row kept so the token's history stays findable |
| `«SUBPROCESSORS_URL»` | The sub-processor list | Referenced by the DPA. Draft exists: [`subprocessors.md`](./subprocessors.md) — the token fills with its published URL (0086 T5) |
| `«PRICING_URL»` | The published price list | **No longer used** since 2026-08-30 — terms links [the pricing page](../../site/pages/en/pricing.md) directly; row kept so the token's history stays findable |
| `«PRIVACY_HISTORY_URL»` | Previous versions of the privacy policy | Privacy §13 promises they stay available |

**The Dutch translations want a lawyer too, not just a reader.** `privacy.nl.md` and
`terms.nl.md` are faithful to the English and structurally identical, and terms §13 names the
English as governing. Whether Dutch consumer law permits a translation to be purely "for
convenience" is a question that cannot be answered from inside this repository, and it is the
one thing about the bilingual publication that is not merely editorial.

**Have a lawyer read both before publishing.** They are written to be accurate about what the
software does — which is the half that is hard to get right from outside and easy to get wrong
from inside — not to be a substitute for advice about Dutch and EU law.

## What must stay true in them

These are not stylistic preferences; each one is a claim the code currently supports, and a
change to the code that falsifies one is a change that has to update the document in the same
commit.

- **Self-host sends us nothing.** No telemetry, no usage counts, no error reports. The privacy
  policy opens with it because it is the strongest thing there is to say and it is checkable.
- **We are controller for the account; for migration content it depends on the customer**
  (privacy §3): processor for an organisation (ADR-0035 §17), and — draft position, lawyer to
  confirm — controller for a household migration, because Art. 2(2)(c) leaves the migrating
  parent outside the GDPR while recital 18 keeps the provider inside it (workplan 0111 §"Who
  is the controller"). It decides the whole shape of the DPA, which stays a business
  instrument; the privacy policy carries the household half itself.
- **The ledger holds metadata, not bodies** — natural keys, hashes, sizes, folder names,
  timestamps. Saying "technical data" instead would be vaguer and no more honest.
- **Nothing is deleted at the source, ever**, and deletion at the target is opt-in and per-item
  (ADR-0024).
- **There is no reverse sync**, so the source stays the customer's fallback.
- **Everything runs in the EU.** A migration off US cloud through a US-hosted tool is
  self-defeating; this is the product, not a compliance line.
- **Google is never a target**, and the Limited Use commitments in privacy §6 are the ones
  [`docs/google-oauth-verification.md`](../../docs/google-oauth-verification.md) maps to
  Google's policy.
- **The billing promises are ADR-0014's**: tier derived not chosen, finishing lowers the bill,
  setup charged once on the highest tier, no billing from inattention, nothing past twelve
  months without re-confirmation. If ADR-0014 changes, terms §6 and §8 change with it.

## What is deliberately not here yet

- **The DPA and the sub-processor list, as published pages** (0086 T5). Drafts now exist —
  [`dpa.md`](./dpa.md) and [`subprocessors.md`](./subprocessors.md), written 2026-08-30 for
  legal review — but they are not rendered by the site build, not linked from any published
  document, and not yet offered to anyone; until publication both legal documents say
  "available on request". A business customer cannot lawfully be onboarded without the DPA.
- **A cookie statement.** The application sets no analytics or advertising cookies, so there is
  nothing to disclose beyond the session cookie the sign-in needs — but that sentence belongs
  on the front door once the front door exists and its actual cookie behaviour is known,
  rather than being asserted here in advance.
