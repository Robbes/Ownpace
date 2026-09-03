// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Shared factories for the native DAV connectors (workplan 0010/0011 T3).
 *
 * One real implementation used by BOTH deps-builders — the managed DB path
 * (`build-deps-from-mapping.ts`) and the self-host file path (`build-deps.ts`) —
 * so both editions sync calendar/contact/file for real instead of one path
 * carrying placeholders. Callers resolve their own config/credentials (DB row +
 * decrypted secret, or file config + env) into a normalized endpoint and hand it
 * here.
 */

import { CalDAVSource, CarddavSource, WebdavFileSource } from '@openmig/connectors';
import { CalDAVTargetWriter, CardDAVTargetWriter, WebDAVTargetWriter } from '@openmig/engines';
import type {
  ThrottleLimiter,
  Ledger,
  TenantId,
  MappingId,
  CalendarSource,
  ContactSource,
  FileSource,
  CalendarTargetWriter,
  ContactTargetWriter,
  FileTargetWriter,
} from '@openmig/shared';

/** A resolved DAV endpoint: URL + direct credentials (never env-indirected here). */
export interface DavEndpoint {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

/** Deps every DAV target writer needs. */
export interface DavTargetDeps {
  readonly ledger: Ledger;
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
}

export function buildCalendarSource(e: DavEndpoint, throttleLimiter?: ThrottleLimiter): CalendarSource {
  return new CalDAVSource({
    url: e.url,
    username: e.username,
    password: e.password,
    ...(throttleLimiter ? { throttleLimiter } : {}),
  });
}
export function buildCalendarTarget(e: DavEndpoint, d: DavTargetDeps): CalendarTargetWriter {
  return new CalDAVTargetWriter({ url: e.url, username: e.username, password: e.password }, d);
}

/**
 * The TASK source: the same CalDAV client, told which component it serves
 * (workplan 0113).
 *
 * On the wire a task list is a calendar collection whose
 * `supported-calendar-component-set` says VTODO, read over the same protocol
 * with the same credential. So this is one line different from
 * `buildCalendarSource`, and that one line is the whole distinction: the
 * source lists only collections carrying VTODO and yields only VTODO objects,
 * so a mixed collection gives each domain its own.
 */
export function buildTaskSource(e: DavEndpoint, throttleLimiter?: ThrottleLimiter): CalendarSource {
  return new CalDAVSource({
    url: e.url,
    username: e.username,
    password: e.password,
    component: 'VTODO',
    ...(throttleLimiter ? { throttleLimiter } : {}),
  });
}

/**
 * The TASK target: the CalDAV writer, unchanged.
 *
 * It needs no component of its own — it reads each object's from the bytes it
 * is handed (0113 T4), so the same writer carries an event or a task and asks
 * the server about whichever it has.
 */
export function buildTaskTarget(e: DavEndpoint, d: DavTargetDeps): CalendarTargetWriter {
  return new CalDAVTargetWriter({ url: e.url, username: e.username, password: e.password }, d);
}

export function buildContactSource(e: DavEndpoint, throttleLimiter?: ThrottleLimiter): ContactSource {
  return new CarddavSource({
    url: e.url,
    username: e.username,
    password: e.password,
    ...(throttleLimiter ? { throttleLimiter } : {}),
  });
}
export function buildContactTarget(e: DavEndpoint, d: DavTargetDeps): ContactTargetWriter {
  return new CardDAVTargetWriter({ url: e.url, username: e.username, password: e.password }, d);
}

export function buildFileSource(e: DavEndpoint, throttleLimiter?: ThrottleLimiter): FileSource {
  return new WebdavFileSource({
    url: e.url,
    username: e.username,
    password: e.password,
    ...(throttleLimiter ? { throttleLimiter } : {}),
  });
}
export function buildFileTarget(e: DavEndpoint, d: DavTargetDeps): FileTargetWriter {
  return new WebDAVTargetWriter({ url: e.url, username: e.username, password: e.password }, d);
}
