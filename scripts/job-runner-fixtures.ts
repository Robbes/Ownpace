// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * managed.yml, changed the ways the tests of either runner need it (workplan
 * 0167 T7), from whatever the file holds today: before the worker's service
 * is in it, and after (where `api` and `worker` both carry
 * `${OWNPACE_JOB_RUNNER:-trigger}`). A fixture that injected a second switch
 * into a file that already had one gave it two defaults, which job-runner.sh
 * rightly refuses, so each change here rewrites what is there before it adds
 * anything.
 */

const SWITCH = /\$\{OWNPACE_JOB_RUNNER:-[^}]*\}/g;

/** The switch's default set to <runner> everywhere the file names it, or a worker added that names it. */
export const switchedTo =
  (runner: 'trigger' | 'pg-boss') =>
  (yml: string): string => {
    // Not SWITCH.test: a /g pattern's test() keeps its lastIndex between calls.
    if (yml.includes('${OWNPACE_JOB_RUNNER:-')) return yml.replace(SWITCH, `\${OWNPACE_JOB_RUNNER:-${runner}}`);
    const out = yml.replace(
      /\nservices:\n/,
      `\nservices:\n  worker:\n    image: localhost/ownpace-worker\n    profiles: ["jobs"]\n    environment:\n      OWNPACE_JOB_RUNNER: \${OWNPACE_JOB_RUNNER:-${runner}}\n`,
    );
    if (out === yml) throw new Error('managed.yml has no services: line this fixture knows');
    return out;
  };

/**
 * The `worker` service taken out, whatever it holds: its line under
 * `services:` to the next service or top-level key. A file without one is
 * returned as it is.
 */
export function withoutWorker(yml: string): string {
  const lines = yml.split('\n');
  const out: string[] = [];
  let inServices = false;
  let dropping = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) inServices = true;
    else if (/^[^\s#]/.test(line)) inServices = false;
    if (inServices && /^ {2}[A-Za-z0-9_.-]+:\s*$/.test(line)) dropping = line.trim() === 'worker:';
    else if (!inServices) dropping = false;
    if (!dropping) out.push(line);
  }
  return out.join('\n');
}

/** Every line that names the switch taken out, as a release from before it (alpha.14, alpha.15) has none. */
export function withoutSwitch(yml: string): string {
  return yml
    .split('\n')
    .filter((l) => !l.includes('${OWNPACE_JOB_RUNNER'))
    .join('\n');
}

/** managed.yml without the plane: no Trigger.dev and no ClickHouse image line (alpha.17). */
export function withoutPlane(yml: string): string {
  const out = yml
    .replace(/^[ \t]*image:.*\$\{TRIGGER_IMAGE_TAG:-v[^}]*\}.*\n/gm, '')
    .replace(/^[ \t]*image:.*clickhouse\/clickhouse-server.*\n/gm, '');
  if (out === yml) throw new Error('managed.yml has no plane image line this fixture knows');
  return out;
}
