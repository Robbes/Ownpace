// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE GRANT LINK'S SERVER SENTENCES, IN ONE DUTCH (workplan 0174, settled
 * when its six tasks met on one branch, 2026-11-25). The page's twin is
 * `apps/web/src/i18n/one-dutch-for-a-grant-link.unit.test.ts`: *verbonden*,
 * never *gekoppeld*; a *toegangslink*, never a *persoonlijke link*. T3's
 * `CONNECTED_BY_SOMEBODY_ELSE` said *gekoppeld* beside T5's *verbonden* for
 * the same refusal.
 */
import { describe, it, expect } from 'vitest';
import { connectedByThemselves, onlyTheirMigrations } from '@openmig/managed';
import { SERVER_NOT_A_NAME } from '../grant-password.ts';
import { ANOTHER_CIRRUX_WORKSPACE } from './cirrux-consent.ts';
import { DRIVE_AFTER_THE_PASSWORD } from './cirrux-link-ending.ts';
import { ALREADY_CONNECTED, CONNECTED_BY_SOMEBODY_ELSE } from './person-grant-ending.ts';

const SENTENCES: Record<string, string> = {
  CONNECTED_BY_SOMEBODY_ELSE: CONNECTED_BY_SOMEBODY_ELSE.nl,
  ALREADY_CONNECTED: ALREADY_CONNECTED.nl,
  SERVER_NOT_A_NAME: SERVER_NOT_A_NAME.nl,
  DRIVE_AFTER_THE_PASSWORD: DRIVE_AFTER_THE_PASSWORD.nl,
  ANOTHER_CIRRUX_WORKSPACE: ANOTHER_CIRRUX_WORKSPACE.nl,
  connectedByThemselves: connectedByThemselves('Anna').nl,
  onlyTheirMigrations: onlyTheirMigrations('Anna').nl,
};

describe('the grant link’s server sentences in Dutch', () => {
  it('say verbonden, never gekoppeld', () => {
    expect(Object.entries(SENTENCES).filter(([, v]) => /koppel/i.test(v))).toEqual([]);
    expect(CONNECTED_BY_SOMEBODY_ELSE.nl).toBe('Dit account is door iemand anders verbonden. Het kan niet opnieuw via deze link worden verbonden.');
  });

  it('call the link a toegangslink, never a persoonlijke link', () => {
    expect(Object.entries(SENTENCES).filter(([, v]) => /persoonlijke link/i.test(v))).toEqual([]);
  });
});
