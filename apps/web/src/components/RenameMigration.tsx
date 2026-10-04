// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *RENAME* ON A MIGRATION'S PAGE (0153 open question 5, item 4; the owner,
 * 2026-10-04: *"go with the recommendations"*).
 *
 * *Start a migration* names each migration itself, *"{person} — {provider}
 * to {destination}"*, and no screen asked for a name. That was the
 * recommendation, with *Rename* here for the name a person would rather read.
 * A name is a label: nothing reads it to decide anything (`mayRevise('name')`),
 * so it may change at any time, and the route stores it trimmed.
 *
 * The title stays the heading, and the press beside it turns it into a box
 * with *Save* and *Cancel*. Managed only: the appliance's names come from its
 * mapping files, which its owner edits.
 */
import React from 'react';
import { Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { mappingApi } from '../services/mapping-service.ts';
import { serverMessage } from '../services/api.ts';
import { useT } from '../i18n/index.tsx';

export const RenameMigration: React.FC<{
  mappingId: string;
  /** The stored name; undefined until the detail read lands. */
  name: string | undefined;
  /** The heading's words while there is no name to show. */
  fallback: string;
  /** Whether a rename may be offered: managed, with the detail read in. */
  editable: boolean;
}> = ({ mappingId, name, fallback, editable }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const inputId = React.useId();
  const [editing, setEditing] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const open = () => {
    setTyped(name ?? '');
    setFailed(null);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      await mappingApi.rename(mappingId, typed.trim());
      // The heading reads the stored name: the save is done once it is read again.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mapping', mappingId] }),
        queryClient.invalidateQueries({ queryKey: ['mappings'] }),
      ]);
      setEditing(false);
    } catch (err) {
      setFailed(serverMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // A fragment: the heading stays a child of the page's header row, beside
  // the stage it names (0154 T1).
  if (!editing) {
    return (
      <>
        <h2 className="text-lg font-semibold text-gray-900">{name ?? fallback}</h2>
        {editable && (
          <button
            type="button"
            onClick={open}
            className="inline-flex min-h-[44px] items-center gap-1 px-2 text-sm text-blue-700 hover:underline"
          >
            <Pencil className="w-4 h-4" aria-hidden="true" />
            {t('hub.rename')}
          </button>
        )}
      </>
    );
  }
  const empty = typed.trim() === '';
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) void save();
      }}
    >
      <div className="flex flex-col">
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          {t('hub.rename.label')}
        </label>
        <input
          id={inputId}
          className="input min-h-[44px] w-72 max-w-full"
          value={typed}
          maxLength={255}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
        />
      </div>
      <button
        type="submit"
        disabled={saving || empty}
        className="min-h-[44px] px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? t('hub.rename.saving') : t('hub.rename.save')}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={saving}
        className="min-h-[44px] px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50"
      >
        {t('common.cancel')}
      </button>
      {failed !== null && (
        <p role="alert" className="w-full text-sm text-red-800">
          <span className="font-medium">{t('hub.rename.failed')}</span> {failed}
        </p>
      )}
    </form>
  );
};
