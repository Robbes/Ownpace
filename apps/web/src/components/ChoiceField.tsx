// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CHOICE WITH AN ANSWER ALREADY MARKED (workplan 0148 T9, D11).
 *
 * The first descriptor field with a default is the export archive's `where`:
 * a folder of the destination's files, or this appliance's disk. A choice of
 * two that is never empty reads as two radio buttons with one marked, not as
 * a drop-down with a blank at the top, so both doors that draw the archive
 * form — the wizard and the Connections page — render it here, the same way.
 *
 * AN ANSWER ONLY THE APPLIANCE CAN GIVE IS SHOWN, NOT HIDDEN. On managed the
 * disk is ours and a pass cannot read it (0136 T5), but the owner's rule is
 * that nothing is hidden on managed (D10): the answer stays on screen,
 * disabled, with the line that says why (*"'Only on a self-hosted
 * appliance': ok"*). The edition is read through `services/edition`.
 */
import React from 'react';
import { fieldDefault, type CredentialField } from '@openmig/shared';
import { useT, type StringKey } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';

/** The answer a choice shows: what was picked, else this edition's default. */
export function choiceValue(field: CredentialField, picked: string | undefined): string {
  return picked || (fieldDefault(field, isSelfHost()) ?? '');
}

export const ChoiceField: React.FC<{
  field: CredentialField;
  /** What was picked, or empty for the edition's default. */
  value: string | undefined;
  onChange: (value: string) => void;
  /** Unique on the page: the radio group's `name`. */
  name: string;
  className?: string;
}> = ({ field, value, onChange, name, className }) => {
  const t = useT();
  const selfHost = isSelfHost();
  const current = choiceValue(field, value);
  return (
    <fieldset className={className}>
      <legend className="block text-sm font-medium text-gray-700 mb-1">
        {t(field.labelKey as StringKey)}
      </legend>
      <div className="space-y-1">
        {(field.options ?? []).map((option) => {
          const locked = Boolean(option.applianceOnly) && !selfHost;
          return (
            <label
              key={option.value}
              className={`flex items-start gap-2 text-sm ${locked ? 'text-gray-400' : 'text-gray-700'}`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={current === option.value}
                disabled={locked}
                onChange={() => onChange(option.value)}
                className="mt-0.5"
              />
              <span>
                {option.labelKey ? t(option.labelKey as StringKey) : option.label}
                {locked && option.applianceOnlyKey && (
                  <span className="block text-xs text-gray-500">
                    {t(option.applianceOnlyKey as StringKey)}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};
