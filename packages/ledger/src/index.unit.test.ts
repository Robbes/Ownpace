// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import { describe, it, expect } from 'vitest';
import { packageName } from './index.ts';

describe('@openmig/ledger', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@openmig/ledger');
  });
});
