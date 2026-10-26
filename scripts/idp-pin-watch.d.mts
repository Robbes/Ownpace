// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the pin watch (the identity provider since 0135 T7, every pin
 * Dependabot cannot see since 0146 T8), so its guard can run it with stubbed
 * registries, npm, nodejs.org's index and a fake `gh`.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: the watch
 * runs in a CI step on a bare checkout and needs no type stripping.
 */

export declare const COMPOSE: string;
export declare const UPSTREAM: string;
export declare const ISSUE_TITLE: string;
export declare const WINDOW_DAYS: number;
export declare const TITLES: Record<'zitadel' | 'trigger' | 'clickhouse' | 'taskNode' | 'pnpm' | 'typescript' | 'routine', string>;
export declare const COMPOSE_FILES: string[];
export declare const COMPARED_ELSEWHERE: Record<string, string>;
export declare const STALWART_RULE: string;
export declare const REBUILD_NOTE: string;
export declare const STALWART_FILES: string[];
export declare const TASK_ON_API_IMAGE: RegExp;

export type State = 'current' | 'behind' | 'ahead' | 'error';

export interface PinResult {
  pin: string;
  newest: string;
  state: 'current' | 'behind' | 'ahead';
}

/** One row of the report. An own-issue row also carries its key and title. */
export interface Row {
  key?: string;
  name?: string;
  title?: string;
  where?: string;
  pin?: string;
  newest?: string;
  state: State;
  /** What the table shows instead of the state, when the state reads wrong (the TypeScript split). */
  shown?: string;
  notes?: string[];
  error?: string;
  body?: string;
  /** Text whose absence from the open issue's body means something new: a comment, not only an edit. */
  news?: string | string[];
  update?: string | ((fresh: string[]) => string);
  closing?: string;
}

export interface Image {
  line: number;
  ref: string;
  repo: string;
  tag: string;
  digest: string;
}

/** The network, so the guard can stub every read. */
export interface Net {
  text(url: string, headers?: Record<string, string>): Promise<string>;
  json(url: string, headers?: Record<string, string>): Promise<unknown>;
  bytes(url: string, headers?: Record<string, string>): Promise<Buffer>;
  /** A HEAD of `url`: its `Docker-Content-Digest`, or '' when it names none. */
  digest(url: string, headers?: Record<string, string>): Promise<string>;
  lsRemote(url: string): Promise<string>;
  npm(args: string[]): Promise<string>;
  /** `trigger-version.sh probe <pin>`: the tags above it both images carry, newest first. */
  probe(pin: string): Promise<string>;
}

/** The checkout: a file's text, or null when it is not there; a directory's names. */
export interface Repo {
  read(rel: string): string | null;
  list(rel: string): string[];
}

export interface Report {
  issues: Row[];
  routine: Row[];
  status: string[];
}

export declare function compareTags(a: string, b: string): number;
export declare function readPin(compose: string): string;
export declare function tagsOf(lsRemote: string): string[];
export declare function newestRelease(major: number, lsRemote: string): string;
export declare function comparePin(pin: string, lsRemote: string): PinResult;
export declare function issueBody(result: Pick<PinResult, 'pin' | 'newest'>): string;

export declare function compareParts(a: string, b: string): number;
export declare function newestLike(pin: string, tags: string[], keep?: number): string;
export declare function stateOf(pin: string, newest: string): PinResult['state'];
export declare function parseRef(ref: string): Omit<Image, 'line'>;
export declare function readImages(text: string): Image[];
export declare function registryOf(repo: string): { host: string; name: string };
export declare function registryTags(net: Net, repo: string): Promise<string[]>;
export declare function nodeVersionOf(net: Net, image: string): Promise<string>;
export declare function registryDigest(net: Net, repo: string, tag: string): Promise<string>;
export declare function stepsUsing(
  workflow: string,
  action: string,
): Array<{ sha: string; version: string; with: Record<string, string> }>;
export declare function actionDefault(actionYml: string, input: string): string;
export declare function fileInTgz(tgz: Buffer, path: string): string;
export declare function baseImageOf(buildImageJs: string, runtime: string): string;
export declare function cliBaseImage(net: Net, version: string, runtime: string): Promise<string>;
export declare function securityFloor(index: unknown, major: number): { version: string; date: string };
export declare function readTriggerPin(compose: string, workerManifest: string): string;
export declare function triggerBody(result: Pick<PinResult, 'pin' | 'newest'>): string;
export declare function clickhouseSupport(securityMd: string, tag: string): string;

export declare function zitadelRow(repo: Repo, net: Net): Promise<Row>;
export declare function triggerRow(repo: Repo, net: Net): Promise<Row>;
export declare function clickhouseRow(repo: Repo, net: Net, trigger: Row): Promise<Row>;
export declare function taskNodeRow(repo: Repo, net: Net): Promise<Row>;
export declare function pnpmRow(repo: Repo, net: Net): Promise<Row>;
export declare function typescriptRow(repo: Repo, net: Net): Promise<Row>;
export declare function routineRows(repo: Repo, net: Net): Promise<{ rows: Row[]; status: string[] }>;
export declare function summaryOf(rows: Row[], status: string[]): Row;

export declare function keepIssue(
  result: PinResult | Row,
  gh: (args: string[]) => string,
  title?: string,
): 'opened' | 'updated' | 'unchanged' | 'closed' | 'untouched';
export declare function watch(repo: Repo, net: Net): Promise<Report>;
export declare function table(report: Report): string;
export declare function realNet(root: string): Net;
export declare function repoReader(root: string): Repo;
