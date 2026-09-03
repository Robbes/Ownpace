// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHOSE WORDS a probe result carries (workplan 0080; 0068 T10d asked for it).
 *
 * A probe answers two very different things through one channel. *Connected.
 * 12 folders visible.* is ours — UI copy, and a Dutch operator should read it
 * in Dutch. `invalid_client` from Dropbox is theirs — the exact string you
 * paste into their console, and translating it would destroy its only use
 * (rule 9, `docs/i18n-prose-boundary.md`).
 *
 * Until this existed the client could not tell them apart, so it rendered
 * everything in English and the owner reported it. The outcome is the handle
 * that separates them: our codes carry their DATA and a client builds the
 * sentence in its own language; `providerRefused` says the accompanying text
 * belongs to the provider and must be shown exactly as it arrived.
 *
 * It lives in `shared` rather than in `orchestration` because both ends need
 * it — the probe writes it, the web reads it — and a contract with a copy on
 * each side is a contract that drifts.
 */

import type { BilingualRefusal } from './credential-refusals.ts';

/**
 * What a source counts when it lists.
 *
 * `taskList` is its own unit rather than a `calendar` (workplan 0113): on the
 * wire both are calendar collections, but a person reading "5 calendars" on a
 * connection that holds four calendars and a to-do list has been told
 * something false. The unit is what makes the count true.
 */
export type ProbeUnit = 'folder' | 'calendar' | 'addressBook' | 'collection' | 'taskList';

export type ProbeOutcome =
  /**
   * Reached it and it listed. Ours. `floor` says the count is a lower bound:
   * a probe that stopped listing at its cap (Dropbox's top level past its
   * page cap, 2026-09-02) saw at least this many, and a screen says so.
   */
  | {
      readonly code: 'connected';
      readonly count: number;
      readonly unit: ProbeUnit;
      readonly floor?: boolean;
    }
  /** JMAP answered its session document — nothing to count. Ours. */
  | { readonly code: 'connectedSession' }
  /** A target answered a status instead of the document. Ours. */
  | { readonly code: 'targetStatus'; readonly url: string; readonly status: number }
  /** No probe is wired for this kind — a gap in us, not in the credential. */
  | { readonly code: 'noProbe'; readonly kind: string }
  /** The accompanying sentence is the PROVIDER's. Render it verbatim. */
  | { readonly code: 'providerRefused' }
  /**
   * A credential refusal WE wrote, in both languages (workplan 0083).
   *
   * This used to arrive as `providerRefused`, and that was wrong in the one
   * way this file exists to prevent: it is not the provider's string, it is
   * ours — *dropbox source: clientId, clientSecret, refreshToken are not set*
   * was written here, not by Dropbox. Being mislabelled as theirs is precisely
   * why it stayed English for a Dutch operator: the rule for the provider's
   * words is render-verbatim, and it was being applied to our own.
   *
   * The pair rides along rather than a locale being chosen at throw time,
   * because the factory that throws has no idea who reads it — a log on the
   * appliance, a probe panel on a phone, an API response.
   */
  | { readonly code: 'credentialsRefused'; readonly refusal: BilingualRefusal }
  /**
   * The probe did not answer within its deadline (2026-09-02, the owner's
   * whole-Dropbox test): a Test that walked a large tree outlived the
   * browser's 30 s while the API kept walking. Ours, with the seconds as
   * data. UNKNOWN, never a refusal — the credentials may be fine, and the
   * connection is kept so it can be tested again.
   */
  | { readonly code: 'timedOut'; readonly seconds: number };
