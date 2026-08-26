// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The front door's face-renderer (workplan 0107 T2): ONE component for the
 * icon registry in `@openmig/shared`, so the wizard's chooser cards, the
 * family headings, and any later surface (the connections list beside its
 * qualification badges) draw the same face for the same id.
 *
 * A `mark` is the trademark-safe floor — a brand-colored tile with the
 * provider's initial. A `glyph` is a deliberately generic shape for the
 * protocol lane. Both render `aria-hidden`: the face is decoration, the
 * card's own text stays the accessible name, so no test or screen reader
 * changes meaning because a tile appeared.
 */
import { Calendar, Folder, Mail, Server, Users } from 'lucide-react';
import { FAMILY_ICONS, frontDoorIconOf, type FrontDoorIcon as IconSpec } from '@openmig/shared';

const GLYPHS = {
  mail: Mail,
  server: Server,
  calendar: Calendar,
  contacts: Users,
  files: Folder,
} as const;

const SIZES = {
  card: { tile: 'h-8 w-8 rounded-md text-sm', glyph: 'h-4 w-4' },
  heading: { tile: 'h-5 w-5 rounded text-[10px]', glyph: 'h-3 w-3' },
} as const;

function renderSpec(spec: IconSpec | undefined, size: keyof typeof SIZES) {
  if (!spec) return null;
  const s = SIZES[size];
  if (spec.kind === 'mark') {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center font-semibold text-white ${s.tile}`}
        style={{ backgroundColor: spec.background }}
      >
        {spec.initial}
      </span>
    );
  }
  const Glyph = GLYPHS[spec.glyph];
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-gray-100 text-gray-500 ${s.tile}`}
    >
      <Glyph className={s.glyph} />
    </span>
  );
}

/** The face for a connectable type — the chooser cards'. */
export function FrontDoorIcon({ type }: { type: string }) {
  return renderSpec(frontDoorIconOf(type), 'card');
}

/** The smaller mark a family heading wears over its method cards. */
export function FamilyIcon({ family }: { family: string }) {
  return renderSpec(FAMILY_ICONS[family], 'heading');
}
