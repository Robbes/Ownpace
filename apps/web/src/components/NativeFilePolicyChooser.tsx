// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT HAPPENS TO GOOGLE DOCS, SHEETS, SLIDES AND DRAWINGS — the one control,
 * wherever the question is asked (workplan 0042 T0 Q3, extracted for 0125 T3,
 * a format per kind since 0042 T9).
 *
 * A folder of them is not an edge case — it is most people's Drive — and until
 * this control existed the answer was decided by a default the owner never saw.
 * They found out when the failure queue filled with files they thought had
 * migrated.
 *
 * ## One format per KIND, not per migration
 *
 * It offered one `<select>` for all four kinds, and no editable format carries
 * all four: OpenDocument leaves every Doc behind and Microsoft Office every
 * Slides deck, measured (0042 T3). So somebody who wanted their Docs editable
 * in Word and their decks at all had to choose which kind to lose. The owner's
 * decision, 2026-09-23: *"a per kind choice makes more sense for the
 * fileformats. Split that up."* Each kind now has its own select, offering only
 * the formats that carry it.
 *
 * Since the refusals of measured-unstable exports went later that day
 * (ADR-0046, amended), every format carries every kind, so every select offers
 * all three. The chooser still reads the table rather than assuming it is
 * full: `a-format-that-leaves-a-kind-behind.unit.test.tsx` holds what it says
 * the day a format cannot render a kind.
 *
 * ## Why it is a component and not a method on the wizard
 *
 * There are TWO places the question is asked: the creation wizard, and the
 * migration's own settings once it is running. 0125 exists because those two
 * disagreed — the appliance could change this setting and had no picker,
 * managed had a picker and could not change it — and hard rule 5 is the rule
 * that was being broken. A second chooser for the settings panel would fix the
 * missing screen and reintroduce the same class of defect one level up.
 *
 * So there is one chooser, and both arrivals render it. A guard holds each
 * kind's options against `NATIVE_POLICY_COVERAGE`, so a format that changes
 * there cannot reach one screen and not the other.
 *
 * ## The lines under the selects are read off the choice
 *
 * An export is a RENDERING — nobody gets a Google Doc back out of an .odt —
 * and an owner who learns that after cutover learns it too late. So what the
 * choice leaves behind, and what arrives as a PDF nobody can edit, is said
 * under the selects, from the same tables the selects are built from.
 */
import React from 'react';
import {
  GOOGLE_EDITOR_KINDS,
  NATIVE_POLICY_COVERAGE,
  NATIVE_POLICY_EXTENSIONS,
  type GoogleEditorKind,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { nativeKindKey } from '../i18n/native-kind-key.ts';
import { Hint } from './Hint.tsx';

/** The format each Google kind is exported in: what this control shows and sets. */
export type NativeFilePolicyByKind = Readonly<Record<GoogleEditorKind, GoogleNativeFilePolicy>>;

type ExportPolicy = Exclude<GoogleNativeFilePolicy, 'refuse'>;

/**
 * Every kind left behind — what a migration nobody has chosen for does, and
 * so what the wizard starts from.
 *
 * Of the two ways this can disappoint somebody — "your Docs did not migrate,
 * and here is why" and "your Docs arrived as something you cannot edit" — only
 * the first is one they can still act on.
 */
export const LEAVE_ALL_BEHIND: NativeFilePolicyByKind = {
  document: 'refuse',
  spreadsheet: 'refuse',
  presentation: 'refuse',
  drawing: 'refuse',
};

/** One entry in a kind's select, beside "Leave behind". */
export interface NativeFormatChoice {
  readonly policy: ExportPolicy;
  /** What the file lands as, such as `.docx`. */
  readonly extension: string;
  /**
   * False only for the format in force when it does not carry this kind — a
   * deck under a migration-wide Office setting. It is shown, as left behind,
   * so the select says what the migration does rather than something nearer
   * to what it might have meant.
   */
  readonly carries: boolean;
}

/**
 * The formats a kind's select offers: each one that carries the kind, by the
 * coverage table, and the one in force whatever it is.
 *
 * ONE ENTRY PER FILE, not per policy. A Drawing is an `.svg` under both
 * OpenDocument and Office, and two entries for the same file would ask
 * somebody to choose between identical results. The entry stands for the
 * policy in force where that is one of them, so opening the page and saving
 * changes nothing the person did not change.
 */
export function formatChoicesFor(
  kind: GoogleEditorKind,
  inForce: GoogleNativeFilePolicy,
): ReadonlyArray<NativeFormatChoice> {
  const choices: NativeFormatChoice[] = [];
  for (const policy of Object.keys(NATIVE_POLICY_COVERAGE) as ExportPolicy[]) {
    const carries = NATIVE_POLICY_COVERAGE[policy].includes(kind);
    if (!carries && policy !== inForce) continue;
    const extension = NATIVE_POLICY_EXTENSIONS[policy][kind];
    const same = choices.findIndex((c) => c.extension === extension && c.carries === carries);
    if (same === -1) choices.push({ policy, extension, carries });
    else if (policy === inForce) choices[same] = { policy, extension, carries };
  }
  return choices;
}

/**
 * An editable format for every kind that has one: the one it is already in
 * where that is editable and carries it, otherwise Microsoft Office where it
 * carries the kind, OpenDocument where Office does not, and PDF only for a
 * kind neither carries.
 *
 * A kind already in an editable format keeps it, so the press changes only
 * what is left behind or arriving as a PDF: a Drawing's `.svg` under
 * OpenDocument is the same file under Office, and switching it would count as
 * a change of format that changes nothing.
 *
 * Read off the coverage table rather than written down, so the day a format
 * stops carrying a kind this follows it. Office first because it is what the
 * owner's own migration already uses for Docs and Sheets.
 */
export function editableFormats(
  current: NativeFilePolicyByKind = LEAVE_ALL_BEHIND,
): NativeFilePolicyByKind {
  const editable = (policy: GoogleNativeFilePolicy, kind: GoogleEditorKind) =>
    policy !== 'refuse' && policy !== 'export-pdf' && NATIVE_POLICY_COVERAGE[policy].includes(kind);
  const pick = (kind: GoogleEditorKind): GoogleNativeFilePolicy =>
    editable(current[kind], kind)
      ? current[kind]
      : ((['export-office', 'export-odf'] as const).find((policy) => editable(policy, kind)) ??
        'export-pdf');
  return {
    document: pick('document'),
    spreadsheet: pick('spreadsheet'),
    presentation: pick('presentation'),
    drawing: pick('drawing'),
  };
}

/** The kinds this choice leaves behind: set to leave, or to a format that does not carry them. */
export function kindsLeftBehind(value: NativeFilePolicyByKind): ReadonlyArray<GoogleEditorKind> {
  return GOOGLE_EDITOR_KINDS.filter((kind) => {
    const policy = value[kind];
    return policy === 'refuse' || !NATIVE_POLICY_COVERAGE[policy].includes(kind);
  });
}

/** The kinds this choice copies as a PDF, which nobody can edit afterwards. */
export function kindsAsPdf(value: NativeFilePolicyByKind): ReadonlyArray<GoogleEditorKind> {
  return GOOGLE_EDITOR_KINDS.filter((kind) => value[kind] === 'export-pdf');
}

function useChoiceLabel(): (choice: NativeFormatChoice) => string {
  const t = useT();
  return (choice) => {
    const ext = choice.extension;
    const format =
      choice.policy === 'export-pdf'
        ? t('wizard.nativePolicy.as.pdf', { ext })
        : ext === '.svg'
          ? t('wizard.nativePolicy.as.image', { ext })
          : choice.policy === 'export-odf'
            ? t('wizard.nativePolicy.as.odf', { ext })
            : t('wizard.nativePolicy.as.office', { ext });
    return choice.carries ? format : t('wizard.nativePolicy.as.leftBehind', { format });
  };
}

export const NativeFilePolicyChooser: React.FC<{
  /** The format in force for each kind. */
  value: NativeFilePolicyByKind;
  onChange: (next: NativeFilePolicyByKind) => void;
  /** While a save is in flight. */
  disabled?: boolean;
  /**
   * The prefix of each select's DOM id, which its label points at. Defaulted
   * because the wizard has one chooser; the settings panel passes its own so
   * two on one page could never share an id.
   */
  id?: string;
}> = ({ value, onChange, disabled, id = 'native-file-policy' }) => {
  const t = useT();
  const label = useChoiceLabel();
  const names = (kinds: ReadonlyArray<GoogleEditorKind>) =>
    kinds.map((kind) => t(nativeKindKey(kind))).join(', ');
  const behind = kindsLeftBehind(value);
  const asPdf = kindsAsPdf(value);
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700">{t('wizard.nativePolicy')}</legend>
      {/* One line, the rest folded (0118 T1). */}
      <Hint text={t('wizard.nativePolicy.hint')} why={t('wizard.nativePolicy.hint.why')} />
      <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        {GOOGLE_EDITOR_KINDS.map((kind) => (
          <React.Fragment key={kind}>
            <label className="text-sm text-gray-700" htmlFor={`${id}-${kind}`}>
              {t(nativeKindKey(kind))}
            </label>
            <select
              id={`${id}-${kind}`}
              className="input w-full"
              value={value[kind]}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, [kind]: e.target.value as GoogleNativeFilePolicy })
              }
            >
              <option value="refuse">{t('wizard.nativePolicy.leave')}</option>
              {formatChoicesFor(kind, value[kind]).map((choice) => (
                <option key={choice.policy} value={choice.policy}>
                  {label(choice)}
                </option>
              ))}
            </select>
          </React.Fragment>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 text-sm font-medium text-blue-700 hover:underline disabled:opacity-50"
        disabled={disabled}
        onClick={() => onChange(editableFormats(value))}
      >
        {t('wizard.nativePolicy.editable')}
      </button>
      {behind.length > 0 && (
        // `caution`, like the other line somebody must read before typing:
        // it says files will not move, and on the wizard it is the last screen
        // where that is still a choice.
        <Hint
          tone="caution"
          text={t('wizard.nativePolicy.leftBehind', { kinds: names(behind) })}
          why={t('wizard.nativePolicy.leftBehind.why')}
        />
      )}
      {asPdf.length > 0 && (
        <Hint
          text={t('wizard.nativePolicy.notEditable', { kinds: names(asPdf) })}
          why={t('wizard.nativePolicy.notEditable.why')}
        />
      )}
      {behind.length === 0 && asPdf.length === 0 && (
        <Hint
          text={t('wizard.nativePolicy.allEditable')}
          why={t('wizard.nativePolicy.allEditable.why')}
        />
      )}
    </fieldset>
  );
};

export default NativeFilePolicyChooser;
