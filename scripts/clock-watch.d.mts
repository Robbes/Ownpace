// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the clock watch, so its guard can run it with a stubbed network
 * and a fake `gh`.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: the watch
 * runs in a CI step on a bare checkout and needs no type stripping.
 */

export declare const ISSUE_TITLE: string;
export declare const CERTIFICATE_DAYS: number;
export declare const SECURITY_TXT_DAYS: number;
export declare const ENTRA_DAYS: number;
export declare const SECURITY_TXT_URL: string;
export declare const ENTRA_NAME: string;
export declare const TLS_PORT: number;

export interface WatchConfig {
  /** `CLOCK_WATCH_SITE=required`: www.ownpace.eu and its security.txt count. */
  site: boolean;
  /** `CLOCK_WATCH_ENTRA_EXPIRES`, `YYYY-MM-DD`, when set. */
  entra?: string;
}

/** One clock as the watch read it. `expires` is `YYYY-MM-DD`; `why` a code, or our words. */
export interface Clock {
  kind: 'certificate' | 'security.txt' | 'entra';
  name: string;
  /** False for the OTA names: reported, never counted. */
  counted: boolean;
  /** Days: fewer whole days left than this is inside the window. */
  window: number;
  state: 'ok' | 'due' | 'unread';
  expires?: string;
  daysLeft?: number;
  verified?: boolean;
  why?: string;
}

export interface CertificateAnswer {
  /** The certificate's `valid_to`, as Node hands it over. */
  validTo?: string;
  verified?: boolean;
  why?: string;
}

export interface WatchIo {
  certificate(name: string): Promise<CertificateAnswer>;
  securityTxt(url: string): Promise<{ text?: string; why?: string }>;
}

export declare function watchConfig(env: Record<string, string | undefined>): {
  config?: WatchConfig;
  errors: string[];
};
export declare function securityTxtExpires(text: string): { expires: Date } | { why: string };
export declare function runWatch(
  config: WatchConfig,
  io: WatchIo,
  now: Date,
): Promise<{ clocks: Clock[]; lines: string[]; code: 0 | 1 }>;
export declare function issueBody(clocks: Clock[]): string;
export declare function keepIssue(
  clocks: Clock[],
  gh: (args: string[]) => string,
): 'opened' | 'updated' | 'unchanged' | 'closed' | 'untouched';
export declare function realNetwork(options?: {
  tlsMs?: number;
  fetchMs?: number;
  connect?: (options: Record<string, unknown>) => unknown;
}): WatchIo;
