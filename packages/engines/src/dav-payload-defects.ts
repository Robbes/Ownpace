// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What is structurally wrong with the payload WE sent, when a target refuses it.
 *
 * ## The failure this exists for
 *
 * On 2026-09-13 two contacts out of 1,400 were refused by a live Nextcloud,
 * five attempts each, with a 500 whose body — once #934 made it legible — read:
 *
 *   TypeError — A type error occurred. For more details, please refer to the
 *   logs, which provide additional context about the type error.
 *
 * The real message was in Nextcloud's own log, not the response:
 * `strtoupper(): Argument #1 ($string) must be of type string, array given`, at
 * `sabre/vobject/lib/Document.php`. That line is
 *
 *   public function getClassNameForPropertyValue($valueParam)
 *   { $valueParam = strtoupper($valueParam);
 *
 * reached from `createProperty` as `getClassNameForPropertyValue($parameters['VALUE'])`.
 * An ARRAY arrives there whenever Sabre's MimeDir parser read MORE THAN ONE
 * value for `VALUE`. A vCard property carries exactly one VALUE type by spec
 * (RFC 6350 §5.2, RFC 5545 §3.2.20), so the second is not data — it is a
 * defect, and a spec-compliant parser is entitled to refuse it.
 *
 * ## TWO WAYS TO GET THERE, AND THIS FILE ONLY SAW ONE (2026-09-17)
 *
 * The first version of this reader assumed the only cause was a parameter
 * written TWICE, because that is the shape Sabre's parser is best known for
 * collapsing into a list. Then the owner pulled the destination's own log for
 * both failing cards, and it named the property and printed the array Sabre
 * had built:
 *
 *   createProperty('BDAY', NULL, Array, NULL, 7, 'BDAY;VALUE=DATE...')
 *   args: [["DATE","X-APPLE-OMIT-YEAR=1604"]]
 *
 * `VALUE` did not hold two value types. It held `DATE` and a whole SECOND
 * PARAMETER that had been folded into its value list — which is what a MimeDir
 * parser produces from
 *
 *   BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:...
 *
 * where a `,` stands in the place a `;` belongs. Parameters are separated by
 * `;`; the values inside ONE parameter are separated by `,`. Put the wrong one
 * there and the next parameter stops being a parameter.
 *
 * That shape was invisible here: it is one segment, one parameter name, seen
 * once, so the repetition scan found nothing and the refusal said nothing —
 * on the only two failures in the owner's whole run that anybody had to chase.
 * The note is now three readings of the same event, and it says which one it
 * found, because "the same parameter twice" sends a reader looking for a
 * duplicate that is not in the card.
 *
 * ## STILL A READER, STILL NOT A REPAIR
 *
 * Restoring the swallowed `;` would be a one-line change and it is NOT made
 * here. The bytes are the customer's: `carddav-source.ts` hands the PUT
 * exactly what the source served, XML-unescaped and otherwise untouched, and
 * nothing on this deployment produced the comma. Rewriting somebody's contact
 * card to make a server accept it is a product decision, not a bug fix, and it
 * needs the owner's word. What this file may do is make the refusal name the
 * line, the property, the parameter and the mistake — which is enough to go
 * and correct the card at the source.
 *
 * ## Why this is a reader, not a repair
 *
 * It would be easy to strip the duplicate before the PUT. That is a change to
 * the CUSTOMER'S content on a hypothesis, and the hypothesis was untestable:
 * the bytes live at the source, the refusal does not carry them, and nothing on
 * the deployment could produce them. **So the first move is to make the failure
 * describe itself**, exactly as `caldav-target-writer.ts` already reasons about
 * its own diagnosis — *"a guess dressed as a diagnosis is worse than the raw
 * refusal"*. A repair can follow once a real refusal has named the shape.
 *
 * ## What may be reported, and what may never be
 *
 * Property names and parameter names come from a fixed vocabulary (`FN`, `TEL`,
 * `VALUE`, `TYPE`, plus `X-`/vendor extensions). **The VALUE is the personal
 * data**, and it is never read, never returned, and never logged here. That is
 * the difference between a diagnosis somebody can paste into an issue and a
 * contact's phone number in a server log, and it is pinned by its own test.
 *
 * ## Cost
 *
 * Nothing on the happy path: both writers call this only while building the
 * error for a PUT that already failed. A well-formed payload returns `[]` and
 * the refusal is reported exactly as it was before.
 */

/** How many defects one message names before it starts summarising. */
const SHOWN = 5;

const times = (n: number): string => (n === 2 ? 'twice' : `${n} times`);

/**
 * Unfold a MIME-directory body into logical lines, keeping each one's number.
 *
 * RFC 6350 §3.2 and RFC 5545 §3.1: a line beginning with a space or tab
 * continues the one before it. Folding is exactly where a naive
 * `split('\n')` scan goes wrong — a parameter pushed onto a continuation line
 * would be invisible to it, which is the case most worth catching.
 */
function logicalLines(body: string): ReadonlyArray<{ readonly at: number; readonly text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  const physical = body.split(/\r\n|\n|\r/);
  for (let i = 0; i < physical.length; i += 1) {
    const line = physical[i] ?? '';
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1]!.text += line.slice(1);
      continue;
    }
    out.push({ at: i + 1, text: line });
  }
  return out;
}

/**
 * The `name;param=…;param=…` half of one content line, or undefined.
 *
 * Quote-aware, because a parameter value may be quoted and a quoted value may
 * contain the very `:` and `;` this splits on — `TEL;TYPE="work;home":+31…` is
 * legal, and a scan that ignored quoting would read `home"` as a parameter and
 * invent a defect that is not there.
 */
function head(line: string): string | undefined {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) return line.slice(0, i);
  }
  return undefined;
}

/** Split on `;` outside quotes: the property name, then one entry per parameter. */
function segments(h: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < h.length; i += 1) {
    const c = h[i];
    if (c === '"') quoted = !quoted;
    else if (c === ';' && !quoted) {
      out.push(h.slice(start, i));
      start = i + 1;
    }
  }
  out.push(h.slice(start));
  return out;
}

/**
 * Split ONE parameter's value on `,` outside quotes: vCard's value LIST.
 *
 * A list is legal — `TEL;TYPE=work,home` is two types and means it — so a
 * comma is not itself a defect and this function makes no judgement. It exists
 * because the two things that ARE defects (a list under a parameter that takes
 * one value, and a parameter swallowed into somebody else's list) can only be
 * seen once the list is separated.
 *
 * Quote-aware for the same reason `head` and `segments` are: a quoted value may
 * contain a comma, and `SORT-AS="Public, John"` is one value.
 */
function values(v: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < v.length; i += 1) {
    const c = v[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      out.push(v.slice(start, i));
      start = i + 1;
    }
  }
  out.push(v.slice(start));
  return out;
}

/**
 * Whether one entry of a value list is itself a `NAME=value` parameter — the
 * `,`-for-`;` shape the owner's destination log named on 2026-09-17.
 *
 * Three conditions, each closing a way to invent a defect that is not there:
 *
 *  - NOT quoted. A quoted parameter value may legally contain `=` and a
 *    comma both, and everything between the quotes is one value.
 *  - An `=` with something before it. A leading `=` is malformed in a
 *    different way and is not this.
 *  - What is before the `=` must match the parameter-name grammar
 *    (RFC 6350 §3.3: alphanumerics and `-`). This is the condition that
 *    matters: a legal multi-value list — `TYPE=work,home`, `PID=1.1,2.2` —
 *    never contains a name followed by `=`, and a value that does is a
 *    separator that went wrong.
 *
 * The entry's TEXT is never reported, only that it has this shape. The name
 * half would usually be vocabulary (`X-APPLE-OMIT-YEAR`) and the value half
 * never is, and a reader who knows the line, the property and the parameter
 * can open the card.
 */
function swallowedParameter(entry: string): boolean {
  const e = entry.trim();
  if (e.startsWith('"')) return false;
  const eq = e.indexOf('=');
  if (eq <= 0) return false;
  return /^[A-Za-z0-9-]+$/.test(e.slice(0, eq));
}

/**
 * The parameters that carry exactly ONE value by spec.
 *
 * `VALUE` alone, and deliberately: it is the one this failure is about, it is
 * the one Sabre hands to `strtoupper`, and both RFC 6350 §5.2 and RFC 5545
 * §3.2.20 define it as a single value type. Other single-valued parameters
 * exist (`PREF`, `ALTID`, `MEDIATYPE`, …) and no refusal has ever named one,
 * so adding them would be this module's own rule broken — a guess dressed as a
 * diagnosis. A shape not in this set that turns out to break a real server
 * arrives as a refusal first, and gets added then.
 */
const SINGLE_VALUED: ReadonlySet<string> = new Set(['VALUE']);

/**
 * Which reading of the same event a sentence is, so the note can explain THAT
 * one rather than whichever was written first.
 */
type DefectKind = 'repeated' | 'separator' | 'overloaded';

/**
 * Every structural defect visible in a vCard or iCalendar body we tried to
 * send, each tagged with WHICH reading of the event it is.
 *
 * Internal: the tag exists so the note can explain the defect it found, and a
 * caller that wants the sentences asks `payloadDefects` for them.
 */
function scan(body: string): ReadonlyArray<{ readonly kind: DefectKind; readonly sentence: string }> {
  const found: Array<{ kind: DefectKind; sentence: string }> = [];
  for (const { at, text } of logicalLines(body)) {
    if (text === '') continue;
    const h = head(text);
    if (h === undefined) continue;
    const parts = segments(h);
    const property = (parts[0] ?? '').trim().toUpperCase();
    if (property === '') continue;

    const seen = new Map<string, number>();
    // Said per parameter, in the order the line writes them, and BEFORE the
    // repetition sentences: a line can carry both, and the one that names a
    // position in the line is the one to read first.
    const inside: Array<{ kind: DefectKind; sentence: string }> = [];
    for (const param of parts.slice(1)) {
      const eq = param.indexOf('=');
      // A parameter with no `=` is vCard 2.1's bare-type shorthand (`TEL;WORK`).
      // It is still a parameter for the purpose of repeating, so it counts.
      const name = (eq === -1 ? param : param.slice(0, eq)).trim().toUpperCase();
      if (name === '') continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
      if (eq === -1) continue;

      const list = values(param.slice(eq + 1));
      // One value is the ordinary case and says nothing either way.
      if (list.length < 2) continue;
      if (list.some(swallowedParameter)) {
        inside.push({
          kind: 'separator',
          sentence:
            `line ${at}: property ${property} carries the parameter ${name} with ` +
            `${list.length} values, one of which is itself a parameter: a "," ` +
            'stands where a ";" belongs',
        });
      } else if (SINGLE_VALUED.has(name)) {
        inside.push({
          kind: 'overloaded',
          sentence:
            `line ${at}: property ${property} carries the parameter ${name} with ` +
            `${list.length} values, and ${name} takes exactly one`,
        });
      }
    }
    found.push(...inside);

    for (const [name, n] of seen) {
      if (n < 2) continue;
      found.push({
        kind: 'repeated',
        sentence: `line ${at}: property ${property} carries the parameter ${name} ${times(n)}`,
      });
    }
  }
  return found;
}

/**
 * Every structural defect visible in a vCard or iCalendar body we tried to send.
 *
 * Returns sentences, each naming a line, a property and a parameter — and
 * never a value. An empty array means nothing was found, which is the ordinary
 * answer and the reason callers append rather than replace.
 */
export function payloadDefects(body: string): string[] {
  return scan(body).map((d) => d.sentence);
}

/**
 * Why each reading of the event makes a spec-compliant parser refuse.
 *
 * Declaration order is output order, and only the kinds actually FOUND are
 * appended: a note that explained all three would be teaching the reader about
 * two defects their card has not got.
 */
const WHY: Readonly<Record<DefectKind, string>> = {
  repeated:
    'A property carries each parameter once; a repeated one makes a ' +
    'spec-compliant parser read a list where it expects a single word.',
  separator:
    'Parameters are separated by ";" and the values inside one by ","; a "," ' +
    'in the place of a ";" folds the next parameter into the previous one\'s ' +
    'value list, with the same effect.',
  overloaded:
    'VALUE names one value type, so a list there is read where a single word ' +
    'is expected.',
};

/**
 * The defects as one clause to append to a refusal, or `''` when there are none.
 *
 * `''` rather than a cheerful "no defects found": a refusal is already bad news
 * and padding it with what we did NOT find buries what the server did say.
 */
export function payloadDefectNote(body: string): string {
  const all = scan(body);
  if (all.length === 0) return '';
  const shown = all.slice(0, SHOWN);
  const rest = all.length - shown.length;
  const why = (Object.keys(WHY) as ReadonlyArray<DefectKind>)
    .filter((kind) => all.some((d) => d.kind === kind))
    .map((kind) => WHY[kind]);
  return (
    ` What we sent is malformed, which is the likeliest cause: ` +
    `${shown.map((d) => d.sentence).join('; ')}` +
    (rest > 0 ? `; and ${rest} more` : '') +
    `. ${why.join(' ')}`
  );
}
