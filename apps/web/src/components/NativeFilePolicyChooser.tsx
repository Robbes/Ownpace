// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT HAPPENS TO GOOGLE DOCS, SHEETS, SLIDES AND DRAWINGS — the one control,
 * wherever the question is asked (workplan 0042 T0 Q3, extracted for 0125 T3).
 *
 * A folder of them is not an edge case — it is most people's Drive — and until
 * this control existed the answer was decided by a default the owner never saw.
 * They found out when the failure queue filled with files they thought had
 * migrated.
 *
 * ## Why it is a component and not a method on the wizard
 *
 * There are now TWO places the question is asked: the creation wizard, and the
 * migration's own settings once it is running. 0125 exists because those two
 * disagreed — the appliance could change this setting and had no picker,
 * managed had a picker and could not change it — and hard rule 5 is the rule
 * that was being broken. Building a second `<select>` for the settings panel
 * would fix the missing screen and reintroduce the same class of defect one
 * level up: two choosers, drifting, and a person told different things about
 * their Docs depending on which one they happened to read.
 *
 * So there is one chooser, and both arrivals render it. A guard holds its
 * options against `NATIVE_POLICY_COVERAGE`, so a policy that gets measured and
 * added cannot reach one screen and not the other.
 *
 * ## The lossy sentence is not a warning to click past
 *
 * An export is a RENDERING — nobody gets a Google Doc back out of an .odt — and
 * an owner who learns that after cutover learns it too late. Which is also why
 * the coverage line below the select is read off the measurements rather than
 * written by hand: a cell that changes colour changes this sentence, and nobody
 * has to remember to.
 */
import React from 'react';
import {
  policyLeavesBehind,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { nativeKindKey } from '../i18n/native-kind-key.ts';
import { Hint } from './Hint.tsx';

/**
 * The four this control offers, `refuse` first and selected by default.
 *
 * Of the two ways this can disappoint somebody — "your Docs did not migrate,
 * and here is why" and "your Docs arrived as something you cannot edit" — only
 * the first is one they can still act on.
 *
 * Exported so the guard can hold it against the measured table AND against the
 * parser both editions validate with, from the outside.
 */
export const NATIVE_FILE_POLICY_OPTIONS: ReadonlyArray<{
  readonly value: GoogleNativeFilePolicy;
  readonly labelKey:
    | 'wizard.nativePolicy.refuse'
    | 'wizard.nativePolicy.odf'
    | 'wizard.nativePolicy.office'
    | 'wizard.nativePolicy.pdf';
}> = [
  { value: 'refuse', labelKey: 'wizard.nativePolicy.refuse' },
  { value: 'export-odf', labelKey: 'wizard.nativePolicy.odf' },
  { value: 'export-office', labelKey: 'wizard.nativePolicy.office' },
  { value: 'export-pdf', labelKey: 'wizard.nativePolicy.pdf' },
];

/**
 * WHICH OF THEIR FILES THIS FORMAT WILL ACTUALLY LEAVE BEHIND.
 *
 * The line that used to sit here said an export is a rendering rather than the
 * original — true of all three formats, and silent about the one difference
 * between them that decides whether a file moves at all: OpenDocument leaves
 * every Google Doc behind and Microsoft Office leaves every Slides deck behind,
 * measured (0042 T3). A person picking "OpenDocument — .odt, .ods, .odp" was
 * choosing, unknowingly, to drop the kind of file that label starts with.
 *
 * They did find out — at discovery, and per file in the failures queue. Both
 * are after the choice, and the second is after the run.
 */
const PolicyCoverage: React.FC<{ policy: Exclude<GoogleNativeFilePolicy, 'refuse'> }> = ({
  policy,
}) => {
  const t = useT();
  const dropped = policyLeavesBehind(policy);
  if (dropped.length === 0) {
    return (
      <Hint
        text={t('wizard.nativePolicy.carriesAll')}
        why={t('wizard.nativePolicy.carriesAll.why')}
      />
    );
  }
  return (
    <Hint
      // `caution`, like the other line somebody must read before typing: this
      // one says files will not move, and on the wizard it is the last screen
      // where that is still a choice.
      tone="caution"
      text={t('wizard.nativePolicy.drops', {
        kinds: dropped.map((kind) => t(nativeKindKey(kind))).join(', '),
      })}
      why={t('wizard.nativePolicy.drops.why')}
    />
  );
};

export const NativeFilePolicyChooser: React.FC<{
  /** The policy in force. A value this control does not offer shows as `refuse`. */
  value: string;
  onChange: (next: GoogleNativeFilePolicy) => void;
  /** While a save is in flight. */
  disabled?: boolean;
  /**
   * The select's DOM id, which its label points at. Defaulted rather than
   * required because the wizard has exactly one; the settings panel passes its
   * own so two of these on one page could never share an id.
   */
  id?: string;
}> = ({ value, onChange, disabled, id = 'native-file-policy' }) => {
  const t = useT();
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700" htmlFor={id}>
        {t('wizard.nativePolicy')}
      </label>
      {/* One line, the rest folded (0118 T1). Three thoughts belong here —
          what these are, what an export costs, what happens if you decline —
          and showing all three at once is the thing that rule exists to
          stop. */}
      <Hint text={t('wizard.nativePolicy.hint')} why={t('wizard.nativePolicy.hint.why')} />
      <select
        id={id}
        className="input w-full mt-2"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as GoogleNativeFilePolicy)}
      >
        {NATIVE_FILE_POLICY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
      {value === 'refuse' ? (
        <Hint
          text={t('wizard.nativePolicy.unmeasured')}
          why={t('wizard.nativePolicy.unmeasured.why')}
        />
      ) : (
        <PolicyCoverage policy={value as Exclude<GoogleNativeFilePolicy, 'refuse'>} />
      )}
    </div>
  );
};

export default NativeFilePolicyChooser;
