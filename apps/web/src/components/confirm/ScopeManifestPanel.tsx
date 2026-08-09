// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { useT } from '../../i18n';
import type { ScopeManifest } from '@openmig/shared';

const Column: React.FC<{
  title: string;
  tone: string;
  entries: ScopeManifest['migrates'];
}> = ({ title, tone, entries }) => (
  <div>
    <h4 className={`text-sm font-semibold ${tone} mb-1`}>{title}</h4>
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.item} className="text-xs text-gray-700">
          <span className="font-medium">{e.item}</span> — {e.detail}
        </li>
      ))}
    </ul>
  </div>
);

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
