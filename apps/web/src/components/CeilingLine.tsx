// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A count with its ceiling (workplan 0177 T16, §20.4), on the operator's
 * *Gifts* screen and above the access queue: *People you let in: 12 of 50*.
 *
 * At the number and past it the line stands out, and not by colour alone
 * (WCAG 1.4.1): in weight, in an edge, and in words, *The number is
 * reached.*, which a screen reader says too. English only, as the screens it
 * stands on are (`operator-strings.ts`).
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useOperatorT } from '../i18n/index.tsx';

/** A count with its ceiling, which stands out at the number and past it: in weight, in a mark, and in words. */
export const CeilingLine: React.FC<{ readonly words: string; readonly n: number; readonly max: number; readonly className?: string }> = ({
  words,
  n,
  max,
  className = '',
}) => {
  const t = useOperatorT();
  const reached = n >= max;
  return (
    <p
      {...(reached ? { 'data-at-ceiling': '' } : {})}
      className={`${className} ${reached ? 'flex flex-wrap items-center gap-2 rounded-md border-2 border-amber-700 bg-amber-50 px-3 py-2 font-semibold text-amber-900' : 'text-gray-900'}`}
    >
      {reached && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{words}</span>
      {reached && <span>{t('gifts.count.atCeiling')}</span>}
    </p>
  );
};

export default CeilingLine;
