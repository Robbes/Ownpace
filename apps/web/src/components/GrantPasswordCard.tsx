// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE OWN-PASSWORD CARD on a person's grant page (workplan 0174 T4: §5.2,
 * §5.7, §5.8). The person types the password of their own account, and it
 * never passes through whoever set up the migration.
 *
 * ## What it shows before the box, and why (§5.8, D3)
 *
 * A link that asks for a password is shaped exactly like phishing (ADR-0035
 * *Consequences*). So before the box, the card says three things:
 * - where the password goes: the server it is tried against, with its
 *   registrable domain in bold, and that only the person's own provider's
 *   server deserves it. For a provider that publishes its servers (Apple)
 *   it says that this is the provider's own server.
 * - D3's warning (the owner, 2026-11-25), when the route found the server is
 *   neither the address's domain nor one of its MX hosts' domains. It is a
 *   warning and never a refusal: the person decides.
 * - who will see the password: nobody, the one who asked included; and what
 *   Ownpace never does.
 *
 * ## What the person fills, and what they only read (§5.2, D2)
 *
 * The fields come from the API's `fields`, built from the one field table
 * (`credentialFieldsFor`). The owner's fields are shown with their values as
 * text, never as boxes. The person's fields are boxes, with the descriptor's
 * own label, hint, placeholder and autofill, so this card and the owner's form
 * cannot word one field two ways. A secret is `type="password"`, with *Show*
 * where the descriptor offers it.
 *
 * ## How it is sent (§5.3, §5.6, §7.3)
 *
 * By `fetch` (`grantApi.putPassword`), as a JSON body of a `PUT`. The page's
 * policy has `form-action 'none'`, and the form is never submitted: its submit
 * event is stopped, and no box has a `name`, so there is nothing a browser
 * could put into a URL. After every answer the boxes are emptied, and nothing
 * on the page keeps the password.
 *
 * ## What it says after (§5.7)
 *
 * Only the category, in the person's language: refused (with the tries left),
 * not reachable (no try counted), a face refused, or locked after five tries.
 * Never the server's own words.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import type { DiscoveryDomain } from '@openmig/shared';
import {
  grantApi,
  type GrantServer,
  type PasswordAnswer,
  type PasswordKind,
  type PersonField,
  type PersonGrantCard,
} from '../services/grant-service.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';

/** The tries a link gives each account (0174 §5.5, D4). Fewer than this is said on the card. */
export const TRIES_PER_LINK = 5;

/**
 * A provider's own name, for a kind that names one. A generic protocol kind
 * names none: its server is whoever the owner typed. Brand names, never
 * translated.
 */
const PROVIDER_NAME: Readonly<Partial<Record<PasswordKind, string>>> = {
  apple: 'Apple',
  soverin: 'Soverin',
  nextcloud: 'Nextcloud',
  cirrux: 'Cirrux',
  infomaniak: 'Infomaniak',
};

/** The kinds whose provider refuses the password the person signs in with: a refusal says to use an app password. */
const APP_PASSWORD_ONLY: ReadonlySet<PasswordKind> = new Set(['apple', 'cirrux', 'nextcloud']);

/**
 * The provider's own help, per kind (§5.2's last column). Apple and Nextcloud
 * fold their steps under a question; Cirrux and Infomaniak say theirs under
 * the box, through the descriptor's hint; every other kind gets the one line.
 */
const HOW: Readonly<Partial<Record<PasswordKind, { readonly question: StringKey; readonly steps: StringKey }>>> = {
  apple: { question: 'grant.apple.how', steps: 'grant.apple.how.more' },
  nextcloud: { question: 'grant.nextcloud.how', steps: 'grant.nextcloud.how.more' },
};
const HINT_UNDER_THE_BOX: ReadonlySet<PasswordKind> = new Set(['cirrux', 'infomaniak']);

/** A host with its registrable domain in bold: `imap.` then **example.com**. Whole host bold when the domain is not its tail. */
const BoldDomain: React.FC<{ host: string; domain: string | undefined }> = ({ host, domain }) => {
  if (domain && host !== domain && host.endsWith(`.${domain}`)) {
    return (
      <span className="font-mono break-all" data-server-host={host}>
        {host.slice(0, host.length - domain.length)}
        <strong className="font-semibold text-gray-900">{domain}</strong>
      </span>
    );
  }
  return (
    <span className="font-mono break-all" data-server-host={host}>
      <strong className="font-semibold text-gray-900">{host}</strong>
    </span>
  );
};

/** The hosts as one phrase of nodes, joined as the page's language joins a list. */
const Hosts: React.FC<{ server: GrantServer }> = ({ server }) => {
  const { list } = useFormatters();
  // The formatter joins markers, and each marker becomes its host's node.
  const joined = list(server.hosts.map((_, i) => `\u0001${i}\u0001`));
  const parts = joined.split(/\u0001(\d+)\u0001/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part === '' ? null : <React.Fragment key={i}>{part}</React.Fragment>;
        const h = Number(part);
        return <BoldDomain key={i} host={server.hosts[h]!} domain={server.registrable?.[h]} />;
      })}
    </>
  );
};

/**
 * A sentence with `{server}` in it, the hosts drawn in place of the token.
 * The dictionary fills strings; this splits the filled sentence at a marker
 * no translation contains and puts the nodes between.
 */
const MARK = '\u0000';
function withServer(sentence: string, server: GrantServer): React.ReactNode {
  const [before, after] = sentence.split(MARK);
  return (
    <>
      {before}
      <Hosts server={server} />
      {after}
    </>
  );
}

/** One box the person fills: a password with *Show* where offered, or text. */
const PersonBox: React.FC<{
  field: PersonField;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  idBase: string;
}> = ({ field, value, onChange, disabled, idBase }) => {
  const t = useT();
  const [shown, setShown] = React.useState(false);
  const id = `${idBase}-${field.key}`;
  const hintId = field.hintKey ? `${id}-hint` : undefined;
  return (
    <div className="text-sm" data-person-field={field.key}>
      <label htmlFor={id} className="block text-gray-700 mb-1">
        {t(field.labelKey as StringKey)}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          // No `name`: nothing here can ever be serialised into a URL.
          type={field.secret && !shown ? 'password' : 'text'}
          autoComplete={field.autoComplete ?? 'off'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder={field.placeholder}
          aria-describedby={hintId}
          className="input w-full"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.secret && field.revealable === true && (
          <button
            type="button"
            className="min-h-[44px] px-3 text-sm rounded-lg border border-gray-300 text-gray-700"
            aria-controls={id}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            {t(shown ? 'grant.password.hide' : 'grant.password.show')}
          </button>
        )}
      </div>
      {field.hintKey && (
        <p id={hintId} className="mt-1 text-sm text-gray-500">
          {t(field.hintKey as StringKey)}
        </p>
      )}
    </div>
  );
};

export interface GrantPasswordCardProps {
  readonly link: string;
  readonly card: PersonGrantCard;
  /** Who asked, as the page names them; the organisation when the member is gone. */
  readonly askedBy: string;
  readonly organisation: string;
  /** The card's state as the page holds it: connected here, or the tries the last answer left. */
  readonly onAnswer: (ref: string, answer: PasswordAnswer) => void;
  /** Connected through this page, this visit. */
  readonly connectedHere: boolean;
  /** Tries as the last answer left them, over the read's. */
  readonly tries: { readonly left: number; readonly locked: boolean } | null;
}

/** The body of a password card: everything under its heading and migration lines. */
export const GrantPasswordCard: React.FC<GrantPasswordCardProps> = ({
  link,
  card,
  askedBy,
  organisation,
  onAnswer,
  connectedHere,
  tries,
}) => {
  const t = useT();
  const { locale } = useLocale();
  const { list } = useFormatters();
  const idBase = React.useId();
  const kind = card.provider as PasswordKind;
  const server: GrantServer = card.server ?? { hosts: [], published: false };
  const fields = card.fields ?? [];
  const owners = fields.filter((f) => f.who === 'owner');
  const persons = fields.filter((f) => f.who === 'person');
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [checking, setChecking] = React.useState(false);
  const [answer, setAnswer] = React.useState<PasswordAnswer | null>(null);
  const hostsText = server.hosts.length > 0 ? list(server.hosts) : card.account;

  if (connectedHere) {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 text-sm font-medium text-green-800">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        {t('grant.password.connected')}
      </p>
    );
  }
  if (tries?.locked === true || answer?.kind === 'locked') {
    return (
      <p role={answer?.kind === 'locked' ? 'alert' : undefined} className="mt-3 flex items-start gap-2 text-sm text-amber-800">
        <Lock className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <span>{t('grant.password.locked', { askedBy })}</span>
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    // Never submitted by the browser: the policy has `form-action 'none'`,
    // and the password belongs in a body, not a URL.
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setAnswer(null);
    const sent = Object.fromEntries(persons.map((f) => [f.key, values[f.key] ?? '']));
    const got = await grantApi.putPassword(link, card.ref, sent, locale);
    // Emptied after every answer: the form stays, empty (§5.7).
    setValues({});
    setChecking(false);
    setAnswer(got);
    onAnswer(card.ref, got);
  };

  const faces = (ds: ReadonlyArray<DiscoveryDomain>) =>
    list(ds.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale)));

  /** What the last answer says, by category only (§5.7). */
  const failure = (a: PasswordAnswer): string | null => {
    switch (a.kind) {
      case 'refused_login': {
        const refused = t('grant.password.refused', {
          server: hostsText,
          left: a.left ?? (tries?.left ?? TRIES_PER_LINK),
        });
        return APP_PASSWORD_ONLY.has(kind) ? `${refused} ${t('grant.password.refused.app')}` : refused;
      }
      case 'unreachable':
        return t('grant.password.unreachable', { server: hostsText, askedBy });
      case 'face_missing': {
        const line = t('grant.password.faceMissing', { server: hostsText, faces: faces(a.faces) });
        // The provider's line under the box that names the password it wants (Infomaniak's mail).
        const hint = persons.find((f) => f.secret && f.hintKey && f.key === 'mailPassword')?.hintKey;
        return hint ? `${line} ${t(hint as StringKey)}` : line;
      }
      case 'refusal':
        return a.sentence ? (locale === 'nl' ? a.sentence.nl : a.sentence.en) : t('link.unreadable');
      case 'no_answer':
        return t('link.unreachable');
      default:
        return null;
    }
  };
  const said = answer ? failure(answer) : null;
  const left = tries?.left ?? TRIES_PER_LINK;
  const how = HOW[kind];
  const provider = PROVIDER_NAME[kind];

  return (
    <div className="mt-3" data-password-card={kind}>
      <p className="text-sm font-medium text-gray-900 break-words">{t('grant.password.title', { account: card.account })}</p>

      {/* WHERE THE PASSWORD GOES, AND WHO SEES IT (§5.8, D3), before any box. */}
      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2 text-sm text-blue-950" data-anti-phishing>
        <p className="flex items-start gap-2">
          <ShieldCheck className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <span data-server-line>
            {server.published && provider
              ? withServer(t('grant.password.published', { provider, server: MARK }), server)
              : withServer(t('grant.password.server', { server: MARK }), server)}
          </span>
        </p>
        {!server.published && server.addressMail === 'mismatch' && (
          <p className="flex items-start gap-2 text-amber-900" data-address-mail="mismatch">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <span>{t('grant.password.notAddressMail')}</span>
          </p>
        )}
        <p>{t('grant.password.nobody', { askedBy, organisation })}</p>
        <p>{t('grant.password.never')}</p>
      </div>

      {/* What the owner fixed (D2): shown, never a box. */}
      {owners.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-owner-fields>
          {owners.map((f) => (
            <React.Fragment key={f.key}>
              <dt className="text-gray-600">{t(f.labelKey as StringKey)}</dt>
              <dd className="text-gray-900 break-all" data-owner-field={f.key}>
                {f.value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {how && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none text-gray-700">{t(how.question)}</summary>
          <p className="mt-1 text-gray-600">{t(how.steps)}</p>
        </details>
      )}
      {!how && !HINT_UNDER_THE_BOX.has(kind) && <p className="mt-3 text-sm text-gray-600">{t('grant.password.appPassword')}</p>}

      <form className="mt-3 space-y-3" onSubmit={(e) => void submit(e)} autoComplete="off">
        {persons.map((f) => (
          <PersonBox
            key={f.key}
            field={f}
            idBase={idBase}
            value={values[f.key] ?? ''}
            disabled={checking}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
        {left < TRIES_PER_LINK && answer === null && (
          <p className="text-sm text-gray-700">{t('grant.password.triesLeft', { left })}</p>
        )}
        <button
          type="submit"
          disabled={checking || persons.length === 0}
          className="min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 break-words"
        >
          {t('grant.password.submit')}
        </button>
        {checking && (
          <p role="status" className="text-sm text-gray-600">
            {t('grant.password.checking', { server: hostsText })}
          </p>
        )}
        {said && (
          <p role="alert" className="text-sm text-amber-800">
            {said}
          </p>
        )}
      </form>
    </div>
  );
};

export default GrantPasswordCard;
