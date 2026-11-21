// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A TEST MIGRATION, SAID ON EVERY PAGE OF IT AND ON THE LISTS (workplan 0162
 * T1, §3; ADR-0053).
 *
 * A migration made in an organisation an operator marked as a test carries
 * the marker on its own row (`testMarker`, the operating contract), copies
 * only the items whose own title contains it, and is never finished or
 * switched over: it ends by being deleted.
 *
 * - **The banner** is drawn by `Layout`, above every page under
 *   `/mappings/{id}` (the hub and each of its screens, `mappingRouteContext`),
 *   from the read of the migration the bar already makes. So a page added
 *   under a migration says it too, without being told. It is why the Finish
 *   page offers its data types neither End nor Keep (`pathEndingChoices`).
 * - **The badge** sits beside a test migration's name on the lists: the
 *   Migrations page and a person's page.
 *
 * Both in the reader's language. The marker is drawn as code, verbatim: it is
 * what the person types into a title, and a quotation mark around it would be
 * read as part of it.
 */
import React from 'react';
import { FlaskConical } from 'lucide-react';
import { useT } from '../i18n/index.tsx';

/** The banner, or nothing for a migration that is not a test (`marker` absent). */
export const TestMigrationBanner: React.FC<{ marker: string | undefined; className?: string }> = ({
  marker,
  className = 'mb-4',
}) => {
  const t = useT();
  if (marker === undefined) return null;
  // The sentence's own words around the marker, which is drawn as code.
  const [before = '', after = ''] = t('testMigration.banner', { marker: '\u0000' }).split('\u0000');
  return (
    <div
      role="note"
      data-test-migration
      className={`${className} flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900`}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <p>
        {before}
        <code className="rounded bg-white/70 px-1 font-mono">{marker}</code>
        {after}
      </p>
    </div>
  );
};

/** The *Test* badge beside a migration's name on a list; nothing for one that is not a test. */
export const TestBadge: React.FC<{ marker: string | undefined }> = ({ marker }) => {
  const t = useT();
  if (marker === undefined) return null;
  return (
    <span
      data-test-badge
      title={marker}
      className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-900"
    >
      {t('testMigration.badge')}
    </span>
  );
};
