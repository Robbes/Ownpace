// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every domain the §20 report accounts for is a domain the e2e gates actually
 * read (workplan 0113, the follow-up to T8).
 *
 * `a-domain-the-fan-outs-forgot.unit.test.ts` counts the ticks that decide
 * whether a domain SYNCS. This counts the ones that decide whether anybody
 * ever LOOKS at what it synced — a different failure, one layer down, and the
 * one that actually happened.
 *
 * T5 widened the report's `dataType` union to five and left every ITERATION at
 * four, because an array literal is never a compile error. Inside the packages
 * that is now fixed by construction: `VERIFICATION_DOMAINS` is the one list,
 * and `VerificationResult` is a total `Record` over it, so a missing domain is
 * a compile error at every construction site.
 *
 * THE E2E GATES CANNOT HAVE THAT. `test/` declares no `@openmig/*` dependency
 * — `no-workspace-imports.unit.test.ts` exists to keep it that way, because
 * pnpm creates no node_modules link there and an import dies at runtime inside
 * a gate that has already stood up eight containers. So the gates restate the
 * domain list, and a restatement drifts silently: e2e.yml enabled
 * `cfg.domains.tasks` in T8, nothing anywhere sets `E2E_DOMAINS`, and both
 * gates went on defaulting to four. The task lane ran on every nightly and no
 * assertion asked about it — a green whose task lane copied nothing is exactly
 * the failure these gates exist to stop.
 *
 * Hence text-pairing. Read the one list out of shared, read what each gate
 * restates, and require them to agree. Adding a domain to
 * `VERIFICATION_DOMAINS` and not to a gate fails HERE, in the unit job, in
 * seconds — rather than in a nightly that stays green because it stopped
 * looking.
 *
 * Read as TEXT rather than imported, for the reason
 * `a-domain-the-fan-outs-forgot.unit.test.ts` gives: a root-level test cannot
 * resolve workspace imports, and the thing under test is the SHAPE of the
 * source anyway.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

const SHARED_REPORT = 'packages/shared/src/verification-report.ts';
const VERIFICATION_GATE = 'test/e2e/selfhost-verification.e2e.test.ts';
const RESUME_GATE = 'test/e2e/selfhost-restart-resume.e2e.test.ts';
const WORKFLOW = '.github/workflows/e2e.yml';
const FIXTURE = 'test/e2e/fixtures/selfhost-restart-resume.mapping.json';
const ENGINE = 'packages/core/src/verification.ts';

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Every single-quoted lowercase word in a fragment of source. */
function quoted(fragment: string): string[] {
  return [...fragment.matchAll(/'([a-z]+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** The one list, as declared: `export const VERIFICATION_DOMAINS = [...]`. */
function reportDomains(): string[] {
  const src = read(SHARED_REPORT);
  const m = /export const VERIFICATION_DOMAINS = \[([^\]]+)\]/.exec(src);
  expect(m, `${SHARED_REPORT} no longer declares VERIFICATION_DOMAINS as an array literal`).toBeTruthy();
  return quoted(m![1]!);
}

/** A named `as const` tuple in a gate, e.g. `const REPORT_DOMAINS = [...] as const`. */
function tupleIn(src: string, name: string): string[] {
  const m = new RegExp(`const ${name} = \\[([^\\]]+)\\] as const`).exec(src);
  expect(m, `expected a \`const ${name} = [...] as const\` tuple`).toBeTruthy();
  return quoted(m![1]!);
}

/** The `E2E_DOMAINS` fallback a gate runs on when nobody sets the variable. */
function defaultDomains(src: string): string[] {
  const m = /process\.env\.E2E_DOMAINS \|\| '([^']+)'/.exec(src);
  expect(m, 'expected an `process.env.E2E_DOMAINS || \'...\'` default').toBeTruthy();
  return m![1]!.split(',').map((d) => d.trim());
}

describe('the report accounts for five domains, so the gates read five', () => {
  it('names them, so a reader of this failure knows what changed', () => {
    // Not a tautology: it pins the list this whole file is about, so a domain
    // ADDED to shared shows up here as the one diff that explains every other
    // failure below.
    expect(reportDomains()).toEqual(['mail', 'calendar', 'contacts', 'files', 'tasks']);
  });

  it('the engine itself verifies every domain, rather than a literal four', () => {
    // THE ORIGINAL DEFECT, and the one assertion here that guards product code
    // rather than a gate. `runVerification` called `verifyDomain` four times by
    // hand while `verifyTasks` arrived as `true`, so the task domain was
    // configured, enabled and never asked about.
    //
    // A type cannot hold this. The results are collected into
    // `{} as Record<VerificationDomain, DataTypeVerification>`, and a cast does
    // not check — narrowing the loop back to four compiles perfectly and leaves
    // `byDomain.tasks` undefined at runtime. What the type DOES hold is the
    // report's shape: `VerificationResult` is a total Record, so omitting a
    // domain from the returned object is a compile error. Shape and reach are
    // two different properties and this is the one nothing else covers.
    const src = read(ENGINE);
    expect(src).toMatch(/for \(const domain of VERIFICATION_DOMAINS\)/);
    expect(
      src,
      'runVerification is walking a literal domain list again — the shape this defect had',
    ).not.toMatch(/for \(const domain of \[/);
    // And the summary is computed over the same walk, not over a second list:
    // the score, the recommendations and canProceedToCutover were all derived
    // from a four-element `allVerifications` while the report carried five.
    expect(src).toMatch(/VERIFICATION_DOMAINS\.map\(\(domain\) => byDomain\[domain\]\)/);
  });

  it('the verification gate loops over every domain the report carries', () => {
    // Three loops in that file used to be a literal
    // `['mail', 'calendar', 'contacts', 'files'] as const` — checksum counters,
    // target bytes, and extras-on-target. All three now walk REPORT_DOMAINS.
    expect(tupleIn(read(VERIFICATION_GATE), 'REPORT_DOMAINS')).toEqual(reportDomains());
  });

  it('the verification gate has no literal four-domain loop left', () => {
    // The specific shape that drifted. A new one would pass every assertion
    // above while quietly reading four fifths of the report.
    const src = read(VERIFICATION_GATE);
    expect(src).not.toMatch(/\['mail', 'calendar', 'contacts', 'files'\]/);
  });

  it('the verification gate maps a wizard domain onto every report domain', () => {
    // DOMAIN_KEY translates the wizard's `email`/`contact`/`file`/`task` into
    // the report's plural spelling. A domain missing from it makes
    // `DOMAIN_KEY[domain]!` undefined, and `report[undefined]` throws inside
    // the gate rather than reporting anything.
    const src = read(VERIFICATION_GATE);
    const block = /const DOMAIN_KEY: Record<string, ReportDomain> = \{([^}]+)\}/.exec(src);
    expect(block, 'DOMAIN_KEY is no longer a literal record in the gate').toBeTruthy();
    const mapped = quoted(block![1]!);
    for (const domain of reportDomains()) {
      expect(mapped, `DOMAIN_KEY maps nothing onto the report's '${domain}'`).toContain(domain);
    }
  });

  it('both gates default to every domain, since nothing sets E2E_DOMAINS', () => {
    // THE DEFECT, stated as an assertion. The override is for a partial
    // dispatch; the default is what every nightly actually runs, and it was
    // four while the workflow configured five.
    const wizardDomains = defaultDomains(read(VERIFICATION_GATE));
    expect(wizardDomains).toHaveLength(reportDomains().length);
    expect(wizardDomains).toContain('task');
    expect(defaultDomains(read(RESUME_GATE))).toEqual(wizardDomains);
  });

  it('the appliance fixture enables a domain for each one the gates will ask about', () => {
    // The other half of the pair: a gate that asks about a domain the
    // appliance was never configured for waits out its whole timeout and
    // reports a product failure that is really a missing config line.
    //
    // Asserted against the FIXTURE, which is the file a person opens to answer
    // "what does this gate migrate?". T8 switched tasks on inside e2e.yml with
    // an `|| { enabled: true }` fallback instead, so the fixture said four and
    // the run did five — true, and unreadable.
    //
    // `MappingConfig.domains` happens to key by the report's own plural
    // spelling, so no translation is needed here. That is a coincidence of two
    // vocabularies, not a rule: if they ever diverge, this is where it shows.
    const cfg = JSON.parse(read(FIXTURE)) as { domains: Record<string, { enabled?: boolean }> };
    const enabled = Object.entries(cfg.domains)
      .filter(([, d]) => d.enabled === true)
      .map(([k]) => k);
    expect([...enabled].sort()).toEqual([...reportDomains()].sort());
  });

  it('the workflow still points the task domain at a real DAV root', () => {
    // Enabled and unaddressed is its own failure: the fixture's URL names
    // `host.docker.internal`, which is not how the appliance container reaches
    // Nextcloud in CI. Every DAV domain gets rewritten in that step; tasks
    // must be one of them.
    const wf = read(WORKFLOW);
    expect(wf).toMatch(/cfg\.domains\.tasks\.source\.url = nextcloudDav;/);
    expect(wf).toMatch(/cfg\.domains\.tasks\.target\.url = nextcloudDav;/);
  });
});
