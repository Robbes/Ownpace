// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The question at *Start* (workplan 0109 T6, the path axis; ADR-0014: *"a
 * path waits for the yes at activation"*).
 *
 * When starting these migrations would run more at the same time than the
 * organisation's tier runs, the server refuses the start (`PathsNeedAYes`), so
 * the step asks first, with both ways on side by side (the owner, 2026-10-04):
 * move up, at the monthly said, and start everything; or start what fits now,
 * and leave the rest set up. The plain *Start* gives way to the two while the
 * question stands (`onAsking`), since pressing it would only be refused.
 *
 * Every step up is consented and paid for, so a press of *Move up* is not yet
 * the yes: it asks once more with the money said, as the Billing page does,
 * and only "Yes, I agree" sends the tier and the price shown. A refusal is
 * said beside the question, which is asked again from the server.
 *
 * The server's own rule answers the question (`GET /billing/paths`), so the
 * question asked is the refusal the start would get. During the alpha it is
 * a note: nothing waits for a yes and everything starts. Managed only, and for
 * owners and admins, who can say yes; anyone else, and a read that fails, sees
 * the step as it was, and the server's refusal says the rest. Rendered
 * through `PathsAtStartNote`, which keeps it out of the appliance's bundle.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { billingApi } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import { isSelfHost } from '../services/edition.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT, useFormatters } from '../i18n/index.tsx';

export interface PathsAtStartProps {
  /** The migrations *Start* would start, in the order it starts them. */
  readonly mappingIds: ReadonlyArray<string>;
  /** Whether *Start* may not be pressed now (a start under way, a tick-box not yet ticked): the buttons wait too. */
  readonly disabled: boolean;
  /** Told whether the question stands, so the plain *Start* can give way to it. */
  readonly onAsking: (asking: boolean) => void;
  /** Start them: every one, or only those named. */
  readonly onStart: (only?: ReadonlyArray<string>) => void;
}

export const PathsAtStart: React.FC<PathsAtStartProps> = ({ mappingIds, disabled, onAsking, onStart }) => {
  const t = useT();
  const { currency } = useFormatters();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [confirming, setConfirming] = React.useState(false);

  const forecast = useQuery({
    queryKey: ['billing-paths', mappingIds.join(',')],
    queryFn: () => billingApi.getPathsAtStart(mappingIds),
    enabled: canManage && !isSelfHost() && mappingIds.length > 0,
    retry: false,
  });
  const f = forecast.data;
  const asking = f !== undefined && f.past && f.holds;

  React.useEffect(() => {
    onAsking(asking);
  }, [asking, onAsking]);
  React.useEffect(() => () => onAsking(false), [onAsking]);

  const yes = useMutation({
    mutationFn: (body: { tierId: string; priceEur: number }) => billingApi.sayYesToPaths(body),
    onSuccess: async () => {
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['billing-ceiling'] }),
        queryClient.invalidateQueries({ queryKey: ['billing-paths'] }),
      ]);
      onStart();
    },
    onError: () => {
      // Asked again: the tier, the price or the slots may have moved.
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['billing-paths'] });
    },
  });

  if (!f || !f.past) return null;
  // The table is in whole euros; `currency` takes cents.
  const eur = (whole: number): string => currency(whole * 100, 'EUR');
  const sentence = t('paths.atStart', { after: f.after, tier: f.tier.name, paths: f.tier.paths });

  if (!f.holds) {
    return (
      <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
        <p>{sentence}</p>
        <p>{t('paths.atStart.alpha')}</p>
      </div>
    );
  }

  const needs = f.needs;
  const total = mappingIds.length;
  const busy = disabled || yes.isPending;
  return (
    <section data-paths-at-start className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-3">
      <p>{sentence}</p>
      {yes.isError && (
        <p className="text-red-800" role="alert">
          <span className="font-medium">{t('billing.ceiling.yesFailed')}</span> {serverMessage(yes.error)}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2 text-gray-900">
          {needs ? (
            <>
              <h3 className="font-medium">{t('paths.atStart.moveUp', { tier: needs.name })}</h3>
              <p>{t('paths.atStart.moveUp.what', { paths: needs.paths, monthly: eur(needs.monthlyEur) })}</p>
              {confirming ? (
                <div role="alertdialog" aria-live="polite" className="space-y-2">
                  <p>{t('billing.ceiling.confirm.moveUp', { monthly: eur(needs.monthlyEur), tier: needs.name })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => yes.mutate({ tierId: needs.id, priceEur: needs.monthlyEur })}
                      disabled={busy}
                      className="inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                    >
                      {yes.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t('billing.ceiling.confirm.yes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                      className="min-h-[44px] px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      {t('billing.ceiling.confirm.no')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  className="min-h-[44px] px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {t('paths.atStart.moveUp.button', { tier: needs.name })}
                </button>
              )}
            </>
          ) : (
            <p>{t('paths.atStart.talkToUs')}</p>
          )}
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2 text-gray-900">
          <h3 className="font-medium">{t('paths.atStart.fits')}</h3>
          {f.fits.length > 0 ? (
            <>
              <p>{t('paths.atStart.fits.what', { count: f.fits.length, total, tier: f.tier.name })}</p>
              <button
                type="button"
                onClick={() => onStart(f.fits)}
                disabled={busy}
                className="min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium"
              >
                {t('paths.atStart.fits.button', { count: f.fits.length, total })}
              </button>
            </>
          ) : (
            <p>{t('paths.atStart.fits.none')}</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default PathsAtStart;
