// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Microsoft Graph's To Do resources, as `/me/todo` answers them (v1.0).
 *
 * Only the fields the VTODO mapping reads; Graph sends more and the source
 * ignores the rest. Every field is optional except the id, because Graph's
 * own documentation marks most of them nullable and a task created from a
 * flagged email carries very few.
 */

/** A list — `GET /me/todo/lists`. */
export interface GraphTodoList {
  readonly id: string;
  readonly displayName: string;
  readonly isOwner?: boolean;
  readonly isShared?: boolean;
  /** `defaultList` is "Tasks"; `flaggedEmails` is the list To Do builds from flagged mail. */
  readonly wellknownListName?: 'none' | 'defaultList' | 'flaggedEmails' | 'unknownFutureValue';
}

/** Graph's wall-clock-plus-zone pair. `dateTime` carries seven fractional digits. */
export interface GraphDateTimeTimeZone {
  readonly dateTime: string;
  readonly timeZone?: string;
}

export type GraphTodoStatus = 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';
export type GraphTodoImportance = 'low' | 'normal' | 'high';

export interface GraphChecklistItem {
  readonly id?: string;
  readonly displayName?: string;
  readonly isChecked?: boolean;
}

export interface GraphRecurrencePattern {
  readonly type:
    | 'daily'
    | 'weekly'
    | 'absoluteMonthly'
    | 'relativeMonthly'
    | 'absoluteYearly'
    | 'relativeYearly';
  readonly interval?: number;
  /** `monday` … `sunday`. */
  readonly daysOfWeek?: ReadonlyArray<string>;
  readonly dayOfMonth?: number;
  /** 1–12. */
  readonly month?: number;
  readonly firstDayOfWeek?: string;
  readonly index?: 'first' | 'second' | 'third' | 'fourth' | 'last';
}

export interface GraphRecurrenceRange {
  readonly type: 'endDate' | 'noEnd' | 'numbered';
  /** `YYYY-MM-DD`. */
  readonly startDate?: string;
  readonly endDate?: string;
  readonly numberOfOccurrences?: number;
  readonly recurrenceTimeZone?: string;
}

/** A task — `GET /me/todo/lists/{id}/tasks?$expand=checklistItems`. */
export interface GraphTodoTask {
  readonly id: string;
  readonly title?: string;
  readonly status?: GraphTodoStatus;
  readonly importance?: GraphTodoImportance;
  readonly body?: { readonly content?: string; readonly contentType?: 'text' | 'html' };
  /** ISO 8601, UTC. */
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly completedDateTime?: GraphDateTimeTimeZone;
  readonly dueDateTime?: GraphDateTimeTimeZone;
  readonly startDateTime?: GraphDateTimeTimeZone;
  readonly reminderDateTime?: GraphDateTimeTimeZone;
  readonly isReminderOn?: boolean;
  readonly categories?: ReadonlyArray<string>;
  readonly recurrence?: {
    readonly pattern?: GraphRecurrencePattern;
    readonly range?: GraphRecurrenceRange;
  };
  readonly checklistItems?: ReadonlyArray<GraphChecklistItem>;
  readonly hasAttachments?: boolean;
}
