// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A security scan that skipped itself, and reported green.
 *
 * `security-scan.yml` ran Trivy with `continue-on-error: true` and gated the
 * SARIF upload on `hashFiles('trivy.sarif') != ''`. Read together, those two
 * lines say: if Trivy fails, the step is green, the upload is SKIPPED rather
 * than failed, and the job passes having scanned nothing, uploaded nothing and
 * said nothing. In the GitHub UI it appears as a green Security Scan with one
 * grey step; in code scanning it appears as no new analysis — which is exactly
 * what a period with no vulnerabilities looks like.
 *
 * Trivy's ordinary failure is not exotic. It pulls its vulnerability database
 * from ghcr.io on every run, and a rate-limited pull is the common way that
 * goes wrong — the same class of upstream outage this repository has already
 * been bitten by elsewhere.
 *
 * THE FILE ALREADY KNEW THE RULE. Its own header says of the SBOM attach step,
 * which was gated on a tag ref the workflow could never reach: *"the step read
 * as deliberate and did nothing, which is the worst shape a guard can have."*
 * That half was fixed in 0025 T3 — SBOM generation is fatal on a release tag
 * and a warning elsewhere. The Trivy half carried the identical shape for
 * another five weeks because nothing was watching it, and nothing in
 * `scripts/` read this workflow at all.
 *
 * ## What these tests hold, and why each one can rot
 *
 *  1. **The job cannot end green having uploaded nothing.** The whole point.
 *     Asserted as a step that runs `if: always()` and can exit non-zero, not
 *     as the absence of `continue-on-error` — the flag is fine, it is the
 *     silence that was not.
 *  2. **The check reads all three facts.** The scan's outcome, the file, and
 *     the upload's outcome. Any one alone leaves a hole: a green Trivy that
 *     wrote nothing, a written file the upload rejected, an upload that was
 *     skipped because the file was absent.
 *  3. **Non-empty, not merely present.** `hashFiles` returns a hash for an
 *     existing EMPTY file, so a zero-byte SARIF satisfies the upload's own
 *     gate. `[ -s ]` is the test that means what the gate was trying to say.
 *  4. **Fatal where the scan is the record, warning where it is not.** The
 *     rule the SBOM half already states in its own words. A pull request is
 *     not the record; main, the weekly schedule and a tag are.
 *  5. **It runs last, and unconditionally.** If it sat directly after Trivy,
 *     failing it would skip the SBOM and the release attach — neither of which
 *     has anything to do with Trivy. Position is part of the fix.
 *
 * Read as text: this is a workflow file, and what is asserted is that certain
 * steps exist, in a certain order, with certain conditions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/security-scan.yml';
const wf = readFileSync(join(REPO_ROOT, WORKFLOW), 'utf8');

/** The assertion step's body — everything from its name to the end of file. */
const check = (() => {
  const at = wf.indexOf('- name: The scan produced a report, and it was uploaded');
  expect(at, `${WORKFLOW} has no step asserting the scan produced anything`).toBeGreaterThan(-1);
  return wf.slice(at);
})();

describe('a scan that uploaded nothing cannot report green', () => {
  it('the job asserts its own result, rather than trusting two green steps', () => {
    // The defect in one sentence. `continue-on-error` plus a `hashFiles` gate
    // makes silence indistinguishable from success, so something has to say
    // out loud that a report was produced.
    expect(check).toMatch(/if: always\(\)/);
    expect(check).toContain('exit 1');
    expect(check).toContain('::error::');
  });

  it('reads the scan, the file and the upload — any one alone leaves a hole', () => {
    // Three different ways to end up with no findings in code scanning, and
    // they do not imply each other: Trivy can fail; Trivy can succeed and
    // write nothing; the upload can be skipped or rejected.
    expect(check).toContain('steps.trivy.outcome');
    expect(check).toContain('steps.upload_sarif.outcome');
    expect(check).toContain('trivy.sarif');
    // And the ids those read have to exist on the steps themselves.
    expect(wf).toMatch(/- name: Trivy filesystem\/dependency scan \(SARIF\)\n\s+id: trivy\b/);
    expect(wf).toMatch(/- name: Upload SARIF to code scanning\n\s+id: upload_sarif\b/);
  });

  it('requires a NON-EMPTY report, which hashFiles does not', () => {
    // `hashFiles` returns a hash for an existing empty file, so the upload's
    // own gate accepts a zero-byte SARIF. This is the test that means what
    // that gate was reaching for.
    expect(check).toMatch(/\[ ! -s trivy\.sarif \]|\[ -s trivy\.sarif \]/);
  });

  it('is fatal where the scan is the record, and a warning where it is not', () => {
    // The same rule the SBOM step above already states for itself. A pull
    // request is not the security record; main, the schedule and a tag are —
    // and an upstream Trivy outage must not stand between a contributor and a
    // merge.
    expect(check).toContain("github.event_name != 'pull_request'");
    expect(check).toContain('::warning::');
  });

  it('runs LAST, so its failure costs nothing else', () => {
    // Position is part of the fix. Immediately after Trivy, a failure here
    // would skip the SBOM and the release attach, neither of which depends on
    // Trivy in any way.
    for (const step of [
      '- name: Generate CycloneDX SBOM',
      '- name: Upload SBOM artifact',
      '- name: Attach SBOM to GitHub release',
    ]) {
      const at = wf.indexOf(step);
      expect(at, `${WORKFLOW} no longer has "${step}"`).toBeGreaterThan(-1);
      expect(at, `the scan assertion must come after "${step}"`).toBeLessThan(
        wf.indexOf('- name: The scan produced a report, and it was uploaded'),
      );
    }
  });

  it('the upload still happens, and still from the file Trivy wrote', () => {
    // Guarding the alarm is worthless if the thing it guards has gone. Both
    // halves are named here so a rename cannot leave this file passing over
    // machinery that no longer exists.
    expect(wf).toContain('output: trivy.sarif');
    expect(wf).toContain('sarif_file: trivy.sarif');
    expect(wf).toContain('upload-sarif@');
  });
});
