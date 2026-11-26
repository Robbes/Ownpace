// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The owner's link surface for one migration (workplan 0108 T3, 0122 T5).
 *
 * ADR-0035 in one screen: *"the owner decides who gets a link to manage and
 * grant their own migration"*, and **the owner distributes it — we never do.**
 * There is no address field on this panel, deliberately. Ownpace never learns
 * who the link went to, which means Ownpace cannot leak it, and the person
 * deciding who gets access already knows who they are.
 *
 * ## Two sections, because the link has two lifetimes
 *
 * The ADR gives the same mechanism two jobs with two risks: *supply the
 * credential*, once and briefly, and *be their page afterwards*, for as long as
 * the migration lasts. Until workplan 0122 only the first existed, and the
 * consequence was already latent here: `listMappingLinks` has never filtered by
 * purpose, so the moment a progress link existed it would have appeared in this
 * list wearing the credential list's words — "Access was granted on…", "this
 * link is spent" — about a link that grants nothing and is never spent.
 *
 * So the sections are separate and the machinery is one `LinkSection`. Revoking
 * in particular is deliberately identical: revoking a door is one action
 * whichever room it opens, and giving the two purposes two kill switches would
 * be two things to get right in a hurry.
 *
 * ## Three things this panel is careful about
 *
 * **The URL exists once.** It lives in component state until the owner
 * navigates away, and there is nowhere else it could come from — the server
 * holds a sha256. So it is shown large, with the copy button beside it and the
 * expiry stated in the same breath, rather than tucked into a toast that
 * disappears while somebody is reaching for the mouse.
 *
 * **An expired link is not greyed away.** Every other ending on these screens
 * fades; this one does not. A link only reads `expired` when it was never used
 * — somebody was asked to do their part and never got there — so it is the one
 * row on the panel that wants an action, and the action (issue another) is put
 * beside it rather than left to be inferred. A progress link that expired says
 * something different, because nobody failed to do anything: their page simply
 * stopped working.
 *
 * ## One link per person (ADR-0035, amended 2026-09-29; the owner, 2026-10-03)
 *
 * A link is the person's now, made on their page for all of their migrations
 * (`PersonGrantLinkSection`, `PersonViewLinkSection`). A migration's page makes
 * none: it says whose page makes them, or, for a migration that belongs to
 * nobody, asks *Who is this for?* first. The links a migration was given
 * before are honoured until they expire, so its page still lists them, by the
 * same `LinkSection` with no form, and still revokes them.
 *
 * **A refusal is the server's sentence, verbatim.** ADR-0024's prose boundary:
 * the ways a link cannot be issued each name what to configure, and re-writing
 * them here in two languages would be two more places for that advice to go
 * stale. The states — live/used/revoked/expired — are the client's to word, and
 * go through `StateChip` like every other enum.
 */

import React from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, KeyRound, Eye } from 'lucide-react';
import type { Person } from '@openmig/shared';
import { isSelfHost } from '../services/edition.ts';
import { addMigrationToPerson, createPerson, fetchPeople } from '../services/operating-service.ts';
import { serverMessage } from '../services/api.ts';
import { conditionsRefusal } from '../services/acceptance.ts';
import {
  LINK_LIFETIMES,
  grantLinkApi,
  personLinkApi,
  type GrantLink,
  type IssuedGrantLink,
  type MappingLinkPurpose,
} from '../services/grant-link-service.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';
import type { StringKey } from '../i18n/index.tsx';
import StateChip from './StateChip.tsx';
import {
  PERSON_VOICES,
  SENDER_RELATIONS,
  isSenderRelation,
  languageOf,
  registerOf,
  type PersonVoice,
  type SenderRelation,
} from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';
import { NL_JE } from '../i18n/informal.ts';
import { fill } from '../i18n/fill.ts';
import { formatDateTime, formatList } from '../i18n/datetime.ts';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { memberApi } from '../services/mapping-service.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { testerGuideSectionUrl } from '../services/tester-guide-link.ts';
import { isAlpha } from './AlphaNote.tsx';
import { providerName } from './ProviderTile.tsx';

/**
 * What `created_by` says when the grant ending minted the link itself
 * (workplan 0122 T7). Not a user id, because there was no user: the person
 * finishing a consent has no account and never will. Kept in step with
 * `grant-ending.ts`'s `mintProgressLink`, which writes it.
 */
const MINTED_AT_GRANT = 'granted-by-link';

/** One key per offered lifetime, so a translator can say "1 day" properly. */
const EXPIRY_LABEL: Record<number, StringKey> = {
  1: 'grantLink.expiry.1',
  7: 'grantLink.expiry.7',
  30: 'grantLink.expiry.30',
  90: 'grantLink.expiry.90',
  180: 'grantLink.expiry.180',
};

/**
 * The words that differ between the two lifetimes.
 *
 * A total `Record<MappingLinkPurpose, …>`, so a third purpose cannot reach this
 * panel without somebody writing its sentences — the same shape the API's
 * `MAPPING_LINK_LIFETIMES` uses, for the same reason. Everything absent from
 * here is shared on purpose: an expiry label, a copy button and a revoke button
 * mean the same thing in both sections.
 */
const WORDS: Record<
  MappingLinkPurpose,
  {
    title: StringKey;
    blurb: StringKey;
    why: StringKey;
    issue: StringKey;
    urlLabel: StringKey;
    empty: StringKey;
    expiredNudge: StringKey;
  }
> = {
  grant: {
    title: 'grantLink.title',
    blurb: 'grantLink.blurb',
    why: 'grantLink.why',
    issue: 'grantLink.issue',
    urlLabel: 'grantLink.issued.urlLabel',
    empty: 'grantLink.empty',
    expiredNudge: 'grantLink.expiredNudge',
  },
  view: {
    title: 'viewLink.title',
    blurb: 'viewLink.blurb',
    why: 'viewLink.why',
    issue: 'viewLink.issue',
    urlLabel: 'viewLink.issued.urlLabel',
    empty: 'viewLink.empty',
    expiredNudge: 'viewLink.expiredNudge',
  },
};

/**
 * Where a section's links live: a migration's (`/migrations/:id/links`) or a
 * person's (`/people/:id/links`, ADR-0035's amendment of 2026-09-29). The
 * section is the same machinery either way; only the doors differ. A
 * migration's doors make nothing since the person's link replaced its own
 * (the owner, 2026-10-03), so only a person's carry `issue`.
 */
interface LinkDoors {
  readonly queryKey: readonly unknown[];
  readonly issue?: (purpose: MappingLinkPurpose, expiryDays: number) => Promise<IssuedGrantLink>;
  revoke(linkId: string): Promise<void>;
}

const migrationDoors = (mappingId: string): LinkDoors => ({
  queryKey: ['grant-links', mappingId],
  revoke: (linkId) => grantLinkApi.revoke(mappingId, linkId),
});

const personDoors = (personId: string): LinkDoors => ({
  queryKey: ['person-links', personId],
  issue: (purpose, expiryDays) => personLinkApi.issue(personId, purpose, expiryDays),
  revoke: (linkId) => personLinkApi.revoke(personId, linkId),
});

/**
 * A person's links say what they cover: the grant link all of their
 * accounts, once each; the progress link all of their migrations.
 */
const PERSON_WORDS: Record<MappingLinkPurpose, (typeof WORDS)[MappingLinkPurpose]> = {
  grant: { ...WORDS.grant, title: 'personLink.title', blurb: 'personLink.blurb', empty: 'personLink.empty' },
  view: {
    ...WORDS.view,
    title: 'personLink.view.title',
    blurb: 'personLink.view.blurb',
    empty: 'personLink.view.empty',
  },
};

/**
 * A migration's links sent before the person's replaced them (the owner,
 * 2026-10-03): listed and revocable until they expire, and never made again.
 */
const SENT_WORDS: Record<MappingLinkPurpose, (typeof WORDS)[MappingLinkPurpose]> = {
  grant: { ...WORDS.grant, title: 'migrationLinks.sent.grant', blurb: 'migrationLinks.sent.blurb', why: 'migrationLinks.sent.why' },
  view: { ...WORDS.view, title: 'migrationLinks.sent.view', blurb: 'migrationLinks.sent.blurb', why: 'migrationLinks.sent.why' },
};

const LinkSection: React.FC<{
  doors: LinkDoors;
  purpose: MappingLinkPurpose;
  links: GrantLink[] | undefined;
  loadFailed: boolean;
  words?: (typeof WORDS)[MappingLinkPurpose];
  /** The lifetime offered first, where it is not the purpose's own. */
  firstDays?: number;
  /** One line before the form: said where the link is made, before it is (0176 D13). */
  beforeForm?: React.ReactNode;
  /** Fields before the lifetime, and between it and the button (0176 T8). */
  fieldsBefore?: React.ReactNode;
  fieldsAfter?: React.ReactNode;
  /** Whether the button may be pressed: false until the form's own condition holds (0176 T8's tick). */
  ready?: boolean;
  /** Run before the link is made: a sentence it answers refuses it, and no link is made. */
  beforeIssue?: () => Promise<string | null>;
  /** What else goes with the link once it is made (0176 T8's message). */
  withIssued?: (issued: IssuedGrantLink) => React.ReactNode;
}> = ({
  doors,
  purpose,
  links,
  loadFailed,
  words: ownWords,
  firstDays,
  beforeForm,
  fieldsBefore,
  fieldsAfter,
  ready = true,
  beforeIssue,
  withIssued,
}) => {
  // Links that are only listed and revoked here, never made: a migration's
  // sent before the person's replaced them.
  const issuable = doors.issue !== undefined;
  const t = useT();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();
  const words = ownWords ?? WORDS[purpose];
  const lifetimes = LINK_LIFETIMES[purpose];

  const [expiryDays, setExpiryDays] = React.useState<number>(firstDays ?? lifetimes.fallback);
  const [issued, setIssued] = React.useState<IssuedGrantLink | null>(null);
  const [issueError, setIssueError] = React.useState('');
  const [issuing, setIssuing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [armedRevoke, setArmedRevoke] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doors.issue) return;
    setIssuing(true);
    setIssueError('');
    setCopied(false);
    try {
      const refused = beforeIssue ? await beforeIssue() : null;
      if (refused !== null) {
        setIssueError(refused);
        return;
      }
      const link = await doors.issue(purpose, expiryDays);
      setIssued(link);
      await queryClient.invalidateQueries({ queryKey: doors.queryKey });
    } catch (err) {
      // Verbatim. Every refusal this route answers with names what to
      // configure; a generic "could not create link" would throw that away.
      // But for the texts not accepted yet (0139 T3), whose sentence is ours
      // and so in the reader's language.
      setIssueError(conditionsRefusal(err, t) ?? serverMessage(err));
    } finally {
      setIssuing(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused by the browser (permission, an
      // insecure origin) and there is nothing to fix — the URL is already on
      // screen and selectable, which is why it is rendered in a real input
      // rather than only behind this button.
      setCopied(false);
    }
  };

  const revoke = async (link: GrantLink) => {
    // Armed, like every other destructive button in this app: the first click
    // relabels, the second acts. Revoking is not undoable — a revoked link
    // cannot be un-revoked, only replaced.
    if (armedRevoke !== link.id) {
      setArmedRevoke(link.id);
      return;
    }
    setArmedRevoke(null);
    setRowErrors((errors) => ({ ...errors, [link.id]: '' }));
    try {
      await doors.revoke(link.id);
      await queryClient.invalidateQueries({ queryKey: doors.queryKey });
    } catch (err) {
      setRowErrors((errors) => ({ ...errors, [link.id]: serverMessage(err) }));
    }
  };

  const mine = links?.filter((l) => l.purpose === purpose);

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-gray-900">{t(words.title)}</h3>
      <Hint className="mt-0.5" text={t(words.blurb)} why={t(words.why)} />

      {issuable && beforeForm}
      {issuable && (
      <form onSubmit={issue} className="mt-3 flex flex-wrap items-end gap-3">
        {fieldsBefore}
        <label className="flex flex-col text-sm text-gray-700">
          {t('grantLink.expiryLabel')}
          <select
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
          >
            {lifetimes.days.map((days) => (
              <option key={days} value={days}>
                {t(EXPIRY_LABEL[days]!)}
              </option>
            ))}
          </select>
        </label>
        {fieldsAfter}
        <button
          type="submit"
          disabled={issuing || !ready}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {purpose === 'grant' ? <KeyRound className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {issuing ? t('grantLink.issuing') : t(words.issue)}
        </button>
      </form>
      )}

      {issueError && <p className="mt-2 text-sm text-amber-800">{issueError}</p>}

      {issued && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm font-medium text-gray-900">{t('grantLink.issued.once')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={issued.url}
              aria-label={t(words.urlLabel)}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 bg-white"
            />
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('grantLink.copied') : t('grantLink.copy')}
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-700">
            {t('grantLink.issued.until', { date: dateTime(issued.expiresAt) })}
          </p>
          <p className="mt-1 text-sm text-gray-700">{t('grantLink.issued.youSend')}</p>
          {issued.asksAgain && <p className="mt-1 text-sm text-gray-700">{t('personLink.asksAgain')}</p>}
          {withIssued?.(issued)}
        </div>
      )}

      {loadFailed && <p className="mt-3 text-sm text-amber-800">{t('grantLink.loadError')}</p>}

      {mine && mine.length === 0 && <p className="mt-3 text-sm text-gray-600">{t(words.empty)}</p>}

      {mine && mine.length > 0 && (
        <ul className="mt-3 space-y-2">
          {mine.map((link) => (
            <li
              key={link.id}
              className={`p-3 rounded-lg border ${
                link.state === 'expired'
                  ? 'border-yellow-300 bg-yellow-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StateChip entity="link" state={link.state} />
                  <span className="text-sm text-gray-600">
                    {/* A link minted by the grant ending has no user behind it
                        — nobody was signed in (workplan 0122 T7). Rendering
                        `granted-by-link` through the ordinary "by {who}"
                        sentence would show the owner a colleague who does not
                        exist, so that one row says what actually happened. */}
                    {link.createdBy === MINTED_AT_GRANT
                      ? t('grantLink.issuedByGrant', { date: dateTime(link.createdAt) })
                      : t('grantLink.issuedBy', {
                          date: dateTime(link.createdAt),
                          who: link.createdBy,
                        })}
                  </span>
                </div>
                {link.state === 'live' && (
                  <button
                    type="button"
                    onClick={() => revoke(link)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                      armedRevoke === link.id
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'text-red-700 hover:bg-red-50'
                    }`}
                  >
                    {armedRevoke === link.id ? t('grantLink.revokeArmed') : t('grantLink.revoke')}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {link.state === 'used' && link.usedAt
                  ? t('grantLink.grantedOn', { date: dateTime(link.usedAt) })
                  : link.state === 'revoked' && link.revokedAt
                    ? t('grantLink.revokedOn', { date: dateTime(link.revokedAt) })
                    : link.state === 'expired'
                      ? t('grantLink.expiredOn', { date: dateTime(link.expiresAt) })
                      : t('grantLink.worksUntil', { date: dateTime(link.expiresAt) })}
              </p>
              {link.state === 'expired' && (
                <p className="mt-1 text-sm text-yellow-900">{t(words.expiredNudge)}</p>
              )}
              {rowErrors[link.id] && (
                <p className="mt-1 text-sm text-amber-800">{rowErrors[link.id]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/**
 * A person's grant link works thirty days unless the member chooses less
 * (workplan 0176 D13 (a), the owner, 2026-11-26): long enough for a person who
 * waits for a call, or for a weekend, before they open it. The choices stay
 * 1, 7 and 30; a migration's own link keeps seven.
 */
const PERSON_GRANT_LINK_DAYS = 30;

/**
 * Whether a source's kind or card is a Google account: the Alpha's lines
 * where a person's link is made are for Google only (0176 T8), as the
 * progress page groups Google's kinds (`View.tsx`).
 */
export const isGoogleKind = (kindOrCard: string): boolean => kindOrCard === 'gmail' || kindOrCard.startsWith('google');

/**
 * The order of the member's choices for who they are to the person (D7): the
 * glossary's, which is `SENDER_RELATIONS`'s, with *I would rather not say*
 * first, which is none.
 */
const RELATION_CHOICES: ReadonlyArray<SenderRelation | ''> = ['', ...SENDER_RELATIONS];

/** How the person knows the member, as this member chose it last for them: offered again. */
function lastRelationOf(links: readonly GrantLink[] | undefined, userId: string | undefined): SenderRelation | '' {
  if (!links || !userId) return '';
  const mine = links
    .filter((l) => l.createdBy === userId && isSenderRelation(l.relation))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const relation = mine[0]?.relation;
  return isSenderRelation(relation) ? relation : '';
}

/** How the page speaks to the person, in the member's words for each (§15). */
const VOICE_WORDS: Readonly<Record<PersonVoice, StringKey>> = {
  'nl-u': 'personLink.voice.dutchU',
  'nl-je': 'personLink.voice.dutchJe',
  en: 'personLink.voice.english',
};

/** A person's grant link's one page, which prints (D15 (a)): under the link page's own address. */
const sheetOf = (url: string): string => `${url.replace(/\/+$/, '')}/all`;

/**
 * THE MESSAGE TO SEND WITH THE LINK (workplan 0176 §12, §15): it names what
 * was said aloud (*This is the link I told you about*), what is copied and
 * where to, as the link asks it (`copies`), and until when, in the person's
 * language and register (§11): the voice the link was made with, so Dutch
 * with *je* for a person whose pages say *je* (the informal layer's twin),
 * whatever language the member's screen is in. The link goes under it. No
 * greeting is written for the member, and nothing hurries (R2). The member
 * may change it before sending; *Copy message* copies what is in the box.
 * Nothing is sent: the member sends it, through a channel the person already
 * trusts (ADR-0035). Beside it, a sheet to print for them: the link's one
 * page (D15 (a)).
 */
const MessageToSend: React.FC<{ issued: IssuedGrantLink; voice: PersonVoice; name: string }> = ({ issued, voice, name }) => {
  const t = useT();
  const id = React.useId();
  const copies = issued.copies;
  const spoken = issued.voice ?? voice;
  const language = languageOf(spoken) ?? 'en';
  const words = STRINGS[language];
  const informal = language === 'nl' && registerOf(spoken) === 'informal';
  const message = (informal ? NL_JE['message.toPerson'] : undefined) ?? words['message.toPerson'];
  const composed = copies
    ? `${fill(message, {
        what: formatList(
          copies.domains.map((d) => words[DOMAIN_STRING_KEY[d]].toLocaleLowerCase(language)),
          language,
        ),
        destination: formatList(
          copies.to.map((kind) => providerName(kind, 'target', language)),
          language,
        ),
        date: formatDateTime(issued.expiresAt, language),
      })}\n\n${issued.url}`
    : null;
  const [text, setText] = React.useState(composed ?? '');
  const [copied, setCopied] = React.useState(false);
  if (composed === null) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Refused by the browser: the message is on screen and selectable.
      setCopied(false);
    }
  };
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        {t('personLink.message.label')}
      </label>
      <p id={`${id}-hint`} className="text-xs text-gray-600">
        {t('personLink.message.hint')}
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-hint`}
        value={text}
        rows={7}
        onChange={(e) => {
          setText(e.target.value);
          setCopied(false);
        }}
        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
      />
      <button
        type="button"
        onClick={copy}
        className="mt-2 flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? t('personLink.message.copied') : t('personLink.message.copy')}
      </button>
      <p className="mt-2 text-sm">
        <a
          href={sheetOf(issued.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
        >
          {t('personLink.print', { name })}
          <span className="sr-only"> {t('common.newTab')}</span>
        </a>
      </p>
    </div>
  );
};

/**
 * A PERSON'S grant link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)):
 * one link for all of their migrations, on their page and on *Start a
 * migration*'s last screen.
 *
 * MADE AFTER TELLING THEM (workplan 0176 §12, T8). The person's first screen
 * asks whether the sender told them about the link themselves, so the form
 * holds that moment, when it can still be acted on:
 *
 * - step A's line (D13 (a)), and a tick before the button: *I have told
 *   {name} that a link is coming: by phone, or in person.* It cannot be
 *   checked; it is a prompt, and the button waits for it;
 * - who the member is to them, from the fixed list (D7, T3), offered again as
 *   this member chose it last for this person;
 * - the member's name, as the person knows them, asked here once: only while
 *   they have given none, and saved for them before the link is made
 *   (`PUT …/members/me`); Team holds it afterwards;
 * - during the Alpha, where the link asks a Google account: that the address
 *   must be on Google's list of test users first, with the tester guide's
 *   part for a family member's link, and that the Google step is best done
 *   together (*"Yes, preferably"*);
 * - how the page speaks to them (§11, T7, D8): Dutch with *u*, Dutch with
 *   *je*, or English, offered as it was chosen for this person, else in the
 *   member's own language with *u*; kept with the person once the link is
 *   made. With *je*, one line gives the privacy text's rule for a child under
 *   16 (§12); nobody's age is asked;
 * - thirty days first (D13 (a)), the choices 1, 7 and 30;
 * - with the link, a message to send in the person's voice, and a sheet to
 *   print for them (`MessageToSend`).
 */
export const PersonGrantLinkSection: React.FC<{
  personId: string;
  /** How the member's screens name the person, in the line before the form. */
  personName: string;
  links: GrantLink[] | undefined;
  loadFailed: boolean;
  /** Whether the link asks a Google account, for the Alpha's two lines. */
  asksGoogle?: boolean;
  /** How the person's pages speak to them, as chosen before (T7); null when never. */
  personVoice?: PersonVoice | null;
}> = ({ personId, personName, asksGoogle = false, personVoice = null, ...props }) => {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const { user, tenantId } = useAuthStore();
  const fieldId = React.useId();
  const name = personName;

  // Your own row, for whether your name is still to be asked (0176 T3).
  const members = useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => memberApi.list(tenantId as string),
    enabled: Boolean(tenantId) && !isSelfHost(),
    retry: false,
  });
  const me = members.data?.find((m) => m.userId === user?.id);
  const asksName = me !== undefined && !me.displayName;

  const [relation, setRelation] = React.useState<SenderRelation | '' | null>(null);
  const chosen = relation ?? lastRelationOf(props.links, user?.id);
  const [yourName, setYourName] = React.useState('');
  const [told, setTold] = React.useState(false);
  // As chosen for this person before, else your own language with u (§11).
  const [voice, setVoice] = React.useState<PersonVoice | null>(null);
  const spoken: PersonVoice = voice ?? personVoice ?? (locale === 'nl' ? 'nl-u' : 'en');

  const doors: LinkDoors = {
    ...personDoors(personId),
    issue: (purpose, expiryDays) =>
      personLinkApi.issue(personId, purpose, expiryDays, { relation: chosen === '' ? null : chosen, voice: spoken }),
  };

  // Your name, before the link that shows it is made: a refusal makes no link.
  const beforeIssue = async (): Promise<string | null> => {
    const typed = yourName.trim();
    if (!asksName || typed === '' || !tenantId) return null;
    try {
      await memberApi.setMine(tenantId, { displayName: typed });
      await queryClient.invalidateQueries({ queryKey: ['members', tenantId] });
      return null;
    } catch (err) {
      const code = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      return code === 'sender_name_refused' ? t('tenants.sender.name.refused') : serverMessage(err);
    }
  };

  const fieldsBefore = (
    <>
      {asksName && (
        <div className="flex w-full flex-col text-sm text-gray-700">
          <label htmlFor={`${fieldId}-name`}>{t('personLink.name.label', { name })}</label>
          <p id={`${fieldId}-name-hint`} className="text-xs text-gray-600">
            {t('personLink.name.hint', { name })}
          </p>
          <input
            id={`${fieldId}-name`}
            aria-describedby={`${fieldId}-name-hint`}
            autoComplete="name"
            maxLength={60}
            value={yourName}
            onChange={(e) => setYourName(e.target.value)}
            className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 w-72 max-w-full"
          />
        </div>
      )}
      <div className="flex w-full flex-col text-sm text-gray-700">
        <label htmlFor={`${fieldId}-relation`}>{t('personLink.relation.label', { name })}</label>
        <p id={`${fieldId}-relation-hint`} className="text-xs text-gray-600">
          {t('personLink.relation.hint')}
        </p>
        <select
          id={`${fieldId}-relation`}
          aria-describedby={`${fieldId}-relation-hint`}
          value={chosen}
          onChange={(e) => setRelation(e.target.value === '' ? '' : (e.target.value as SenderRelation))}
          className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white w-72 max-w-full"
        >
          {RELATION_CHOICES.map((r) => (
            <option key={r || 'none'} value={r}>
              {t((r === '' ? 'personLink.relation.none' : `personLink.relation.${r}`) as StringKey, { name })}
            </option>
          ))}
        </select>
      </div>
      <div className="flex w-full flex-col text-sm text-gray-700">
        <label htmlFor={`${fieldId}-voice`}>{t('personLink.voice.label', { name })}</label>
        <select
          id={`${fieldId}-voice`}
          value={spoken}
          onChange={(e) => setVoice(e.target.value as PersonVoice)}
          className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white w-72 max-w-full"
        >
          {PERSON_VOICES.map((v) => (
            <option key={v} value={v}>
              {t(VOICE_WORDS[v])}
            </option>
          ))}
        </select>
        {spoken === 'nl-je' && (
          <p role="note" className="mt-1 text-sm text-gray-900">
            {t('personLink.voice.child', { name })}
          </p>
        )}
      </div>
    </>
  );

  const fieldsAfter = (
    <>
      {isAlpha() && asksGoogle && (
        <div className="w-full space-y-1">
          <p role="note" className="text-sm text-gray-900">
            {t('personLink.alpha.testUsers', { name })}{' '}
            <a
              href={testerGuideSectionUrl(locale, 'familyLink')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              {t('personLink.alpha.guide')}
              <span className="sr-only"> {t('common.newTab')}</span>
            </a>
          </p>
          <p className="text-sm text-gray-900">{t('personLink.together')}</p>
        </div>
      )}
      <label className="flex w-full items-start gap-2 text-sm text-gray-900">
        <input type="checkbox" checked={told} onChange={(e) => setTold(e.target.checked)} className="mt-0.5" />
        <span>{t('personLink.told', { name })}</span>
      </label>
    </>
  );

  return (
    <LinkSection
      {...props}
      doors={doors}
      purpose="grant"
      words={PERSON_WORDS.grant}
      firstDays={PERSON_GRANT_LINK_DAYS}
      beforeForm={<p className="mt-3 text-sm text-gray-900">{t('personLink.tellFirst', { name })}</p>}
      fieldsBefore={fieldsBefore}
      fieldsAfter={fieldsAfter}
      ready={told}
      beforeIssue={beforeIssue}
      withIssued={(issued) => <MessageToSend key={issued.id} issued={issued} voice={spoken} name={name} />}
    />
  );
};

/**
 * A PERSON'S progress link (slice 3): one page for all of their migrations,
 * where they can also take back what they granted, per account. The grant
 * ending hands one over by itself; this is the owner's way to make another.
 */
export const PersonViewLinkSection: React.FC<{
  personId: string;
  links: GrantLink[] | undefined;
  loadFailed: boolean;
}> = ({ personId, ...props }) => (
  <LinkSection {...props} doors={personDoors(personId)} purpose="view" words={PERSON_WORDS.view} />
);

/**
 * For a migration that belongs to nobody: who it is for. That gives it a
 * person, whose page makes its links (ADR-0035's amendment: *"a migration with
 * no person gets one first"*). Somebody already on the Migrations page, or
 * somebody new, named here.
 */
const WhoIsThisFor: React.FC<{ mappingId: string; people: readonly Person[] }> = ({ mappingId, people }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const chooseId = React.useId();
  const nameId = React.useId();
  /** The choice that is somebody new: not an id, which is a uuid. */
  const NEW = 'new';
  // Nobody is preset (UX sweep, 2026-10-17): the first person in the list was,
  // so one press gave a shared mailbox to whoever that happened to be.
  const [choice, setChoice] = React.useState(people.length > 0 ? '' : NEW);
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFailed(null);
    try {
      const personId =
        choice === NEW ? (await createPerson({ displayName: name.trim(), email: null })).id : choice;
      await addMigrationToPerson(personId, mappingId);
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    } catch (error) {
      setFailed(serverMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-2">
      <p className="text-sm text-gray-700">{t('migrationLinks.whoFor.why')}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col text-gray-700">
          <label htmlFor={chooseId}>{t('migrationLinks.whoFor')}</label>
          <select
            id={chooseId}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
          >
            <option value="" disabled>
              {t('migrationLinks.whoFor.choose')}
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
            <option value={NEW}>{t('start.who.someoneNew')}</option>
          </select>
        </div>
        {choice === NEW && (
          <div className="flex flex-col text-gray-700">
            <label htmlFor={nameId}>{t('people.new.name')}</label>
            <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} className="input mt-1" />
          </div>
        )}
        <button
          type="submit"
          disabled={pending || choice === '' || (choice === NEW && name.trim() === '')}
          className="px-3 py-2 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t('migrationLinks.whoFor.save')}
        </button>
      </div>
      {failed !== null && <p className="mt-2 text-sm text-amber-800">{failed}</p>}
    </form>
  );
};

const MappingLinksPanel: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const t = useT();
  const selfHost = isSelfHost();
  const links = useQuery({
    queryKey: ['grant-links', mappingId],
    queryFn: () => grantLinkApi.list(mappingId),
    enabled: !selfHost,
    retry: false,
  });
  // Whose migration this is: the Migrations page's own read, so the two agree.
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, enabled: !selfHost, retry: false });

  // The appliance's ledger carries the table (the migration is shared), but its
  // API does not serve these routes — 0108 T3 built the managed half. Showing a
  // button that 404s would be worse than showing nothing, and claiming the
  // feature is managed-only would be worse still, because it is not: it is
  // unbuilt there.
  if (selfHost) return null;

  const named = people.data?.people.filter((p) => !p.implicit) ?? [];
  const person = named.find((p) => p.migrations.some((m) => m.id === mappingId));
  const has = (purpose: MappingLinkPurpose) => links.data?.some((l) => l.purpose === purpose) ?? false;

  return (
    <>
      <section className="mt-8" aria-labelledby={`links-${mappingId}`}>
        <h3 id={`links-${mappingId}`} className="text-base font-semibold text-gray-900">
          {t('migrationLinks.title')}
        </h3>
        {person ? (
          <p className="mt-1 text-sm text-gray-700">
            {t('migrationLinks.perPerson', { name: person.displayName ?? '' })}{' '}
            <Link to={`/people/${person.id}`} className="text-blue-700 underline">
              {t('migrationLinks.openPerson', { name: person.displayName ?? '' })}
            </Link>
          </p>
        ) : people.data ? (
          <WhoIsThisFor mappingId={mappingId} people={named} />
        ) : people.isError ? (
          <p className="mt-1 text-sm text-amber-800">{t('migrationLinks.peopleFailed')}</p>
        ) : null}
        {links.error != null && <p className="mt-3 text-sm text-amber-800">{t('grantLink.loadError')}</p>}
      </section>
      {/* The links this migration was given before the person's replaced
          them: honoured until they expire, so listed and revocable, and never
          made again. ONE query for both, as before: two could disagree about a
          link revoked between them. */}
      {(['grant', 'view'] as const).filter(has).map((purpose) => (
        <LinkSection
          key={purpose}
          doors={migrationDoors(mappingId)}
          purpose={purpose}
          links={links.data}
          loadFailed={false}
          words={SENT_WORDS[purpose]}
        />
      ))}
    </>
  );
};

export default MappingLinksPanel;
