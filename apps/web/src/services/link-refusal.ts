// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A refusal to somebody holding a link, in the page's language (workplan 0145
 * T6).
 *
 * The grant and view pages are read by somebody with no account, and every
 * refusal they show is the server's sentence, written to be forwarded to the
 * person who sent the link. Since 0145 T6 the server sends each of those in
 * both languages, from the pairs in `@openmig/shared`: the Dutch half beside
 * the English one, under the same name with `Nl` added (`reason` and
 * `reasonNl`, or `message` and `messageNl` for the link check itself).
 *
 * Under `nl` this reads the Dutch half OF THE SENTENCE `serverMessage` would
 * show, so the two languages can never be two different refusals: `message`
 * first, then `reason`, in `serverMessage`'s own order. Anything without a
 * Dutch half (an older server, a fault, a sentence nobody has paired yet)
 * falls back to `serverMessage`, the English as served, rather than to nothing.
 */

import axios from 'axios';
import type { Locale } from '../i18n/strings.ts';
import { serverMessage } from './api.ts';

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

export function linkRefusal(err: unknown, locale: Locale): string {
  if (locale === 'nl' && axios.isAxiosError(err)) {
    const data: unknown = err.response?.data;
    if (data && typeof data === 'object') {
      const d = data as { message?: unknown; messageNl?: unknown; reason?: unknown; reasonNl?: unknown };
      if (nonEmpty(d.message)) {
        if (nonEmpty(d.messageNl)) return d.messageNl;
      } else if (nonEmpty(d.reason) && nonEmpty(d.reasonNl)) {
        return d.reasonNl;
      }
    }
  }
  return serverMessage(err);
}
