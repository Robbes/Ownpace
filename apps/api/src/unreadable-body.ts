// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BODY THE API COULD NOT READ IS THE CALLER'S 4xx, NOT OUR 500.
 *
 * `express.json()` and `express.urlencoded()` refuse a body that is not JSON,
 * that is too large, or that is in a charset or an encoding they do not read.
 * They hand the refusal on as an error. Until 2026-10-04 that error reached
 * the API's last handler, which answers every error 500 "a fault on our side"
 * and logs the error object. For a body that would not parse, that object
 * carries the raw text as `body`, and its message can quote part of it. So on
 * `POST /api/access-requests` a stranger's address, their note and the spam
 * trap's value reached the log, though that route keeps the name and the note
 * out of it (§17). Found by #1490's review (workplan 0093).
 *
 * Now such a refusal is answered here, just before that handler: with the
 * status the parser gave it (400, 413 or 415), in the API's refusal shape
 * `{ error, message }`, and with nothing of the body in it. The log gets one
 * line: the parser's type, the method and the path, with a link in the path
 * written as the access log writes it, and no query (`access-log.ts`). Never
 * the body, and never the parser's message, which can quote it.
 *
 * A compressed body that does not decompress is refused too. body-parser
 * reads gzip, deflate and br, and when the bytes are not that format (or the
 * stream is cut short), zlib's own error comes back as a 400 with no `type`.
 * So the parsers are mounted through `readingTheBody`, which marks every
 * error they hand on: a 4xx from a parser is the caller's, whatever its
 * shape. Found by the review of this fix.
 *
 * What is not the caller's goes on to `serverFault`: any error that is not
 * the parser's, and the parser's own 5xx (a stream it could not read). The
 * report route answers its own parser's refusals itself, in words for its
 * form (`routes/problem-reports.ts`); it logs nothing of the body either.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { log } from '@openmig/shared';
import { loggableUrl } from './access-log.ts';

/** A body the parser refused, and how the API answers it. */
export interface BodyRefusal {
  /** The parser's own status: 400, 413 or 415, or another 4xx it gave. */
  readonly status: number;
  /** The parser's name for the refusal, such as `entity.parse.failed`. */
  readonly type: string;
  readonly error: string;
  readonly message: string;
}

/**
 * How body-parser and raw-body name a refusal: words joined by dots. Only a
 * name of that shape is written to the log; a `type` of another shape is not
 * the parser's.
 */
const PARSER_TYPE = /^[a-z]+(?:\.[a-z]+)+$/i;

/** Every error a body parser mounted through `readingTheBody` handed on. */
const handedOnByAParser = new WeakSet<object>();

/**
 * `parser`, with every error it hands on marked as the parser's. Mount each
 * body parser through this: `app.use(readingTheBody(express.json()))`.
 */
export function readingTheBody(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void parser(req, res, (err?: unknown) => {
      if (typeof err === 'object' && err !== null) handedOnByAParser.add(err);
      next(err);
    });
  };
}

/** Whether a body parser mounted through `readingTheBody` handed on `err`. */
export function handedOnByABodyParser(err: unknown): boolean {
  return typeof err === 'object' && err !== null && handedOnByAParser.has(err);
}

/**
 * The refusal, when `err` is the parser refusing what the caller sent: a
 * 4xx status, and a `type` the parser names or a parser that handed it on.
 * Anything else is not the caller's.
 */
export function bodyRefusal(err: unknown): BodyRefusal | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { type, status, statusCode } = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  const code = typeof status === 'number' ? status : statusCode;
  const named = typeof type === 'string' && PARSER_TYPE.test(type);
  if (!named && !handedOnByABodyParser(err)) return undefined;
  if (typeof code !== 'number' || !Number.isInteger(code) || code < 400 || code > 499) return undefined;
  if (!named) {
    // The stream's own error, which raw-body hands on as it is and
    // body-parser wraps as a 400: for a compressed body, zlib's. The log
    // gets a fixed name, never that error's message or code.
    return {
      status: code,
      type: 'content.decode.failed',
      error: 'body_unreadable',
      message: 'The request body could not be read.',
    };
  }
  if (code === 413) {
    return { status: code, type, error: 'body_too_large', message: 'The request body is too large for this service.' };
  }
  if (code === 415) {
    return {
      status: code,
      type,
      error: 'body_encoding_unsupported',
      message: 'The request body is in a charset or a content encoding this service does not read.',
    };
  }
  // The JSON parser's refusal is the `SyntaxError` that `JSON.parse` threw.
  if (type === 'entity.parse.failed' && err instanceof SyntaxError) {
    return { status: code, type, error: 'body_not_json', message: 'The request body could not be read as JSON.' };
  }
  return { status: code, type, error: 'body_unreadable', message: 'The request body could not be read.' };
}

/**
 * Express error middleware: answers a refused body as the caller's, and
 * passes every other error on. Mounted just before the API's last handler.
 */
export function unreadableBody(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const refusal = bodyRefusal(err);
  if (!refusal) {
    next(err);
    return;
  }
  // The path only: `req.path` has no query, and `loggableUrl` writes a link
  // in it as `:link`, as the access log does.
  const path = loggableUrl(`${req.baseUrl ?? ''}${req.path ?? ''}` || undefined);
  log.info(`[api] ${req.method} ${path}: a body the parser could not read (${refusal.type}), answered ${refusal.status}`);
  res.status(refusal.status).json({ error: refusal.error, message: refusal.message });
}
