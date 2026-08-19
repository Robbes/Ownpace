// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * "Email notifications are off" — where somebody can see it (workplan 0043 T3).
 *
 * 0030 T1 promised an unconfigured channel would be *"said honestly in the UI"*.
 * It was said honestly in the logs: one `log.info` at boot, plus a
 * `disabledNotifier` line emitted exactly once per process — so an appliance up
 * for a month said it once, a month ago. The owner 0030 describes "checks the UI
 * weekly at best" and never sees either.
 *
 * The failure this prevents is not a crash. It is an owner who believes silence
 * means nothing needs them, when it means nothing can reach them. Those two
 * states are indistinguishable without this.
 *
 * Renders NOTHING when the channel is on, and nothing when the payload does not
 * carry a `notifications` field at all — absent is deliberately not the same as
 * off (see `NotificationChannelReport`), and a banner for "nobody asked" would
 * send people hunting for a setting.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../i18n/index.tsx';
import { fetchStatus } from '../services/operating-service.ts';

export function NotificationChannelBanner(): React.ReactElement | null {
  const t = useT();
  const { data } = useQuery({
    queryKey: ['status', 'notifications'],
    queryFn: fetchStatus,
    // A failed read renders nothing rather than an alarming banner: "we could
    // not ask" is not "they are off", and this component must not become a
    // second way to be wrong about the same question.
    retry: false,
  });

  const channel = data?.notifications;
  if (!channel || channel.enabled) return null;

  return (
    <div
      role="status"
      className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="font-medium">{t('notifications.off')}</p>
      <p className="mt-1">{t('notifications.offHint')}</p>
      {channel.reason ? (
        <p className="mt-1">
          {/* VERBATIM. readNotifierConfig distinguishes nothing-set from
              half-set and names the missing variable; paraphrasing it here
              would throw away the only actionable part (rule 9). */}
          {t('notifications.offReason')} <span className="font-mono">{channel.reason}</span>
        </p>
      ) : null}
    </div>
  );
}
