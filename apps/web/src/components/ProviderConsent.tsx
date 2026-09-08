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
  isProviderAccountKind,
  type CredentialField,
  type DiscoveryDomain,
  type ProviderAccountKind,
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
      // registered with the provider BEFORE the first one can work.
      setRedirect(redirectUri ?? null);
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
 * The faces to ask for, the button, and what came back — in the provider's own
 * words. Renders nothing for a kind whose descriptor names no consent.
 */
export const ProviderConsentPanel: React.FC<{
  readonly consent: ProviderConsent;
  readonly className?: string;
}> = ({ consent, className = 'mt-4' }) => {
  const t = useT();
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
      <Hint text={words('connect.hint')} why={words('connect.why')} />
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
