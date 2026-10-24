// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for what the release scripts share: the GitHub client, the fields
 * kept of its answers, and the line every check prints.
 */

export declare const REPOSITORY: string;
export declare const RUN_FIELDS: string[];
export declare const JOB_FIELDS: string[];
export declare const STEP_FIELDS: string[];
export declare const RELEASE_FIELDS: string[];
export declare const ASSET_FIELDS: string[];
export declare const ALERT_FIELDS: string[];
export declare const ALERT_RULE_FIELDS: string[];
export declare const ALERT_TOOL_FIELDS: string[];
export declare const ALERT_INSTANCE_FIELDS: string[];
/** Keys that never belong in anything recorded from the API. */
export declare const NEVER_RECORDED: string[];

/** A code-scanning alert as the whitelist keeps it. */
export interface Alert {
  number?: number;
  state?: string;
  rule?: { id?: string; severity?: string; security_severity_level?: string };
  tool?: { name?: string };
  most_recent_instance?: { ref?: string; category?: string };
}

export declare function slimRun(run: unknown): Record<string, unknown>;
export declare function slimJob(job: unknown): Record<string, unknown>;
export declare function slimRelease(release: unknown): Record<string, unknown>;
export declare function slimAlert(alert: unknown): Alert;

/** One check's answer. */
export interface Line {
  kind: 'pass' | 'refuse' | 'note' | string;
  check: string;
  sentence: string;
}

export declare function line(kind: string, check: string, sentence: string): Line;
export declare function pass(check: string, sentence: string): Line;
export declare function refuse(check: string, sentence: string): Line;
export declare function note(check: string, sentence: string): Line;
export declare function refusals(lines: Line[]): number;
export declare function render(line: Line): string;
export declare function report(lines: Line[], options?: { file?: string; actions?: boolean }): void;
export declare function output(values: Record<string, string | number>, file?: string): void;

export declare class ApiError extends Error {
  constructor(method: string, path: string, status: number, body: unknown);
  status: number;
  body: unknown;
}

/** What the scripts ask of the API. GET is retried; nothing else is. */
export interface Client {
  get(path: string, options?: { allow404?: boolean }): Promise<unknown>;
  send(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }>;
}

export declare function github(options?: {
  token?: string;
  api?: string;
  repository?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  tries?: number;
}): Client & { url(path: string): string };

export declare function getAll(client: Pick<Client, 'get'>, path: string, options?: { perPage?: number; maxPages?: number }): Promise<unknown[]>;

export declare function runUrl(id: number | string, repository?: string, server?: string): string;
export declare function short(sha: string): string;
