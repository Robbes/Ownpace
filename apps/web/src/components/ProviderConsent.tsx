// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Connect with Google / Microsoft / Dropbox — one path, both doors.
 *
 * ## The dead end this closes
 *
 * A refresh token is the credential most likely to need replacing: it is the
 * one a provider revokes, expires, or invalidates when somebody changes a
 * password. Replace credentials on the connection card offered a box for it
 * and a Check and replace button — and no way to OBTAIN one. On a managed
 * deployment, where the person never had the client pair to run a consent
 * themselves, that made the panel unusable for exactly the credential it
 * exists to fix; the owner met it on a Google connection and a Microsoft one.
 *
 * The add form had the button (workplan 0089 T1, then #719 and Dropbox). The
 * rotate panel is the same question asked by the same person about the same
 * connection, so it must be the same path — not a second implementation that
 * can drift. Hence this module: the add form and the rotate panel now import
 * one hook and one component, and neither knows a provider's name.
 *
 * ## What stays the descriptor's answer
 *
 * WHOSE consent mints this kind's token is `consent` on the refresh-token
 * field (2026-09-02): Google's kinds say google, Dropbox says dropbox, and a
 * kind that says nothing gets no button at all. Not a list of kinds kept in a
 * page — that would be a second copy of the same table, and the reason this
 * whole file exists is that a second copy drifts.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PROVIDER_ACCOUNT_DOMAINS,
  googleConsentAllowsChanges,
  isProviderAccountKind,
  sourceTypeDomains,
  type CredentialField,
  type DiscoveryDomain,
  type ProviderAccountKind,
  type WizardSourceType,
} from '@openmig/shared';
import {
  mappingApi,
  providerAccountsApi,
  providerClientsApi,
} from '../services/mapping-service.ts';
import { useT, type StringKey } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';

export interface ProviderConsent {
  /** The provider whose consent mints this kind's token, or undefined. */
  readonly provider: string | undefined;
  /** Whether this kind has a consent at all — the button's whole condition. */
  readonly isGrantKind: boolean;
  /** Whether the deployment carries its own application for that provider. */
  readonly deploymentClient: boolean;
  readonly isAccountKind: boolean;
  readonly faces: ReadonlyArray<DiscoveryDomain>;
  readonly domains: DiscoveryDomain[];
  /**
   * What this consent asks the provider for: an account's ticked faces, or
   * the one type a single-purpose card is. What the lines beside the button
   * describe (`ConsentLines`, workplan 0144 T3 (a)).
   */
  readonly asked: ReadonlyArray<DiscoveryDomain>;
  readonly setDomains: React.Dispatch<React.SetStateAction<DiscoveryDomain[]>>;
  readonly note: string | null;
  readonly redirect: string | null;
  readonly pairMissing: boolean;
  readonly facesMissing: boolean;
  readonly accountMissing: boolean;
  readonly start: () => Promise<void>;
  readonly reset: () => void;
  /** Rises by one each time a token lands, so a SECOND consent submits again. */
  readonly landed: number;
  /** The provider's own words for the button, fold and hints. */
  readonly words: (suffix: ConsentWord) => string;
}

type ConsentWord =
  | 'connect'
  | 'connect.hint'
  | 'connect.why'
  | 'connect.needsClient'
  | 'connect.halfClient'
  | 'deploymentClient'
  | 'ownClient'
  | 'redirectUri';

export function useProviderConsent(opts: {
  readonly role: 'source' | 'target';
  readonly type: string;
  readonly fields: ReadonlyArray<CredentialField>;
  /** What is currently typed into the form this consent belongs to. */
  readonly values: Record<string, string>;
  /** Where a landed token goes — the SAME field a pasted one fills (ADR-0037). */
  readonly onToken: (refreshToken: string) => void;
  /** Turn an error into the sentence this form shows. */
  readonly refusalText: (err: unknown) => string;
}): ProviderConsent {
  const { role, type, fields, values, onToken, refusalText } = opts;
  const t = useT();

  const provider = role === 'source' ? fields.find((f) => f.key === 'refreshToken')?.consent : undefined;
  const isGrantKind = provider !== undefined;

  // Does this deployment carry its own application for THAT provider
  // (ADR-0041)? One fact per provider, read over the wire, never compiled in,
  // and defaulting to "no" while the answer is on its way — the direction
  // that cannot under-ask.
  const { data: providerClients } = useQuery({
    queryKey: ['provider-clients'],
    queryFn: providerClientsApi.get,
    retry: false,
    staleTime: Infinity,
  });
  const deploymentClient = provider !== undefined && providerClients?.[provider] === 'deployment';

  // An account kind is the one the table calls an account, and nothing else —
  // `type === provider` was true of `dropbox` too, which is a SINGLE-face
  // source, and disabled its button waiting for face ticks it never shows.
  const isAccountKind = isProviderAccountKind(type);
  const { data: providerAccounts } = useQuery({
    queryKey: ['provider-accounts'],
    queryFn: providerAccountsApi.get,
    enabled: isAccountKind,
  });
  const faces: ReadonlyArray<DiscoveryDomain> = isAccountKind
    ? (providerAccounts?.[type]?.domains ?? PROVIDER_ACCOUNT_DOMAINS[type as ProviderAccountKind] ?? [])
    : [];

  const [domains, setDomains] = React.useState<DiscoveryDomain[]>([]);
  const asked = consentAsks(type, domains, faces);
  const [note, setNote] = React.useState<string | null>(null);
  const [redirect, setRedirect] = React.useState<string | null>(null);
  const [landed, setLanded] = React.useState(0);

  const clientIdTyped = (values.clientId ?? '').trim() !== '';
  const clientSecretTyped = (values.clientSecret ?? '').trim() !== '';
  // One half typed is a pair being typed, never a pair left to the deployment
  // (ADR-0041): both or neither, as every door refuses it.
  const pairRequired = !deploymentClient || clientIdTyped !== clientSecretTyped;
  const ownPair =
    clientIdTyped && clientSecretTyped
      ? { clientId: (values.clientId ?? '').trim(), clientSecret: values.clientSecret ?? '' }
      : {};
  const pairMissing = pairRequired && !(clientIdTyped && clientSecretTyped);
  const facesMissing = isAccountKind && domains.length === 0;
  // Every required field but the token the consent fills. Pressed before the
  // address was typed, the add door answered "Still needed: username" to a
  // form whose button had just said yes; the rotate route validates every
  // required field too, so the same check serves both.
  const accountMissing = fields.some(
    (f) => f.required && f.key !== 'refreshToken' && (values[f.key] ?? '').trim() === '',
  );

  // The popup hands the token back over postMessage — same origin, the flow's
  // own shape, a non-empty token. THIS kind's provider is read at the moment a
  // message lands: a Google popup left open behind a Dropbox form must not
  // hand its token to Dropbox's box.
  const providerRef = React.useRef(provider);
  providerRef.current = provider;
  const onTokenRef = React.useRef(onToken);
  onTokenRef.current = onToken;
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; refreshToken?: string } | null;
      if (event.origin !== window.location.origin) return;
      const p = providerRef.current;
      if (p === undefined) return;
      if (!data || data.type !== `ownpace-${p}-consent`) return;
      if (typeof data.refreshToken !== 'string' || data.refreshToken.length === 0) return;
      onTokenRef.current(data.refreshToken);
      setNote('received');
      setLanded((n) => n + 1);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const start = async () => {
    setNote(null);
    try {
      // ONE ASK PER PROVIDER, off a table rather than a `?:` chain (workplan
      // 0114). A chain's else branch ran GOOGLE's authorize for anything that
      // was not Dropbox — so a third provider would not have failed to
      // compile, it would have asked the wrong company for a consent and
      // reported success.
      const beginConsent: Record<string, () => Promise<{ url: string; redirectUri?: string }>> = {
        dropbox: () => mappingApi.dropboxAuthorize(ownPair),
        // The ACCOUNT asks for exactly the faces ticked, so the consent screen
        // and the ticks cannot disagree; the single-purpose kinds ask for
        // their own one scope.
        microsoft: () => mappingApi.microsoftAuthorize({ domains, ...ownPair }),
        google: () =>
          mappingApi.googleAuthorize(
            isAccountKind
              ? { domains, ...ownPair }
              : {
                  sourceType: type as
                    | 'gmail'
                    | 'google-calendar'
                    | 'google-contacts'
                    | 'google-drive',
                  ...ownPair,
                },
          ),
      };
      const begin = provider === undefined ? undefined : beginConsent[provider];
      if (!begin) {
        // Never silently Google's. A descriptor naming a provider this table
        // has no row for is a defect, and saying so beats consenting to the
        // wrong company on somebody's behalf.
        setNote(t('wizard.consent.noProvider'));
        return;
      }
      const { url, redirectUri } = await begin();
      // The address this consent used, shown on every attempt: it has to be
      // registered with the provider BEFORE the first one can work — by whoever
      // owns the application. With a pair the person typed, that is them; with
      // none, the consent ran on the deployment's own, whose addresses are the
      // operator's to register, so the line would send them to a console they
      // have no app in (workplan 0148 T2 (a)).
      setRedirect('clientId' in ownPair ? (redirectUri ?? null) : null);
      window.open(url, `ownpace-${provider ?? 'google'}-consent`, 'popup,width=520,height=640');
    } catch (err) {
      setNote(refusalText(err));
    }
  };

  const reset = () => {
    setDomains([]);
    setNote(null);
    setRedirect(null);
  };

  const words = (suffix: ConsentWord) => t(`wizard.${provider ?? 'google'}.${suffix}` as StringKey);

  return {
    provider,
    isGrantKind,
    deploymentClient,
    isAccountKind,
    faces,
    domains,
    setDomains,
    asked,
    note,
    redirect,
    pairMissing,
    facesMissing,
    accountMissing,
    start,
    reset,
    landed,
    words,
  };
}

/**
 * What a consent for this source asks for: the faces ticked, for a provider
 * ACCOUNT (the only kind whose consent is a set), and otherwise the one type
 * the card is. Shared by both doors, so the wizard and the Connections page
 * describe the same ask the same way.
 *
 * An account's ticks count only inside `served`, the faces this deployment
 * serves for the kind (`/api/provider-accounts`, read by the door). The
 * Connections panel offers only those, but the wizard's source step offers all
 * five, and a tick outside the answer is refused by the server before Google
 * is asked for anything, so it is no part of the ask. `undefined` means the
 * door has no answer that bounds this kind, and the ticks stand.
 */
export function consentAsks(
  type: string,
  ticked: ReadonlyArray<DiscoveryDomain>,
  served: ReadonlyArray<DiscoveryDomain> | undefined,
): ReadonlyArray<DiscoveryDomain> {
  if (isProviderAccountKind(type)) {
    return served === undefined ? ticked : ticked.filter((d) => served.includes(d));
  }
  return sourceTypeDomains(type as WizardSourceType) ?? [];
}

/**
 * THE LINES BESIDE A CONNECT BUTTON, laid out once for both doors.
 *
 * The wizard's source step draws its own button and the Connections page
 * draws the panel below; what sits under either is this, so the two cannot
 * say different things about the same consent. That is the button's own hint
 * and, by provider, the consent screens' own lines: for Google, what the
 * permission allows (workplan 0144 T3 (a)) and the in-app browser (0140 T3
 * (a)); for Microsoft, what an organisation may ask (0140 T6 (b)). What the
 * picked card IS stays one line higher, where the wizard says it (0148 T2 (a)'s
 * about-line), so nothing here repeats whose app it is.
 *
 * **The line beside *Connect with Google*.** Google's screen, one click later,
 * describes `https://mail.google.com/`, `auth/calendar` and `auth/carddav` as
 * allowing changes and permanent deletion. That is the first a tester heard of
 * it, on a page they have never seen, from a company that is not us. So the
 * line says it first, with what is true of Ownpace: it only reads, and changes
 * and deletes nothing. Shown when the consent asks for mail, calendars or
 * contacts, and not for Drive or Tasks, whose scopes Google holds to reading
 * (`googleConsentAllowsChanges`, from shared, held to the scope tables by their
 * tests). It is §3's two sentences, whole: a promise about a consent, which the
 * owner's copy rule keeps verbatim (0118 §2), not a field hint to be cut to
 * twelve words, and so it has no fold.
 *
 * Whose app asks (the deployment's or one the person typed in) changes nothing
 * here: the scope Google describes is the same. What the deployment decides is
 * which faces an account consent may ask for at all, and `asked` is kept
 * inside that answer by `consentAsks`: the Connections panel offers only the
 * faces `/api/provider-accounts` returned, and the wizard's source step offers
 * all five, so there the door hands the answer in.
 *
 * **The in-app browser, beside *Connect with Google*** (0140 T3 (a)). A link
 * tapped in a chat or mail app opens in that app's own browser, where Google
 * is reported to refuse its consent (*"Error 403: disallowed_useragent"*,
 * outside knowledge, 0140 §1). One plain line, always shown for Google, with
 * no sniffing for user agents: that is T3's optional part, not built. It ends
 * by signing in to Ownpace again, because these doors have no grant link to
 * reopen; the grant page carries its own twin above its button. Dropbox and
 * Microsoft get none, because how they behave there is not known (§1).
 *
 * **What an organisation may ask, beside *Connect with Microsoft*** (0140 T6
 * (b)). The deployment's registration serves every organisation (authority
 * `common`), and an organisation decides who in it may consent to an app like
 * that. A tester from one met it only after the button, as
 * `microsoftConsentRefusal`'s sentence. The line says it before, and holds
 * whether or not publisher verification (T5) is done. It is shown with a pair
 * the person typed too, where it still holds: an organisation's consent
 * settings decide for a registration of its own as well, and the line says
 * "may".
 *
 * **Heard before the button is pressed** (the review of 2026-09-26). Both
 * lines come after the button in the page, so a keyboard or screen-reader user
 * reaches the button first; T6's whole point is that the line is known before
 * pressing. So each door's button points at them (`aria-describedby`, as 0148
 * did for its select), through `consentLineIds`, which names the ids this
 * component gives them.
 */
export const ConsentLines: React.FC<{
  /** The provider whose consent the button runs, from the descriptor. */
  readonly provider: string | undefined;
  /** What the consent asks for (`consentAsks`). */
  readonly asked: ReadonlyArray<DiscoveryDomain>;
  /** The door's own `useId()`, which its button hands to `consentLineIds`. */
  readonly idBase: string;
}> = ({ provider, asked, idBase }) => {
  const t = useT();
  if (provider === undefined) return null;
  const beforePressing = consentLineIds(provider, idBase);
  const word = (suffix: 'connect.hint' | 'connect.why') => t(`wizard.${provider}.${suffix}` as StringKey);
  return (
    <>
      <Hint text={word('connect.hint')} why={word('connect.why')} />
      {provider === 'google' && googleConsentAllowsChanges(asked) && (
        <Hint text={t('wizard.google.readsOnly')} />
      )}
      {provider === 'google' && <Hint id={beforePressing} text={t('wizard.google.inAppBrowser')} />}
      {provider === 'microsoft' && <Hint id={beforePressing} text={t('wizard.microsoft.orgApproval')} />}
    </>
  );
};

/**
 * The id of the line beside a provider's Connect button that must be heard
 * before it is pressed (0140 T3 (a) for Google, T6 (b) for Microsoft), for the
 * button's `aria-describedby`; undefined where `ConsentLines` draws none.
 */
export function consentLineIds(provider: string | undefined, idBase: string): string | undefined {
  if (provider === 'google') return `${idBase}-in-app-browser`;
  if (provider === 'microsoft') return `${idBase}-org-approval`;
  return undefined;
}

/**
 * The faces to ask for, the button, and what came back — in the provider's own
 * words. Renders nothing for a kind whose descriptor names no consent.
 */
export const ProviderConsentPanel: React.FC<{
  readonly consent: ProviderConsent;
  readonly className?: string;
}> = ({ consent, className = 'mt-4' }) => {
  const t = useT();
  const linesId = React.useId();
  if (!consent.isGrantKind) return null;
  const { words } = consent;
  return (
    <div className={className}>
      {consent.isAccountKind && (
        <fieldset className="mb-3">
          <legend className="block text-sm text-gray-700 mb-1">{t('connections.googleFaces')}</legend>
          <div className="flex flex-wrap gap-4">
            {consent.faces.map((face) => (
              <label key={face} className="inline-flex items-center gap-1 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={consent.domains.includes(face)}
                  onChange={() =>
                    consent.setDomains((d) =>
                      d.includes(face) ? d.filter((x) => x !== face) : [...d, face],
                    )
                  }
                />
                {t(`domain.${face}` as StringKey)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button
        type="button"
        onClick={consent.start}
        disabled={consent.pairMissing || consent.facesMissing || consent.accountMissing}
        aria-describedby={consentLineIds(consent.provider, linesId)}
        className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        title={
          consent.pairMissing
            ? consent.deploymentClient
              ? words('connect.halfClient')
              : words('connect.needsClient')
            : consent.facesMissing
              ? t('wizard.google.connect.needsDomains')
              : consent.accountMissing
                ? t('wizard.consent.needsAccount')
                : undefined
        }
      >
        {words('connect')}
      </button>
      <ConsentLines provider={consent.provider} asked={consent.asked} idBase={linesId} />
      {consent.note && (
        <p className={`mt-1 text-sm ${consent.note === 'received' ? 'text-green-700' : 'text-amber-800'}`}>
          {consent.note === 'received' ? t('wizard.consent.received') : consent.note}
        </p>
      )}
      {consent.redirect && consent.note !== 'received' && (
        <p className="mt-1 text-sm text-gray-500">
          {words('redirectUri')}{' '}
          <code className="break-all font-mono text-xs">{consent.redirect}</code>
        </p>
      )}
    </div>
  );
};
