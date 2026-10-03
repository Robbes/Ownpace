// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Values substituted into a string's `{placeholders}` (workplan 0080).
 *
 * Added for the probe results, and the reason it had to exist rather than be
 * composed at the call site: a sentence built by concatenating dictionary
 * fragments has ENGLISH word order baked into the concatenation. *The JMAP
 * session document at {url} answered {status}* and its Dutch counterpart do
 * not put those two values in the same places, and no amount of care at the
 * call site fixes that — the ordering belongs to the sentence, which means it
 * belongs to the dictionary.
 */
export type TemplateVars = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` from `vars`. A placeholder with no value is left ALONE
 * rather than blanked: a visible `{count}` on screen is a bug report, and an
 * empty gap is a mystery.
 */
export function fill(template: string, vars?: TemplateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
