// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *YOUR NEW ADDRESS: ‹address›. IS THAT RIGHT?* (workplan 0168 §4.4, D6).
 *
 * One line per row of the person's own, on the grant page and the progress
 * page (ADR-0035), the pages a migrated person already reaches. The server
 * sends only the rows linked to this person (`addressChanges`), each named by
 * an opaque `ref`, and takes the answer by the link
 * (`PUT /api/{grant|view}/{link}/address-changes/{ref}`), with the new address
 * the line showed: a row whose address changed since the page was opened is
 * refused, never confirmed as something the person did not read.
 *
 * - A **proposed** row offers *Yes, that is right*, which confirms it as
 *   theirs. Until then it changes nothing, and the line under it says so:
 *   there is no *No* to send, because a proposed row is already one that
 *   changes nothing.
 * - A **confirmed** row, by them or by an owner or admin for them, offers
 *   *Not right?*, which sends it back to proposed, so an admin's word for them
 *   can be undone by them.
 *
 * After a press the buttons follow the row the server answered, and the line
 * under it says the address that answer holds, so a press made by mistake can
 * be taken back at once and nothing is said of an address that was not the
 * one answered. A refusal is said in the server's words, beside the row.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import { answerAddressChangeByLink, type LinkAddressChange } from '../services/link-address-service.ts';

const BUTTON =
  'min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50';

type State = LinkAddressChange['state'];

export const YourNewAddress: React.FC<{
  door: 'grant' | 'view';
  link: string;
  changes: ReadonlyArray<LinkAddressChange> | undefined;
  /** The page's own query, read again after an answer. */
  queryKey: ReadonlyArray<unknown>;
}> = ({ door, link, changes, queryKey }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const idBase = React.useId();
  const [busy, setBusy] = React.useState<string | null>(null);
  /** The row as the server answered each press, by ref. */
  const [said, setSaid] = React.useState<Readonly<Record<string, LinkAddressChange>>>({});
  const [refused, setRefused] = React.useState<Readonly<Record<string, string>>>({});
  if (changes === undefined || changes.length === 0) return null;
  const answer = async (c: LinkAddressChange, state: State) => {
    setBusy(c.ref);
    try {
      // The row as this line shows it: its ref, and the new address it says.
      const row = await answerAddressChangeByLink(door, link, c, state);
      setSaid((prev) => ({ ...prev, [c.ref]: row }));
      setRefused((prev) => {
        const next = { ...prev };
        delete next[c.ref];
        return next;
      });
    } catch (error) {
      setRefused((prev) => ({ ...prev, [c.ref]: serverMessage(error) }));
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey });
    }
  };
  return (
    <section className="mt-6 space-y-3" data-your-new-address>
      {changes.map((c, i) => {
        const answered = said[c.ref];
        const now = answered?.state ?? c.state;
        const lineId = `${idBase}-${i}`;
        return (
          <div key={c.ref} className="rounded-lg border border-gray-200 bg-white p-4">
            <p id={lineId} className="text-sm text-gray-900 break-words">
              {t('addresses.grant.yours', { new: c.newAddress })}
            </p>
            {answered?.state === 'confirmed' && (
              <p role="status" className="mt-1 text-sm text-green-800 break-words">
                {t('addresses.grant.confirmed', { new: answered.newAddress })}
              </p>
            )}
            {answered?.state === 'proposed' && (
              <p role="status" className="mt-1 text-sm text-gray-700">
                {t('addresses.grant.returned')}
              </p>
            )}
            {now === 'proposed' && answered === undefined && (
              <p className="mt-1 text-sm text-gray-600">{t('addresses.grant.leaveIt')}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {now === 'proposed' ? (
                <button
                  type="button"
                  aria-describedby={lineId}
                  disabled={busy === c.ref}
                  className={BUTTON}
                  onClick={() => void answer(c, 'confirmed')}
                >
                  {t('addresses.grant.yes')}
                </button>
              ) : (
                <button
                  type="button"
                  aria-describedby={lineId}
                  disabled={busy === c.ref}
                  className={BUTTON}
                  onClick={() => void answer(c, 'proposed')}
                >
                  {t('addresses.notRight')}
                </button>
              )}
            </div>
            {refused[c.ref] !== undefined && (
              <p role="alert" className="mt-2 text-sm text-red-800 break-words">
                <span className="font-medium">{t('addresses.notSaved')}</span> {refused[c.ref]}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
};
