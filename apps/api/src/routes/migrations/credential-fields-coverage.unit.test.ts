// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The descriptor and the create schema must agree (workplan 0063).
 *
 * `credential-fields.ts` says what to ASK a person for; `CreateMappingSchema`
 * says what the server will ACCEPT. They are separate on purpose — the schema
 * is the authority, and the descriptor is a form's view of it — but a type the
 * schema accepts with no descriptor means the Connections page silently cannot
 * offer that provider, and a descriptor field the schema has never heard of
 * means a form that collects something nothing stores.
 *
 * Neither failure raises an error at runtime; both just quietly do less than
 * they claim. So they are pinned here, in the one place both are importable.
 */

import { describe, it, expect } from 'vitest';
import {
  connectableTypes,
  credentialFieldsFor,
  wizardTypeForConnectionKind,
} from '@openmig/shared';
import { CreateMappingBase, sourceKindFor } from './index.ts';

/** The wizard vocabularies the create route accepts, read off the schema itself. */
function acceptedTypes(field: 'sourceType' | 'targetType'): string[] {
  return [...CreateMappingBase.shape[field].options];
}

/** The field names each side's config object actually has. */
function configKeys(field: 'sourceConfig' | 'targetConfig'): Set<string> {
  return new Set(Object.keys(CreateMappingBase.shape[field].shape));
}

describe('every type the server accepts can be asked for', () => {
  it('has a source descriptor', () => {
    const missing = acceptedTypes('sourceType').filter(
      (t) => credentialFieldsFor('source', t).length === 0,
    );
    expect(missing, 'source types the create API accepts but no form can collect').toEqual([]);
  });

  it('has a target descriptor', () => {
    const missing = acceptedTypes('targetType').filter(
      (t) => credentialFieldsFor('target', t).length === 0,
    );
    expect(missing, 'target types the create API accepts but no form can collect').toEqual([]);
  });

  it('offers nothing the server would refuse', () => {
    const accepted = acceptedTypes('sourceType');
    const offered = connectableTypes('source');
    expect(offered.filter((t) => !accepted.includes(t))).toEqual([]);
  });
});

describe('every field the descriptor asks for is one the schema knows', () => {
  it('names only sourceConfig properties', () => {
    const known = configKeys('sourceConfig');
    for (const type of connectableTypes('source')) {
      for (const field of credentialFieldsFor('source', type)) {
        expect(known, `${type}.${field.key} is collected but sourceConfig has no such field`).toContain(
          field.key,
        );
      }
    }
  });

  it('names only targetConfig properties', () => {
    const known = configKeys('targetConfig');
    for (const type of connectableTypes('target')) {
      for (const field of credentialFieldsFor('target', type)) {
        expect(known, `${type}.${field.key} is collected but targetConfig has no such field`).toContain(
          field.key,
        );
      }
    }
  });
});

describe('connection kind and wizard type are inverses', () => {
  it('round-trips every source type through sourceKindFor and back', () => {
    // The two vocabularies differ by an underscore, and getting it wrong is
    // SILENT: a setup profile looked up by kind answers [], which renders as
    // "this provider needs nothing set up in advance" (workplan 0065).
    for (const type of acceptedTypes('sourceType')) {
      const kind = sourceKindFor(type as never);
      const back = wizardTypeForConnectionKind(kind);
      // oauth2 and graph both store as o365, so the inverse picks one of them;
      // what must hold is that the answer is a type with a real descriptor.
      expect(
        credentialFieldsFor('source', back).length,
        `${type} → ${kind} → ${back} has no descriptor`,
      ).toBeGreaterThan(0);
    }
  });

  it('maps the Google kinds back to their hyphenated wizard types', () => {
    expect(wizardTypeForConnectionKind('google_drive')).toBe('google-drive');
    expect(wizardTypeForConnectionKind('google_calendar')).toBe('google-calendar');
    expect(wizardTypeForConnectionKind('google_contacts')).toBe('google-contacts');
  });

  it('leaves kinds that are already wizard types alone', () => {
    expect(wizardTypeForConnectionKind('box')).toBe('box');
    expect(wizardTypeForConnectionKind('dropbox')).toBe('dropbox');
  });
});
