// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH NEXTCLOUD THE INTEGRATION TIER STARTS, AND PROOF THAT IT WAS THAT ONE
 * (workplan 0119, Status of 2026-10-25).
 *
 * The tier starts the image `testcontainers-setup.ts` names: the major the demo
 * runs. `NEXTCLOUD_IMAGE` asks for another one. The second-major leg
 * (`.github/workflows/nextcloud-second-major.yml`) sets it, to run the suites
 * that talk to Nextcloud against the other major a customer's own server may
 * run: 35 while the demo ran 34, and 34, which a customer who has not upgraded
 * still runs, since the demo moved to 35 (workplan 0119 T5).
 *
 * An image asked for by name changes two things in the setup:
 *
 *  - A Nextcloud that does not start FAILS the run. Without a name the tier
 *    warns and the DAV suites skip, which is right for a developer with no
 *    Nextcloud and wrong for a run whose only purpose is that Nextcloud: it
 *    would report green over nothing (AGENTS.md hard rule 9).
 *  - The server that answered must be the version the tag names. `status.php`
 *    says which version it is, so a leg that started the default by mistake,
 *    or a tag that moved to another release, fails before any suite runs.
 *
 * No Docker or Testcontainers import here, so the rules are unit-tested on
 * their own (`nextcloud-image.unit.test.ts`).
 */

/** The image `NEXTCLOUD_IMAGE` asks for, or undefined when it asks for none. */
export function nextcloudImageAsked(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const asked = env.NEXTCLOUD_IMAGE?.trim();
  return asked ? asked : undefined;
}

/**
 * The version a Nextcloud image reference names, from its tag:
 * `nextcloud:35.0.1-apache@sha256:…` names `35.0.1`, `nextcloud:35-apache`
 * names `35`. Undefined for a tag that names no version (`latest`, `apache`,
 * `stable`) and for a reference with no tag.
 */
export function versionTheTagNames(ref: string): string | undefined {
  const named = ref.split('@')[0] ?? '';
  const colon = named.lastIndexOf(':');
  if (colon < 0 || colon < named.lastIndexOf('/')) return undefined;
  return /^(\d+(?:\.\d+)*)(?:-|$)/.exec(named.slice(colon + 1))?.[1];
}

/**
 * Whether a server's `versionstring` (from `status.php`) is the version a tag
 * names. `35.0.1` is named by `35`, `35.0` and `35.0.1`, and never by `35.0.10`
 * or `3`: the match ends at a dot, not inside a number.
 */
export function isTheVersionNamed(named: string, versionstring: string): boolean {
  return versionstring === named || versionstring.startsWith(`${named}.`);
}

/**
 * `status.php`'s `versionstring`, or undefined when the body is not its JSON
 * or carries none.
 */
export function versionstringOf(statusBody: string): string | undefined {
  try {
    const parsed = JSON.parse(statusBody) as { versionstring?: unknown };
    return typeof parsed.versionstring === 'string' && parsed.versionstring ? parsed.versionstring : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The refusal, when the server that answered is not the one asked for, or
 * undefined when it is (or when nothing was asked for by name). A tag that
 * names no version is held to nothing: there is no version to compare.
 */
export function wrongServer(asked: string | undefined, statusBody: string): string | undefined {
  if (!asked) return undefined;
  const named = versionTheTagNames(asked);
  if (!named) return undefined;
  const answered = versionstringOf(statusBody);
  if (!answered) {
    return `NEXTCLOUD_IMAGE asks for ${asked}, and status.php said no version: ${statusBody.slice(0, 200)}`;
  }
  return isTheVersionNamed(named, answered)
    ? undefined
    : `NEXTCLOUD_IMAGE asks for ${asked}, whose tag names ${named}, and the server that answered is Nextcloud ${answered}`;
}
