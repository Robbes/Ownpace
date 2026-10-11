// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The bilingual dictionary (workplan 0024 T1, ADR-0013).
 *
 * Hand-rolled on purpose: two locales and compile-time key parity do not need
 * an i18n framework (see the workplan's decision notes). `en` defines the key
 * set; `nl` is TYPED against it, so a missing or extra Dutch key is a
 * typecheck failure, not a runtime English leak.
 *
 * The platform operator's screens are NOT here: they are English only, in
 * `operator-strings.ts` (ADR-0013, amended 2026-10-11).
 *
 * Server prose is NOT here: refusals render verbatim (rule 2/ADR-0024), and
 * shared operator prose lives in @openmig/shared next to its English source
 * (e.g. APPLY_FLAG_WARNING / APPLY_FLAG_WARNING_NL) so editions and languages
 * cannot drift apart separately.
 */

import * as app from './strings/app.ts';
import * as signIn from './strings/sign-in.ts';
import * as start from './strings/start.ts';
import * as connect from './strings/connect.ts';
import * as migrations from './strings/migrations.ts';
import * as people from './strings/people.ts';
import * as grant from './strings/grant.ts';
import * as confirm from './strings/confirm.ts';
import * as confirmed from './strings/confirmed.ts';
import * as queues from './strings/queues.ts';
import * as verify from './strings/verify.ts';
import * as finish from './strings/finish.ts';
import * as report from './strings/report.ts';
import * as billing from './strings/billing.ts';
import * as organisation from './strings/organisation.ts';

/**
 * The dictionary, composed from its areas in `strings/`. A key belongs to one
 * area: a second definition would silently win here, so
 * `one-area-per-key.unit.test.ts` refuses it.
 */
const en = {
  ...app.en,
  ...signIn.en,
  ...start.en,
  ...connect.en,
  ...migrations.en,
  ...people.en,
  ...grant.en,
  ...confirm.en,
  ...confirmed.en,
  ...queues.en,
  ...verify.en,
  ...finish.en,
  ...report.en,
  ...billing.en,
  ...organisation.en,
} as const;

const nl: Record<keyof typeof en, string> = {
  ...app.nl,
  ...signIn.nl,
  ...start.nl,
  ...connect.nl,
  ...migrations.nl,
  ...people.nl,
  ...grant.nl,
  ...confirm.nl,
  ...confirmed.nl,
  ...queues.nl,
  ...verify.nl,
  ...finish.nl,
  ...report.nl,
  ...billing.nl,
  ...organisation.nl,
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];
