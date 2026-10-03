# ADR-0000: <short title>

- **Status:** Proposed | Accepted YYYY-MM-DD | Superseded by ADR-00xx
- **Date:** YYYY-MM-DD
- **Deciders:** <names/roles>

<!-- The Status entry is at most 400 characters (ADR-0051): the status, its date, and — once
     there are any — how many amendments, never their story. That goes in the amendment log. -->

## Operative rules

<!-- REQUIRED (ADR-0038). What holds NOW — the constraints a reader must comply with, nothing
     else. At most 8 bullets, 60 words a bullet, 300 words in all (ADR-0051):
     scripts/adr-operative.mjs refuses a section over that, and table rows are not counted.
     A bullet states the rule and points at what holds it — prefer the guard that enforces
     it, then the file, then the section below. Reasons, examples, quotes and "this used to
     say…" belong below, never here; so does any ### heading.
     Amend these bullets IN PLACE when a later decision changes them (the sections below
     stay append-only), and regenerate the assembled file:  node scripts/adr-operative.mjs --write
     A change decided but not yet in force is one "- **Pending (proposed YYYY-MM-DD, not in
     force):** …" bullet AND a "## Pending — …" section holding its text: both, or neither.
     A retracted/superseded ADR states "Nothing is operative — …" plus its revisit
     condition. -->

- <rule>

## Context
What problem/force are we addressing? Constraints, requirements, assumptions.

## Decision
The decision, stated plainly.

## Consequences
Positive, negative, and neutral results of the decision. What becomes easier/harder.

## Alternatives considered
Options weighed and why they were not chosen.

## Amendment log

<!-- Add this section with the first change after acceptance; delete it until then. One dated
     line per change: what changed, who decided, where it is written.
       - **YYYY-MM-DD** — <what changed> (<who>, <workplan/task>). Record: *<section>*.
     When the decision can no longer be read without reconciling these lines, consolidate the
     ADR in place (ADR-0051): rewrite it as it stands today under the same number and file
     name, move the old file word for word to history/, and link it from here. -->
