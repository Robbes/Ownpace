// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GUIDE HANDLE: which section of which served guide a refusal points at
 * (workplan 0148 T7).
 *
 * A refusal used to name a file, *"Where each comes from is
 * docs/box-setup.md"*, which a customer in a browser cannot open. Its words
 * now stay as written, in English (the i18n prose boundary), and a handle such
 * as `'dropbox#own-app'` rides beside them: on the create route's Zod issues as
 * `params.guide`, on a `BilingualRefusal`, and on a probe's refusal. The web
 * app draws the link from it in the reader's language, *Guide: {title}* /
 * *Handleiding: {title}*, to `/docs/<slug>#<section>`.
 *
 * The slug is typed against the guides that are served, `docs/guides/<locale>/
 * <slug>.md`; `scripts/a-refusal-that-links-its-guide.unit.test.ts` holds this
 * list to the files in both languages, and every handle in the sources to a
 * section both languages' guides have.
 */

/** The guides `/docs` serves, in Dutch and in English (0148 T1, T4). */
export const SERVED_GUIDES = [
  'apple',
  'archive',
  'box',
  'dav',
  'dropbox',
  'google',
  'imap',
  'jmap',
  'microsoft',
  'nextcloud',
  'soverin',
] as const;

export type ServedGuide = (typeof SERVED_GUIDES)[number];

/** `<guide>#<section>`: a served guide and one of its section ids. */
export type GuideHandle = `${ServedGuide}#${string}`;

const HANDLE = /^([a-z][a-z0-9-]*)#([a-z0-9-]+)$/;

/** The guide and the section of a handle, or undefined when it is not one. */
export function guideHandleParts(value: unknown): { guide: ServedGuide; section: string } | undefined {
  if (typeof value !== 'string') return undefined;
  const match = HANDLE.exec(value);
  if (!match || !(SERVED_GUIDES as readonly string[]).includes(match[1]!)) return undefined;
  return { guide: match[1] as ServedGuide, section: match[2]! };
}

/** True for a well-formed handle that names a served guide. */
export function isGuideHandle(value: unknown): value is GuideHandle {
  return guideHandleParts(value) !== undefined;
}

/** Where a handle's section is in the app. */
export function guideHref(handle: GuideHandle): string {
  const { guide, section } = guideHandleParts(handle)!;
  return `/docs/${guide}#${section}`;
}

/**
 * An error whose words are a provider's, with ours added, and a guide that
 * says the rest: Box's `unauthorized_client`, which is the Admin Console's
 * one-time authorization. `message` is unchanged, so every log line and every
 * reader that only knows `Error` reads what it always read.
 */
export function guidedError(message: string, guide: GuideHandle): Error & { readonly guide: GuideHandle } {
  return Object.assign(new Error(message), { guide });
}

/** The guide an error carries, whoever threw it, or undefined. */
export function guideOf(error: unknown): GuideHandle | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { guide } = error as { guide?: unknown };
  return isGuideHandle(guide) ? guide : undefined;
}
