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
 * The English is the sentence `serverMessage` would show, `message` first and
 * then `reason`, in its own order. Under `nl` this reads the Dutch half OF THAT
 * SENTENCE, so the two languages can never be two different refusals. A
 * server sentence without a Dutch half (an older server, a fault, a sentence
 * nobody has paired yet) is shown in the English as served, rather than as
 * nothing.
 *
 * A failure the server wrote no sentence for is the page's own, from the
 * dictionary, in the page's language (0145 T6, review). Until then it fell
 * back to the error's own message: zod's JSON dump of its issues for a
 * subject this page could not read, axios's English *Network Error* for a
 * connection that dropped, or *Request failed with status code 502* for a
 * proxy's HTML. None of those is a sentence, and none is in the page's
 * language. The failure is still shown as one: which sentence, not whether.
 */

import axios from 'axios';
import type { Locale, StringKey } from '../i18n/strings.ts';

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

export function linkRefusal(err: unknown, locale: Locale, t: (key: StringKey) => string): string {
  if (!axios.isAxiosError(err)) {
    // Not a request that failed: a subject or an answer this page could not
    // read, which is a bug or a newer server, and nothing the reader can fix.
    return t('link.unreadable');
  }
  // No answer at all: the connection dropped, or the request timed out.
  if (!err.response) return t('link.unreachable');
  const data: unknown = err.response.data;
  if (data && typeof data === 'object') {
    const d = data as { message?: unknown; messageNl?: unknown; reason?: unknown; reasonNl?: unknown };
    if (nonEmpty(d.message)) return locale === 'nl' && nonEmpty(d.messageNl) ? d.messageNl : d.message;
    if (nonEmpty(d.reason)) return locale === 'nl' && nonEmpty(d.reasonNl) ? d.reasonNl : d.reason;
  }
  // An answer with no sentence in it: a proxy's page, or a body that names
  // only a code.
  return t('link.unreadable');
}
