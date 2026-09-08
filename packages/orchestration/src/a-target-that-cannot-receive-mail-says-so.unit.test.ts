// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE EMAIL ROW THAT SAID `Unsupported target type: undefined`.
 *
 * A Microsoft → Nextcloud migration with Email ticked showed exactly that on
 * its preflight (owner, 2026-09-08), beside four real counts. Nextcloud has no
 * mail face — `TARGET_TYPE_DOMAINS.nextcloud` is calendar, contact, file, task,
 * with a comment saying so deliberately — so the mail arm genuinely could not
 * build a target. The refusal was correct. The sentence was unusable.
 *
 * `undefined` is not a target type. It is the ABSENCE of one: for a DAV
 * protocol kind, `mailTargetConfigFromConnection` set no `type` and the
 * writer's `default:` arm printed the missing value back. The sentence names
 * no target, no domain, no remedy, and reads to the person who ticked Email as
 * the product failing to see their mail (hard rule 9).
 *
 * ## Why this reuses the wizard's sentence rather than writing one
 *
 * The true sentence was already written, and is already a prose boundary
 * rendered verbatim wherever it surfaces — `targetDomainRefusal`, which the
 * create wizard refuses this same combination with. Two sentences for one fact
 * is two things to keep true; the file this guards has been repaired twice for
 * exactly that shape (a table and a switch agreeing by hand until a provider
 * was added to one of them).
 *
 * So the assertions below are deliberately about the SENTENCE THE WIZARD
 * WOULD HAVE GIVEN, compared against `targetDomainRefusal` itself rather than
 * against a copy typed here. A guard that hard-codes the prose is a third copy.
 */

import { describe, it, expect } from 'vitest';
import { TARGET_TYPE_DOMAINS, targetDomainRefusal, type WizardTargetType } from '@openmig/shared';
import { mailTargetConfigFromConnection } from './build-deps-from-mapping.ts';

/** The credential record shape the seam reads; empty is enough to refuse. */
const NO_CREDS: Record<string, string> = {};

/** Every wizard target type, split by whether it can take mail at all. */
const WITHOUT_MAIL = (Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[]).filter(
  (t) => !TARGET_TYPE_DOMAINS[t].includes('email'),
);
const WITH_MAIL = (Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[]).filter((t) =>
  TARGET_TYPE_DOMAINS[t].includes('email'),
);

describe('a target with no mail face refuses by name', () => {
  it('covers both halves — a split with nothing on one side proves nothing', () => {
    expect(WITHOUT_MAIL.length).toBeGreaterThan(0);
    expect(WITH_MAIL.length).toBeGreaterThan(0);
  });

  for (const kind of WITHOUT_MAIL) {
    it(`refuses a ${kind} target with the sentence the wizard uses`, () => {
      // Derived, not typed out: this is the one sentence, asked for the same
      // way the create door asks for it.
      const expected = targetDomainRefusal(kind, ['email']);
      expect(expected, 'the wizard must have a sentence for this kind').not.toBeNull();

      expect(() => mailTargetConfigFromConnection(kind, {}, NO_CREDS)).toThrow(expected!);
    });

    it(`never answers 'undefined' for a ${kind} target`, () => {
      // The literal string the owner was shown. Asserted apart from the
      // sentence above, because a future refusal could be reworded and still
      // regress into printing an absent value back.
      let message = '';
      try {
        mailTargetConfigFromConnection(kind, {}, NO_CREDS);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).not.toContain('undefined');
      // And it names the domain the person would have to untick. Asserted for
      // every kind rather than for one, so this cannot pass vacuously.
      expect(message).toContain('email');
    });

    it(`refuses a ${kind} target even when the row carries a stale type`, () => {
      // The question is answered by the KIND, not by a config blob. A row
      // stored with some `type` on it must not talk its way past a face the
      // provider has not got — which is why the check sits ABOVE the
      // stored-config shortcut rather than below it.
      expect(() =>
        mailTargetConfigFromConnection(kind, { type: 'imap-dav', host: 'mail.example' }, NO_CREDS),
      ).toThrow(/cannot receive/);
    });
  }

  for (const kind of WITH_MAIL) {
    it(`lets a ${kind} target through — it does carry mail`, () => {
      // The refusal must not become a wall. These kinds have a mail face, so
      // the seam's own branches decide; whether they then need a host or a
      // credential is their business and not this guard's.
      expect(() => mailTargetConfigFromConnection(kind, {}, NO_CREDS)).not.toThrow(
        /cannot receive/,
      );
    });
  }

  it('leaves a kind the table has never heard of alone', () => {
    // Legacy and internal config types (`imap-oauth2`, appliance shapes) are
    // not wizard target types and are not this check's business: refusing them
    // here would turn an unknown into a mail-face claim it never made.
    expect(() =>
      mailTargetConfigFromConnection('imap-oauth2', { type: 'imap-dav' }, NO_CREDS),
    ).not.toThrow(/cannot receive/);
  });
});
