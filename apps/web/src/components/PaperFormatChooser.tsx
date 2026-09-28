// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT HAPPENS TO DROPBOX PAPER DOCS — the one control, wherever the question
 * is asked (workplan 0150 T3 (d)).
 *
 * A Paper doc has no file to download: Dropbox hands one over only as an
 * export. The owner moved that export before the alpha (*"yes, paper export
 * before the alpha"*), and a migration now holds the format it is made in.
 * This is where a person chooses it.
 *
 * ## One control, two arrivals, as Drive's
 *
 * `NativeFilePolicyChooser` says why: the creation wizard and the migration's
 * own settings both ask the question, and a second copy for the settings panel
 * is how the two screens stop agreeing. So both render this one.
 *
 * ## One select
 *
 * Paper is the one kind a Dropbox migration chooses a format for, and a Paper
 * template follows the same choice (D7). The formats are read off
 * `DROPBOX_PAPER_FORMATS`, the list the shared parser accepts, so a format
 * added there reaches both screens and the server at once. The wizard suggests
 * Markdown (D1): Nextcloud's Text app opens it.
 *
 * ## The line under it is read off the choice
 *
 * Left behind, the docs are reported by name, and the line says so in the
 * caution tone Drive's uses, because on the wizard it is the last screen where
 * that is still a choice. Exported, the line names the file each doc becomes.
 */
import React from 'react';
import {
  DROPBOX_PAPER_FORMATS,
  type DropboxPaperFormat,
  type DropboxPaperPolicy,
} from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { Hint } from './Hint.tsx';

/** What each format is called in the select, and the suffix a doc arrives under (D4). */
const FORMAT: Readonly<Record<DropboxPaperFormat, { readonly label: StringKey; readonly ext: string }>> = {
  markdown: { label: 'wizard.paperFormat.as.markdown', ext: '.md' },
  html: { label: 'wizard.paperFormat.as.html', ext: '.html' },
};

/** What the wizard starts from (D1): Markdown, which Nextcloud's Text app opens. */
export const SUGGESTED_PAPER_FORMAT: DropboxPaperPolicy = 'markdown';

export const PaperFormatChooser: React.FC<{
  /** The format in force, or `refuse`. */
  value: DropboxPaperPolicy;
  onChange: (next: DropboxPaperPolicy) => void;
  /** While a save is in flight. */
  disabled?: boolean;
  /** The select's DOM id, which its label points at; the settings panel passes its own. */
  id?: string;
}> = ({ value, onChange, disabled, id = 'paper-format' }) => {
  const t = useT();
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700" htmlFor={id}>
        {t('wizard.paperFormat')}
      </label>
      {/* One line, the rest folded (0118 T1). */}
      <Hint text={t('wizard.paperFormat.hint')} why={t('wizard.paperFormat.hint.why')} />
      <select
        id={id}
        className="input mt-2 w-full"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as DropboxPaperPolicy)}
      >
        <option value="refuse">{t('wizard.paperFormat.leave')}</option>
        {DROPBOX_PAPER_FORMATS.map((format) => (
          <option key={format} value={format}>
            {t(FORMAT[format].label)}
          </option>
        ))}
      </select>
      {value === 'refuse' ? (
        <Hint
          tone="caution"
          text={t('wizard.paperFormat.leftBehind')}
          why={t('wizard.paperFormat.leftBehind.why')}
        />
      ) : (
        <Hint
          text={t('wizard.paperFormat.arrives', { ext: FORMAT[value].ext })}
          why={t('wizard.paperFormat.arrives.why')}
        />
      )}
    </div>
  );
};

export default PaperFormatChooser;
