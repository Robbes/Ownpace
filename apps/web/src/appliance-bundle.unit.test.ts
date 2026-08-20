// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Does the APPLIANCE's bundle still contain the billing screen? (ADR-0036)
 *
 * `ManagedOnly` in AppRoutes has always refused to render Billing on the
 * appliance, and `AppRoutes.unit.test.tsx` has always proved it. Neither says
 * anything about what SHIPS: a static import is a build-time fact, and the
 * screen, its Mollie-shaped API client and the routes it calls went into the
 * appliance's JavaScript regardless of a runtime guard that would never let a
 * pixel of it render.
 *
 * The fix is one line of AppRoutes — comparing against a literal Vite bakes in,
 * so the self-host build folds the branch away and the dynamic import becomes
 * unreachable. The fix is also completely invisible: nothing about it fails
 * loudly if a later edit turns the comparison back into a function call, or
 * adds a second static import of a managed screen. So this asks the bundler.
 *
 * ## Why it builds BOTH editions
 *
 * "The appliance bundle contains no billing" is true of a build that produced
 * nothing at all, of a typo'd search string, and of a day somebody deletes the
 * billing screen outright. The managed half is what makes the self-host half
 * mean something: the same markers, from the same search, must be PRESENT
 * there. One direction is the rule; two directions are evidence.
 *
 * `write: false` — both builds stay in memory, so there is no output directory
 * to collide with `pnpm build` or to clean up.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build, type Rollup } from 'vite';

// apps/web/src -> apps/web
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Strings that exist only because somebody is being charged.
 *
 * API PATHS AND IDENTIFIERS, not display text: `apps/web/src/i18n/strings.ts`
 * carries the billing labels for both editions in one shared module, so
 * searching for "Payment Methods" would find the appliance's copy of a string
 * table and report contamination that is not there.
 */
const BILLING_MARKERS = ['/billing/invoices', '/billing/payment-methods', 'invoiceId'];

/** Every JS chunk of one build, as one string, plus the chunk file names. */
async function bundleFor(mode: 'managed' | 'selfhost'): Promise<{
  code: string;
  fileNames: string[];
}> {
  const result = (await build({
    root: WEB_ROOT,
    mode,
    logLevel: 'silent',
    build: { write: false, outDir: `dist-assert-${mode}` },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];

  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((o) => o.output).filter((c) => c.type === 'chunk');
  return {
    code: chunks.map((c) => c.code).join('\n'),
    fileNames: chunks.map((c) => c.fileName),
  };
}

let managed: { code: string; fileNames: string[] };
let selfhost: { code: string; fileNames: string[] };

beforeAll(async () => {
  [managed, selfhost] = await Promise.all([bundleFor('managed'), bundleFor('selfhost')]);
}, 300_000);

describe('the appliance bundle carries no billing screen (ADR-0036)', () => {
  it('builds two bundles with code in them, so the searches below are not vacuous', () => {
    // A build that emitted nothing would satisfy every "is absent" assertion
    // perfectly. This is the check that the tool ran.
    expect(managed.code.length).toBeGreaterThan(100_000);
    expect(selfhost.code.length).toBeGreaterThan(100_000);
  });

  it('puts every billing marker in the MANAGED bundle', () => {
    // The control. If a marker stops appearing here it has been renamed or
    // removed, and its absence from the appliance below stops being evidence.
    const missing = BILLING_MARKERS.filter((m) => !managed.code.includes(m));
    expect(
      missing,
      'these markers are gone from the managed bundle too, so searching for ' +
        'them proves nothing about the appliance — update BILLING_MARKERS:\n' +
        missing.map((m) => `  - ${m}`).join('\n'),
    ).toEqual([]);
  });

  it('puts none of them in the SELF-HOST bundle', () => {
    const present = BILLING_MARKERS.filter((m) => selfhost.code.includes(m));
    expect(
      present,
      'the appliance bundle ships billing code. Most likely a static import of ' +
        'a managed-only screen came back, or the edition comparison in ' +
        'AppRoutes.tsx became something the bundler cannot fold:\n' +
        present.map((m) => `  - ${m}`).join('\n'),
    ).toEqual([]);
  });

  it('emits a separate Billing chunk on managed and none on self-host', () => {
    // The shape, not just the strings: on managed the screen is its own lazy
    // chunk, which is what makes it droppable at all.
    expect(managed.fileNames.some((f) => /Billing/.test(f))).toBe(true);
    expect(selfhost.fileNames.filter((f) => /Billing/.test(f))).toEqual([]);
  });
});
