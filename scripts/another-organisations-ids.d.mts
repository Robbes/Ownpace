// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the second identity's asker, so its guard can import it.
 *
 * `.mjs` like the reports here: `scripts/schemathesis-report.mjs` runs it
 * with `node`, inside the stack's namespace, with no type stripping.
 */

export declare const TENANT_HEADER: string;
export declare const VIA: ReadonlyArray<'path' | 'header'>;
export declare const ID_PARAMS: Readonly<Record<string, string>>;
export declare const ID_BY_PREFIX: Readonly<Record<string, string>>;

export type Classified = 'refused' | 'answered' | 'other';
export type Verdict = 'refused' | 'leak' | 'answered' | 'other';

export declare function classify(status: number): Classified;
export declare function verdictOf(answer: { status: number; carries: boolean }): Verdict;

export interface Ask {
  readonly operation: string;
  readonly via: 'path' | 'header';
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}
export interface NotAsked {
  readonly operation: string;
  readonly why: string;
}
export declare function asksFor(doc: unknown, ids: Readonly<Record<string, string>>): { asks: Ask[]; notAsked: NotAsked[] };

export interface Asked {
  readonly operation: string;
  readonly via: string;
  readonly status: number;
  readonly carries: boolean;
  readonly error?: string;
}
export declare function askAll(
  asks: ReadonlyArray<Ask>,
  opts: { base: string; token: string; tenant: string; markers?: ReadonlyArray<string>; fetchImpl?: typeof fetch },
): Promise<Asked[]>;
