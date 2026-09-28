// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the outside probe, so its guard can run it with a fake network.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: the probe
 * runs in a CI step on a bare checkout and needs no type stripping.
 */

export declare const PRODUCTION_NAMES: readonly string[];
export declare const OTA_NAMES: readonly string[];
export declare const ISSUER: string;
export declare const DISCOVERY: string;
export declare const OTA_MODES: readonly string[];
/** The production site's name (workplan 0139 T10), tried only on live's front. */
export declare const SITE_NAME: string;
export declare const SITE_MODES: readonly string[];
export declare const TLS_PORT: number;

export type OtaMode = 'report' | 'internet' | 'mesh-only';

/** What www.ownpace.eu must do: `report` records it, `required` fails on it. */
export type SiteMode = 'report' | 'required';

export interface ProbeConfig {
  /** Every port tried on every address, sorted, once each. */
  readonly ports: readonly number[];
  /** EXPOSURE_PROBE_HOST: the machine's own address or name, or ''. */
  readonly host: string;
  readonly otaMode: OtaMode;
  /** EXPOSURE_PROBE_SITE_NAME, the dispatch input `site_name`. */
  readonly siteMode: SiteMode;
}

/** What a TCP connection attempt met. `untried`: this runner could not try (its code). */
export type ConnectAnswer = 'open' | 'closed' | 'silent' | { readonly untried: string };

/** What 443 on a name met: a TLS session, a TCP connection only, or nothing. */
export interface TlsAnswer {
  readonly state: 'tls' | 'tcp-only' | 'none';
  readonly why?: string;
}

/** The network and the log, so a test can hand the probe its own. */
export interface ProbeIo {
  resolve(name: string): Promise<{ readonly addresses: readonly string[]; readonly error?: string }>;
  connect(address: string, port: number): Promise<ConnectAnswer>;
  tls(name: string): Promise<TlsAnswer>;
  issuer(url: string): Promise<{ readonly issuer?: string; readonly why?: string }>;
  print(line: string): void;
}

/** The configuration from the workflow's environment, or why it cannot run. */
export declare function probeConfig(
  env: Readonly<Record<string, string | undefined>>,
  derivedPorts: readonly number[],
): { readonly config?: ProbeConfig; readonly errors: readonly string[] };

/** The probe; resolves to the exit code (0 pass, 1 a finding). */
export declare function runProbe(config: ProbeConfig, io: ProbeIo): Promise<number>;

/** The real network, with its timeouts in milliseconds. */
export declare function realNetwork(timeouts?: {
  readonly connectMs?: number;
  readonly tlsMs?: number;
  readonly fetchMs?: number;
}): Omit<ProbeIo, 'print'>;
