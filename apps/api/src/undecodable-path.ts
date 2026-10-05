// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PATH THE API COULD NOT DECODE IS THE CALLER'S 400, AND ITS LINK STAYS OUT
 * OF THE LOG.
 *
 * Express decodes each route parameter. When one holds a malformed escape
 * (`/api/grant/<link>%ZZ`), its router throws a `URIError` with status 400,
 * and the message quotes the raw value: "Failed to decode param '<link>%ZZ'".
 * That error reached the API's last handler. It was answered 500, a fault of
 * ours, and `serverFault` logged it whole, link and all. Found by the review
 * of the case fix, 2026-10-05 (workplan 0108).
 *
 * Now it is answered here, just before that handler: 400, in the API's
 * refusal shape `{ error, message }`. The log gets one line: the method and
 * the path, with a link in it written as the access log writes it, and no
 * query (`access-log.ts`). Never the error's message.
 */

import type { NextFunction, Request, Response } from 'express';
import { log } from '@openmig/shared';
import { loggableUrl } from './access-log.ts';

/** Whether `err` is the router refusing a parameter it could not decode. */
export function undecodableParam(err: unknown): boolean {
  return err instanceof URIError && (err as URIError & { status?: unknown }).status === 400;
}

/**
 * Express error middleware: answers a path the router could not decode as the
 * caller's 400, and passes every other error on.
 */
export function undecodablePath(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (!undecodableParam(err)) {
    next(err);
    return;
  }
  const path = loggableUrl(`${req.baseUrl ?? ''}${req.path ?? ''}` || undefined);
  log.info(`[api] ${req.method} ${path}: a path the router could not decode, answered 400`);
  res.status(400).json({ error: 'path_unreadable', message: 'The request path could not be read.' });
}
