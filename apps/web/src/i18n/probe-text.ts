// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A probe result in the reader's language — except the half that is not ours
 * (workplan 0080; 0068 T10d asked for exactly this).
 *
 * The owner met *Connected. 12 folders visible.* in a Dutch UI and reported
 * it. The naive fix — translate the probe result — is wrong, and the reason
 * is the whole design: half of what a probe returns is the PROVIDER's. When
 * Dropbox answers `invalid_client`, that string is the one you paste into
 * their console, and a Dutch rendering of it would be a Dutch rendering of
 * somebody else's identifier (rule 9, `docs/i18n-prose-boundary.md`).
 *
 * So the probe now says whose words these are, as a code plus data, and this
 * is where that gets read: our codes become dictionary sentences, and
 * `providerRefused` falls through to the verbatim text. A result with no
 * outcome at all — an older API, a cached response — also falls through, so
 * this can never render less than what arrived.
 *
 * `credentialsRefused` (workplan 0083) is the case that was on the wrong side
 * of that line: *dropbox source: clientId … are not set* reads like a
 * provider's error and is not one — we wrote it — so it was rendering verbatim
 * in a Dutch UI under a rule meant for somebody else's strings.
 */

import {
  refusalText,
  DOMAIN_FOR_QUALIFICATION_KEY,
  QUALIFICATION_KEYS,
  type ProbeOutcome,
  type ProbeUnit,
  type QualificationKey,
  type QualificationReason,
  type RefusalLocale,
  reasonEarnsASentence,
} from '@openmig/shared';
import type { StringKey } from './strings.ts';
import { DOMAIN_STRING_KEY } from './domain-words.ts';
import { formatBytes } from './bytes.ts';

type Translate = (key: StringKey, vars?: Readonly<Record<string, string | number>>) => string;

/**
 * One face of a stored qualification record, as the three functions below
 * read it. `volume` is absent from the capability line's own reading and
 * present in the other two; typed together because they are one row.
 */
interface QualifiedFace {
  readonly answer: 'yes' | 'no' | 'unknown';
  readonly reason?: QualificationReason;
  readonly detail?: string;
  readonly count?: number;
  readonly unit?: ProbeUnit;
  readonly volume?: {
    readonly items?: number;
    readonly bytes?: number;
    readonly estimated?: boolean;
    readonly nativeFilesExcluded?: boolean;
    readonly unreadable?: number;
    readonly failed?: string;
  };
}

/**
 * A stored record's faces — PARTIAL, and that is the contract rather than a
 * looseness.
 *
 * Every qualification written before 2026-09-03 has four faces, because that
 * is how many there were; the browser reads those rows for as long as their
 * connections go untested (workplan 0113 T5). A total `Record` would have had
 * this code walk five keys over four-key JSON and throw on the first old row
 * — the fifth-domain failure this workplan exists to stop, landing in the one
 * layer with no compiler to catch it, since the record arrives over the wire.
 */
type QualifiedDomains = Partial<Record<QualificationKey, QualifiedFace>>;

/**
 * The word for one face. The record says `mail` where the rest of the product
 * says `email`; shared owns that mapping and `DOMAIN_STRING_KEY` owns the
 * word. The three functions below kept a label map each until T5 — three
 * copies of four domains, which is how a fifth face reached the record while
 * every line on screen still listed four.
 */
function faceLabel(face: QualificationKey): StringKey {
  return DOMAIN_STRING_KEY[DOMAIN_FOR_QUALIFICATION_KEY[face]];
}

/**
 * A FACE THE RECORD DOES NOT MENTION IS UNMEASURED, not missing.
 *
 * `?`, not omission and not a no: shared's `qualifiedAnswerFor` already says
 * a face with no well-formed answer must be treated exactly like `unknown`,
 * and one rule read the same way at every door is why it was written down
 * once. The line then carries the unmeasured hint, and the remedy is the Test
 * button the reader is already looking at.
 */
const UNMEASURED_FACE: QualifiedFace = { answer: 'unknown', detail: '' };

function faceOf(domains: QualifiedDomains, face: QualificationKey): QualifiedFace {
  return domains[face] ?? UNMEASURED_FACE;
}

/** The counted noun, in the right number. */
function unitWord(t: Translate, unit: ProbeUnit, count: number): string {
  const suffix = count === 1 ? 'one' : 'many';
  return t(`probe.unit.${unit}.${suffix}` as StringKey);
}

/**
 * The sentence to show for a probe result.
 *
 * `fallback` is the server's own English (`detail` or `reason`) and is what
 * comes back whenever the outcome is the provider's or is missing — never a
 * blank, and never a worse sentence than the one that arrived.
 */
export function probeText(
  t: Translate,
  outcome: ProbeOutcome | undefined,
  fallback: string,
  locale: RefusalLocale = 'en',
): string {
  if (!outcome) return fallback;
  switch (outcome.code) {
    case 'connected':
      // A count that stopped at the listing's cap is a floor, and says so.
      return t(outcome.floor ? 'probe.connected.floor' : 'probe.connected', {
        count: outcome.count,
        unit: unitWord(t, outcome.unit, outcome.count),
      });
    case 'connectedSession':
      return t('probe.connectedSession');
    case 'targetStatus':
      return `${t('probe.targetStatus', { url: outcome.url, status: outcome.status })} ${
        outcome.status === 401 ? t('probe.targetStatus.refused') : t('probe.targetStatus.check')
      }`;
    case 'noProbe':
      return t('probe.noProbe', { kind: outcome.kind });
    case 'timedOut':
      // Ours: unknown, not refused — the credentials may be fine.
      return t('probe.timedOut', { seconds: outcome.seconds });
    case 'credentialsRefused':
      // OURS, so it gets translated — the opposite of the case below, and the
      // distinction the outcome exists to carry. The field names inside the
      // sentence are still verbatim in both languages: they are the literal
      // thing the operator has to go and set (workplan 0083).
      return refusalText(outcome.refusal, locale);
    case 'providerRefused':
      // Theirs. Verbatim, always — this is the string somebody pastes into a
      // provider's console, and the only thing translating it could do is
      // make it useless.
      return fallback;
    default:
      return fallback;
  }
}

/**
 * The scheduling verdict a DAV target's probe carries (0105 T0), in the
 * reader's language. The capability is OURS — a closed code measured by one
 * OPTIONS request — so it gets dictionary sentences; a code this build does
 * not know falls back to the server's own English `sentence`, never a blank.
 * Returns null when the probe carried no verdict (a source, a mail target,
 * an older API), so callers can render nothing at all.
 */
export function schedulingText(
  t: Translate,
  scheduling: { capability: string; sentence: string } | undefined,
): string | null {
  if (!scheduling) return null;
  switch (scheduling.capability) {
    case 'auto-schedule':
      return t('probe.scheduling.autoSchedule');
    case 'none':
      return t('probe.scheduling.none');
    case 'unknown':
      return t('probe.scheduling.unknown');
    default:
      return scheduling.sentence;
  }
}

/**
 * WHAT THIS CONNECTION CARRIES — the names, and nothing else (2026-09-07).
 *
 * This line used to mark every face the record mentions: *Email ? · Calendar
 * ✓ 1 calendar · Contacts ✓ 1 address book · Files ✓ 4 folders · Tasks ✓ 0
 * task lists — '?' is unmeasured*. Five faces, three marks, two units and a
 * disclaimer, to say that a Nextcloud carries four things.
 *
 * The owner read that on his own card and asked for the obvious: **list what
 * it carries.** A face that is not a `yes` is not a capability, and marking
 * its absence costs a reader more than it tells them — the more domains this
 * product supports, the longer the line of things a connection is not.
 *
 * So the marks are gone with the faces they marked. `✓` is implied by being
 * on the line at all, and the counts moved off it (see `measuredText`) so
 * that "what" and "how much" are one question each rather than one and a
 * half. What is NOT on the line is explained underneath, but only where a
 * person can act on it — `qualificationEvidence` owns that judgement.
 *
 * Returns null when nothing was measured as carried, so a caller renders no
 * empty lead; the evidence lines still speak, and a record that never
 * qualified says so through `probe.qualify.none`.
 */
export function qualificationText(
  t: Translate,
  qualification:
    | { domains: QualifiedDomains }
    | undefined,
): string | null {
  if (!qualification) return null;
  const carried = QUALIFICATION_KEYS.filter(
    (domain) => faceOf(qualification.domains, domain).answer === 'yes',
  );
  if (carried.length === 0) return null;
  return `${t('probe.qualify.lead')} ${carried.map((d) => t(faceLabel(d))).join(' · ')}`;
}

/**
 * THE SENTENCES A PERSON CAN ACT ON, and only those (2026-09-07).
 *
 * Every unmeasured face used to get a line here. That was right when `?` meant
 * one thing — Google's own words naming an API to switch on, which the owner
 * needed on a phone that has no hover. It stopped being right when the same
 * mark started covering faces nobody ever asked about: a Nextcloud target
 * explaining, in three lines above the fold, that it carries no mail server
 * address.
 *
 * `reasonEarnsASentence` decides, in shared, so this screen and the wizard and
 * the appliance's report cannot form three opinions about one record. What
 * survives is `refused` (we asked, something said no, the words are the
 * remedy) and `incomplete` (a field is missing and the sentence names it).
 * What goes silent is `structural` (a Dropbox is not a calendar), `notAskable`
 * (this row has no such face to ask about) and `notGranted` — the last on the
 * owner's instruction, and sound because the consent door will not store a
 * partial grant, so an ungranted face is one nobody ticked.
 *
 * A failed MEASURE still speaks regardless of any of that: the face answered,
 * so it is on the carry line, and the number beside it is missing for a reason
 * worth one sentence.
 */
export function qualificationEvidence(
  t: Translate,
  qualification:
    | { domains: QualifiedDomains }
    | undefined,
): string[] {
  if (!qualification) return [];
  const lines: string[] = [];
  for (const domain of QUALIFICATION_KEYS) {
    const d = faceOf(qualification.domains, domain);
    // A face that answered needs no explanation for not answering; only its
    // measure can still have failed, which the second arm covers.
    if (d.answer !== 'yes' && d.detail && reasonEarnsASentence(d.reason)) {
      lines.push(`${t(faceLabel(domain))}: ${d.detail}`);
    } else if (d.volume?.failed) {
      lines.push(`${t(faceLabel(domain))} — ${t('probe.measured.failed')}: ${d.volume.failed}`);
    }
  }
  return lines;
}

type Measured = { domains: QualifiedDomains };

/**
 * HOW MUCH EACH CARRIED FACE HOLDS — collections and volume on one line
 * (2026-09-07, replacing the split that shipped 2026-09-02).
 *
 * The counts used to live on the capability line — *Calendar ✓ 1 calendar* —
 * and the volumes on their own line below it. That put two kinds of number in
 * two places for no reason a reader could see: the collection count was
 * EVIDENCE that the tick was real, which is a fine thing for it to be and not
 * a thing anybody reads it as. On screen it is a quantity, and quantities
 * belong together.
 *
 * So the capability line answers "what", this one answers "how much", and a
 * face appears here once with everything known about it: *Files 4 folders,
 * 3.8 GB*. Only carried faces appear — a face that is not a `yes` has no
 * quantity to report and is not on the line above either.
 *
 * A face that answered with NOTHING says so in words. "Tasks ✓ 0 task lists"
 * read as a contradiction and was not one: zero collections is a real answer
 * and the protocol works. `Tasks none` keeps the fact and drops the argument.
 *
 * Counts are formatted for the reader's locale; an extrapolated byte figure
 * carries ≈ and an exact one does not, because the difference is the honesty
 * of the number.
 */
export function measuredText(
  t: Translate,
  qualification: Measured | undefined,
  locale: RefusalLocale = 'en',
): string | null {
  if (!qualification) return null;
  const numberFormat = new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB');
  const parts: string[] = [];
  for (const domain of QUALIFICATION_KEYS) {
    const face = faceOf(qualification.domains, domain);
    if (face.answer !== 'yes') continue;
    const bits: string[] = [];
    // WHAT THE PROTOCOL ANSWERED WITH, first: the collections are the coarse
    // shape of the account, and the volume the fill inside it.
    if (face.count !== undefined && face.unit) {
      bits.push(
        face.count === 0
          ? t('probe.found.none')
          : `${numberFormat.format(face.count)} ${unitWord(t, face.unit, face.count)}`,
      );
    }
    const v = face.volume;
    if (v && !v.failed) {
      if (v.items !== undefined) {
        const key: StringKey =
          domain === 'mail'
            ? v.items === 1
              ? 'probe.measured.message.one'
              : 'probe.measured.message.many'
            : domain === 'contact'
              ? v.items === 1
                ? 'probe.measured.card.one'
                : 'probe.measured.card.many'
              : v.items === 1
                ? 'probe.measured.item.one'
                : 'probe.measured.item.many';
        bits.push(t(key, { count: numberFormat.format(v.items) }));
      }
      if (v.bytes !== undefined) {
        bits.push(`${v.estimated ? '≈ ' : ''}${formatBytes(v.bytes)}`);
      }
      if (v.nativeFilesExcluded) bits.push(`(${t('probe.measured.driveNote')})`);
      // BESIDE THE COUNT, NOT INSTEAD OF IT (2026-09-07). "0 cards" and "0
      // cards, 25 could not be read" are different facts, and the owner read
      // the first on a live account without being able to tell which it was.
      if (v.unreadable !== undefined && v.unreadable > 0) {
        bits.push(
          t(
            v.unreadable === 1
              ? 'probe.measured.unreadable.one'
              : 'probe.measured.unreadable.many',
            { count: numberFormat.format(v.unreadable) },
          ),
        );
      }
    }
    if (bits.length > 0) parts.push(`${t(faceLabel(domain))} ${bits.join(', ')}`);
  }
  if (parts.length === 0) return null;
  return `${t('probe.measured.lead')} ${parts.join(' · ')}`;
}
