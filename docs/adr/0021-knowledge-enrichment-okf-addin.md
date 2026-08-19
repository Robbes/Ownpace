# ADR-0021: Optional knowledge-enrichment add-in (OKF) — a parallel, opt-in `KnowledgeSink`

- **Status:** **Retracted 2026-08-05** (owner decision, workplan 0026 T3 row 16) — accepted 2026-06-22 as planned/optional, never built
- **Date:** 2026-06-22
- **Relates to:** ADR-0007 (reuse/engines), ADR-0009 (repo strategy), ADR-0011 (sovereignty), ADR-0015 (backup/data scope), ADR-0020 (rebuildable cache / natural-key idempotency).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Nothing is operative — retracted 2026-08-05, never built.** No `KnowledgeSink`, no OKF writer; the scope manifest does not name it.
- Revisit trigger: somebody asks for a knowledge side-output **with a use for it**; the opt-in-sink-off-the-critical-path shape remains the right one if revived.

> **Update 2026-08-05 (owner decision, workplan 0026 T3 row 16) — RETRACTED.**
> This ADR was accepted with a deferral: build it *after the file slices*. Those
> landed, the precondition expired, and in the whole time since **not one line
> of code was written** against it — no `KnowledgeSink`, no OKF writer, no
> vocabulary.
>
> Retracted rather than deferred again, for a reason the ADR states about
> itself: it is **a different concern from migration** and it is
> **privacy-sensitive**, deriving relationships and topics from personal
> mailboxes. A product whose first-run story is not finished should not carry a
> standing promise to mine its customers' mail for a knowledge graph — and a
> promise nobody has moved on in months is one nobody is going to build.
>
> The reasoning is kept below rather than deleted: if this is ever picked up,
> the analysis of OKF v0.1 against OWL/RDF is worth having, and the decision to
> put it behind an **opt-in** sink rather than in the migration path is the
> right shape whatever the format turns out to be.
>
> **Revisit condition, and it is a real trigger rather than a date:** somebody
> asks for a knowledge side-output, with a use for it. Until then the scope
> manifest does not name it, and the SAD names it only as retracted — §24's
> decision list and §25's backlog item 4 both carry the retraction, so a reader
> arriving from either place is told the same thing.

## Context
We already extract every item during migration (the `SourceConnector` reads content; the reconcile loop touches each one). A recurring ask is to produce, **in parallel**, an agent-readable knowledge bundle alongside the migrated data — "knowledge files with an ontology," as an add-in.

The **Open Knowledge Format (OKF)** — an open spec published by Google Cloud (v0.1, June 2026) — represents knowledge as a **directory of markdown files with YAML frontmatter**, where the **file path is a concept's identity** and **markdown links between files form the graph**; the only required field is `type`. It is deliberately far lighter than OWL/RDF (which are more expressive but need schema registries, tooling, and expertise). That makes a knowledge/ontology side-output cheap to produce from our TypeScript stack — but it is a **different concern** from migration and is **privacy-sensitive** (it derives relationships/topics from personal mailboxes).

## Decision
1. **Optional, opt-in, parallel — never on the migration's critical path, and NOT in the MVP.** Migration correctness must never depend on it; sink failures are logged and non-fatal.
2. **Seam:** a `KnowledgeSink` port (in `@openmig/shared`) that the reconcile loop fans each fetched item out to, as a zero-or-more observer; an optional `@openmig/enrich` package implements it. When no sink is registered, the hook is a no-op (zero impact when off).
3. **Pluggable writers behind the sink:** an **OKF writer** (markdown + YAML frontmatter; file path = concept identity) first; optional **JSON-LD / RDF (Turtle)** writers later for a *formal* ontology. Same entities, multiple serializations.
4. **Ontology = a small, producer-defined vocabulary.** OKF gives structural interoperability only; semantics are ours: a minimal type set (Person, Organization, Thread, Message, Document, Folder, Topic) plus link conventions. That lightweight vocabulary *is* the ontology; a formal OWL/SKOS export is an optional extra, not the default.
5. **Deterministic-first.** Metadata-level concepts (senders/recipients, threads, dates, folders, attachment types) are pure deterministic parsing — **no AI**. LLM/NLP enrichment (topics, summaries, entity/relationship extraction) is a **separate, further opt-in layer**, never bundled into the migration path.
6. **Idempotent & rebuildable.** Concept identity reuses the same natural key (Message-ID / contact email / folder path), so re-runs **update, not duplicate** (aligns ADR-0020); a lost bundle is rebuilt from the migrated target.
7. **Local-only by default.** Output goes to a user-controlled directory / git repo, never transmitted off the device; explicit consent; honors the sovereignty stance (ADR-0011).
8. **Isolate behind the writer interface.** OKF is v0.1 (a v0.2 is expected) and there is even a name collision with an unrelated `OKF-SCIS` supply-chain spec — so avoid lock-in; emit JSON-LD/RDF alongside if OKF shifts.

## Consequences
- Users can get a portable, agent-ready "digital brain" of their migrated corpus with no heavy ontology tooling — an SMB-leaning differentiator.
- Adds an optional package plus a guarded fan-out hook in `core`; **zero impact when disabled**.
- The privacy surface grows (derived/inferred data), so it must be opt-in, local, and consented — to be documented in `SECURITY.md` / the threat model when built.
- Format-churn risk (OKF v0.1) is contained by the writer abstraction.
- **Sequencing:** after the file-migration slices (mail is 0001; files are 0003+), though the sink can also attach to the mail path. Tracked in §25 backlog.

## Alternatives considered
- **Formal ontology (OWL/RDF) as the primary output:** rejected as default — heavy tooling/expertise, poor fit for families/SMBs; kept as an optional writer.
- **Bake enrichment into the migration path:** rejected — couples a different concern to migration correctness and adds cost/non-determinism.
- **LLM-first extraction:** rejected as default — expensive, non-deterministic, dependency-heavy; deterministic metadata-first, LLM as an opt-in layer.
- **Process bundles in a managed/cloud service:** rejected — violates the local-only/sovereignty stance.
