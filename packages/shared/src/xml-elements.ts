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
