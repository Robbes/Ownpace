// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Microsoft Graph refuses in JSON, and the sentence that matters is inside it
 * (workplan 0114 T6, 2026-09-05).
 *
 * The Graph connectors quoted a refusal as `403 - {"error":{"code":
 * "Authorization_RequestDenied","message":"Insufficient privileges to
 * complete the operation.","innerError":{"date":"…","request-id":"…",
 * "client-request-id":"…"}}}` — Graph's words wrapped in an envelope a phone
 * screen turns into a wall, the same shape #722 met in Google's GData XML
 * (`gdata-refusal.ts`). The rule is the same: the provider's words are
 * rendered verbatim, code and message in Graph's order, and only the
 * envelope goes. `innerError` is request ids and dates — Microsoft support's
 * material, not the person's — and stays out of the sentence.
 *
 * Anything that is not a Graph error document passes through unchanged.
 *
 * The second half is the way forward. The 0114 narrative asked for the tenant
 * policy refusals to be "rendered as sentences with a way forward": those
 * arrive at the CONSENT screen as AADSTS65001/AADSTS90094 and
 * `microsoft-consent.ts` already speaks them. What arrives HERE, at a face's
 * first request, is the consequence of a consent that did not include the
 * face — `Authorization_RequestDenied`, `ErrorAccessDenied`, or a token Graph
 * will not take — and the way forward is the same one the To Do source named
 * on its own (0114 T9): reconnect the account with the face ticked, and if
 * the organisation blocks user consent, an administrator grants it once.
 */

const GRAPH_ERROR_CODES_FOR_A_FACE_NOT_GRANTED = new Set([
  'Authorization_RequestDenied',
  'ErrorAccessDenied',
  'AccessDenied',
  'Forbidden',
]);

interface GraphError {
  readonly code: string;
  readonly message: string;
}

/** Graph's error document, if the body is one. */
function graphError(body: string): GraphError | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const error = (parsed as { error?: unknown })?.error;
  if (!error || typeof error !== 'object') return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const c = typeof code === 'string' ? code.trim() : '';
  const m = typeof message === 'string' ? message.trim() : '';
  if (!c && !m) return null;
  return { code: c, message: m };
}

/** The refusal body as a person should read it: Graph's code and message without the envelope. */
export function graphRefusalBody(body: string): string {
  const error = graphError(body);
  if (!error) return body;
  return error.code && error.message ? `${error.code} — ${error.message}` : error.code || error.message;
}

/**
 * The way forward, when the refusal says this consent did not include the
 * face — or nothing, when it says something else.
 *
 * `scope` is the delegated permission the face needs (`Mail.Read`,
 * `Calendars.Read`, …) and `face` the word the person ticked. Named, because
 * "insufficient privileges" is true and useless; which tick to make is the
 * sentence.
 */
export function graphRefusalHint(status: number, body: string, face: string, scope: string): string {
  const error = graphError(body);
  const code = error?.code ?? '';
  const aFaceNotGranted = status === 403 && (code === '' || GRAPH_ERROR_CODES_FOR_A_FACE_NOT_GRANTED.has(code));
  const aTokenGraphWillNotTake = status === 401;
  if (!aFaceNotGranted && !aTokenGraphWillNotTake) return '';
  return (
    ` (a ${status} here usually means the consent this connection carries does not include ` +
    `${scope} — reconnect the account with ${face} ticked; if the organisation has turned off ` +
    `"Users can consent to applications", an administrator has to grant it once — Entra says ` +
    `AADSTS65001 or AADSTS90094 at the consent screen when that is the case)`
  );
}

/** Both halves in one: the failure line every Graph face reports. */
export function graphFailure(
  what: string,
  response: { readonly status: number; readonly body: string },
  face?: { readonly face: string; readonly scope: string },
): string {
  const hint = face ? graphRefusalHint(response.status, response.body, face.face, face.scope) : '';
  return `${what}: ${response.status} - ${graphRefusalBody(response.body)}${hint}`;
}
