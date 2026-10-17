// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE WAY ON TO THE NEXT STEP, under every step page of a migration (the UX
 * sweep, `journey-step-pages-no-next`).
 *
 * The hub lists the seven steps before a switch in cutover order, and each
 * opens a page of its own; none of those pages led on. Check ended on *"This
 * migration is ready to cut over."* and stopped, and the only way to step 7
 * was back up to the hub. `Layout` draws this under the page, so every step
 * page has one without each page carrying it.
 *
 * The order and the names are the hub's own list (`hub-screens.ts`), the one
 * `CutoverSteps` reads, so the three cannot disagree. Finish is the last step
 * and has no next; Review and the report are not in the list and have none.
 */
import React from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n/index.tsx';
import { SCREENS } from '../pages/hub-screens.ts';
import type { MappingScreen } from './layout-context.ts';

const NextStepLink: React.FC<{ mappingId: string; screen: MappingScreen }> = ({ mappingId, screen }) => {
  const t = useT();
  const here = SCREENS.findIndex((s) => s.path === screen);
  const next = here === -1 ? undefined : SCREENS[here + 1];
  if (!next) return null;
  return (
    <p className="mt-8">
      <Link
        to={`/mappings/${encodeURIComponent(mappingId)}/${next.path}`}
        className="text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
      >
        {t('hub.nextStep', { step: t(next.nameKey) })}
      </Link>
    </p>
  );
};

export default NextStepLink;
