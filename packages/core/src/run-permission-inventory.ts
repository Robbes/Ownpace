// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Running the permission inventory (workplan 0029 T1/T3, the wiring half).
 *
 * The scans are connectors, the mapping table and the report are pure; this
 * is the pass that composes them, behind a deps seam so it can be tested
 * without a tenant and wired identically in both editions.
 *
 * THE ONE RULE THIS FILE ENFORCES ON ITS OWN: **the mailbox-delegation
 * section is always present.** It is not a dep, not optional and not
 * conditional on anything a caller passes — because FullAccess and SendAs
 * cannot be read through Graph at all, a report is only ever honest if it
 * says so, and the way that sentence would get lost is exactly the way
 * sections normally get lost: a caller that forgot to add one. So the pass
 * emits it, every time, whatever else it was given.
 *
 * The rest is composition. Each scan that fails contributes its reason to the
 * report's blind-spot section rather than being dropped, which is why the
 * deps return `PermissionListing` and never throw for a category's sake.
 */

import type { PermissionListing } from '@openmig/shared';
import {
  renderPermissionReport,
  type PermissionSection,
  type ReportLanguage,
} from './permission-report.ts';

/**
 * The words this pass says itself, in each language (workplan 0144): the
 * section titles and the reasons it gives when a scan gave none. A scan's own
 * reason, and an error's own message, stay as they were said.
 */
const WORDS = {
  en: {
    delegation: 'Who else had access to the mailbox',
    calendars: 'Calendar sharing',
    drive: 'File and folder sharing',
    noReader:
      'This source has nothing of this kind to inventory, or no reader for it is ' +
      'configured. Nothing was looked at either way.',
    scanFailed: (message: string) => `the scan failed: ${message}`,
    conductUnmeasured: (message: string) =>
      `The target's conduct could not be measured: ${message}. Unmeasured is not safe — ` +
      'treat scheduling fan-out as possible until it is measured.',
  },
  nl: {
    delegation: 'Wie verder toegang had tot het postvak',
    calendars: "Gedeelde agenda's",
    drive: 'Gedeelde bestanden en mappen',
    noReader:
      'Deze bron heeft hier niets van om te inventariseren, of er is geen lezer voor ' +
      'ingesteld. In beide gevallen is er niets bekeken.',
    scanFailed: (message: string) => `de scan is mislukt: ${message}`,
    conductUnmeasured: (message: string) =>
      `Het gedrag van het nieuwe systeem kon niet worden gemeten: ${message}. Niet gemeten ` +
      'is niet veilig. Ga ervan uit dat het nieuwe systeem uitnodigingen naar deelnemers ' +
      'kan sturen, tot het is gemeten.',
  },
} as const;

export interface PermissionInventoryDeps {
  /** Rendered into the header so the reader knows which migration this is. */
  readonly mappingLabel?: string;
  /** ISO date, passed in: nothing here reads a clock. */
  readonly generatedOn?: string;
  /** The reader's language for everything this pass and the report say; English when omitted. */
  readonly lang?: ReportLanguage;
  /**
   * Why mailbox delegation could not be inventoried, in the source's words.
   * Required, because it is always true of every source this tool speaks to.
   */
  readonly delegationReason: string;
  /** Calendar sharing. Omit for a source that has no calendars. */
  scanCalendars?(): Promise<PermissionListing>;
  /** File and folder sharing. Omit for a source that has no drive. */
  scanDrive?(): Promise<PermissionListing>;
  /**
   * What the TARGET will do with what this migration writes (0105 T0):
   * will-do/cannot-do sentences, MEASURED against the target — e.g. the
   * scheduling verdict `measureTargetScheduling` returns. Omit when no
   * target this question applies to is connected; a thrown measurement
   * becomes a stated unmeasured-is-not-safe line, never a dropped section.
   */
  measureTargetConduct?(): Promise<readonly string[]>;
  error?(message: string, err: unknown): void;
}

/** One inventory pass. Returns the report as Markdown; never throws. */
export async function runPermissionInventory(deps: PermissionInventoryDeps): Promise<string> {
  const lang = deps.lang ?? 'en';
  const w = WORDS[lang];
  const sections: PermissionSection[] = [
    // Always first in the array and always present. See the module comment.
    // Titled in words true of every source (the owner, 2026-10-14): it read
    // *Mailbox delegation (FullAccess, SendAs, SendOnBehalf)*, Exchange's
    // names, on a Gmail or an IMAP mailbox's report too. A Microsoft source's
    // reason still names them, where they are its own.
    {
      title: w.delegation,
      listing: { kind: 'not_discoverable', reason: deps.delegationReason },
    },
  ];

  sections.push(await section(w.calendars, deps.scanCalendars, deps.error, lang));
  sections.push(await section(w.drive, deps.scanDrive, deps.error, lang));

  let targetConduct: readonly string[] = [];
  if (deps.measureTargetConduct) {
    try {
      targetConduct = await deps.measureTargetConduct();
    } catch (err) {
      deps.error?.('[permissions] the target conduct could not be measured', err);
      // The run-#6 rule again: a measurement that failed is stated as
      // unmeasured, never dropped — dropped reads as "nothing to say".
      targetConduct = [w.conductUnmeasured(err instanceof Error ? err.message : String(err))];
    }
  }

  return renderPermissionReport({
    sections,
    ...(targetConduct.length > 0 ? { targetConduct } : {}),
    ...(deps.mappingLabel ? { mappingLabel: deps.mappingLabel } : {}),
    ...(deps.generatedOn ? { generatedOn: deps.generatedOn } : {}),
    lang,
  });
}

/**
 * Run one scan, turning both an absent dep and a thrown error into a stated
 * blind spot. A category that silently vanished from the report would be
 * indistinguishable from one that came back empty.
 */
async function section(
  title: string,
  scan: (() => Promise<PermissionListing>) | undefined,
  onError: PermissionInventoryDeps['error'],
  lang: ReportLanguage,
): Promise<PermissionSection> {
  if (!scan) {
    return { title, listing: { kind: 'not_discoverable', reason: WORDS[lang].noReader } };
  }
  try {
    return { title, listing: await scan() };
  } catch (err) {
    onError?.(`[permissions] ${title} could not be inventoried`, err);
    return {
      title,
      listing: {
        kind: 'not_discoverable',
        reason: WORDS[lang].scanFailed(err instanceof Error ? err.message : String(err)),
      },
    };
  }
}
