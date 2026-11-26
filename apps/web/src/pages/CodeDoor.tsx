// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE DOOR OF A CODE, `/code` (workplan 0177 T1, §5; the owner's D6, D9,
 * D13 to D16).
 *
 * A member recommends somebody they know with a code, on a card or in a link,
 * and since the owner's D6 the code lets that person in at once: *"The free
 * giving is limited in alpha to 1, so one needs to be allow in straight
 * away."* The reader has no account, did not ask for this, and may be older.
 * So the door asks only what letting them in needs, one thing at a time (R4),
 * and says what happens next (R6):
 *
 * 1. **The code, alone** (`POST /api/gifts/check`). No address is asked yet,
 *    so a mistyped code costs nothing and sends nothing about the person. A
 *    refused code is mended where it was typed: a heading above the same
 *    field, tied to it and announced, with the server's sentence in the
 *    page's language and the page's own line. A code after a `#` (the link,
 *    D2) fills the field; the reader still presses the button.
 * 2. **What this is, and one question**: did the person you got the code from
 *    tell you about this themselves? *No, not yet* and *No, I do not want
 *    this* end calmly. The answer is neither sent nor stored: it is there for
 *    the reader who was not told (R2, R5).
 * 3. **The address**, a name that may be left empty, and one question about
 *    Google (D14) (`POST /api/gifts/redeem`). The address is shown back before
 *    the button, with the sentence that the code is used by this step.
 *
 * Then *You are in*, with *Create your account*: the sign-in page with the
 * address filled in, as the yes mail's link opens it
 * (`registrationLink` in `@openmig/shared`).
 *
 * Every refusal is the server's sentence, in the page's language
 * (`refusalSaid`). Three answers keep the code: a code that
 * stopped working since step 1 (refused as there, back at step 1, in its
 * field); an address that already has access (said, with the way to sign
 * in); and a full Alpha (§20.3), a calm screen with the code's last day and
 * one button that goes back.
 *
 * ## What it does not show (D13, R5)
 *
 * No welcome of the Alpha: the yes mail carries the owner's. No link to sign
 * in before the person is in, and no sentence that says whose page this is:
 * the address bar says that, and the card says what to expect there. The
 * build stamp and the accessibility statement stand at the foot, as on every
 * screen (0145 T9 (b)), and during the Alpha a link to the site's page.
 *
 * ## Steps, as a browser and a screen reader meet them
 *
 * As a person's link page has them (`PersonGrant.tsx`, 0176 §5.6): each step
 * an entry in the browser's history, so Back goes one step back; one `h1`,
 * which takes the focus when the step opens; the tab named after the step;
 * *Step n of 3* in words. A step is a place in the page, not an address: one
 * opened with no code checked on this visit is the first. The code itself is
 * never put in the history. Once the person is let in the page says so on
 * every entry, so Back never uses the code twice.
 *
 * ## A person's sizes
 *
 * Drawn inside `PersonsPageProvider`, as a person's own pages are (0176 T9):
 * the language switch then says *English* and *Nederlands* at 44 by 44, and
 * the build stamp is 16 pixels at 7 to 1; and the frame carries
 * `data-persons-page`, so the keyboard's focus is index.css's 2-pixel
 * outline. The door's own sizes are 0176 §13's (0177 §10): sentences at 18
 * pixels, a main button 60 pixels high and as wide as the column, every other
 * target 44 by 44, edges at 3 to 1.
 *
 * Managed only, and public, as `/request-access` is (`AppRoutes.tsx`).
 */

import React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Check } from 'lucide-react';
import { registrationLink } from '@openmig/shared';
import { useT, useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import BuildStamp from '../components/BuildStamp.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import AccessibilityLink from '../components/AccessibilityLink.tsx';
import { isAlpha } from '../components/AlphaNote.tsx';
import { supportAddress } from '../components/SupportLine.tsx';
import { PersonsPageProvider } from '../components/persons-page.tsx';
import {
  checkCode,
  keptCode,
  redeemCode,
  refusalSaid,
  refusedCode,
  type CheckedCode,
  type CodeToUse,
  type KeptCode,
  type LetIn,
} from '../services/gifts.ts';
import { recommendationPageUrl } from '../services/recommendation-page-link.ts';
import { legalUrl } from '../services/legal-links.ts';

/** A person's sizes (0176 §13, 0177 §10), as `PersonGrant.tsx` draws them. */
const MAIN_FILLED =
  'block w-full min-h-[60px] px-4 py-3 rounded-lg bg-blue-700 text-white text-lg font-semibold text-center ' +
  'hover:bg-blue-800 disabled:opacity-60 break-words';
const MAIN_OUTLINED =
  'block w-full min-h-[60px] px-4 py-3 rounded-lg border-2 border-gray-700 bg-white text-gray-900 text-lg ' +
  'font-semibold text-center hover:bg-gray-50 disabled:opacity-60 break-words';
const QUIET = 'inline-flex min-h-[44px] min-w-[44px] items-center text-lg text-blue-700 underline underline-offset-4';
const FIELD = 'mt-2 block w-full min-h-[52px] rounded-lg border-2 border-gray-700 bg-white px-3 py-2 text-lg text-gray-900';
/**
 * Two answers to one question, one size: each a box as wide as half the
 * column, 60 pixels high, with its radio inside it. The box is the target;
 * the radio is there for the keyboard and a screen reader, and the box draws
 * its focus. A tick says which is chosen, so it is not said by colour alone.
 */
const ANSWER =
  'group flex min-h-[60px] cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-gray-700 ' +
  'bg-white px-4 py-3 text-lg font-semibold text-gray-900 has-checked:border-blue-700 has-checked:bg-blue-50 ' +
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-blue-700';
const SENTENCE = 'mt-4 text-lg text-gray-900';

/**
 * The form's trap (workplan 0093 T2d), by the request form's name: a field a
 * bot fills and a person never meets. The server answers a filled one as let
 * in, and writes and sends nothing (0177 §21.3, 8).
 */
const TRAP_FIELD = 'website';

/** The screens that are entries in the browser's history. */
const STEP_KINDS = ['code', 'question', 'notYet', 'noThanks', 'address', 'full'] as const;
type StepKind = (typeof STEP_KINDS)[number];

/** What a step leaves in the history: the step, and whether the page put it there. Never the code. */
interface StepState {
  readonly codeStep: StepKind;
  readonly back?: boolean;
}

function stepIn(state: unknown): StepKind | null {
  if (state === null || typeof state !== 'object') return null;
  const asked = (state as Partial<StepState>).codeStep;
  return STEP_KINDS.find((k) => k === asked) ?? null;
}

/** The three steps a card names: type the code, answer one question, fill in your address. */
const PATH: readonly StepKind[] = ['code', 'question', 'address'];

const TITLE: Readonly<Record<StepKind | 'in', StringKey>> = {
  code: 'code.step1.title',
  question: 'code.step2.title',
  notYet: 'code.notYet.title',
  noThanks: 'code.noThanks.title',
  address: 'code.step3.title',
  full: 'code.full.title',
  in: 'code.in.title',
};

/**
 * The code a link carries after its `#` (D2), or nothing. A fragment never
 * reaches a server or a log; anything that is not a code's shape is left
 * out, and the field stays empty.
 */
function codeFromHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  let code: string;
  try {
    code = decodeURIComponent(raw).trim();
  } catch {
    return '';
  }
  return code.length <= 64 && /^[0-9A-Za-z -]+$/.test(code) ? code : '';
}

/** Whether the reader's browser says motion is fine: the step change scrolls smoothly only then. */
const motionWelcome = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

/** A day as the reader names it, in their language. */
const dayIn = (when: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(when));

/** A sentence with an address as a `mailto:` link where it says `{support}`. */
function withSupport(sentence: string, address: string): React.ReactNode {
  const [before = '', after = ''] = sentence.split('{support}');
  return (
    <>
      {before}
      <a href={`mailto:${address}`} className="text-blue-700 underline underline-offset-4 break-all">
        {address}
      </a>
      {after}
    </>
  );
}

/** A full Alpha, and the step it was told at, so Back goes back there. */
interface Full extends KeptCode {
  readonly from: 'code' | 'address';
}

const CodeDoor: React.FC = () => {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const ids = {
    refusal: React.useId(),
    trouble: React.useId(),
    hint: React.useId(),
    question: React.useId(),
    emailHint: React.useId(),
    googleHint: React.useId(),
  };

  /** `?locale=`, as the request form reads it: the site's link carries the page's language. Once, on arrival. */
  React.useEffect(() => {
    const asked = search.get('locale');
    if ((asked === 'en' || asked === 'nl') && asked !== locale) setLocale(asked);
  }, []);
  // The tab's name goes back to what it was when this page leaves.
  React.useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);

  const [code, setCode] = React.useState(() => codeFromHash(location.hash));
  const [checked, setChecked] = React.useState<CheckedCode | null>(null);
  const [checking, setChecking] = React.useState(false);
  /** The server's refusal of the code, in the page's language. */
  const [refusal, setRefusal] = React.useState<string | null>(null);
  /** Anything else that stopped step 1 (too many tries, no answer), in the page's language. */
  const [trouble, setTrouble] = React.useState<string | null>(null);
  const [full, setFull] = React.useState<Full | null>(null);
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [google, setGoogle] = React.useState<boolean | null>(null);
  const [using, setUsing] = React.useState(false);
  const [alreadyIn, setAlreadyIn] = React.useState<KeptCode | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [letIn, setLetIn] = React.useState<{ readonly answer: LetIn; readonly email: string; readonly google: boolean } | null>(
    null,
  );

  const valid = (s: StepKind | null): StepKind | null => {
    if (s === null) return null;
    if (s === 'code') return s;
    if (s === 'full') return full ? s : null;
    // Every other step stands on a code checked on this visit.
    return checked ? s : null;
  };
  const step: StepKind | 'in' = letIn ? 'in' : (valid(stepIn(location.state)) ?? 'code');

  const go = (next: StepKind) =>
    void navigate(`${location.pathname}${location.search}`, { state: { codeStep: next, back: true } satisfies StepState });
  const previousOf = (s: StepKind | 'in'): StepKind | null => {
    switch (s) {
      case 'question':
        return 'code';
      case 'notYet':
      case 'noThanks':
      case 'address':
        return 'question';
      case 'full':
        return full?.from ?? 'code';
      default:
        return null;
    }
  };
  const previous = previousOf(step);
  const back = () => {
    if ((location.state as Partial<StepState> | null)?.back === true) void navigate(-1);
    else if (previous) void navigate(`${location.pathname}${location.search}`, { state: { codeStep: previous } satisfies StepState });
  };

  const title = t(TITLE[step]);
  const n = step === 'in' ? 0 : PATH.indexOf(step) + 1;

  // A NEW SCREEN STARTS AT THE TOP, with the focus on its heading. Not on the
  // first render: opening the page moves nothing.
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const shown = React.useRef<string>(step);
  React.useLayoutEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: motionWelcome() ? 'smooth' : 'instant' });
  }, [step]);
  // The tab named after the step (criterion 2.4.2).
  React.useEffect(() => {
    document.title = `${title} — Ownpace`;
  }, [title]);

  const check = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const typed = code.trim();
    if (typed === '') {
      // The browser says, in its own words and at the field, that the field is empty.
      e.currentTarget.reportValidity();
      return;
    }
    if (checking) return;
    setChecking(true);
    setRefusal(null);
    setTrouble(null);
    try {
      const yes = await checkCode(typed);
      setChecked(yes);
      go('question');
    } catch (err) {
      const kept = keptCode(err);
      if (kept?.error === 'full') {
        setFull({ ...kept, from: 'code' });
        go('full');
      } else if (refusedCode(err)) {
        setRefusal(refusalSaid(err, locale, t));
      } else {
        setTrouble(refusalSaid(err, locale, t));
      }
    } finally {
      setChecking(false);
    }
  };

  const use = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity() || google === null) {
      form.reportValidity();
      return;
    }
    if (using) return;
    // The trap is read from the form, not kept in state, as the request form reads it.
    const trap = new FormData(form).get(TRAP_FIELD);
    const body: CodeToUse = {
      code: code.trim(),
      email: email.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      google,
      locale,
      ...(typeof trap === 'string' && trap.trim() !== '' ? { [TRAP_FIELD]: trap.trim() } : {}),
    };
    setUsing(true);
    setAlreadyIn(null);
    setFailure(null);
    try {
      const answer = await redeemCode(body);
      setLetIn({ answer, email: body.email, google });
    } catch (err) {
      const kept = keptCode(err);
      if (kept?.error === 'full') {
        setFull({ ...kept, from: 'address' });
        go('full');
      } else if (kept?.error === 'already_in') {
        setAlreadyIn(kept);
      } else if (refusedCode(err)) {
        // Stopped working since step 1: refused as there, in its field.
        setRefusal(refusalSaid(err, locale, t));
        setChecked(null);
        go('code');
      } else {
        setFailure(refusalSaid(err, locale, t));
      }
    } finally {
      setUsing(false);
    }
  };

  const until = full?.until ?? checked?.until;
  const said = (kept: KeptCode): string => (locale === 'nl' && kept.reasonNl ? kept.reasonNl : kept.reason);
  const support = supportAddress();

  const backButton = previous !== null && (
    <p className="mt-6">
      <button type="button" className={QUIET} onClick={back}>
        {t('grant.step.back')}
      </button>
    </p>
  );

  const body = ((): React.ReactNode => {
    switch (step) {
      case 'code': {
        const describedBy = [refusal ? ids.refusal : null, trouble ? ids.trouble : null, ids.hint].filter(Boolean).join(' ');
        return (
          <form noValidate onSubmit={(e) => void check(e)}>
            {refusal !== null && (
              <div id={ids.refusal} role="alert" className="mt-6 rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
                <h2 className="text-xl font-semibold text-gray-900">{t('code.refused.title')}</h2>
                <p className="mt-2 text-lg text-gray-900">{refusal}</p>
                <p className="mt-2 text-lg text-gray-900">{t('code.refused.line')}</p>
              </div>
            )}
            {trouble !== null && (
              <p id={ids.trouble} role="alert" className="mt-6 rounded-lg border-2 border-amber-700 bg-amber-50 p-4 text-lg text-gray-900">
                {trouble}
              </p>
            )}
            <label htmlFor="door-code" className="mt-6 block text-lg font-semibold text-gray-900">
              {t('code.field')}
            </label>
            <p id={ids.hint} className="mt-1 text-lg text-gray-900">
              {t('code.field.hint')}
            </p>
            <input
              id="door-code"
              name="code"
              type="text"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                // A changed code is not the one checked.
                setChecked(null);
              }}
              aria-describedby={describedBy}
              aria-invalid={refusal !== null}
              className={`${FIELD} font-mono tracking-wider`}
            />
            <button type="submit" data-main disabled={checking} className={`mt-6 ${MAIN_FILLED}`}>
              {t('grant.step.next')}
            </button>
            <p className="mt-4">
              <Link to="/request-access" className={QUIET}>
                {t('code.noCode')}
              </Link>
            </p>
          </form>
        );
      }

      case 'question':
        return (
          <>
            <p className={SENTENCE}>{t('code.what')}</p>
            <ul className="mt-3 space-y-2 list-disc pl-6 text-lg text-gray-900">
              <li>{t('code.alpha')}</li>
              <li>{t('code.letIn')}</li>
              <li>{t('code.cost')}</li>
              <li>{t('code.after')}</li>
              <li>{t('code.giverSees')}</li>
            </ul>
            <p id={ids.question} className="mt-6 text-lg font-semibold text-gray-900">
              {t('code.question')}
            </p>
            {/* Three answers of one size, and none louder: not yet is as good an answer. */}
            <div role="group" aria-labelledby={ids.question} data-answers className="mt-3 space-y-3">
              <button type="button" data-main className={MAIN_OUTLINED} onClick={() => go('address')}>
                {t('code.yes')}
              </button>
              <button type="button" data-main className={MAIN_OUTLINED} onClick={() => go('notYet')}>
                {t('code.notYet')}
              </button>
              <button type="button" data-main className={MAIN_OUTLINED} onClick={() => go('noThanks')}>
                {t('code.noThanks')}
              </button>
            </div>
            {backButton}
          </>
        );

      case 'notYet':
        return (
          <>
            {checked && <p className={SENTENCE}>{t('code.notYet.later', { date: dayIn(checked.until, locale) })}</p>}
            <p className={SENTENCE}>{t('code.nothingSent')}</p>
            {backButton}
          </>
        );

      case 'noThanks':
        return (
          <>
            <p className={SENTENCE}>{t('code.nothingSent')}</p>
            <p className={SENTENCE}>{t('code.noThanks.tell')}</p>
            {backButton}
          </>
        );

      case 'address':
        return (
          <form noValidate onSubmit={(e) => void use(e)}>
            <label htmlFor="door-email" className="mt-6 block text-lg font-semibold text-gray-900">
              {t('code.email')}
            </label>
            <p id={ids.emailHint} className="mt-1 text-lg text-gray-900">
              {t('code.email.hint')}
            </p>
            <input
              id="door-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={ids.emailHint}
              className={FIELD}
            />
            <label htmlFor="door-name" className="mt-6 block text-lg font-semibold text-gray-900">
              {t('code.name')}
            </label>
            <input
              id="door-name"
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
            />
            <fieldset className="mt-6" aria-describedby={ids.googleHint}>
              <legend className="text-lg font-semibold text-gray-900">{t('code.google')}</legend>
              <div data-answers className="mt-3 grid grid-cols-2 gap-3">
                {([true, false] as const).map((answer) => (
                  <label key={String(answer)} className={ANSWER}>
                    <input
                      type="radio"
                      name="google"
                      required
                      checked={google === answer}
                      onChange={() => setGoogle(answer)}
                      className="sr-only"
                    />
                    <Check className="hidden h-6 w-6 shrink-0 group-has-checked:block" aria-hidden="true" />
                    {t(answer ? 'code.yes' : 'code.no')}
                  </label>
                ))}
              </div>
              <p id={ids.googleHint} className="mt-2 text-lg text-gray-900">
                {t('code.google.hint')}
              </p>
            </fieldset>

            {/* The trap (workplan 0093 T2d): off-screen rather than undisplayed, out of the tab order. */}
            <div aria-hidden="true" className="absolute left-[-10000px] top-auto w-px h-px overflow-hidden">
              <label htmlFor={TRAP_FIELD}>{t('access.trap')}</label>
              <input
                id={TRAP_FIELD}
                name={TRAP_FIELD}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                className="h-px w-px"
                defaultValue=""
                data-1p-ignore=""
                data-lpignore="true"
                data-bwignore=""
              />
            </div>

            {email.trim() !== '' && (
              <p data-shown-back className="mt-6 text-lg font-medium text-gray-900 break-words">
                {t('code.shownBack', { email: email.trim() })}
              </p>
            )}
            {alreadyIn !== null && (
              <div role="alert" className="mt-6 rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
                <p className="text-lg text-gray-900">{said(alreadyIn)}</p>
                <p className="mt-2">
                  <Link to="/login" className={QUIET}>
                    {t('access.backToSignIn')}
                  </Link>
                </p>
              </div>
            )}
            {failure !== null && (
              <p role="alert" className="mt-6 rounded-lg border-2 border-amber-700 bg-amber-50 p-4 text-lg text-gray-900">
                {failure}
              </p>
            )}
            <button type="submit" data-main disabled={using} aria-busy={using} className={`mt-6 ${MAIN_FILLED}`}>
              {t('code.use')}
            </button>
            <p className={SENTENCE}>{t('code.kept')}</p>
            <p className="mt-2 text-lg text-gray-900">
              {(isAlpha() ? (['privacy', 'alpha'] as const) : (['privacy'] as const)).map((page, i) => (
                <React.Fragment key={page}>
                  {i > 0 && ' · '}
                  <a href={legalUrl(page, locale)} target="_blank" rel="noopener noreferrer" className={QUIET}>
                    {t(page === 'privacy' ? 'acceptance.doc.privacy' : 'acceptance.doc.alpha')}
                    <span className="sr-only"> {t('common.newTab')}</span>
                  </a>
                </React.Fragment>
              ))}
            </p>
            {backButton}
          </form>
        );

      case 'full':
        return (
          <>
            {full && <p className={SENTENCE}>{said(full)}</p>}
            {until && <p className={SENTENCE}>{t('code.full.line', { date: dayIn(until, locale) })}</p>}
            {/* Its one button goes back (§20.3). */}
            <button type="button" data-main className={`mt-6 ${MAIN_OUTLINED}`} onClick={back}>
              {t('grant.step.back')}
            </button>
          </>
        );

      case 'in': {
        const { answer, email: address } = letIn!;
        return (
          <>
            <p className={SENTENCE}>{t('code.in.left', { email: address })}</p>
            <Link to={registrationLink('', locale, address)} data-main className={`mt-6 ${MAIN_FILLED}`}>
              {t('code.in.create')}
            </Link>
            {answer.mailed && checked?.answersFrom && (
              <p className={SENTENCE}>{t('code.in.mailed', { from: checked.answersFrom })}</p>
            )}
            {letIn!.google && <p className={SENTENCE}>{t('code.in.google', { email: address })}</p>}
            <p className={SENTENCE}>{t('code.in.safety')}</p>
            {support !== null && <p className={`${SENTENCE} break-words`}>{withSupport(t('code.in.mistyped', { email: address }), support)}</p>}
          </>
        );
      }
    }
  })();

  return (
    // Nothing on the door names who sent the code until T9 (step B); no part of it reads `who`.
    <PersonsPageProvider value={{ who: '' }}>
      <main data-code-door data-persons-page className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        <LanguageSwitch className="justify-end mb-4" />
        <div data-step={step}>
          {n > 0 && <p className="text-base text-gray-800">{t('grant.step', { n: String(n), total: String(PATH.length) })}</p>}
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 text-2xl font-semibold text-gray-900 break-words">
            {title}
          </h1>
          {body}
        </div>
        {/* The foot of every screen (0145 T9 (b)): during the Alpha the site's
            page, the accessibility statement, and the build stamp. */}
        <div data-foot className="mt-10 border-t border-gray-300 pt-4 space-y-1">
          {isAlpha() && (
            <p>
              <a href={recommendationPageUrl(locale)} className={`${QUIET} text-gray-900`}>
                {t('code.readMore')}
              </a>
            </p>
          )}
          <p>
            <AccessibilityLink className={`${QUIET} text-gray-900`} />
          </p>
          {/* Outside `Layout`, so the sidebar's stamp never reaches here (components/BuildStamp.tsx). */}
          <BuildStamp />
        </div>
      </main>
    </PersonsPageProvider>
  );
};

export default CodeDoor;
