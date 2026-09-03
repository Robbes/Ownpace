// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { CreateMappingBase, sourceKindFor, targetConnectionConfig } from './index.ts';

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

describe('the DAV url escape hatch is stored, and only where it means something (0105 T1)', () => {
  const cfg = {
    host: 'mail.example.com',
    port: 443,
    username: 'u',
    password: 'p',
    useSsl: true,
    url: 'https://mail.example.com/dav/',
  };

  it('a caldav target stores the url beside host and port — davUrl prefers it', () => {
    const stored = targetConnectionConfig({ targetType: 'caldav', targetConfig: cfg } as never);
    expect(stored.url).toBe('https://mail.example.com/dav/');
    expect(stored.host).toBe('mail.example.com');
  });

  it('absent url stores nothing extra — existing rows keep their exact shape', () => {
    const { url: _url, ...bare } = cfg;
    const stored = targetConnectionConfig({ targetType: 'webdav', targetConfig: bare } as never);
    expect('url' in stored).toBe(false);
  });

  it('a jmap target derives its baseUrl and never stores a pasted url', () => {
    const stored = targetConnectionConfig({ targetType: 'jmap', targetConfig: cfg } as never);
    expect('url' in stored).toBe(false);
    expect(stored.baseUrl).toBe('https://mail.example.com:443');
  });

  it('an imap target has no URL at all', () => {
    const stored = targetConnectionConfig({ targetType: 'imap', targetConfig: cfg } as never);
    expect('url' in stored).toBe(false);
  });
});

describe('a stored target carries its type (2026-09-03)', () => {
  // The Connections door called this builder with the fields alone, so the
  // kind never reached it and an imap target was stored without `type`, user
  // or tls; the first migration reusing the row met "Unsupported target
  // type: undefined". These pin the shapes each type stores, and the guard
  // beside them pins that the door now says which type.
  const cfg = { host: 'mail.example.com', port: 993, username: 'u', password: 'p', useSsl: true };

  it('imap stores the imap-dav writer shape, user and tls included', () => {
    expect(targetConnectionConfig({ targetType: 'imap', targetConfig: cfg } as never)).toMatchObject({
      type: 'imap-dav',
      host: 'mail.example.com',
      port: 993,
      user: 'u',
      tls: true,
    });
  });

  it('jmap stores its type, baseUrl and user', () => {
    expect(
      targetConnectionConfig({ targetType: 'jmap', targetConfig: { ...cfg, port: 443 } } as never),
    ).toMatchObject({ type: 'jmap', baseUrl: 'https://mail.example.com:443', user: 'u' });
  });

  it('soverin keeps its mail face — only when the type says soverin', () => {
    const withMail = { ...cfg, url: 'https://dav.example.com/', mailHost: 'imap.example.com', mailPort: 993 };
    expect(
      targetConnectionConfig({ targetType: 'soverin', targetConfig: withMail } as never),
    ).toMatchObject({ url: 'https://dav.example.com/', mailHost: 'imap.example.com', mailPort: 993 });
    // A protocol row never grows a mail face — and a call WITHOUT a type
    // (the door's old shape) drops it, which is the defect made visible.
    expect(
      'mailHost' in targetConnectionConfig({ targetType: 'caldav', targetConfig: withMail } as never),
    ).toBe(false);
    expect('mailHost' in targetConnectionConfig({ targetConfig: withMail } as never)).toBe(false);
  });
});
