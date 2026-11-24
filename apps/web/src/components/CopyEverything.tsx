// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * COPY EVERYTHING (workplan 0170 §5.3, §7.2): a migration of only the last 90
 * days, broadened to everything from its own page, without starting over.
 *
 * One way only (the owner, 2026-11-24: *"One should be able to broaden the
 * migration from 'only 90 days' to 'all'. We dont do the other way around"*):
 * nothing on any screen turns a migration of everything back into one of 90
 * days. And it is where the switch-over would be (D8, *"no, not before"*): a
 * migration of only the last 90 days is not switched over before this.
 *
 * One press opens a confirmation in place, *Copy everything older too? What
 * is there stays.*, and the second press sends `{ recentOnly: false }`. The
 * next pass of mail, files and calendars then copies the older items. A
 * refusal is the server's own sentence, shown beside the button; the page's
 * reads are forgotten on success, so the chip and this button go with the
 * next read rather than on a guess.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mappingApi } from '../services/mapping-service.ts';
import { forgetMappingLifecycle } from '../services/mapping-cache.ts';
import { serverMessage } from '../services/api.ts';
import { useT } from '../i18n/index.tsx';

export const CopyEverything: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const [asking, setAsking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  const copy = async () => {
    setSaving(true);
    setFailed(null);
    try {
      await mappingApi.copyEverything(mappingId);
      setAsking(false);
      await forgetMappingLifecycle(queryClient, mappingId);
    } catch (err) {
      setFailed(serverMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const button =
    'inline-flex items-center px-3 py-1 text-sm font-medium rounded border border-blue-300 text-blue-800 hover:bg-blue-50 disabled:opacity-50';
  return (
    <div data-copy-everything className="inline-flex flex-col items-end gap-1">
      {asking ? (
        <div role="group" aria-label={t('hub.window.copyEverything')} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-800">{t('hub.window.copyEverything.confirm')}</span>
          <button ref={confirmRef} type="button" onClick={() => void copy()} disabled={saving} className={button}>
            {saving ? t('hub.window.copyEverything.saving') : t('hub.window.copyEverything')}
          </button>
          <button
            type="button"
            onClick={() => {
              setAsking(false);
              setFailed(null);
            }}
            disabled={saving}
            className="text-sm text-gray-700 hover:underline disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={button}>
          {t('hub.window.copyEverything')}
        </button>
      )}
      {failed && (
        <p className="text-sm text-red-700">
          {t('hub.window.copyEverything.failed')} {failed}
        </p>
      )}
    </div>
  );
};
