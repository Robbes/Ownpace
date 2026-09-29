// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A COLLECTION A PASS COULD NOT LIST, AND THE LINE THAT SAYS SO
 * (2026-09-29; workplan 0055 T3 (e), the owner's "2a").
 *
 * One folder the source would not list used to end the whole data type's pass:
 * *"Dropbox answered 500 on files/list_folder"*, and every folder after it
 * waited for the next pass, which met the same folder first. The owner chose
 * to skip such a folder for that pass, carry on with the others, say which one
 * could not be read, ask for it again on the next pass, and conclude nothing
 * about its files meanwhile. The shared loop (`runDomainSync`) does the
 * skipping; this module is the part both editions' status rows share, so the
 * appliance and the managed worker cannot word it differently (hard rule 5).
 *
 * The note stands where a pass's error stands (`last_error`), with a category
 * and a reference beside it, because that is where the owner's screen already
 * shows what went wrong, and the category's sentence is the way out. It never
 * crosses to a link holder or an operator: the migration view and the support
 * screens do not carry `last_error`, and the folder's name is the owner's.
 */

import type { DiscoveryDomain } from './discovery.ts';
import type { FailureCategory } from './failure-category.ts';

/** One collection a pass could not list, and why, in the source's words. */
export interface UnreadCollection {
  /** The collection's path, as the ledger and the cursors name it. */
  readonly collection: string;
  /** What the owner calls it: a calendar's or address book's own name, else the path. */
  readonly name: string;
  /** What the source said, after its own retries. */
  readonly error: string;
  /**
   * What kind of failure that was, classified where it happened, as the
   * source's (0110 T3), and with any category the throw site stated.
   */
  readonly category: FailureCategory;
  /** The operator log's reference for it (0129 T1). */
  readonly reference: string;
}

/**
 * How every such note begins. It is how a later pass finds the note to clear
 * it, and so how clearing it can never touch a real failure's line: a pass
 * error is the provider's prose, and no provider starts one like this. "The
 * last pass" rather than "this pass", because the note is still on the screen
 * while the next pass runs.
 */
export const UNREAD_NOTE_PREFIX = 'Not read on the last pass: ';

/** How many collections a note names before it counts the rest. */
export const UNREAD_NOTE_NAMES = 5;

/** What a pass's status row says about the collections it could not list. */
export interface UnreadCollectionsNote {
  /** The line itself, starting with `UNREAD_NOTE_PREFIX`. */
  readonly note: string;
  /** The first collection's category, whose sentence is the way out. */
  readonly category: FailureCategory;
  /** The first collection's reference, which a person quotes. */
  readonly reference: string;
}

const WORDS: Record<DiscoveryDomain, readonly [one: string, many: string]> = {
  email: ['folder', 'folders'],
  file: ['folder', 'folders'],
  calendar: ['calendar', 'calendars'],
  contact: ['address book', 'address books'],
  task: ['task list', 'task lists'],
};

/** "A", "A" and "B", "A", "B" and "C" … and N more. */
function listed(names: ReadonlyArray<string>): string {
  const shown = names.slice(0, UNREAD_NOTE_NAMES).map((n) => `"${n}"`);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/**
 * The note for a pass that could not list `unread`, or `undefined` when it
 * listed everything it opened, which is what clears an earlier note.
 */
export function unreadCollectionsNote(
  domain: DiscoveryDomain,
  unread: ReadonlyArray<UnreadCollection>,
): UnreadCollectionsNote | undefined {
  const [first] = unread;
  if (!first) return undefined;
  const [one, many] = WORDS[domain];
  const which =
    unread.length === 1
      ? `the ${one} ${listed([first.name])}`
      : `${unread.length} ${many}, ${listed(unread.map((u) => u.name))}`;
  const after =
    unread.length === 1
      ? 'The next pass asks for it again, and nothing in it is counted as deleted until it is read.'
      : 'The next pass asks for them again, and nothing in them is counted as deleted until they are read.';
  return {
    note: `${UNREAD_NOTE_PREFIX}${which}. The source answered: ${sentence(first.error)} ${after}`,
    category: first.category,
    reference: first.reference,
  };
}

/** The source's words as they came, closed with a full stop when they were not. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return 'nothing.';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
