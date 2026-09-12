// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A POLICY OFFERED FOR A FORM THAT CANNOT BE EXPORTED (found live 2026-09-11).
 *
 * The refusal for a Google Form, a My Map and a Drive shortcut all read "Set
 * an export policy on the mapping to migrate these" — the same sentence as
 * for a Doc. Drive cannot export a Form, a Map or a shortcut in ANY format
 * (`files.export` answers 403), so the operator who followed that advice
 * changed a setting and watched the same items fail again. The sentence
 * has to depend on what the thing is, because the way out does.
 *
 * And every one of them is a DECISION (`isDecisionError`): the sync loop
 * parks it on first sight rather than retrying a policy five times.
 */
import { describe, it, expect } from 'vitest';
import { isDecisionError } from '@openmig/shared';
import { NativeFileRefused, EXPORTABLE_NATIVE_TYPES, DRIVE_SHORTCUT_MIME } from './google-drive-source.ts';
import { NATIVE_EXPORT_TYPES } from './google-drive-source.types.ts';

const G = 'application/vnd.google-apps.';

describe('NativeFileRefused says the thing that is true for THIS type', () => {
  it('a Doc under refuse: the export policy is the way out, and is named', () => {
    const e = new NativeFileRefused('Heen-en-Weer tas', `${G}document`);
    expect(e.message).toContain('is a Google document');
    expect(e.message).toContain('nativeFilePolicy="refuse"');
    expect(e.message).toContain('Set an export policy');
  });

  it.each(['form', 'map', 'site', 'script'])('a %s: no export exists, so no policy is offered', (kind) => {
    const e = new NativeFileRefused('Thema-avond', `${G}${kind}`);
    expect(e.message).toContain(`is a Google ${kind}`);
    expect(e.message).toContain(`cannot export a ${kind}`);
    expect(e.message).not.toContain('export policy on the mapping');
    expect(e.message).toContain('Accept leaving it behind');
  });

  it('a shortcut is a pointer, not content', () => {
    const e = new NativeFileRefused('Process mining tools overview', DRIVE_SHORTCUT_MIME);
    expect(e.message).toContain('is a Google Drive shortcut');
    expect(e.message).toContain('nothing to copy');
    expect(e.message).not.toContain('export policy');
  });

  it('an exportable type the chosen policy has no rendering for names the policy', () => {
    const e = new NativeFileRefused('Sketch', `${G}drawing`, 'export-office');
    expect(e.message).toContain("export policy (export-office) has no rendering for a drawing");
  });

  it('every refusal is a decision the loop parks, never a retry', () => {
    for (const mime of [`${G}document`, `${G}form`, DRIVE_SHORTCUT_MIME]) {
      expect(isDecisionError(new NativeFileRefused('x', mime))).toBe(true);
    }
    expect(isDecisionError(new Error('ECONNRESET'))).toBe(false);
  });

  it('the exportable set is exactly what the export policies can render, plus drawing', () => {
    const fromPolicies = new Set(Object.values(NATIVE_EXPORT_TYPES).flatMap((m) => Object.keys(m)));
    for (const mime of fromPolicies) expect(EXPORTABLE_NATIVE_TYPES.has(mime)).toBe(true);
    expect(EXPORTABLE_NATIVE_TYPES.has(`${G}form`)).toBe(false);
    expect(EXPORTABLE_NATIVE_TYPES.has(DRIVE_SHORTCUT_MIME)).toBe(false);
  });
});
