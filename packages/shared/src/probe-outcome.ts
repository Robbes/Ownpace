// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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

/** What a source counts when it lists. */
export type ProbeUnit = 'folder' | 'calendar' | 'addressBook' | 'collection';

export type ProbeOutcome =
  /** Reached it and it listed. Ours. */
  | { readonly code: 'connected'; readonly count: number; readonly unit: ProbeUnit }
  /** JMAP answered its session document — nothing to count. Ours. */
  | { readonly code: 'connectedSession' }
  /** A target answered a status instead of the document. Ours. */
  | { readonly code: 'targetStatus'; readonly url: string; readonly status: number }
  /** No probe is wired for this kind — a gap in us, not in the credential. */
  | { readonly code: 'noProbe'; readonly kind: string }
  /** The accompanying sentence is the PROVIDER's. Render it verbatim. */
  | { readonly code: 'providerRefused' };
