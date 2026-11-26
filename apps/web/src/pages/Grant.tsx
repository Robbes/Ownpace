// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The page a migrated person lands on (workplan 0108 T4, ADR-0035).
 *
 * The only screen in this product whose reader has no account, no session and
 * no reason to trust us — somebody's colleague, doing a favour, following a
 * link a person they know sent them. So it is written for that reader and not
 * for an operator: no chrome, no navigation, no jargon, and every sentence in
 * the second person.
 *
 * ## What it must say before the button, and why
 *
 * **Who is asking.** Consenting to an anonymous request is not consenting. The
 * organisation's name comes from the server, so the page cannot be made to
 * claim somebody else asked.
 *
 * **Who asked, from where, and to where** (workplan 0108 T8a, 2026-09-23).
 * Who asked is the address of the member who issued the link, the one they
 * sign in with: the owner, *"It has to be clear who is facilitating a
 * migration of someone else."* Somebody with
 * a tenant of their own can set up a migration from another person's account
 * into a server they control and send the link with a plausible story. This
 * page and Google's consent screen would both be genuine. The account it reads
 * and the destination it writes are the two facts only the person granting can
 * check, so they come before the button, with one plain question beside them.
 *
 * **Which account to sign in with** (0108 T8 (b)). From is a condition, not a
 * label: the server refuses any other account that signs in, and stores
 * nothing. Said before the button, together with why Google will also ask to
 * share their address, which is how the account is checked.
 *
 * **What will be read, and what the permission allows.** In plain words AND
 * as the scope Google itself will record (ADR-0041's operative rule: the
 * scopes are shown as scopes). The plain sentence is what a person
 * understands; each scope is said as what it allows, in the reader's language
 * (the owner, 2026-10-14), and the exact string Google records sits in a
 * closed *Technical details* fold, for whoever wants to check it against
 * their account. Before that it was shown as it was, three addresses in
 * monospace under the sentence. The plain
 * words are this page's, from the dictionary (workplan 0145 T6): the server
 * names the data types, and the page says them in the reader's language and
 * joins them as that language joins a list. Until then the server sent an
 * English phrase, and a Dutch reader met it inside a Dutch sentence.
 *
 * "Read-only" only where Google enforces it (workplan 0144 T3 (c)). The box
 * above the scope said *"Read-only."* for every link, and for a Gmail link the
 * scope under it is `https://mail.google.com/`, which Google's screen, one
 * click later, describes as reading, sending and deleting all mail. Ownpace
 * only reads, whatever the permission allows; the permission is read-only only
 * for Drive and Tasks. So the server says which (`readOnlyAtProvider`, decided
 * from the scopes the link asks), and the box says "Read-only" only then, and
 * otherwise that Ownpace only reads and that Google describes more.
 *
 * **Until when.** The link's own validity, in a date. An expiry that lands
 * mid-intention — after somebody has cleared ten minutes to do this — is a
 * small betrayal that costs an afternoon.
 *
 * **Where to open it** (workplan 0140 T3 (a)). A link tapped in a chat or mail
 * app opens in that app's own browser, and Google is reported to refuse its
 * consent there. One line above the button says to open it in Safari or
 * Chrome instead, and that the link still works, which it does: opening it
 * spends nothing.
 *
 * **In one language, which the reader chooses** (workplan 0145 T6). The page
 * is outside `Layout`, so it carries its own switch, the same two buttons.
 * A refusal shows the half the server sent in the page's language; a failure
 * the server wrote no sentence for (no connection, a subject this page cannot
 * read) is the page's own sentence (`link-refusal.ts`), and the
 * button tells the server which language the ending after Google should be
 * in. A refusal is announced (`role="alert"`) and the waiting line is a
 * status, which 0145 T4 left to this change.
 *
 * **The privacy policy and terms, before any redirect.** This is the in-product
 * disclosure Google's verification requires, and it belongs where a person can
 * still walk away. The addresses, in the reader's language, come from
 * `services/legal-links.ts`, the one module every link to the texts reads
 * (workplan 0139 T10). They are named as everywhere else in the app
 * (`acceptance.doc.*`), and kept apart by a dot rather than one space.
 *
 * **Only to Google's own page** (workplan 0163 T4). Both buttons send the page
 * to the consent address the API answers, and until 2026-11-21 they followed
 * whatever came back. Now the address goes through `consentToFollow('google',
 * …)` (`services/address-to-follow.ts`), the check *Pay* and the consent
 * window use: `https:` on `accounts.google.com` exactly, or nothing is opened
 * and the page says the address is not Google's own page.
 *
 * ## A person's link, one thing at a time (workplan 0176 step A)
 *
 * A person's link, which asks for one or more of a person's accounts, is no
 * longer drawn here: `PersonGrant.tsx` asks one thing at a time, in a
 * person's words and at a person's sizes (`persons-page.tsx`). What both
 * pages say alike is in `grant-parts.tsx`. This page keeps the migration's
 * own link, sent before 2026-10-03, as it was, and names the tab and draws
 * the frame of both.
 *
 * ## What it must never do
 *
 * Never show a token, never receive one, never postMessage. The refresh token
 * is stored server-side and this page's success state is a boolean — see
 * `grantResultPage` in the API, which cannot render a token because its
 * signature has nowhere to put one.
 */

import React from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { grantApi, type GrantSubject, type PersonGrantSubject } from '../services/grant-service.ts';
import { linkRefusal } from '../services/link-refusal.ts';
import { consentToFollow } from '../services/address-to-follow.ts';
import { legalLinks } from '../services/legal-links.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import BuildStamp from '../components/BuildStamp.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';
import AlphaGoogleLine from '../components/AlphaGoogleLine.tsx';
import { isAlpha } from '../components/AlphaNote.tsx';
import AccessibilityLink from '../components/AccessibilityLink.tsx';
import { PersonsPageProvider } from '../components/persons-page.tsx';
import { whoSent } from '../components/TheSender.tsx';
import { PersonGrant } from './PersonGrant.tsx';
import { GrantScope, NotTheProvider, failureSentence, providerName, readsKey, wordsOf } from './grant-parts.tsx';

/**
 * Whether the page opened a person's link. Here rather than imported, so a
 * test that stands in for the service with its two calls still draws the page.
 */
const isPersonSubject = (s: GrantSubject | PersonGrantSubject): s is PersonGrantSubject =>
  'kind' in s && s.kind === 'person';

/**
 * Whether a link is a person's by its shape (`p.<id>.<secret>`): so the page
 * draws a person's sizes while it loads, and for a refusal, which a person
 * reads too (workplan 0176 T9).
 */
const isPersonsLink = (link: string | undefined): boolean => (link ?? '').startsWith('p.');

/**
 * DO IT TOGETHER, DURING THE ALPHA (the owner's decisions of 2026-11-26,
 * change 4). While Google still shows its warning screen for the app it has
 * not verified, which is the Alpha (`isAlpha`, the rule `AlphaGoogleLine`
 * keeps for the same screen), one plain line before a Google button invites
 * the person to take the step together with whoever set it up, on the phone
 * or at the table. Named as the page already names them (`askedBy`, else
 * the organisation). Calm and short, and never a request for help by
 * message, which is the shape of a known scam.
 */
const DoItTogether: React.FC<{ who: string; className?: string }> = ({ who, className }) => {
  const t = useT();
  if (!isAlpha()) return null;
  return <p className={`${className ?? ''} text-sm text-gray-900`}>{t('grant.together', { who })}</p>;
};

const Grant: React.FC = () => {
  const { link } = useParams<{ link: string }>();
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, list } = useFormatters();
  // The policy and terms, in the reader's language. A value the module would
  // refuse never reaches here: the web build refuses it (`vite.config.ts`).
  const legal = legalLinks(locale);
  const [starting, setStarting] = React.useState(false);
  // The refusal itself rather than its sentence, so switching language after
  // it arrived shows the other half.
  const [failure, setFailure] = React.useState<unknown>(null);

  const subject = useQuery({
    queryKey: ['grant', link],
    queryFn: () => grantApi.read(link!),
    enabled: Boolean(link),
    retry: false,
  });

  // The tab's name goes back to what it was when this page leaves, so the
  // next screen is not called after this one. Its own effect, run once: a
  // language switch renames the tab and must not bring the old name back.
  React.useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);
  // A person's link draws a person's page (0176 T1, T9): `PersonGrant` names
  // the tab after its step, and the frame takes a person's sizes.
  const personsSubject = subject.data !== undefined && isPersonSubject(subject.data);
  const personsPage = subject.data !== undefined ? personsSubject : isPersonsLink(link);
  // The tab's name, as the page's own title says it (the UX sweep, 2026-10-17).
  const title = t('grant.title');
  React.useEffect(() => {
    if (personsSubject) return;
    document.title = `${title} — Ownpace`;
  }, [title, personsSubject]);

  // A migration's own link: its one provider, once the page has read it.
  const single = {
    provider: (subject.data && !isPersonSubject(subject.data) ? subject.data.provider : undefined) ?? 'google',
  };

  const connect = async () => {
    if (!link) return;
    setStarting(true);
    setFailure(null);
    try {
      // The page's language, so the ending after Google is in it too.
      const provider = single.provider;
      const { url } = await grantApi.authorize(link, locale, provider);
      // Only to the provider's own page (0163 T4), the host by provider (0171).
      const consent = consentToFollow(provider, url);
      if (consent === null) {
        setFailure(new NotTheProvider(wordsOf(provider).name));
        setStarting(false);
        return;
      }
      // A full navigation, not a popup: there is no wizard window behind this
      // page to hand anything back to, and a popup blocked by the browser
      // would look exactly like a button that does nothing.
      globalThis.location.assign(consent);
    } catch (err) {
      setFailure(err);
      setStarting(false);
    }
  };

  const page = (
    <main
      {...(personsPage ? { 'data-persons-page': '' } : {})}
      className={personsPage ? 'max-w-xl mx-auto px-4 py-8 sm:py-12' : 'max-w-xl mx-auto px-6 py-12'}
    >
      <LanguageSwitch className="justify-end mb-4" />
      {/* A person's link names each step in its own heading (`PersonGrant`),
          and has none while it loads: the first is the first screen's. */}
      {!personsSubject && !(personsPage && subject.isPending) && (
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      )}

      {subject.isPending && (
        <p role="status" className={personsPage ? 'mt-4 text-lg text-gray-900' : 'mt-4 text-sm text-gray-600'}>
          {t('grant.loading')}
        </p>
      )}

      {subject.error != null && (
        // The server's own sentence, verbatim, in the half the page is in:
        // every refusal here is written to be forwarded to the person who sent
        // the link, and rewording it would lose the half that says what to
        // tell them. An alert, because it replaces the whole page.
        <p role="alert" className={personsPage ? 'mt-4 text-lg text-amber-900' : 'mt-4 text-sm text-amber-800'}>
          {linkRefusal(subject.error, locale, t)}
        </p>
      )}

      {subject.data && isPersonSubject(subject.data) && link && <PersonGrant data={subject.data} link={link} />}

      {subject.data && !isPersonSubject(subject.data) && (
        <>
          <p className="mt-4 text-gray-900">
            {t('grant.asking', { organisation: subject.data.organisation })}
          </p>

          <dl className="mt-4 p-4 border border-gray-200 rounded-lg grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {/* The company as the EU VAT register names it (0108 T8a): shown
                only when the organisation's VAT number was checked and found
                valid, because it is the one name here nobody typed. */}
            {subject.data.checkedCompany && (
              <>
                <dt className="text-gray-600">{t('grant.company')}</dt>
                <dd className="text-gray-900">
                  <span className="block">{subject.data.checkedCompany}</span>
                  <span className="block text-xs text-gray-500">{t('grant.companyChecked')}</span>
                </dd>
              </>
            )}
            {subject.data.askedBy && (
              <>
                <dt className="text-gray-600">{t('grant.askedBy')}</dt>
                <dd className="text-gray-900 break-all">{subject.data.askedBy}</dd>
              </>
            )}
            {/* The organisation's number, when it gave one: optional, and the
                server shows nothing here that is not a phone number. */}
            {subject.data.organisationPhone && (
              <>
                <dt className="text-gray-600">{t('grant.phone')}</dt>
                <dd className="text-gray-900">
                  <a className="underline" href={`tel:${subject.data.organisationPhone.replace(/[^0-9+]/g, '')}`}>
                    {subject.data.organisationPhone}
                  </a>
                </dd>
              </>
            )}
            <dt className="text-gray-600">{t('grant.from')}</dt>
            <dd className="text-gray-900 break-all">{subject.data.from}</dd>
            <dt className="text-gray-600">{t('grant.to')}</dt>
            <dd className="text-gray-900 break-all">
              {subject.data.to.account && <span className="block">{subject.data.to.account}</span>}
              <span className="block text-gray-600">
                {subject.data.to.host
                  ? t('grant.toWhere', {
                      provider: providerName(subject.data.to.provider),
                      host: subject.data.to.host,
                    })
                  : providerName(subject.data.to.provider)}
              </span>
            </dd>
          </dl>
          <p className="mt-2 text-sm font-medium text-gray-900">{t('grant.check')}</p>
          {/* The answer to that question when it is no (0108 T8 (d)): tell
              the owner instead of continuing. Offered only where a report
              can reach somebody. */}
          {link && (
            <ReportThisLink
              kind="grant"
              link={link}
              organisation={subject.data.organisation}
              next="linkReport.next.grant"
            />
          )}
          <p className="mt-3 text-gray-900">
            {t('grant.reads', {
              reads: list(subject.data.domains.map((d) => t(readsKey(d, wordsOf(single.provider))))),
            })}
          </p>

          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="flex items-start gap-2 text-sm text-green-900">
              <ShieldCheck className="w-5 h-5 flex-shrink-0" />
              <span>{t(wordsOf(subject.data.provider).readOnly(subject.data.readOnlyAtProvider))}</span>
            </p>
          </div>

          <GrantScope scope={subject.data.scope} provider={single.provider} className="mt-4" />

          <p className="mt-4 text-sm text-gray-600">
            {t('grant.until', { date: dateTime(subject.data.expiresAt) })}
          </p>

          {/* The account is a condition, not a label (0108 T8 (b)): any other
              account that signs in is refused and nothing is kept. Said before
              the button, with why Google will also ask for their address. */}
          <p className="mt-4 text-sm font-medium text-gray-900 break-words">
            {t(wordsOf(subject.data.provider).signInAs, { account: subject.data.from })}
          </p>

          {/* A link sent by chat or mail opens inside that app's own browser,
              where Google is reported to refuse its consent (workplan 0140
              T3 (a); outside knowledge, 0140 §1). Always shown, with no
              sniffing for user agents, and before the button: opening the
              link again in the phone's own browser spends nothing (`grant.ts`), and
              the line says so. */}
          <p className="mt-3 text-sm text-gray-600">{t('grant.inAppBrowser')}</p>

          {/* During the Alpha, the guide's section on connecting Google,
              right above the button (the owner, 2026-10-18). */}
          {(subject.data.provider ?? 'google') === 'google' && <AlphaGoogleLine className="mt-3" />}
          {(subject.data.provider ?? 'google') === 'google' && (
            <DoItTogether who={subject.data.askedBy ?? subject.data.organisation} className="mt-3" />
          )}

          <button
            type="button"
            onClick={connect}
            disabled={starting}
            className="mt-6 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {starting
              ? t(wordsOf(subject.data.provider).connecting)
              : t(wordsOf(subject.data.provider).connect, { account: subject.data.from })}
          </button>

          {failure != null && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              {failureSentence(failure, locale, t)}
            </p>
          )}

          <p className="mt-6 text-sm text-gray-500">
            {t('grant.disclosure')}{' '}
            <a className="underline" href={legal.privacy}>
              {t('acceptance.doc.privacy')}
            </a>
            {' · '}
            <a className="underline" href={legal.terms}>
              {t('acceptance.doc.terms')}
            </a>
          </p>
          <p className="mt-3 text-sm text-gray-500">{t(wordsOf(subject.data.provider).withdraw)}</p>
          {/* Its own line: the one above lists what a person accepts (0145 T9 (b)). */}
          <p className="mt-3 text-sm text-gray-500">
            <AccessibilityLink className="underline" />
          </p>
        </>
      )}

      {/* Outside `Layout`, so the sidebar's stamp never reaches here — and this
          is the page whose reader is LEAST able to describe what they are
          looking at. "The link my colleague sent me does not work" is a support
          conversation that starts with which build they are on. See
          components/BuildStamp.tsx. */}
      <div className="mt-10 text-center">
        <BuildStamp />
      </div>
    </main>
  );
  // Whoever the page names as having sent the link (0176 D14, §7): the name
  // the member gave, else their address, else the organisation; nothing yet
  // while the page loads.
  const who = subject.data && isPersonSubject(subject.data) ? whoSent(subject.data) : '';
  return personsPage ? <PersonsPageProvider value={{ who }}>{page}</PersonsPageProvider> : page;
};

export default Grant;
