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
 * ## A REPAIR THE OWNER ASKED FOR (2026-09-22)
 *
 * The rule above says a rewrite of somebody's card "needs the owner's word".
 * This is that word, recorded rather than inferred.
 *
 * Contacts migrated from Google arrive with their photo as inline base64 and
 * NO `TYPE` parameter — `PHOTO;ENCODING=B:/9j/…`. The bytes are all there;
 * Nextcloud draws the initials instead, because nothing in the card says what
 * the bytes are. The owner found it on his own 1,229 contacts, and then proved
 * the cause on two of them by hand: adding `TYPE=JPEG` made the picture
 * appear. The first attempt also lowercased the `B`, so a second card was done
 * with the capital kept and only the TYPE added — it worked too, which is what
 * isolates the variable. Without that second card this repair would have been
 * built on a guess between two changes.
 *
 * So the rewrite is narrow and it is the owner's: add the `TYPE` that is
 * missing, to a property that already says it carries encoded bytes, when the
 * bytes themselves say which format they are. Nothing else about the card is
 * touched — not the name, not the UID, not the value, not the folding of any
 * line that needed no repair.
 *
 * ## What may be reported, and what may never be
 *
 * Property names and parameter names come from a fixed vocabulary (`FN`, `TEL`,
 * `VALUE`, `TYPE`, plus `X-`/vendor extensions). **The VALUE is the personal
 * data**, and it is never returned and never logged here. That is the
 * difference between a diagnosis somebody can paste into an issue and a
 * contact's phone number in a server log, and it is pinned by its own test.
 *
 * NARROWED ONCE, deliberately: `untypedImageFault` reads the first sixteen
 * characters of a `PHOTO`/`LOGO` value to tell a JPEG from a PNG. It is a
 * bounded prefix, it is read for one purpose, and what leaves the function is
 * the word `JPEG` — never a byte of the image. The rule it narrows is about
 * personal data reaching a log, and a format name is not that. Stated here
 * because a rule crossed in silence is a rule nobody can rely on.
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
interface LogicalLine {
  readonly at: number;
  readonly text: string;
  /**
   * `offsets[i]` is where `text[i]` lives in the ORIGINAL body.
   *
   * Carried because a REPAIR may not rebuild the body from these lines: folding
   * is lossy the other way round — the same logical line can be folded at any
   * column, and re-emitting it would rewrite line breaks in a card nobody asked
   * us to touch. Guard rail 2 says a card with nothing matching goes through
   * byte-identical, and the only way to keep that is to change the individual
   * CHARACTERS that are wrong and nothing else. This map is how a position in
   * the unfolded line becomes a position in the bytes.
   *
   * The reader ignores it. One unfolder, so the line the diagnosis describes
   * and the line the repair edits are the same line.
   */
  readonly offsets: readonly number[];
}

function logicalLines(body: string): ReadonlyArray<LogicalLine> {
  const out: Array<{ at: number; text: string; offsets: number[] }> = [];
  let base = 0;
  const physical = body.split(/\r\n|\n|\r/);
  for (let i = 0; i < physical.length; i += 1) {
    const line = physical[i] ?? '';
    // Where this physical line starts in `body`. Recomputed from the running
    // base plus the separator actually used, because the split accepts three
    // and a fixed +1 would drift by one per CRLF — on a vCard, which RFC 6350
    // §3.2 says SHOULD use CRLF, that is every line.
    const start = base;
    base += line.length;
    if (body.startsWith('\r\n', base)) base += 2;
    else if (base < body.length) base += 1;

    const folded = (line.startsWith(' ') || line.startsWith('\t')) && out.length > 0;
    const from = folded ? 1 : 0;
    const offsets: number[] = [];
    for (let c = from; c < line.length; c += 1) offsets.push(start + c);
    if (folded) {
      const prev = out[out.length - 1]!;
      prev.text += line.slice(1);
      prev.offsets.push(...offsets);
      continue;
    }
    out.push({ at: i + 1, text: line, offsets });
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

/**
 * THE REPAIR (workplan 0124 T1, the owner's word 2026-09-18).
 *
 * `payloadDefectNote` above makes a refusal name this shape; everything below
 * corrects it before the PUT, which the owner asked for and gave the reason
 * for:
 *
 *   *"the contact just is in my Google contact-list. Other people will also
 *   have such data. Can you fix it in transit, would you recommend me that?"*
 *
 * An Apple-written card synced into Google is an extremely ordinary shape, and
 * "ask every customer to hand-edit their own cards" is not a product. He chose
 * to repair on the way out rather than only after a refusal, because we already
 * know it will not land: *"we already now it needs repairing, because else it
 * will not land in the target."*
 *
 * ## Why this is not a change to somebody's content
 *
 * `;` separates vCard PARAMETERS. `,` separates VALUES inside one parameter.
 *
 *   BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:...
 *
 * `VALUE` is not holding two value types here. It is holding `DATE` and an
 * entire second parameter, folded into its value list by a `,` standing where a
 * `;` belongs — and the array Sabre builds from it is the proof. That is
 * malformed by the grammar, not a stylistic choice, which is what makes
 * restoring the separator different in kind from rewriting somebody's data.
 * **The date itself is never touched.** The same two parameters go out, parsed
 * as two parameters.
 *
 * ## Three guard rails, each with a test proved by breaking it
 *
 * 1. **One shape only.** It fires exactly where `swallowedParameter` fires —
 *    the reader's own judgement, not a second opinion. A value list that is
 *    legal (`TYPE=work,home`, `PID=1.1,2.2`) never contains a name followed by
 *    `=`, which is the condition that keeps this off ordinary cards.
 * 2. **It splits, and does nothing else.** One `,` becomes one `;`. No
 *    reordering, no case changes, no quoting changes, no other property, no
 *    re-folding. A card with nothing matching comes back the SAME STRING — not
 *    an equivalent one — and that is the test that matters most.
 * 3. **It is recorded, never silent.** The corrections come back with the body
 *    and the writer puts them on the item's row. This is the rail that makes
 *    the other two safe to have: if the rule ever fires where it should not,
 *    the evidence is on the item, not in a log nobody reads.
 *
 * Quoted values are the trap, and the reason this lives here: a `,` INSIDE
 * quotes separates nothing, and `SORT-AS="Public, John"` is one value. The scan
 * below is quote-aware for the same reason `head`, `segments` and `values` are,
 * and it is the same code reading the same lines.
 *
 * ## What is reported, and what never is
 *
 * The line, the property and the CONTAINING parameter — the reader's own
 * vocabulary, word for word, so a correction and a diagnosis describe the same
 * event in the same terms. Never a value: that is the personal data, and it is
 * as unwelcome on an item row as it is in a server log.
 */
export interface PayloadRepair {
  /** The body to send. The SAME STRING when nothing matched. */
  readonly body: string;
  /**
   * What was corrected, one sentence each, empty when nothing was.
   *
   * Empty is the ordinary answer: it means the card was well-formed, and a
   * caller records nothing rather than recording that nothing happened.
   */
  readonly corrections: readonly string[];
}

/**
 * Where the commas that should be semicolons are, as offsets into `body`.
 *
 * Positional rather than reusing `segments`/`values`, which answer what the
 * pieces ARE and not where they were — and a repair that cannot say where may
 * only rebuild, which guard rail 2 forbids.
 */
function separatorFaults(
  line: LogicalLine,
): ReadonlyArray<{ readonly offset: number; readonly property: string; readonly parameter: string }> {
  const faults: Array<{ offset: number; property: string; parameter: string }> = [];
  const h = head(line.text);
  if (h === undefined) return faults;

  const property = (segments(h)[0] ?? '').trim().toUpperCase();
  if (property === '') return faults;

  let quoted = false;
  // Where the current parameter starts, where its `=` was, and where the
  // current value-list entry starts. `-1` means "not in one yet".
  let paramStart = -1;
  let eq = -1;
  let entryStart = -1;
  let entryComma = -1;

  /** Close the entry that ends at `end`, recording a fault if it is one. */
  const closeEntry = (end: number): void => {
    if (paramStart < 0 || eq < 0 || entryComma < 0) return;
    const entry = line.text.slice(entryStart, end);
    if (!swallowedParameter(entry)) return;
    const parameter = line.text.slice(paramStart, eq).trim().toUpperCase();
    faults.push({ offset: line.offsets[entryComma]!, property, parameter });
  };

  for (let i = 0; i < h.length; i += 1) {
    const c = h[i];
    if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === ';') {
      closeEntry(i);
      paramStart = i + 1;
      eq = -1;
      entryStart = -1;
      entryComma = -1;
    } else if (c === '=' && paramStart >= 0 && eq < 0) {
      eq = i;
      entryStart = i + 1;
      // The FIRST entry has no comma before it, so it can never be a fault:
      // `VALUE=DATE` is the parameter being written, not one swallowed into it.
      entryComma = -1;
    } else if (c === ',' && eq >= 0) {
      closeEntry(i);
      entryStart = i + 1;
      entryComma = i;
    }
  }
  closeEntry(h.length);
  return faults;
}

/**
 * Correct the `,`-for-`;` separator in a vCard or iCalendar body we are about
 * to send, and say what was corrected.
 *
 * Returns the body UNCHANGED — the same string, by identity — when there is
 * nothing to correct, which is almost every card. Never throws: this runs on
 * the write path, and a repair that threw would fail an item it was there to
 * rescue.
 */
export function repairPayload(body: string): PayloadRepair {
  const faults: Array<{ offset: number; property: string; parameter: string }> = [];
  const inserts = new Map<number, string>();
  const sentences: string[] = [];
  for (const line of logicalLines(body)) {
    if (line.text === '') continue;
    for (const fault of separatorFaults(line)) {
      faults.push(fault);
      sentences.push(
        `line ${line.at}: property ${fault.property} carried the parameter ` +
          `${fault.parameter} with a "," where a ";" belongs; the separator was ` +
          'corrected so the next parameter is a parameter again',
      );
    }
    const untyped = untypedImageFault(line);
    if (untyped) {
      inserts.set(untyped.offset, `;TYPE=${untyped.format}`);
      sentences.push(
        `line ${line.at}: property ${untyped.property} carried encoded bytes with no TYPE, ` +
          `so a consumer had nothing to say what they were; TYPE=${untyped.format} was added ` +
          'from the bytes themselves',
      );
    }
  }
  if (faults.length === 0 && inserts.size === 0) return { body, corrections: [] };

  // ONE CHARACTER EACH, in place. Built by walking the offsets in order rather
  // than by `replace`, because there is no pattern here that is safe to match
  // globally — the same `,` in a different parameter is a legal list.
  //
  // The TYPE repair INSERTS rather than replaces, which is the one thing in
  // this function that lengthens a line. It can push the first physical line of
  // a folded PHOTO past the 75-octet fold width RFC 6350 §3.2 asks for. That is
  // accepted deliberately and it is measured, not assumed: refolding would
  // rewrite line breaks in a card nobody asked us to touch, which the
  // `offsets` map exists to avoid, and a Nextcloud took the over-long line and
  // drew the photo (owner's box, 2026-09-22).
  const at = new Set(faults.map((f) => f.offset));
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const insert = inserts.get(i);
    if (insert !== undefined) out += insert;
    out += at.has(i) ? ';' : body[i];
  }
  return { body: out, corrections: sentences };
}

/**
 * The base64 an image starts with, and what it is.
 *
 * Read from the VALUE, which this file otherwise never touches — see the
 * narrowing in the header. Four formats, each identified by bytes that cannot
 * mean anything else at offset zero; anything unrecognised produces NO repair,
 * because a wrong TYPE is worse than a missing one.
 */
const IMAGE_MAGIC: ReadonlyArray<readonly [string, string]> = [
  ['/9j/', 'JPEG'],
  ['iVBORw0KGgo', 'PNG'],
  ['R0lGOD', 'GIF'],
  ['UklGR', 'WEBP'],
];

/** How much of the value is read to classify it. Nothing past this is looked at. */
const MAGIC_WINDOW = 16;

/**
 * A `PHOTO`/`LOGO` carrying encoded bytes and no `TYPE` to say what they are.
 *
 * Returns where a `;TYPE=…` belongs — the offset of the colon that ends the
 * parameters — or `null` when the property is fine, carries a TYPE already, or
 * holds bytes this cannot identify.
 */
function untypedImageFault(
  line: LogicalLine,
): { readonly offset: number; readonly property: string; readonly format: string } | null {
  const opener = /^(PHOTO|LOGO)((?:;[^:]*)?):/i.exec(line.text);
  if (!opener) return null;
  const parameters = opener[2] ?? '';
  // A `VALUE=uri` photo is a LINK and has no bytes to classify; it is also the
  // shape that carries no ENCODING, so this one test excludes both.
  if (!/ENCODING\s*=\s*(?:b|base64)(?:;|$)/i.test(parameters)) return null;
  if (/(?:^|;)\s*TYPE\s*=/i.test(parameters)) return null;

  const window = line.text.slice(opener[0].length, opener[0].length + MAGIC_WINDOW);
  const known = IMAGE_MAGIC.find(([prefix]) => window.startsWith(prefix));
  if (!known) return null;

  const colon = opener[0].length - 1;
  const offset = line.offsets[colon];
  if (offset === undefined) return null;
  return { offset, property: (opener[1] ?? '').toUpperCase(), format: known[1]! };
}
