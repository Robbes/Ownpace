// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE BROWSER SAYS WITH A REPORT (workplan 0130 T6, Part B; the owner's
 * "Both parts", 2026-09-28).
 *
 * Some facts only the browser has, and support needs them as much as the ones
 * our records hold (`report-facts.ts`, Part A):
 *
 * - **the screen's language**, to answer in it;
 * - **the time zone**, which turns the person's "at 14:02" into the log's UTC;
 * - **the window's width**, in CSS pixels, which a layout follows, so a phone's
 *   problem is seen as one;
 * - **the web app's build**, written only when it is not the server's own: an
 *   old page talking to a newer server says so here, and nowhere else;
 * - **the failure line the form was opened from**: its data type, its side and
 *   its migration, which a line on Connections knows and its page's address
 *   does not;
 * - **the references of the faults the page met in the five minutes before**,
 *   each with its code (`list_failed`), so that nobody copies a reference out
 *   of a "Something went wrong" sentence by hand. The web app keeps only these
 *   two words of a fault (`apps/web/src/services/recent-errors.ts`), never the
 *   request, which carries the sign-in token.
 *
 * They arrive as one object, `browser`, in the report's body, and in the
 * preview's query as JSON. Anybody can write it, so this takes from it only
 * {@link BROWSER_FACT_KEYS}, each on its own: its type, its length, and only
 * characters its kind of value has, so that no line and no header can be built
 * from it. Anything else is DROPPED, not refused: an unknown key, a value too
 * long or of the wrong shape, a list longer than the form keeps, an object that
 * is not one. The report is the person's, and what their browser added to it
 * wrongly is no reason to lose it. Nothing here is ever stored or read again;
 * it is written into the report's lines ({@link browserFactLines}) and nowhere
 * else.
 */

import { z } from 'zod';
import type { BuildIdentity } from '@openmig/core';
import { APP_EVENT_REFERENCE, DISCOVERY_DOMAINS, FAILURE_SIDES } from '@openmig/shared';

/** The most recent faults a report carries: the form keeps three. */
export const MAX_RECENT_ERRORS = 3;

/**
 * The longest `browser` the preview's query may carry, as JSON. Every fact at
 * its longest is about 600 characters; more than this is not the form's.
 */
export const MAX_BROWSER_FACTS_QUERY = 2000;

const LANGUAGE_NAMES = { en: 'English', nl: 'Dutch' } as const;

/**
 * A fault's code, as `serverFault` names it: lower case, digits and `_`, and
 * the web app's `unknown` for one it could not read.
 */
const FAULT_CODE = /^[a-z][a-z0-9_]{0,47}$/;

/**
 * EVERY FACT THE BROWSER MAY SEND, each with the only values it takes. A key
 * that is not here is never read; the guard holds this list to its keys.
 */
const FACTS = {
  language: z.enum(['en', 'nl']),
  /** An IANA name (`Europe/Amsterdam`, `America/Argentina/Buenos_Aires`, `UTC`, `Etc/GMT+1`). */
  timeZone: z
    .string()
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/),
  /** CSS pixels, whole: no window is wider than this. */
  windowWidth: z.number().int().min(1).max(20_000),
  /** The root `package.json`'s version, as the web build stamps it. */
  appVersion: z
    .string()
    .max(40)
    .regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/),
  appCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  dataType: z.enum(DISCOVERY_DOMAINS),
  side: z.enum(FAILURE_SIDES),
  migrationId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .transform((id) => id.toLowerCase()),
  /** Newest first. An entry's other keys are dropped; a list longer than the form keeps is dropped whole. */
  recentErrors: z
    .array(
      z.object({
        reference: z.string().regex(APP_EVENT_REFERENCE),
        code: z.string().regex(FAULT_CODE),
      }),
    )
    .min(1)
    .max(MAX_RECENT_ERRORS),
};

/** The keys a report's `browser` may carry, and nothing else. */
export const BROWSER_FACT_KEYS = Object.keys(FACTS) as ReadonlyArray<keyof typeof FACTS>;

/** What the browser said, as far as it was one of these and in their shape. */
export type BrowserFacts = { readonly [K in keyof typeof FACTS]?: z.output<(typeof FACTS)[K]> };

/**
 * The facts in `value`, as far as they are {@link BROWSER_FACT_KEYS} in their
 * shape; undefined when none is. `value` is the report body's object, or the
 * preview query's JSON, at most {@link MAX_BROWSER_FACTS_QUERY} characters.
 */
export function parseBrowserFacts(value: unknown): BrowserFacts | undefined {
  let said = value;
  if (typeof said === 'string') {
    if (said.length > MAX_BROWSER_FACTS_QUERY) return undefined;
    try {
      said = JSON.parse(said);
    } catch {
      return undefined;
    }
  }
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const from = said as Record<string, unknown>;
  const facts: Record<string, unknown> = {};
  for (const key of BROWSER_FACT_KEYS) {
    if (!Object.hasOwn(from, key)) continue;
    const parsed = FACTS[key].safeParse(from[key]);
    if (parsed.success) facts[key] = parsed.data;
  }
  return Object.keys(facts).length > 0 ? (facts as BrowserFacts) : undefined;
}

/** A build as the report's `Build:` line writes it, for comparing. */
function shortCommit(commit: string | undefined): string | undefined {
  return commit && commit !== 'unknown' ? commit.slice(0, 7) : undefined;
}

/**
 * The web app's build, when it is not the server's: another version, or,
 * when both know their commit, another commit. Undefined when it is the same,
 * or the browser did not say.
 */
function appBuildLine(facts: BrowserFacts, server: BuildIdentity): string | undefined {
  const commit = shortCommit(facts.appCommit);
  const serverCommit = shortCommit(server.commit);
  const otherVersion = facts.appVersion !== undefined && facts.appVersion !== server.version;
  const otherCommit = commit !== undefined && serverCommit !== undefined && commit !== serverCommit;
  if (!otherVersion && !otherCommit) return undefined;
  const build = [facts.appVersion ? `v${facts.appVersion}` : undefined, commit].filter(Boolean).join(' · ');
  return `App build in the browser: ${build}, not the server's`;
}

/**
 * The lines the browser's facts are written as, under labels the report's
 * list (`REPORT_FACT_LABELS`) names, in this order. None when it said nothing.
 */
export function browserFactLines(facts: BrowserFacts | undefined, server: BuildIdentity): string[] {
  if (!facts) return [];
  const failure = [
    facts.dataType,
    facts.side ? `${facts.side} side` : undefined,
    facts.migrationId ? `migration ${facts.migrationId}` : undefined,
  ].filter(Boolean);
  const appBuild = appBuildLine(facts, server);
  return [
    ...(facts.language ? [`Screen language: ${LANGUAGE_NAMES[facts.language]}`] : []),
    ...(facts.timeZone ? [`Time zone: ${facts.timeZone}`] : []),
    ...(facts.windowWidth ? [`Window width: ${facts.windowWidth} px`] : []),
    ...(appBuild ? [appBuild] : []),
    ...(failure.length > 0 ? [`Failure line: ${failure.join(', ')}`] : []),
    ...(facts.recentErrors ?? []).map((e) => `Recent error: ${e.reference}, ${e.code}`),
  ];
}
