// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NEWER PAGE, OFFERED (workplan 0145; the owner's "build the deploy check
 * and the reload prompt", 2026-09-29).
 *
 * Asks the site which build it serves (`served-build.ts`) once when the page
 * opens, when the person comes back to the tab, every five minutes while the
 * tab is in front, and at once after an answer the page could not read. When
 * that is not the page's own build, it says so above the screen, with one
 * button.
 *
 * NEVER RELOADS BY ITSELF. A reload loses what somebody typed and did not
 * save, so the moment is theirs, and the sentence says what it costs. Once
 * shown it stays until they reload: the page they have does not get newer by
 * waiting.
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '../i18n/index.tsx';
import { uiBuild } from '../services/build-identity.ts';
import { fetchServedBuild, onAskServedBuild, servesAnotherBuild } from '../services/served-build.ts';

/** How often a tab in front asks: every five minutes. */
export const ASK_EVERY_MS = 5 * 60_000;

const NewVersionPrompt: React.FC<{
  /** TEST SEAM ONLY: what the button does; `location.reload()` otherwise. */
  readonly reload?: () => void;
}> = ({ reload }) => {
  const t = useT();
  const [newer, setNewer] = React.useState(false);

  React.useEffect(() => {
    let gone = false;
    let asking = false;
    // Told to ask while a question is still out: that answer may predate the
    // deploy the person is coming back from, so it asks once more after it.
    let again = false;
    const ask = async (): Promise<void> => {
      if (gone || document.visibilityState === 'hidden') return;
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      try {
        do {
          again = false;
          const served = await fetchServedBuild();
          if (!gone && servesAnotherBuild(uiBuild(), served)) setNewer(true);
        } while (again && !gone);
      } finally {
        asking = false;
      }
    };
    // Back in front: anything but hidden, since not every browser says
    // `visible` for a tab it is showing.
    const onBack = (): void => {
      if (document.visibilityState !== 'hidden') void ask();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    const every = window.setInterval(() => void ask(), ASK_EVERY_MS);
    const stop = onAskServedBuild(() => void ask());
    void ask();
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
      window.clearInterval(every);
      stop();
    };
  }, []);

  if (!newer) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
    >
      <RefreshCw className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      {/* A width of its own, so on a phone the button wraps under the
          sentence instead of squeezing it into a column beside it. */}
      <p className="min-w-0 flex-1 basis-60">{t('reload.newer')}</p>
      <button
        type="button"
        onClick={() => (reload ?? (() => window.location.reload()))()}
        className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
      >
        {t('reload.button')}
      </button>
    </div>
  );
};

export default NewVersionPrompt;
