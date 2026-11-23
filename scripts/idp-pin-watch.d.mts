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
export declare function builtNote(dockerfile: string): string;
/** How a tag ends after its version, where that starts with a letter: `-p0`, `-alpine`, or nothing. */
export declare function endingOf(tag: string): string;
/** Said instead of `builtNote` where the newest tag ends otherwise than the pin: Dependabot does not propose it. */
export declare function byHandNote(dockerfile: string, pin: string, newest: string): string;
export declare const STALWART_FILES: string[];
export declare const GOACCESS_DOCKERFILE: string;
export declare const LINES: Record<string, number>;
export declare const COSIGN_FILES: string[];
export declare const ATLAS_WORKFLOW: string;
export declare const ATLAS_HOST: string;
export declare const ATLAS_IMAGE: string;
export declare const ATLAS_ARCHES: string[];
export declare const ATLAS_NOTE: string;
/** The Atlas release migration-lint installs, and its sha256 for each architecture; throws for a step that may not run. */
export declare function atlasPin(workflow: string): { version: string; sha256: Record<'amd64' | 'arm64', string>; line: number };

export declare const STALWART_CLI_FILES: string[];
export declare const STALWART_CLI_HOST: string;
export declare const STALWART_CLI_UPSTREAM: string;
export declare const STALWART_CLI_ARCHES: Record<'AMD64' | 'ARM64', string>;
export declare const STALWART_CLI_HINTS: string[];
export declare const STALWART_CLI_NOTE: string;
/** The stalwart-cli release a workflow installs, and its sha256 for each architecture; throws for a step that may not run. */
export declare function stalwartCliPin(workflow: string): { version: string; sha256: Record<'amd64' | 'arm64', string>; line: number };
export declare const NEXTCLOUD_SECOND_MAJOR_WORKFLOW: string;
export declare const NEXTCLOUD_SECOND_MAJOR_NOTE: string;
/** The one image the second Nextcloud major's leg names, by a numbered tag and its index digest; throws for any other line. */
export declare function secondMajorPin(workflow: string): Omit<Image, 'line'>;
export declare const HADOLINT_WORKFLOW: string;
export declare const HADOLINT_NOTE: string;
/** The one image hadolint.yml names, hadolint/hadolint by a release tag and its index digest; throws for any other line. */
export declare function hadolintPin(workflow: string): Omit<Image, 'line'>;
export declare const SEMGREP_WORKFLOW: string;
export declare const SEMGREP_NOTE: string;
/** The one image semgrep.yml names, semgrep/semgrep by a release tag and its index digest; throws for any other line. */
export declare function semgrepPin(workflow: string): Omit<Image, 'line'>;
export declare const ZIZMOR_WORKFLOW: string;
export declare const ZIZMOR_NOTE: string;
/** The one image zizmor.yml names, ghcr.io/zizmorcore/zizmor by a release tag and its index digest; throws for any other line. */
export declare function zizmorPin(workflow: string): Omit<Image, 'line'>;
export declare const TRIVY_WORKFLOW: string;
export declare const TRIVY_JOBS: string[];
export declare const TRIVY_HOST: string;
export declare const TRIVY_UPSTREAM: string;
export declare const TRIVY_ARCHES: Record<'AMD64' | 'ARM64', string>;
export declare const TRIVY_NOTE: string;
export declare function trivyPin(workflow: string, job: string): { version: string; sha256: Record<'amd64' | 'arm64', string>; line: number };
export declare const OSV_SCANNER_WORKFLOW: string;
export declare const OSV_SCANNER_HOST: string;
export declare const OSV_SCANNER_UPSTREAM: string;
export declare const OSV_SCANNER_ARCHES: string[];
export declare const OSV_SCANNER_NOTE: string;
/** The osv-scanner the Security Scan installs, read from its one install step; throws for a step not of the shape it must have. */
export declare function osvScannerPin(workflow: string): { version: string; sha256: Record<'amd64' | 'arm64', string>; line: number };
export declare const GITLEAKS_WORKFLOW: string;
export declare const GITLEAKS_HOST: string;
export declare const GITLEAKS_UPSTREAM: string;
export declare const GITLEAKS_ARCHES: string[];
export declare const GITLEAKS_NOTE: string;
/** The gitleaks ci.yml's gitleaks job installs, read from its one install step; throws for a step not of the shape it must have. */
export declare function gitleaksPin(workflow: string): { version: string; sha256: Record<'x64' | 'arm64', string>; line: number };
export declare const SQUAWK_WORKFLOW: string;
export declare const SQUAWK_HOST: string;
export declare const SQUAWK_UPSTREAM: string;
export declare const SQUAWK_ARCHES: string[];
export declare const SQUAWK_NOTE: string;
/** The squawk the Migration locks workflow installs (workplan 0165): its release and each architecture's sha256. */
export declare function squawkPin(workflow: string): { version: string; sha256: Record<'x64' | 'arm64', string>; line: number };
export interface ActionImageSpec {
  action: string;
  input: string;
  option?: string;
  repo: string;
  channel: string;
}
export declare const ACTION_IMAGES_WORKFLOW: string;
export declare const ACTION_IMAGES: ActionImageSpec[];
export declare function channelNote(spec: ActionImageSpec): string;
/** Every image an action in a workflow runs from an input; throws for one left to its default or not pinned by release tag and digest. */
export declare function actionImages(workflow: string): Array<{ action: string; input: string; ref: string; repo: string; tag: string; digest: string }>;

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
  /** The comment a current row closes its open issue with; a removed row's says why (`removedRow`). */
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
  /** A HEAD of `url`: its `Docker-Content-Digest`, '' when it names none, and null when the registry answers 404. */
  digest(url: string, headers?: Record<string, string>): Promise<string | null>;
  lsRemote(url: string): Promise<string>;
  /** `git ls-remote <url> HEAD`: the repository's newest commit on its default branch. */
  head(url: string): Promise<string>;
  npm(args: string[]): Promise<string>;
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
/** The one FROM of a Dockerfile built beside a compose file, which carries a tag and a digest. */
export declare function dockerfileBase(text: string): Omit<Image, 'line'>;
/** `<base tag>-<12 hex of the SHA-256 of the instruction lines>`: the tag a compose file gives the image it builds. */
export declare function builtTag(text: string): string;
/** A compose file's `localhost/<name>` image, built from `<name>/Dockerfile` beside it; null for a pulled one. */
export declare function builtImage(
  repo: Repo,
  file: string,
  image: Pick<Image, 'ref' | 'repo'>,
): { context: string; dockerfile: string; base: Omit<Image, 'line'>; tag: string } | null;
export declare function registryOf(repo: string): { host: string; name: string };
export declare function registryTags(net: Net, repo: string): Promise<string[]>;
export declare function registryDigest(net: Net, repo: string, tag: string): Promise<string>;
export declare function stepsUsing(
  workflow: string,
  action: string,
): Array<{ sha: string; version: string; with: Record<string, string> }>;
export declare function actionDefault(actionYml: string, input: string): string;

export declare function zitadelRow(repo: Repo, net: Net): Promise<Row>;
export declare function pnpmRow(repo: Repo, net: Net): Promise<Row>;
export declare function typescriptRow(repo: Repo, net: Net): Promise<Row>;
export declare function routineRows(repo: Repo, net: Net): Promise<{ rows: Row[]; status: string[] }>;
export declare function summaryOf(rows: Row[], status: string[]): Row;
/** A row for a pin that went with Trigger.dev in alpha.18 (workplan 0167 T9): current, with the sentence its open issue is closed with. */
export declare function removedRow(what: string): { pin: string; newest: string; state: 'current'; closing: string };

export declare function keepIssue(
  result: PinResult | Row,
  gh: (args: string[]) => string,
  title?: string,
): 'opened' | 'updated' | 'unchanged' | 'closed' | 'untouched';
export declare function watch(repo: Repo, net: Net): Promise<Report>;
export declare function table(report: Report): string;
export declare function realNet(): Net;
export declare function repoReader(root: string): Repo;
export declare const NODE_RELEASE_KEYS_FILE: string;
export declare const NODE_RELEASE_KEYS_NOTE: string;
export declare function releaseKeysPin(text: string | null): { repo: string; commit: string; path: string; blob: string };
export declare function gitBlobId(bytes: Uint8Array): string;
