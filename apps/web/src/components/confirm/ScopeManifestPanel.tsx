// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The §11.2 scope manifest: what migrates, what migrates partially, and what
 * does not migrate at all (ADR-0026).
 *
 * Also previously duplicated between the appliance's hand-rolled HTML and the
 * managed React wizard. It is the honest answer to "what am I actually getting",
 * and it is shown BEFORE the green light rather than discovered afterwards —
 * so the two editions saying it slightly differently was never acceptable.
 *
 * The server owns the content (`GET /scope-manifest`), in English and in
 * Dutch; this only lays it out, in the reader's language.
 */

import React from 'react';
import { useLocale, useT } from '../../i18n/index.tsx';
import { scopeManifestWords, type ScopeManifest } from '@openmig/shared';
import { GuideLink } from '../GuideLink.tsx';

/**
 * ONE LINE PER ROW, THE REST FOLDED (owner, 2026-09-17).
 *
 * *"the explaining tekst about 'Migrates' in green, 'Partial' in orange and
 * 'Does not migrate' in grey contain alot of tekst. Please compres/rewrite to
 * contain the Essentials."*
 *
 * Four of these rows had grown to five and six lines, so three columns of
 * paragraphs met somebody at the moment they decide whether to start — and the
 * longest rows were the ones carrying the caveats most worth reading, which is
 * the worst way round. The manifest now carries `detail` (the essential) and
 * `more` (everything else, verbatim), and this renders the second behind the
 * same native fold the wizard's hints use: 0118 T1's rule, applied to server
 * prose.
 *
 * NOTHING IS DROPPED. A disclosure compressed out of existence is exactly what
 * §11.2's "no silent omissions" forbids, so the fold is the answer rather than
 * the delete key — and a guard in shared holds each phrase that must survive.
 */
const Column: React.FC<{
  title: string;
  tone: string;
  entries: ScopeManifest['migrates'];
}> = ({ title, tone, entries }) => {
  const { locale, t } = useLocale();
  return (
    <div>
      <h4 className={`text-sm font-semibold ${tone} mb-1`}>{title}</h4>
      <ul className="space-y-1">
        {entries.map((e) => {
          // The row in the reader's language (2026-10-14): its Dutch half
          // under `nl`, or the English as served where a row has none, said
          // as English so a screen reader does not read it in a Dutch voice.
          const words = scopeManifestWords(e, locale);
          const english = locale !== 'en' && e.nl === undefined;
          return (
            <li key={e.item} className="text-xs text-gray-700" lang={english ? 'en' : undefined}>
              <span className="font-medium">{words.item}</span> — {words.detail}
              {words.more !== undefined && (
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-gray-500">
                    {t('fold.more')}
                  </summary>
                  <p className="mt-1 text-gray-500">{words.more}</p>
                </details>
              )}
              {/* The row's guide, beside its words (0148 T7). */}
              <GuideLink handle={e.guide} className="block mt-1 text-xs text-blue-700 hover:underline" />
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const ScopeManifestPanel: React.FC<{ manifest: ScopeManifest }> = ({ manifest }) => {
  // Column titles are CLIENT framing (translated). The entries are the
  // server's own prose with their Dutch beside them in shared, so each row
  // picks its half rather than being translated here (the prose boundary,
  // class 4).
  const t = useT();
  return (
    <section aria-label={t('scope.title')} className="grid gap-4 md:grid-cols-3">
      <Column title={t('scope.migrates')} tone="text-green-700" entries={manifest.migrates} />
      <Column title={t('scope.partial')} tone="text-amber-700" entries={manifest.partial} />
      <Column
        title={t('scope.doesNotMigrate')}
        tone="text-gray-500"
        entries={manifest.doesNotMigrate}
      />
    </section>
  );
};

export default ScopeManifestPanel;
