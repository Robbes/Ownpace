// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * FINISH'S STEP 4, the part that reads (workplan 0171 §7, T10).
 *
 * Until alpha.20 step 4 was the one step nothing checked: it said so, and the
 * person ticked it on trust. Two things are read now, both live and neither
 * stored:
 *
 * - **The addresses that receive mail** at the old provider, for a mailbox on
 *   a domain the person controls: each one must exist at the new provider
 *   before MX moves, or mail to it bounces. Each has a tick, which is the
 *   person's own note: Ownpace cannot see a destination's aliases, so the list
 *   is advice, never a gate.
 * - **The MX check**, on a button: one line saying where MX points. The tick
 *   below it stays the person's (D8 (a)): DNS differs between resolvers for a
 *   day, and the list of known hosts starts short.
 *
 * The body is split by the kind of address: the MX sentence for an own domain,
 * forwarding and the automatic reply for an address the provider keeps, and
 * both, as before, while the address is not known.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { ReceivingAddresses } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import { Hint } from '../Hint.tsx';
import { serverMessage } from '../../services/api.ts';
import { checkMxNow, fetchFinishAddresses, type MxCheckAnswer } from '../../services/operating-service.ts';

type MxState = 'idle' | 'checking' | { readonly answer: MxCheckAnswer } | { readonly failed: unknown };

/** HTTP 429 from the pace: said as a wait, not as a failure. */
function isPaced(err: unknown): boolean {
  return (err as { response?: { status?: number } } | null)?.response?.status === 429;
}

const AddressList: React.FC<{ receiving: ReceivingAddresses }> = ({ receiving }) => {
  const t = useT();
  const [made, setMade] = React.useState<Record<string, boolean>>({});
  if (receiving.state === 'not_readable') return <p className="mt-1 text-gray-600">{t('finish.aliases.notReadable')}</p>;
  if (receiving.state === 'not_read') {
    return (
      <p className="mt-1 text-amber-800">
        {receiving.why === 'api_off'
          ? t('finish.aliases.apiOff')
          : t('finish.aliases.notRead', { provider: receiving.provider })}
      </p>
    );
  }
  if (receiving.state === 'failed') {
    return (
      <p className="mt-1 text-amber-800">
        {t('finish.aliases.failed')} <span className="font-mono text-xs">{receiving.reason}</span>
      </p>
    );
  }
  if (receiving.addresses.length === 0) return <p className="mt-1 text-gray-600">{t('finish.aliases.none')}</p>;
  return (
    <ul className="mt-1 space-y-1">
      {receiving.addresses.map((a) => (
        <li key={a}>
          <label className="flex flex-wrap items-center gap-x-2 text-gray-800">
            <input
              type="checkbox"
              checked={made[a] ?? false}
              onChange={(e) => setMade((m) => ({ ...m, [a]: e.target.checked }))}
            />
            <span className="font-mono text-xs break-all">{a}</span>
            <span className="text-gray-500">{t('finish.aliases.made')}</span>
          </label>
        </li>
      ))}
    </ul>
  );
};

const MxLine: React.FC<{ state: MxState }> = ({ state }) => {
  const t = useT();
  if (state === 'idle' || state === 'checking') return null;
  if ('failed' in state) {
    return isPaced(state.failed) ? (
      <p className="mt-1 text-gray-600">{t('finish.mx.paced')}</p>
    ) : (
      <p className="mt-1 text-amber-800">
        {t('finish.mx.failed')} {serverMessage(state.failed)}
      </p>
    );
  }
  const { answer } = state;
  if (answer.domain === null) return null;
  const r = answer.reading;
  const domain = answer.domain;
  switch (r.line) {
    case 'ok':
      return <p className="mt-1 text-emerald-700">{t('finish.mx.ok', { domain, destination: r.destination })}</p>;
    case 'old':
      return <p className="mt-1 text-amber-800">{t('finish.mx.old', { domain, hosts: r.hosts.join(', ') })}</p>;
    case 'other':
      return <p className="mt-1 text-gray-800">{t('finish.mx.other', { domain, hosts: r.hosts.join(', ') })}</p>;
    case 'disagree':
      return <p className="mt-1 text-amber-800">{t('finish.mx.disagree')}</p>;
    case 'none':
      return <p className="mt-1 text-amber-800">{t('finish.mx.none', { domain })}</p>;
    case 'unreadable':
      return (
        <p className="mt-1 text-amber-800">
          {t('finish.mx.unreadable')} <span className="font-mono text-xs">{r.reasons.join('; ')}</span>
        </p>
      );
  }
};

const DeliveryMoves: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const t = useT();
  const [mx, setMx] = React.useState<MxState>('idle');
  const addresses = useQuery({
    queryKey: ['finish-addresses', mappingId],
    queryFn: () => fetchFinishAddresses(mappingId),
    staleTime: 60_000,
  });

  const check = () => {
    setMx('checking');
    void checkMxNow(mappingId)
      .then((answer) => setMx({ answer }))
      .catch((failed: unknown) => setMx({ failed }));
  };

  const data = addresses.data;
  // While the address is unread, or could not be read, both ways are said, as before.
  const body =
    data === undefined || data.address === null
      ? 'finish.step4.body'
      : data.ownDomain !== null
        ? 'finish.step4.body.own'
        : 'finish.step4.body.kept';

  return (
    <>
      <Hint className="" tone="body" label="more" text={t(body)} why={t('finish.step4.more')} />
      {body !== 'finish.step4.body.own' && <p className="mt-1">{t('finish.step4.autoreply')}</p>}
      {addresses.error != null && (
        // Unread is not "nothing to make" (rule 9).
        <p className="mt-1 text-amber-800">
          {t('finish.aliases.failed')} {serverMessage(addresses.error)}
        </p>
      )}
      {addresses.isLoading && (
        <p className="mt-1 flex items-center gap-1 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('finish.aliases.reading')}
        </p>
      )}
      {data?.ownDomain != null && (
        <>
          <div className="mt-2">
            <p className="font-medium text-gray-900">{t('finish.aliases.title')}</p>
            <Hint className="" tone="muted" text={t('finish.aliases.hint')} why={t('finish.aliases.why')} />
            {data.receiving && <AddressList receiving={data.receiving} />}
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={check}
              disabled={mx === 'checking'}
              className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {mx === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('finish.mx.check')}
            </button>
            <MxLine state={mx} />
          </div>
        </>
      )}
    </>
  );
};

export default DeliveryMoves;
