// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DOORS THAT START WORK, AND A CHECKER FOR WHAT THEY ANSWER.
 *
 * Shared by two guards that press the same doors for two different reasons:
 * `a-hold-that-holds-every-door.unit.test.ts` (an operator hold, workplan 0132
 * T6 (b)) and `an-organisation-closed-at-every-door.unit.test.ts` (a closed
 * organisation, workplan 0085 T2). A plain module and not a test, because
 * importing from a `.unit.test.ts` runs every case in it inside the importer.
 * It lives under `__tests__`, which the enqueue sweep skips: it is not the
 * product.
 *
 * What is here:
 *
 *  - `enqueueDoors`, the eight doors that enqueue a task on a person's press,
 *    each with the rows it would write before it enqueues;
 *  - the sweep's reading of the source: every shipped file, and its code
 *    without comments;
 *  - a small JSON Schema checker for the refusals the spec documents, which
 *    applies only the words those refusals use and fails loudly on any other.
 *
 * The mocks stay in each guard: `vi.mock` is hoisted per file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** One door, as a guard presses it. */
export interface Door {
  /** What the person pressed. */
  readonly name: string;
  /** POST unless said. */
  readonly method?: 'post' | 'put' | 'get';
  readonly path: string;
  /** Its entry in `apps/api/docs/openapi.yaml`. */
  readonly spec: string;
  readonly body?: Record<string, unknown>;
  /** The status the same press answers when nothing refuses it. */
  readonly accepted: number;
  /** The task it enqueues, for a door that enqueues. */
  readonly task?: string;
  /** For a door that writes: the rows it would have written. */
  readonly wrote?: () => Promise<number>;
  /** Put the rows back as they were before a press that went through. */
  readonly reset?: () => Promise<void>;
}

/** The rows a guard's fixture gives the eight doors. */
export interface EnqueueFixture {
  /** A running migration, which may apply deletions. */
  readonly active: string;
  /** A draft (`paused`), which Start activates. */
  readonly draft: string;
  /** A natural-key hash the two apply doors name. */
  readonly hash: string;
  readonly tenant: string;
  /** `SELECT count(*) AS n …`, on the guard's own database. */
  readonly count: (sqlText: string, params: unknown[]) => Promise<number>;
}

/** The migration routes' path prefix, as the spec writes it. */
export const M = '/api/migrations/{mappingId}';

/**
 * The eight doors that enqueue a task on a person's press, on 2026-09-27: four
 * in each of the two migration routers. A door added later is one more here.
 */
export function enqueueDoors(f: EnqueueFixture): readonly Door[] {
  const auditRows = () => f.count('SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1', [f.tenant]);
  return [
    {
      name: 'Sync now',
      path: `/api/migrations/${f.active}/sync`,
      spec: `${M}/sync`,
      body: {},
      accepted: 202,
      task: 'run-delta-sync',
    },
    {
      name: 'a cutover’s preparation',
      path: `/api/migrations/${f.active}/cutover`,
      spec: `${M}/cutover`,
      body: {},
      accepted: 202,
      task: 'run-cutover',
    },
    {
      name: 'a discovery count',
      path: `/api/migrations/${f.active}/discover`,
      spec: `${M}/discover`,
      body: {},
      accepted: 202,
      task: 'run-discovery',
    },
    {
      name: 'Start, which activates the migration and runs its first pass',
      path: `/api/migrations/${f.draft}/start`,
      spec: `${M}/start`,
      accepted: 200,
      task: 'run-delta-sync',
      wrote: async () =>
        (await f.count(`SELECT count(*) AS n FROM mailbox_mapping WHERE id = $1 AND status <> 'paused'`, [f.draft])) +
        (await auditRows()),
    },
    {
      name: 'a verification',
      path: `/api/migrations/${f.active}/verify/start`,
      spec: `${M}/verify/start`,
      accepted: 202,
      task: 'run-verification',
      wrote: () => f.count('SELECT count(*) AS n FROM verification_run WHERE mapping_id = $1', [f.active]),
    },
    {
      name: 'a deletion followed through',
      path: `/api/migrations/${f.active}/deletions/${f.hash}/apply`,
      spec: `${M}/deletions/{hash}/apply`,
      accepted: 202,
      task: 'run-apply-deletion',
      wrote: async () =>
        (await f.count(`SELECT count(*) AS n FROM apply_receipt WHERE mapping_id = $1 AND action = 'deletion'`, [f.active])) +
        (await auditRows()),
    },
    {
      name: 'a relocation followed through',
      path: `/api/migrations/${f.active}/moves/${f.hash}/apply`,
      spec: `${M}/moves/{hash}/apply`,
      accepted: 202,
      task: 'run-apply-relocation',
      wrote: async () =>
        (await f.count(`SELECT count(*) AS n FROM apply_receipt WHERE mapping_id = $1 AND action = 'relocation'`, [f.active])) +
        (await auditRows()),
    },
    {
      name: 'a confirmation pass',
      path: `/api/migrations/${f.active}/confirm`,
      spec: `${M}/confirm`,
      accepted: 202,
      task: 'run-confirmation',
    },
  ];
}

// ─── The sweep's reading of the source ─────────────────────────────────────

/** Every shipped source file under `dir`: tests, and this directory, are not the product. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' || name === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/**
 * The code without its comments, so a comment that names a call is not
 * counted as one. Block comments, and lines that are only a comment; a
 * comment after code on the same line is kept, which can only count more.
 */
export function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ─── The spec ────────────────────────────────────────────────────────────────

export type Schema = { readonly [key: string]: unknown };

/** Words that describe a value and do not constrain it. */
const ANNOTATIONS = new Set(['description', 'examples', 'example', 'format', 'title']);
/** Words this checker applies. Anything else fails loudly rather than passing unread. */
const CONSTRAINTS = new Set([
  '$ref', 'type', 'enum', 'required', 'properties', 'additionalProperties', 'oneOf', 'anyOf', 'allOf', 'items',
  // OpenAPI 3.0's `nullable: true`: null is allowed beside the type. Applied
  // below, first, so a null never reaches the type check it would fail.
  'nullable',
]);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** A checker over one spec file. */
export interface SpecChecker {
  /** A `#/…` pointer into the spec. */
  resolve(ref: string): Schema;
  /**
   * Does `value` satisfy `schema`, by JSON Schema's own rules for the words
   * the spec's refusals use? `oneOf` is exactly one branch. A type given as a
   * list (`[string, 'null']`) admits any of them. Dependency-free: `ajv` is
   * not a dependency of this package, and these are the only words it has to
   * know.
   */
  satisfies(schema: Schema, value: unknown): boolean;
  /** The body schema a door's response documents, through a shared response when it names one. */
  responseSchema(door: Door, status: string): { raw: unknown; schema: Schema };
}

export function specChecker(specPath: string): SpecChecker {
  const spec = parse(readFileSync(specPath, 'utf8')) as Schema & {
    paths: Record<string, Record<string, { responses?: Record<string, Schema> } | undefined>>;
  };

  const resolve = (ref: string): Schema => {
    let at: unknown = spec;
    for (const part of ref.replace(/^#\//, '').split('/')) at = (at as Schema)[part];
    if (!at || typeof at !== 'object') throw new Error(`${ref} points at nothing in openapi.yaml`);
    return at as Schema;
  };

  const satisfies = (schema: Schema, value: unknown): boolean => {
    if (typeof schema.$ref === 'string') return satisfies(resolve(schema.$ref), value);
    for (const word of Object.keys(schema)) {
      if (!CONSTRAINTS.has(word) && !ANNOTATIONS.has(word)) {
        throw new Error(`this checker does not apply "${word}"; teach it before trusting its answer`);
      }
    }
    if (value === null && schema.nullable === true) return true;
    const branches = (word: string) => (schema[word] as Schema[] | undefined)?.filter((b) => satisfies(b, value));
    if (schema.oneOf && branches('oneOf')!.length !== 1) return false;
    if (schema.anyOf && branches('anyOf')!.length === 0) return false;
    if (schema.allOf && branches('allOf')!.length !== (schema.allOf as Schema[]).length) return false;
    if (schema.type !== undefined) {
      const allowed = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
      const actual = typeOf(value);
      if (!allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'))) return false;
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
    // Every element, for an array: the list of texts a refusal names (0139 T3).
    if (schema.items && Array.isArray(value) && !value.every((v) => satisfies(schema.items as Schema, v))) return false;
    if (typeOf(value) === 'object') {
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required ?? []) as string[]) if (!(key in record)) return false;
      for (const [key, v] of Object.entries(record)) {
        if (properties[key]) {
          if (!satisfies(properties[key], v)) return false;
        } else if (schema.additionalProperties === false) {
          return false;
        }
      }
    }
    return true;
  };

  const responseSchema = (door: Door, status: string): { raw: unknown; schema: Schema } => {
    const method = door.method ?? 'post';
    const raw = spec.paths[door.spec]?.[method]?.responses?.[status];
    if (!raw) throw new Error(`${method.toUpperCase()} ${door.spec} documents no ${status}`);
    const response = typeof raw.$ref === 'string' ? resolve(raw.$ref) : raw;
    const content = response.content as Record<string, { schema?: Schema }> | undefined;
    const schema = content?.['application/json']?.schema;
    if (!schema) throw new Error(`${method.toUpperCase()} ${door.spec}'s ${status} has no JSON body`);
    return { raw, schema };
  };

  return { resolve, satisfies, responseSchema };
}
