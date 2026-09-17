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
 * The server owns the content (`GET /scope-manifest`); this only lays it out.
 */

import React from 'react';
import { useT } from '../../i18n/index.tsx';
import type { ScopeManifest } from '@openmig/shared';

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
  const t = useT();
  return (
    <div>
      <h4 className={`text-sm font-semibold ${tone} mb-1`}>{title}</h4>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.item} className="text-xs text-gray-700">
            <span className="font-medium">{e.item}</span> — {e.detail}
            {e.more !== undefined && (
              <details className="mt-1">
                <summary className="cursor-pointer select-none text-gray-500">
                  {t('fold.more')}
                </summary>
                <p className="mt-1 text-gray-500">{e.more}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export const ScopeManifestPanel: React.FC<{ manifest: ScopeManifest }> = ({ manifest }) => {
  // Column titles are CLIENT framing (translated); the entries inside the
  // columns are server prose and render verbatim (the prose boundary).
  const t = useT();
  return (
    <section aria-label="scope-manifest" className="grid gap-4 md:grid-cols-3">
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
