// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * One state vocabulary (0035 T1): the table is complete in both languages,
 * server vocabulary stays OUT of it, and no screen renders a raw state enum
 * outside StateChip.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StateChip, { STATE_TABLE } from './StateChip';
import { STRINGS, LOCALES } from '../i18n/strings';

describe('the canonical state table', () => {
  it('resolves every entry in BOTH languages', () => {
    for (const [entity, states] of Object.entries(STATE_TABLE)) {
      for (const [state, entry] of Object.entries(states) as Array<
        [string, { key: keyof (typeof STRINGS)['en'] }]
      >) {
        for (const locale of LOCALES) {
          const label = STRINGS[locale][entry.key];
          expect(label, `${entity}.${state} in ${locale}`).toBeTruthy();
        }
      }
    }
  });

  it('contains NO server vocabulary — findings are not states (the prose boundary)', () => {
    // PASS/FAIL are verification findings; reported/trashed/inferred are
    // evidence words. They render verbatim, never through StateChip. If one
    // of these appears in the table, the boundary rule in StateChip's header
    // has been violated.
    const serverWords = ['PASS', 'FAIL', 'WARNING', 'reported', 'trashed', 'inferred'];
    for (const states of Object.values(STATE_TABLE)) {
      for (const word of serverWords) {
        expect(Object.keys(states)).not.toContain(word);
      }
    }
  });

  it('renders the translated word, never the raw enum', () => {
    render(<StateChip entity="lifecycle" state="cutover" />);
    expect(screen.getByText('In cutover')).toBeInTheDocument();
    expect(screen.queryByText('cutover')).not.toBeInTheDocument();
  });

  it('reserves the wachtrij words for queued — pending is "In afwachting" in NL, both entities', () => {
    // The fleet's dictionary read: "Pending" rendered as both "In wachtrij"
    // (runs) and "In afwachting" (domains). One word now.
    expect(STRINGS.nl['runs.status.pending']).toBe('In afwachting');
    expect(STRINGS.nl['confirm.state.pending']).toBe('In afwachting');
  });
});

describe('no raw state enum renders outside StateChip (the 0035 T1 acceptance grep)', () => {
  const roots = [join(__dirname, '..', 'pages'), join(__dirname, '..', 'components')];
  const offenders: string[] = [];
  // The exact renders the review found leaking, plus the general corner
  // pattern. Test files are exempt (they assert against fixtures).
  const RAW_RENDERS = [
    /\{queue\.migrationStatus\}/,
    /\{m\.migrationStatus\}/,
    /\{mapping\.status\}/,
    /\{detail\.data\.status\}/,
    /\{invoice\.status\}/,
  ];

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      // Line-based so the chip's own `state={...}` props and comments don't
      // count — the offense is the value rendered as TEXT.
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const line of lines) {
        if (line.includes('StateChip') || line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) {
          continue;
        }
        for (const pattern of RAW_RENDERS) {
          if (pattern.test(line)) offenders.push(`${name}: ${line.trim()}`);
        }
      }
    }
  };

  it('finds no offender in pages/ or components/', () => {
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
