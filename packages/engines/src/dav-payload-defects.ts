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
 * An ARRAY arrives there when a property line carries the same parameter TWICE,
 * because that is what Sabre's MimeDir parser produces for a repeated
 * parameter. A vCard property carries exactly one VALUE type by spec, so the
 * second is not data — it is a defect, and a spec-compliant parser is entitled
 * to refuse it.
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
 * Every structural defect visible in a vCard or iCalendar body we tried to send.
 *
 * Returns sentences, newest concern first, each naming a line, a property and a
 * parameter — and never a value. An empty array means nothing was found, which
 * is the ordinary answer and the reason callers append rather than replace.
 */
export function payloadDefects(body: string): string[] {
  const found: string[] = [];
  for (const { at, text } of logicalLines(body)) {
    if (text === '') continue;
    const h = head(text);
    if (h === undefined) continue;
    const parts = segments(h);
    const property = (parts[0] ?? '').trim().toUpperCase();
    if (property === '') continue;

    const seen = new Map<string, number>();
    for (const param of parts.slice(1)) {
      const eq = param.indexOf('=');
      // A parameter with no `=` is vCard 2.1's bare-type shorthand (`TEL;WORK`).
      // It is still a parameter for the purpose of repeating, so it counts.
      const name = (eq === -1 ? param : param.slice(0, eq)).trim().toUpperCase();
      if (name === '') continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }

    for (const [name, n] of seen) {
      if (n < 2) continue;
      found.push(`line ${at}: property ${property} carries the parameter ${name} ${times(n)}`);
    }
  }
  return found;
}

/**
 * The defects as one clause to append to a refusal, or `''` when there are none.
 *
 * `''` rather than a cheerful "no defects found": a refusal is already bad news
 * and padding it with what we did NOT find buries what the server did say.
 */
export function payloadDefectNote(body: string): string {
  const all = payloadDefects(body);
  if (all.length === 0) return '';
  const shown = all.slice(0, SHOWN);
  const rest = all.length - shown.length;
  return (
    ` What we sent is malformed, which is the likeliest cause: ${shown.join('; ')}` +
    (rest > 0 ? `; and ${rest} more` : '') +
    '. A property carries each parameter once; a repeated one makes a ' +
    'spec-compliant parser read a list where it expects a single word.'
  );
}
