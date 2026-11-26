// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Elements of an XML body a remote server sent, found in time linear in the
 * body's length.
 *
 * ## Why not one regular expression (workplan 0163, 2026-11-23)
 *
 * The DAV readers each pulled an element out with a pattern of the shape
 * `<name…>([\s\S]*?)</name>`. On a body that opens the element many times and
 * never closes it, the engine starts at every opening tag and scans to the
 * end of the body for a closing one: time quadratic in the body's length. A
 * CalDAV or CardDAV server is whatever host a person names (workplan 0136
 * treats every one as hostile), and nothing caps the body it answers with, so
 * a few megabytes of `<d:response>` held a worker for minutes. An outside,
 * read-only check found the pattern in six places.
 *
 * Here the body is read once, tag by tag (`<` to the next `>`, with no `<` or
 * `>` inside), and each caller says in plain code which tag opens the element
 * and which closes it. An element runs from an opening tag to the first
 * closing tag after it, as the lazy pattern did. When no tag after an opening
 * tag closes it, none after a later one can either, so the read stops there.
 *
 * Not an XML parser, as the patterns it replaces were not: it does not pair
 * nested elements of the same name, and it does not read comments or CDATA.
 */

/** One element `elementsIn` found: where it stands in the body, and the text between its two tags. */
export interface XmlElement {
  /** The index of its opening tag's `<`. */
  readonly start: number;
  /** The index just past its closing tag's `>`. */
  readonly end: number;
  /** What stands between the opening tag and the closing one. */
  readonly text: string;
}

/**
 * The elements of `xml` that `opens` and `closes` name, in order and without
 * overlap. Each callback gets a tag's text between `<` and `>`; a closing
 * tag's starts with `/`. `first` stops at the first element.
 */
export function elementsIn(
  xml: string,
  opens: (tag: string) => boolean,
  closes: (tag: string) => boolean,
  first = false,
): XmlElement[] {
  const found: XmlElement[] = [];
  const tags = /<([^<>]*)>/g;
  for (let open = tags.exec(xml); open !== null; open = tags.exec(xml)) {
    if (!opens(open[1] ?? '')) continue;
    const from = tags.lastIndex;
    let close = tags.exec(xml);
    while (close !== null && !closes(close[1] ?? '')) close = tags.exec(xml);
    // No tag after this opening one closes it, so none closes a later one.
    if (close === null) break;
    found.push({ start: open.index, end: tags.lastIndex, text: xml.slice(from, close.index) });
    if (first) break;
  }
  return found;
}

/** `xml` with every element `elementsIn` finds taken out, as `xml.replace(pattern, '')` did. */
export function withoutElements(xml: string, opens: (tag: string) => boolean, closes: (tag: string) => boolean): string {
  let kept = '';
  let at = 0;
  for (const element of elementsIn(xml, opens, closes)) {
    kept += xml.slice(at, element.start);
    at = element.end;
  }
  return kept + xml.slice(at);
}

/**
 * `text` with only A to Z lowered: how a regular expression's `i` flag
 * (without `u`) compares a name written in ASCII, which no other letter
 * matches.
 */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/**
 * Whether `tag`, after an optional namespace prefix that `prefix` matches at
 * its start (a pattern anchored with `^` that ends in `:`), names `name`, with
 * `after` accepting the rest of the tag. As `<(?:prefix:)?name…` did: tried with
 * the prefix first, then without. `ignoreCase` compares as the `i` flag did.
 */
export function namesElement(
  tag: string,
  name: string,
  prefix: RegExp,
  after: (rest: string) => boolean,
  ignoreCase = false,
): boolean {
  const lead = prefix.exec(tag)?.[0].length;
  const at = (i: number): boolean => {
    const word = tag.slice(i, i + name.length);
    return (ignoreCase ? asciiLower(word) === asciiLower(name) : word === name) && after(tag.slice(i + name.length));
  };
  return (lead !== undefined && at(lead)) || at(0);
}

/**
 * Whether `tag` is `p:name…`, with a prefix of word characters and `-`, and
 * the name compared as the `i` flag did: as `<[\w-]+:name[^>]*>` read an
 * opening tag, or, `whole`, as `<\/[\w-]+:name>` read what follows its `/`.
 */
export function namesPrefixedElement(tag: string, name: string, whole = false): boolean {
  const lead = /^[\w-]+:/.exec(tag)?.[0].length;
  if (lead === undefined) return false;
  const rest = tag.slice(lead);
  return whole ? asciiLower(rest) === asciiLower(name) : asciiLower(rest.slice(0, name.length)) === asciiLower(name);
}

/** An element a DAV reader looks for: which tags open it and which close it. */
export interface DavElement {
  readonly opens: (tag: string) => boolean;
  readonly closes: (tag: string) => boolean;
}

/**
 * The element `name` as a reader's pattern named it, the name compared as the
 * `i` flag did: `<P:name…>` opens it and `</P:name>` closes it, `P` being what
 * `prefix` (anchored with `^`, ending in `:`) matches. `optionalPrefix` also
 * takes the bare name, as `(?:P:)?name` did. `after` accepts the rest of an
 * opening tag after the name; by default anything, as `name[^>]*>` did.
 */
export function davElement(
  name: string,
  prefix: RegExp,
  options: { readonly optionalPrefix?: boolean; readonly after?: (rest: string) => boolean } = {},
): DavElement {
  const lowered = asciiLower(name);
  const after = options.after ?? (() => true);
  const opensAt = (tag: string, at: number): boolean =>
    asciiLower(tag.slice(at, at + name.length)) === lowered && after(tag.slice(at + name.length));
  const closesAt = (tag: string, at: number): boolean => asciiLower(tag.slice(at)) === lowered;
  const lead = (tag: string): number | undefined => prefix.exec(tag)?.[0].length;
  return {
    opens: (tag) => {
      const at = lead(tag);
      return (at !== undefined && opensAt(tag, at)) || (options.optionalPrefix === true && opensAt(tag, 0));
    },
    closes: (tag) => {
      if (!tag.startsWith('/')) return false;
      const rest = tag.slice(1);
      const at = lead(rest);
      return (at !== undefined && closesAt(rest, at)) || (options.optionalPrefix === true && closesAt(rest, 0));
    },
  };
}

/** The text of every `element` in `xml`: `[...xml.matchAll(/<open>([\s\S]*?)<close>/g)]`. */
export function textsOf(xml: string, element: DavElement): string[] {
  return elementsIn(xml, element.opens, element.closes).map((found) => found.text);
}

/** The text of the first `element` in `xml`: `xml.match(/<open>([\s\S]*?)<close>/)?.[1]`. */
export function firstTextOf(xml: string, element: DavElement): string | undefined {
  return elementsIn(xml, element.opens, element.closes, true)[0]?.text;
}

/**
 * The text between the first opening tag `opens` accepts and the next `<`,
 * where `accept` takes that text and the tag at that `<` (its text between
 * `<` and `>`, undefined when it is not a tag). As a pattern
 * `<open>(text with no <)<…` did: tried at each opening tag in turn. Linear:
 * each opening tag reads only as far as the next `<` and its `>`.
 */
export function firstTextBeforeTag(
  xml: string,
  opens: (tag: string) => boolean,
  accept: (text: string, next: string | undefined) => boolean,
): string | undefined {
  const tags = /<([^<>]*)>/g;
  for (let open = tags.exec(xml); open !== null; open = tags.exec(xml)) {
    if (!opens(open[1] ?? '')) continue;
    const from = tags.lastIndex;
    const lt = xml.indexOf('<', from);
    // No `<` after this opening tag, so none after a later one.
    if (lt === -1) return undefined;
    const gt = xml.indexOf('>', lt + 1);
    const next = gt === -1 ? undefined : xml.slice(lt + 1, gt);
    const text = xml.slice(from, lt);
    if (accept(text, next !== undefined && !next.includes('<') ? next : undefined)) return text;
  }
  return undefined;
}

/**
 * The first `element` in `xml` that holds only text:
 * `xml.match(/<open>([^<]*)<close>/)?.[1]`, or with `nonEmpty`, `([^<]+)`.
 */
export function firstPlainTextOf(xml: string, element: DavElement, nonEmpty = false): string | undefined {
  return firstTextBeforeTag(
    xml,
    element.opens,
    (text, next) => (!nonEmpty || text.length > 0) && next !== undefined && element.closes(next),
  );
}

/**
 * The first `element` in `xml`, shaped as `xml.match(pattern)` answered, so a
 * reader that read `match[1]` reads it unchanged: the whole `element`
 * (`([\s\S]*?)`), or one that holds only text (`([^<]*)`, or `([^<]+)` for
 * `non-empty text`). `null` when there is none.
 */
export function firstMatchOf(
  xml: string,
  element: DavElement,
  holding: 'element' | 'text' | 'non-empty text',
): readonly [string, string] | null {
  const text =
    holding === 'element' ? firstTextOf(xml, element) : firstPlainTextOf(xml, element, holding === 'non-empty text');
  return text === undefined ? null : [text, text];
}
