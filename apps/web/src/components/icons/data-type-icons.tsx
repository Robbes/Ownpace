// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SIX DATA-TYPE ICONS (workplan 0153 §5, 0152 T3).
 *
 * Drawn once, in `docs/design/0152-0154/icons.svg`, and copied here element
 * for element, so the site's sprite and these components draw the same six.
 * `an-icon-drawn-twice.unit.test.tsx` reads that drawing and fails when a
 * part here differs from it, so a redraw lands in both places or in neither.
 *
 * The style is lucide's: a 24-pixel box, a 2-pixel stroke, round caps and
 * joins, no fill, and `currentColor`. So they sit beside the icons the app
 * already imports from `lucide-react` without reading as a second set.
 *
 * AN ICON NEVER STANDS ALONE. It is `aria-hidden`, and the data type's name
 * is always written beside it. `DataTypeLabel` does both, with the words the
 * dictionary already has for each data type (`DOMAIN_STRING_KEY`).
 */
import React from 'react';
import type { DiscoveryDomain } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../../i18n/domain-words.ts';

export const DATA_TYPE_ICONS = ['mail', 'calendar', 'contacts', 'files', 'photos', 'tasks'] as const;
export type DataTypeIconName = (typeof DATA_TYPE_ICONS)[number];

/** One element of a drawing: its tag and its attributes, as the drawing writes them. */
export type IconPart = readonly ['rect' | 'circle' | 'path', Readonly<Record<string, string>>];

/** The drawing's elements, per icon, in the drawing's order. */
export const DATA_TYPE_ICON_PARTS: Readonly<Record<DataTypeIconName, readonly IconPart[]>> = {
  mail: [
    ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
    ['path', { d: 'M3 7l9 6 9-6' }],
  ],
  calendar: [
    ['rect', { x: '3', y: '5', width: '18', height: '16', rx: '2' }],
    ['path', { d: 'M3 10h18M8 3v4M16 3v4' }],
  ],
  contacts: [
    ['circle', { cx: '12', cy: '8', r: '4' }],
    ['path', { d: 'M4 21c0-4 3.6-6 8-6s8 2 8 6' }],
  ],
  files: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
  photos: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['circle', { cx: '9', cy: '10', r: '2' }],
    ['path', { d: 'M21 16l-5-5-9 9' }],
  ],
  tasks: [['path', { d: 'M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M10 6h11M10 12h11M10 18h11' }]],
};

/**
 * Which icon each data type wears. Photos have no data type of their own:
 * they arrive through an export archive as files, so the photos icon is for
 * the rows that say so, and a caller names it directly.
 */
export const ICON_OF_DOMAIN: Readonly<Record<DiscoveryDomain, DataTypeIconName>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contacts',
  file: 'files',
  task: 'tasks',
};

export function DataTypeIcon({
  name,
  size = 20,
  className,
}: {
  name: DataTypeIconName;
  size?: number;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {DATA_TYPE_ICON_PARTS[name].map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/** A data type's icon with its name beside it: the name is what a screen reader reads. */
export function DataTypeLabel({
  domain,
  size = 20,
}: {
  domain: DiscoveryDomain;
  size?: number;
}): React.ReactElement {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-2">
      <DataTypeIcon name={ICON_OF_DOMAIN[domain]} size={size} className="shrink-0" />
      <span>{t(DOMAIN_STRING_KEY[domain])}</span>
    </span>
  );
}
