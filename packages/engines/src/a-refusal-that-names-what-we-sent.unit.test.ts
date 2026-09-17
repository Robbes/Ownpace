// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A refusal that names what WE sent.
 *
 * #934 made Sabre's refusal legible. It was still not enough on 2026-09-13:
 * two contacts out of 1,400 were refused five times each, and the whole of what
 * the server would say was
 *
 *   TypeError — A type error occurred. For more details, please refer to the
 *   logs, which provide additional context about the type error.
 *
 * The cause was in Nextcloud's own log rather than the response — `strtoupper():
 * Argument #1 ($string) must be of type string, array given` in
 * `getClassNameForPropertyValue`, which Sabre reaches as
 * `getClassNameForPropertyValue($parameters['VALUE'])`. An array lands there
 * whenever the parser read more than one value for `VALUE`.
 *
 * So the gap was never legibility. The refusal could not name the item, the
 * line, or the property, and the bytes that would have were at the source. This
 * closes that: when a target refuses a write, the error says what is wrong with
 * the payload we handed it.
 *
 * ## THEN THE OWNER PULLED THE LOG (2026-09-17)
 *
 * The first version of this file guessed at one cause — a parameter written
 * twice — and its fixture is still below, labelled as the guess it was. Four
 * days later the destination's log named the property and printed the array:
 *
 *   createProperty('BDAY', NULL, Array, NULL, 7, 'BDAY;VALUE=DATE...')
 *   args: [["DATE","X-APPLE-OMIT-YEAR=1604"]]
 *
 * `VALUE` was not holding two value types. It was holding `DATE` and a whole
 * SECOND PARAMETER, folded into its value list by a `,` standing where a `;`
 * belongs. That shape is ONE parameter, written ONCE, so the repetition scan
 * saw nothing and the refusal said nothing — on the only two failures in the
 * owner's entire run that anybody had to chase.
 *
 * The tests below the guess are for the shape the log actually named.
 */

import { describe, it, expect } from 'vitest';
import { payloadDefects, payloadDefectNote } from './dav-payload-defects.ts';

/**
 * A repeated parameter. Written on 2026-09-13 as "the shape that actually
 * broke"; the destination's log named a different one four days later, so this
 * is now what it always was — a real defect this reader must catch, and not a
 * record of the owner's failure. `SWALLOWED` below is that one.
 */
const DUPLICATED = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:A Person',
  'item1.URL;VALUE=uri;TYPE=pref;VALUE=uri:http://example.invalid/',
  'END:VCARD',
].join('\r\n');

const CLEAN = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:A Person', 'TEL;TYPE=work:+31000', 'END:VCARD'].join('\r\n');

describe('the defect we actually met', () => {
  it('names the line, the property and the parameter', () => {
    expect(payloadDefects(DUPLICATED)).toEqual([
      'line 4: property ITEM1.URL carries the parameter VALUE twice',
    ]);
  });

  it('says nothing at all about a well-formed card', () => {
    // The ordinary answer, and the reason both writers APPEND this rather than
    // replace the refusal: a clean payload must leave the server's own words
    // exactly as they were.
    expect(payloadDefects(CLEAN)).toEqual([]);
    expect(payloadDefectNote(CLEAN)).toBe('');
  });

  it('counts past two rather than stopping at "twice"', () => {
    const thrice = 'TEL;TYPE=work;TYPE=home;TYPE=cell:+31000';
    expect(payloadDefects(thrice)).toEqual([
      'line 1: property TEL carries the parameter TYPE 3 times',
    ]);
  });
});

describe('what may never reach the message', () => {
  it('reports no VALUE, ever — the names are vocabulary, the value is the person', () => {
    // THE LOAD-BEARING TEST. A property name comes from a fixed vocabulary and
    // a parameter name likewise; the value is somebody's phone number, address
    // or name. This is the difference between a diagnosis that can be pasted
    // into an issue and a contact's details in a server log.
    const card = [
      'BEGIN:VCARD',
      'TEL;VALUE=text;VALUE=text:+31 6 12345678',
      'EMAIL;TYPE=home;TYPE=home:someone@example.invalid',
      'ADR;TYPE=home;TYPE=home:;;Kerkstraat 1;Amsterdam;;1011AA;NL',
      'END:VCARD',
    ].join('\r\n');

    const note = payloadDefectNote(card);
    expect(note).not.toBe('');
    for (const secret of ['+31 6 12345678', 'someone@example.invalid', 'Kerkstraat', 'Amsterdam', '1011AA']) {
      expect(note).not.toContain(secret);
    }
  });
});

describe('the grammar this has to survive', () => {
  it('does not invent a defect inside a QUOTED parameter value', () => {
    // `TEL;TYPE="work;TYPE=home"` is legal: everything between the quotes is
    // ONE value, `;` and all. Splitting naively reads it as a second `TYPE=`
    // and reports a duplicate that is not there — and a false diagnosis on a
    // refusal is worse than none, which is the rule caldav-target-writer
    // already states for its own.
    //
    // Chosen so it DISCRIMINATES: the first draft of this test used
    // `TYPE="work;home"`, where naive splitting yields `TYPE` and `HOME"` —
    // two different names, no duplicate, and the test passed with the quote
    // handling deleted. A guard that cannot fail is not a guard.
    expect(payloadDefects('TEL;TYPE="work;TYPE=home":+31000')).toEqual([]);
  });

  it('does not end the parameters at a colon INSIDE quotes', () => {
    // The same rule one level up: `head` stops at the first unquoted `:`. A
    // naive stop would cut the line at `LABEL="a` and never see the second
    // LABEL — so this asserts the defect IS found, which only holds when the
    // quoted colon was skipped.
    expect(payloadDefects('TEL;LABEL="a:b";LABEL=c:+31000')).toEqual([
      'line 1: property TEL carries the parameter LABEL twice',
    ]);
  });

  it('sees a parameter pushed onto a FOLDED continuation line', () => {
    // RFC 6350 §3.2: a line beginning with a space continues the one before.
    // This is the case most worth catching, because the duplicate is invisible
    // to anything that reads physical lines.
    const folded = ['BEGIN:VCARD', 'TEL;VALUE=text;', ' VALUE=text:+31000', 'END:VCARD'].join('\r\n');
    expect(payloadDefects(folded)).toEqual([
      'line 2: property TEL carries the parameter VALUE twice',
    ]);
  });

  it('counts vCard 2.1 bare-type parameters, which carry no "="', () => {
    // `TEL;WORK;WORK` is 2.1 shorthand. It is still one parameter written
    // twice, and Sabre collects it the same way.
    expect(payloadDefects('TEL;WORK;WORK:+31000')).toEqual([
      'line 1: property TEL carries the parameter WORK twice',
    ]);
  });

  it('is case-insensitive, because the grammar is', () => {
    expect(payloadDefects('tel;value=text;VALUE=TEXT:+31000')).toEqual([
      'line 1: property TEL carries the parameter VALUE twice',
    ]);
  });

  it('ignores a line with no unquoted colon rather than guessing at it', () => {
    // Malformed beyond this reader's remit. Reporting something confident
    // about it would be the guess-dressed-as-diagnosis this file exists to
    // avoid.
    expect(payloadDefects('this is not a content line')).toEqual([]);
  });

  it('reads an iCalendar body by the same grammar', () => {
    // RFC 5545 §3.1 folds and parameterises identically, which is why one
    // reader serves both writers rather than two that drift.
    const ics = ['BEGIN:VCALENDAR', 'DTSTART;VALUE=DATE;VALUE=DATE:20260913', 'END:VCALENDAR'].join('\r\n');
    expect(payloadDefects(ics)).toEqual([
      'line 2: property DTSTART carries the parameter VALUE twice',
    ]);
  });
});

describe('the note the writers append', () => {
  it('explains the consequence, not just the count', () => {
    const note = payloadDefectNote(DUPLICATED);
    expect(note).toContain('line 4: property ITEM1.URL carries the parameter VALUE twice');
    // The sentence that turns a fact into something actionable: this is WHY a
    // spec-compliant parser refused it.
    expect(note).toContain('read a list where it expects a single word');
  });

  it('summarises past the fifth rather than printing a wall', () => {
    // A pathological payload must not turn one refusal into a thousand-line
    // error in a ledger column somebody reads on a phone.
    const many = Array.from({ length: 9 }, (_, i) => `X-P${i};A=1;A=2:v`).join('\r\n');
    const note = payloadDefectNote(many);
    expect(payloadDefects(many)).toHaveLength(9);
    expect(note).toContain('and 4 more');
    expect(note).toContain('X-P4');
    expect(note).not.toContain('X-P5');
  });
});

describe('the shape the destination log named', () => {
  /**
   * The line Sabre must have parsed to build `['DATE', 'X-APPLE-OMIT-YEAR=1604']`.
   * Parameters are separated by `;`; the values inside ONE parameter by `,`.
   * Put the wrong one there and the next parameter stops being a parameter.
   */
  const SWALLOWED = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:A Person',
    'BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:1604-05-15',
    'END:VCARD',
  ].join('\r\n');

  it('was completely invisible before, and is the whole reason for this change', () => {
    // ONE parameter, written ONCE, carrying a list. Nothing in the repetition
    // scan can see it. Assert the sentence rather than merely non-emptiness:
    // a reader sent to the wrong line is barely better than silence.
    expect(payloadDefects(SWALLOWED)).toEqual([
      'line 4: property BDAY carries the parameter VALUE with 2 values, one of which is itself a parameter: a "," stands where a ";" belongs',
    ]);
  });

  it('names the mistake, not "the same parameter twice"', () => {
    // The wrong explanation is worse than a vague one here: it sends somebody
    // hunting a duplicate their card has not got.
    const note = payloadDefectNote(SWALLOWED);
    expect(note).toContain('a "," stands where a ";" belongs');
    expect(note).toContain('folds the next parameter into the previous one');
    expect(note).not.toContain('carries each parameter once');
  });

  it('reports the SHAPE and never the text of what was swallowed', () => {
    // Same rule as the load-bearing test above, on the new path. The name half
    // would usually be vocabulary and the value half never is, and neither is
    // needed by somebody who has the line, the property and the parameter.
    const note = payloadDefectNote(SWALLOWED);
    for (const text of ['X-APPLE-OMIT-YEAR', '1604', 'DATE']) {
      expect(note, `the note leaks ${text}`).not.toContain(text);
    }
  });

  it('finds it wherever the separator went wrong, not only under VALUE', () => {
    // Parameter-agnostic on purpose: `TYPE` may legally carry a list, but a
    // list entry that is itself `NAME=value` is never one of its types.
    expect(payloadDefects('TEL;TYPE=work,home,PREF=1:+31000')).toEqual([
      'line 1: property TEL carries the parameter TYPE with 3 values, one of which is itself a parameter: a "," stands where a ";" belongs',
    ]);
  });

  it('says both when a line carries both, the position first', () => {
    const both = 'BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604;VALUE=DATE:1604-05-15';
    expect(payloadDefects(both)).toEqual([
      'line 1: property BDAY carries the parameter VALUE with 2 values, one of which is itself a parameter: a "," stands where a ";" belongs',
      'line 1: property BDAY carries the parameter VALUE twice',
    ]);
    // And the note explains BOTH readings, in one sentence each.
    const note = payloadDefectNote(both);
    expect(note).toContain('carries each parameter once');
    expect(note).toContain('folds the next parameter into the previous one');
  });
});

describe('a list where the spec allows one value', () => {
  it('reports VALUE carrying two value types, which breaks the same parser', () => {
    // No `=` anywhere in the list, so the separator reading does not apply —
    // and Sabre still gets an array where it calls strtoupper. RFC 6350 §5.2
    // and RFC 5545 §3.2.20: VALUE names ONE type.
    expect(payloadDefects('DTSTART;VALUE=DATE,DATE-TIME:20260913')).toEqual([
      'line 1: property DTSTART carries the parameter VALUE with 2 values, and VALUE takes exactly one',
    ]);
    expect(payloadDefectNote('DTSTART;VALUE=DATE,DATE-TIME:20260913')).toContain(
      'VALUE names one value type',
    );
  });

  it('is silent about a parameter that MAY carry a list', () => {
    // The commonest line in any address book. A reader that called this a
    // defect would put a false diagnosis on every refusal in the product.
    expect(payloadDefects('TEL;TYPE=work,home,cell:+31000')).toEqual([]);
    expect(payloadDefects('EMAIL;TYPE=internet,pref:someone@example.invalid')).toEqual([]);
    expect(payloadDefects('X-ABLabel;PID=1.1,2.2:_$!<Home>!$_')).toEqual([]);
  });

  it('is silent about one value, which is the ordinary case', () => {
    expect(payloadDefects('BDAY;VALUE=DATE:19700101')).toEqual([]);
  });

  it('does not split a list INSIDE quotes', () => {
    // Discriminating: with the quote handling deleted this reads two values,
    // the second carrying an `=`, and reports the separator defect. Quoted,
    // it is one value and there is nothing to report.
    expect(payloadDefects('BDAY;VALUE="DATE,X-APPLE-OMIT-YEAR=1604":1604-05-15')).toEqual([]);
  });
});
