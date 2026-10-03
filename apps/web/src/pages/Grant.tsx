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
 * understands; the scope string is what they can check afterwards in their own
 * account, and one without the other is either vague or unreadable. The plain
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
 * (workplan 0139 T10).
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
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import type { DiscoveryDomain } from '@openmig/shared';
import { grantApi, type GrantSubject, type PersonGrantSubject } from '../services/grant-service.ts';

/**
 * Whether the page opened a person's link. Here rather than imported, so a
 * test that stands in for the service with its two calls still draws the page.
 */
const isPersonSubject = (s: GrantSubject | PersonGrantSubject): s is PersonGrantSubject =>
  'kind' in s && s.kind === 'person';
import { linkRefusal } from '../services/link-refusal.ts';
import { legalLinks } from '../services/legal-links.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import BuildStamp from '../components/BuildStamp.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';
import { TARGET_CARDS } from '../components/front-door-cards.ts';

/**
 * What each data type reads, as the dictionary says it (workplan 0145 T6). A
 * total record, so a sixth data type is a compile error here rather than a
 * gap in what a person is told they are giving access to.
 */
const READS_KEY: Readonly<Record<DiscoveryDomain, StringKey>> = {
  email: 'grant.reads.email',
  calendar: 'grant.reads.calendar',
  contact: 'grant.reads.contact',
  file: 'grant.reads.file',
  task: 'grant.reads.task',
};

/** A destination's kind, by the name its card carries; the kind itself otherwise. */
function providerName(kind: string): string {
  return TARGET_CARDS.find((c) => c.id === kind)?.name ?? kind;
}

/**
 * A PERSON'S link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)): who is
 * asking and who asked, once, then one card per Google account. Each card says
 * where each of its migrations goes and what it copies, what the permission
 * allows and the scope in Google's words, which account to sign in with, and
 * its own button; or that it is connected already; or, in the reader's
 * language, why it cannot be asked. Everything else on the page is the
 * migration's page's, in the same words.
 */
const PersonGrant: React.FC<{ data: PersonGrantSubject; link: string }> = ({ data, link }) => {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, list } = useFormatters();
  const legal = legalLinks(locale);
  // Which account's button was pressed, and what refused it.
  const [starting, setStarting] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<{ account: string; error: unknown } | null>(null);

  const connect = async (account: string) => {
    setStarting(account);
    setFailure(null);
    try {
      const { url } = await grantApi.authorize(link, locale, account);
      globalThis.location.assign(url);
    } catch (error) {
      setFailure({ account, error });
      setStarting(null);
    }
  };

  const where = (to: PersonGrantSubject['accounts'][number]['migrations'][number]['to']) => {
    const place = to.host ? t('grant.toWhere', { provider: providerName(to.provider), host: to.host }) : providerName(to.provider);
    return to.account ? t('grant.person.where', { account: to.account, place }) : place;
  };

  return (
    <>
      <p className="mt-4 text-gray-900">{t('grant.person.asking', { organisation: data.organisation })}</p>
      {(data.checkedCompany || data.askedBy || data.organisationPhone) && (
        <dl className="mt-4 p-4 border border-gray-200 rounded-lg grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {data.checkedCompany && (
            <>
              <dt className="text-gray-600">{t('grant.company')}</dt>
              <dd className="text-gray-900">
                <span className="block">{data.checkedCompany}</span>
                <span className="block text-xs text-gray-500">{t('grant.companyChecked')}</span>
              </dd>
            </>
          )}
          {data.askedBy && (
            <>
              <dt className="text-gray-600">{t('grant.askedBy')}</dt>
              <dd className="text-gray-900 break-all">{data.askedBy}</dd>
            </>
          )}
          {data.organisationPhone && (
            <>
              <dt className="text-gray-600">{t('grant.phone')}</dt>
              <dd className="text-gray-900">
                <a className="underline" href={`tel:${data.organisationPhone.replace(/[^0-9+]/g, '')}`}>
                  {data.organisationPhone}
                </a>
              </dd>
            </>
          )}
        </dl>
      )}
      <p className="mt-2 text-sm font-medium text-gray-900">{t('grant.check')}</p>
      {/* The answer to that question when it is no (0108 T8 (d)), as a
          migration's page offers it: the report names the person and every
          migration of theirs. Offered only where a report can reach somebody. */}
      <ReportThisLink kind="grant" link={link} organisation={data.organisation} next="linkReport.next.grant" />

      {data.accounts.map((a, i) => (
        <section
          key={a.account}
          aria-labelledby={`grant-account-${i}`}
          className="mt-6 p-4 border border-gray-200 rounded-lg"
        >
          <h2 id={`grant-account-${i}`} className="text-base font-semibold text-gray-900 break-all">
            {a.account}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {a.migrations.map((m, j) => (
              <li key={j} className="break-words">
                {t('grant.person.migration', {
                  where: where(m.to),
                  reads: list(m.domains.map((d) => t(READS_KEY[d]))),
                })}
              </li>
            ))}
          </ul>
          {a.granted && !a.again ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-green-800">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              {t('grant.person.connected')}
            </p>
          ) : a.notReady ? (
            <p className="mt-3 text-sm text-amber-800">{locale === 'nl' ? a.notReady.reasonNl : a.notReady.reason}</p>
          ) : (
            <>
              {/* Connected, and asked for again: a link made while every
                  account was connected, because a connection can stop
                  working while its token is still held. */}
              {a.again && <p className="mt-3 text-sm text-gray-900">{t('grant.person.again')}</p>}
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="flex items-start gap-2 text-sm text-green-900">
                  <ShieldCheck className="w-5 h-5 flex-shrink-0" />
                  <span>{t(a.readOnlyAtProvider ? 'grant.readOnly' : 'grant.readsOnly')}</span>
                </p>
              </div>
              <p className="mt-3 text-sm text-gray-600">{t('grant.scopeIntro')}</p>
              <p className="mt-1 text-sm font-mono break-all text-gray-900">{a.scope}</p>
              <p className="mt-3 text-sm font-medium text-gray-900 break-words">
                {t('grant.signInAs', { account: a.account })}
              </p>
              <button
                type="button"
                onClick={() => void connect(a.account)}
                disabled={starting !== null}
                className="mt-3 min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 break-all"
              >
                {starting === a.account
                  ? t('grant.connecting')
                  : t(a.again ? 'grant.person.connectAgain' : 'grant.person.connect', { account: a.account })}
              </button>
              {failure?.account === a.account && (
                <p role="alert" className="mt-3 text-sm text-amber-800">
                  {linkRefusal(failure.error, locale, t)}
                </p>
              )}
            </>
          )}
        </section>
      ))}

      <p className="mt-6 text-sm text-gray-600">{t('grant.until', { date: dateTime(data.expiresAt) })}</p>
      <p className="mt-3 text-sm text-gray-600">{t('grant.inAppBrowser')}</p>
      <p className="mt-6 text-sm text-gray-500">
        {t('grant.disclosure')}{' '}
        <a className="underline" href={legal.privacy}>
          {t('grant.privacy')}
        </a>{' '}
        <a className="underline" href={legal.terms}>
          {t('grant.terms')}
        </a>
      </p>
      <p className="mt-3 text-sm text-gray-500">{t('grant.withdraw')}</p>
    </>
  );
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

  const connect = async () => {
    if (!link) return;
    setStarting(true);
    setFailure(null);
    try {
      // The page's language, so the ending after Google is in it too.
      const { url } = await grantApi.authorize(link, locale);
      // A full navigation, not a popup: there is no wizard window behind this
      // page to hand anything back to, and a popup blocked by the browser
      // would look exactly like a button that does nothing.
      globalThis.location.assign(url);
    } catch (err) {
      setFailure(err);
      setStarting(false);
    }
  };

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <LanguageSwitch className="justify-end mb-4" />
      <h1 className="text-xl font-semibold text-gray-900">{t('grant.title')}</h1>

      {subject.isPending && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          {t('grant.loading')}
        </p>
      )}

      {subject.error != null && (
        // The server's own sentence, verbatim, in the half the page is in:
        // every refusal here is written to be forwarded to the person who sent
        // the link, and rewording it would lose the half that says what to
        // tell them. An alert, because it replaces the whole page.
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {linkRefusal(subject.error, locale, t)}
        </p>
      )}

      {subject.data && isPersonSubject(subject.data) && link && (
        <PersonGrant data={subject.data} link={link} />
      )}

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
            {t('grant.reads', { reads: list(subject.data.domains.map((d) => t(READS_KEY[d]))) })}
          </p>

          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="flex items-start gap-2 text-sm text-green-900">
              <ShieldCheck className="w-5 h-5 flex-shrink-0" />
              <span>{t(subject.data.readOnlyAtProvider ? 'grant.readOnly' : 'grant.readsOnly')}</span>
            </p>
          </div>

          <p className="mt-4 text-sm text-gray-600">{t('grant.scopeIntro')}</p>
          <p className="mt-1 text-sm font-mono break-all text-gray-900">{subject.data.scope}</p>

          <p className="mt-4 text-sm text-gray-600">
            {t('grant.until', { date: dateTime(subject.data.expiresAt) })}
          </p>

          {/* The account is a condition, not a label (0108 T8 (b)): any other
              account that signs in is refused and nothing is kept. Said before
              the button, with why Google will also ask for their address. */}
          <p className="mt-4 text-sm font-medium text-gray-900 break-words">
            {t('grant.signInAs', { account: subject.data.from })}
          </p>

          {/* A link sent by chat or mail opens inside that app's own browser,
              where Google is reported to refuse its consent (workplan 0140
              T3 (a); outside knowledge, 0140 §1). Always shown, with no
              sniffing for user agents, and before the button: opening the
              link again in a real browser spends nothing (`grant.ts`), and
              the line says so. */}
          <p className="mt-3 text-sm text-gray-600">{t('grant.inAppBrowser')}</p>

          <button
            type="button"
            onClick={connect}
            disabled={starting}
            className="mt-6 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {starting ? t('grant.connecting') : t('grant.connect')}
          </button>

          {failure != null && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              {linkRefusal(failure, locale, t)}
            </p>
          )}

          <p className="mt-6 text-sm text-gray-500">
            {t('grant.disclosure')}{' '}
            <a className="underline" href={legal.privacy}>
              {t('grant.privacy')}
            </a>{' '}
            <a className="underline" href={legal.terms}>
              {t('grant.terms')}
            </a>
          </p>
          <p className="mt-3 text-sm text-gray-500">{t('grant.withdraw')}</p>
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
};

export default Grant;
