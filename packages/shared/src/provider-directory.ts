// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The provider directory (workplan 0106 T5 — first entry 2026-09-03, at the
 * owner's ask after finding Soverin's help page by hand: "can we add the
 * default already, like servers and ports?").
 *
 * WHAT A ROW IS. The servers and ports a NAMED provider publishes for the
 * account kind that carries its name — what a person would otherwise copy
 * from the provider's help page into the boxes. Pre-filled, editable, and
 * MEASURED before anything trusts them: Test probes exactly what is in the
 * boxes, pre-filled or typed, and the stored record is what the boxes held
 * when it was tested. A saved trip to a help page, never a promise about
 * the provider.
 *
 * WHAT A ROW IS NOT. Not a guess. 0105's never-guess rule is about what the
 * PRODUCT claims, and a row claims nothing — it names the page it was read
 * from and the day it was read, so a stale row can be found in a diff, and
 * a provider that moves its DAV host makes the pre-filled Test refuse in the
 * provider's own words rather than pass in ours. Protocol kinds (`imap`,
 * `jmap`, the DAV trio) have no row: a person who picked "IMAP" has not
 * named a provider, and a directory that answered anyway would be guessing.
 *
 * THE RULE FOR APPLYING ONE — only what is ours is ever overwritten. A blank
 * box takes the default; a box still holding the previous pick's default
 * takes the next pick's; a box the person typed into keeps what they typed;
 * and on leaving a provider whose default a box still shows, that box is
 * emptied rather than left claiming a server the new kind never named.
 * `applyProviderDefaults` is that rule, pure, so both doors apply the same
 * one and a test can break it.
 */

import { providerDisplayName } from './credential-fields.ts';

export interface ProviderDirectoryEntry {
  readonly role: 'source' | 'target';
  /** The door type the row pre-fills, in `credentialFieldsFor`'s vocabulary. */
  readonly type: string;
  /** Descriptor key → the published value, exactly as a person would type it. */
  readonly values: Readonly<Record<string, string>>;
  /** Where the values were read, and when — so a stale row has a date on it. */
  readonly sources: ReadonlyArray<{ readonly url: string; readonly seen: string }>;
}

export const PROVIDER_DIRECTORY: ReadonlyArray<ProviderDirectoryEntry> = [
  {
    role: 'target',
    type: 'soverin',
    // Soverin serves calendars and contacts from ONE DAV host at the root
    // (no path, so the DAV base URL box stays empty), and mail over IMAP on
    // a second host. The account address is the username on both, and the
    // account password signs in — nothing here pre-fills either.
    values: {
      host: 'caldav.soverin.net',
      port: '443',
      mailHost: 'imap.soverin.net',
      mailPort: '993',
    },
    sources: [
      { url: 'https://soverin.com/help/calendar-setup', seen: '2026-09-03' },
      { url: 'https://soverin.com/help/setup', seen: '2026-09-03' },
    ],
  },
];

const NOTHING: Readonly<Record<string, string>> = Object.freeze({});

/** The row for one door, or nothing — a provider without a row is not guessed. */
export function providerDirectoryEntry(
  role: 'source' | 'target',
  type: string,
): ProviderDirectoryEntry | undefined {
  return PROVIDER_DIRECTORY.find((entry) => entry.role === role && entry.type === type);
}

/** The published values for one door, or `{}` when no row exists. */
export function providerDefaultsFor(
  role: 'source' | 'target',
  type: string,
): Readonly<Record<string, string>> {
  return providerDirectoryEntry(role, type)?.values ?? NOTHING;
}

/**
 * THE PORT A PROTOCOL IS SERVED ON (the owner, 2026-10-04, on 0153's *not
 * carried over*: *"B"*). The wizard filled in 993 and 443; when it retired,
 * a protocol card's port box started empty, and a person looked up and typed
 * a number that is the same for nearly everyone. A protocol's usual port is
 * not a guess about a provider, which is what the directory refuses to make:
 * IMAP over TLS is 993 and JMAP and the DAV trio are HTTPS on 443, whoever
 * serves them. So it is filled in the way a row's values are: editable, and
 * measured by Test like anything typed. It is not a row, and it brings no
 * *Pre-filled from* line, because no provider published it.
 */
const USUAL_PORT: Readonly<Record<string, string>> = {
  imap: '993',
  jmap: '443',
  caldav: '443',
  carddav: '443',
  webdav: '443',
};

/**
 * What a fresh form starts from, at both doors: the protocol's usual port,
 * with a named provider's published values over it.
 */
export function formDefaultsFor(
  role: 'source' | 'target',
  type: string,
): Readonly<Record<string, string>> {
  const port = USUAL_PORT[type];
  const published = providerDefaultsFor(role, type);
  return port === undefined ? published : { port, ...published };
}

/**
 * What a door says beside pre-filled boxes — whose published settings, read
 * when — or nothing, for a kind without a row. The date is the latest read,
 * so the sentence ages honestly.
 */
export function providerDefaultsProvenance(
  role: 'source' | 'target',
  type: string,
): { readonly provider: string; readonly seen: string } | undefined {
  const entry = providerDirectoryEntry(role, type);
  if (!entry) return undefined;
  const seen = entry.sources.map((s) => s.seen).sort().reverse()[0] ?? '';
  return { provider: providerDisplayName(type), seen };
}

/**
 * Carry a form's boxes from one pick to the next, touching only what is
 * ours: a blank box or one still at `from`'s default takes `to`'s; a box
 * left at `from`'s default that `to` never named is emptied; everything
 * the person typed stays exactly as typed.
 */
export function applyProviderDefaults(
  from: Readonly<Record<string, string>>,
  to: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const [key, previous] of Object.entries(from)) {
    if (!(key in to) && (out[key] ?? '') === previous) out[key] = '';
  }
  for (const [key, next] of Object.entries(to)) {
    const current = out[key] ?? '';
    if (current.trim() === '' || current === from[key]) out[key] = next;
  }
  return out;
}
