// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `alreadyOwnsRefusal` — is this a "no" the operator can answer, or one they
 * cannot?
 *
 * Its own file because it is a pure reading of somebody else's JSON, and the
 * interesting cases are all REFUSALS to recognise. A recogniser that is too
 * eager puts an override button under a 409 that can never be overridden; one
 * that is too strict leaves the operator where they were before this existed,
 * reading a sentence naming a field they could only send with curl.
 *
 * The screen's own tests (`pages/AccessRequests.unit.test.tsx`) run against the
 * REAL function rather than a stub, so these two files fail differently: this
 * one says the reading is wrong, that one says the screen does the wrong thing
 * with a correct reading.
 */

import { describe, it, expect } from 'vitest';
import { alreadyOwnsRefusal } from './access-requests.ts';

/** What the route actually answers (apps/api/src/routes/access-requests.ts). */
const REAL = {
  response: {
    status: 409,
    data: {
      error: 'Conflict',
      message: 'That address already owns an organisation: De Vries. Granting again creates another one.',
      organisations: ['De Vries'],
      confirmWith: 'alsoCreateSecondOrganisation',
    },
  },
};

describe('the refusal an operator can answer', () => {
  it('reads the server’s sentence and the names it gave', () => {
    expect(alreadyOwnsRefusal(REAL)).toEqual({
      message: REAL.response.data.message,
      organisations: ['De Vries'],
    });
  });

  it('keeps more than one, in the order the server sent them', () => {
    // The server sorts by name; re-sorting here would be a second opinion about
    // an order somebody already decided.
    const many = {
      response: {
        data: { ...REAL.response.data, organisations: ['Acme', 'Bakerloo SMB', 'De Vries'] },
      },
    };
    expect(alreadyOwnsRefusal(many)?.organisations).toEqual(['Acme', 'Bakerloo SMB', 'De Vries']);
  });

  it('does not need the status, so a changed code cannot silence the override', () => {
    const { status: _status, ...rest } = REAL.response;
    expect(alreadyOwnsRefusal({ response: rest })).not.toBeNull();
  });
});

describe('everything it must NOT mistake for that', () => {
  it('refuses the OTHER 409 — already decided, which nothing can override', () => {
    expect(
      alreadyOwnsRefusal({
        response: { status: 409, data: { error: 'Conflict', message: 'That request was already granted.' } },
      }),
    ).toBeNull();
  });

  it('refuses a body naming a different confirmation', () => {
    // A future route may grow its own override; offering THIS one for it would
    // send a field that route never asked for.
    expect(
      alreadyOwnsRefusal({
        response: { data: { ...REAL.response.data, confirmWith: 'somethingElseEntirely' } },
      }),
    ).toBeNull();
  });

  it('refuses a refusal that names nobody', () => {
    // "They already own these: " with nothing after it says the opposite of
    // what it means, and there is nothing for the operator to weigh.
    for (const organisations of [[], undefined, 'De Vries', {}]) {
      expect(
        alreadyOwnsRefusal({ response: { data: { ...REAL.response.data, organisations } } }),
        `organisations = ${JSON.stringify(organisations)}`,
      ).toBeNull();
    }
  });

  it('refuses a list with anything in it that is not a name', () => {
    // Partial trust is not trust: rendering `[object Object]` beside a real
    // organisation is worse than not offering the override at all.
    expect(
      alreadyOwnsRefusal({
        response: { data: { ...REAL.response.data, organisations: ['De Vries', null] } },
      }),
    ).toBeNull();
  });

  it('refuses the shapes a failed request actually takes', () => {
    // A network error has no `response` at all; these are the values that reach
    // an onError handler on a bad day.
    for (const notARefusal of [
      undefined,
      null,
      'Network Error',
      new Error('timeout of 0ms exceeded'),
      {},
      { response: {} },
      { response: { data: null } },
      { response: { data: 'Bad Gateway' } },
    ]) {
      expect(alreadyOwnsRefusal(notARefusal), String(notARefusal)).toBeNull();
    }
  });

  it('still answers when the server sent names but no sentence', () => {
    // The names are what the operator weighs; the sentence is the courtesy. A
    // missing message must not cost them the override — the screen has its own
    // heading and help text for exactly this.
    const { message: _message, ...withoutMessage } = REAL.response.data;
    const refusal = alreadyOwnsRefusal({ response: { data: withoutMessage } });
    expect(refusal).not.toBeNull();
    expect(refusal?.message).toBe('');
    expect(refusal?.organisations).toEqual(['De Vries']);
  });
});
