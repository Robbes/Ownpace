// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * One line on screen, the rest behind a fold (workplan 0118 T1).
 *
 * Why a component: the owner read the wizard on 2026-09-05 and found every
 * field carrying three thoughts — what goes in the box, why, and a caveat —
 * all visible at once. The rule since then is one sentence under a control,
 * and everything else under a native `<details>` that says "Why?" until it
 * is opened. Field hints share this one shape, so a screen cannot grow a
 * second one with a different fold or a hint that runs on.
 *
 * The fold is native `<details>/<summary>`: no state, no script, keyboard
 * and screen-reader behaviour for free, and `toBeVisible` in a test knows
 * its content is hidden until opened. Its label is one of three words,
 * because a fold that has to explain itself is already too long.
 */
import React from 'react';
import { useT, type StringKey } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

export type FoldLabel = 'why' | 'how' | 'more';

export const Hint: React.FC<{
  /** The one sentence that stays on screen. */
  text: string;
  /** What folds away — omitted, there is no fold at all. */
  why?: string;
  /** The word on the fold: "Why?" for a hint, "How?" for a step, "More" for a choice. */
  label?: FoldLabel;
  /** Grey by default; `caution` for the one line that must be read before typing. */
  tone?: 'muted' | 'caution' | 'info' | 'note';
  /** Wraps the pair; defaults to the field-hint spacing. */
  className?: string;
  /** Open on first render — for the step somebody is on right now. */
  open?: boolean;
}> = ({ text, why, label = 'why', tone = 'muted', className = 'mt-1', open }) => {
  const t = useT();
  const toneClass = {
    muted: 'text-gray-500',
    caution: 'text-amber-800',
    info: 'text-blue-900',
    note: 'text-yellow-800',
  }[tone];
  const foldClass = tone === 'note' ? 'text-yellow-800' : 'text-gray-500';
  return (
    <div className={className}>
      <p className={`text-sm ${toneClass}`}>{text}</p>
      {why && (
        <details className="mt-1 text-sm" open={open}>
          <summary className={`cursor-pointer select-none ${foldClass}`}>
            {t(`fold.${label}` as StringKey)}
          </summary>
          <p className={`mt-1 ${foldClass}`}>{why}</p>
        </details>
      )}
    </div>
  );
};

/**
 * The folded twin of a descriptor's hint, by convention: `x.hint` (or the
 * one `x.width`) folds `x.why` when the dictionary has it. Descriptors are
 * shared with the server and carry keys, not prose, so the fold is found
 * here rather than declared there — a hint with nothing to fold simply has
 * no `.why`, and the component renders no fold.
 */
export function whyKeyOf(hintKey: string): StringKey | undefined {
  const candidate = hintKey.replace(/\.[^.]+$/, '.why');
  return candidate in STRINGS.en ? (candidate as StringKey) : undefined;
}
