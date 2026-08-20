// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Playing a recorded Drive back at the connector (workplan 0042 T6, the other
 * half of `drive-capture.ts`).
 *
 * A capture is what Google really answered, redacted. This turns one into a
 * `DriveTransport`, so `GoogleDriveSource` can be driven by Drive's own replies
 * in CI, with no credentials and no network.
 *
 * TWO PROPERTIES CARRY THE WHOLE THING, and both are about refusing to be
 * quietly useless:
 *
 * **1. An unmatched request THROWS.** The obvious implementation answers an
 * unknown URL with `{}` or `{ files: [] }`, and that is the worst thing a
 * replay can do: a fixture that no longer matches the code produces an empty
 * listing, the connector reports zero items, the test asserts zero items, and
 * the gate goes green having proved that nothing happened. Every failure mode
 * of a stale fixture has to be LOUD, so an unmatched request names the URL it
 * wanted and lists what the fixture has.
 *
 * **2. Repeats are served IN ORDER.** The probe exports the same document
 * twice, deliberately, and those two exchanges share a URL. A matcher that
 * always returned the first recording would replay a stability test that can
 * only pass. Each exchange is consumed once, in the order it was recorded.
 *
 * A recorded FAILURE replays as one: the status comes back, and `text()` gives
 * the reason Drive gave, scrubbed. That matters because the connector quotes it
 * verbatim (rule 9), and a replay that answered an empty string would let a
 * regression in that message pass unnoticed.
 *
 * WHAT A REPLAY CANNOT DO, said here rather than discovered by somebody
 * asserting on it: reproduce document BYTES. A capture stores a sha256 and a
 * length, never the content — that is the point of the redaction. So a replayed
 * download hands back filler of the recorded LENGTH, filled with a visible
 * marker, and `recordedSha256()` is how a test reaches the real hash. Comparing
 * a re-hash of the filler against a recorded sha256 is comparing a fixture to
 * itself; `drive-replay.unit.test.ts` pins that the two are never equal, so
 * nobody can make a failing assertion pass that way.
 */

import type { DriveCapture, DriveExchange, RecordableTransport } from './drive-capture.ts';

/**
 * What a replayed download is filled with.
 *
 * Chosen to be unmistakable in a hex dump or a diff. A replay that returned
 * zeroes, or the ASCII of a plausible document, would let somebody believe for
 * a while that they were looking at content.
 */
const FILLER = 'REDACTED-BYTES-';

export interface DriveReplay {
  readonly transport: RecordableTransport;
  /** The sha256 the recording holds for the nth byte-answering exchange. */
  recordedSha256(index: number): string | undefined;
  /** Exchanges the fixture still holds that nothing asked for. */
  unplayed(): readonly DriveExchange[];
}

/**
 * Build a transport that answers from a capture.
 *
 * Matching is by EXACT url, because a recording is of specific requests and a
 * fuzzy match is how a replay ends up answering a question it was never asked.
 * The connector builds its URLs deterministically from the same inputs, so an
 * exact match is achievable — and when it is not, that is a change in how we
 * call Drive, which is exactly the thing a contract test should notice.
 */
export function createReplayTransport(capture: DriveCapture): DriveReplay {
  // Consumed in order, so a repeated URL serves its recordings one at a time.
  const remaining = capture.exchanges.map((exchange) => ({ exchange, played: false }));
  const byteHashes = capture.exchanges
    .filter((e) => e.bytes !== undefined)
    .map((e) => e.bytes!.sha256);

  const transport: RecordableTransport = async (url) => {
    const slot = remaining.find((r) => !r.played && r.exchange.url === url);
    if (!slot) {
      const played = remaining.filter((r) => r.played && r.exchange.url === url).length;
      throw new Error(
        `No recorded Drive answer for:\n  ${url}\n` +
          (played > 0
            ? `The fixture has ${played} recording(s) of that exact URL and all are already ` +
              'used, so the code asked for it more times than Drive was asked when this was ' +
              'recorded.\n'
            : 'The fixture has no recording of that URL at all, so the code is calling Drive ' +
              'differently from when this was recorded.\n') +
          `Recorded URLs:\n${capture.exchanges.map((e) => `  - ${e.url}`).join('\n')}`,
      );
    }
    slot.played = true;
    const { exchange } = slot;

    return {
      // From the recorded STATUS, and a recorded failure carries its reason in
      // `text` rather than a body — which is what the connector quotes.
      ok: exchange.status < 400,
      status: exchange.status,
      json: async () => {
        if (exchange.json === undefined) {
          throw new Error(
            `The recorded answer for ${url} is ${exchange.text !== undefined ? 'an error' : 'bytes'}` +
              ', not JSON. Reading it as JSON means the code has changed which kind of call ' +
              'this is.',
          );
        }
        return exchange.json;
      },
      arrayBuffer: async () => {
        if (exchange.bytes === undefined) {
          throw new Error(
            `The recorded answer for ${url} is JSON, not bytes. Reading it as bytes means the ` +
              'code has changed which kind of call this is.',
          );
        }
        return fillerOf(exchange.bytes.byteLength);
      },
      // What Drive said, for a recorded failure. Empty for a success, which is
      // what the connector's own success path expects.
      text: async () => exchange.text ?? '',
    };
  };

  return {
    transport,
    recordedSha256: (index) => byteHashes[index],
    unplayed: () => remaining.filter((r) => !r.played).map((r) => r.exchange),
  };
}

/**
 * `length` bytes of a visible marker.
 *
 * The LENGTH is real — it is what Drive actually sent — so a connector's own
 * size bookkeeping replays honestly. The content is not, and looks it.
 */
function fillerOf(length: number): ArrayBuffer {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = FILLER.charCodeAt(i % FILLER.length);
  }
  return out.buffer;
}
