// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Prometheus metrics, for §19's per-tenant dashboards and §18's Grafana/LGTM.
 *
 * Hand-rolled for the same reason the logger is: the exposition format is a
 * dozen lines of text, and a client library brings a registry abstraction,
 * default process collectors and a config surface this does not need. It also
 * keeps the self-host image free of a dependency it would otherwise carry for
 * one endpoint (hard rule 5).
 *
 * ## Labels are a privacy boundary, not a convenience
 *
 * §17 is explicit that job metadata — addresses, folder names — is itself
 * personal data. A metrics store has completely different retention, access and
 * export properties from the ledger: it is scraped, federated, and often
 * long-retained. A label like `folder="Inbox/Clients/AcmeBV"` or
 * `user="anna@example.com"` moves customer data into that system silently, and
 * it is far easier to add than to withdraw.
 *
 * So label VALUES are restricted to opaque identifiers — tenant/mapping UUIDs
 * and the fixed domain names — and `assertOpaqueLabel` rejects anything that
 * looks like an address or a path. See `metrics.unit.test.ts`, which is the
 * enforcement.
 */

/** Label sets are small and fixed; a sorted key string is enough to intern them. */
type Labels = Readonly<Record<string, string>>;

const EMAIL_LIKE = /@/;
const PATH_LIKE = /[/\\]/;

/**
 * Reject a label value that looks like personal data.
 *
 * Deliberately crude and deliberately loud. It cannot recognise every shape of
 * personal data, but it catches the two that would actually happen here — an
 * address and a folder path — and it does so at the point of instrumentation
 * rather than after a year of retention.
 */
export function assertOpaqueLabel(name: string, value: string): void {
  if (EMAIL_LIKE.test(value) || PATH_LIKE.test(value)) {
    throw new Error(
      `metric label ${name}=${JSON.stringify(value)} looks like personal data ` +
        `(an address or a path). §17 treats job metadata as personal data, and a ` +
        `metrics store has different retention and access than the ledger. Use an ` +
        `opaque id — tenantId, mappingId, domain.`,
    );
  }
}

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  for (const k of keys) assertOpaqueLabel(k, labels[k]!);
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

/** Prometheus label values escape backslash, double quote and newline. */
function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map(
    (k) => `${k}="${labels[k]!.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
  );
  return `{${parts.join(',')}}`;
}

interface Series {
  labels: Labels;
  value: number;
}

abstract class Metric {
  protected readonly series = new Map<string, Series>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  abstract get type(): string;
  protected slot(labels: Labels): Series {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { labels, value: 0 };
      this.series.set(key, s);
    }
    return s;
  }
  render(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
    for (const s of this.series.values()) {
      out.push(`${this.name}${renderLabels(s.labels)} ${s.value}`);
    }
    return out;
  }
  reset(): void {
    this.series.clear();
  }
}

/** Monotonic total. */
export class Counter extends Metric {
  get type(): string {
    return 'counter';
  }
  inc(labels: Labels = {}, amount = 1): void {
    this.slot(labels).value += amount;
  }
}

/** A value that goes up and down. */
export class Gauge extends Metric {
  get type(): string {
    return 'gauge';
  }
  set(labels: Labels, value: number): void {
    this.slot(labels).value = value;
  }
}

/**
 * Bucketed distribution.
 *
 * Buckets are in SECONDS and chosen for what this actually measures: per-item
 * migration latency ran 30 ms (mail read) to 440 ms (mail write) in real runs,
 * with large files well above that. A default `0.005..10` spread would put
 * nearly everything in two buckets.
 */
export class Histogram {
  private readonly counts = new Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  ) {}
  observe(labels: Labels, seconds: number): void {
    const key = labelKey(labels);
    let s = this.counts.get(key);
    if (!s) {
      s = { labels, buckets: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.counts.set(key, s);
    }
    s.sum += seconds;
    s.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (seconds <= this.buckets[i]!) s.buckets[i]! += 1;
    }
  }
  render(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.counts.values()) {
      // Prometheus buckets are CUMULATIVE, and `observe` already accumulates
      // that way — it increments EVERY bucket the observation falls under, not
      // just the narrowest — so these counts are emitted as they stand.
      for (let i = 0; i < this.buckets.length; i++) {
        out.push(
          `${this.name}_bucket${renderLabels({ ...s.labels, le: String(this.buckets[i]) })} ${s.buckets[i]}`,
        );
      }
      out.push(`${this.name}_bucket${renderLabels({ ...s.labels, le: '+Inf' })} ${s.count}`);
      out.push(`${this.name}_sum${renderLabels(s.labels)} ${s.sum}`);
      out.push(`${this.name}_count${renderLabels(s.labels)} ${s.count}`);
    }
    return out;
  }
  reset(): void {
    this.counts.clear();
  }
}

/**
 * The product's metrics.
 *
 * Named after §19's dashboard columns — migrated, errors, throughput — so the
 * mapping from the architecture to the scrape output is legible rather than
 * inferred.
 */
export const metrics = {
  itemsMigrated: new Counter(
    'openmigrate_items_migrated_total',
    'Items written to the target, by domain and outcome (created/adopted/skipped).',
  ),
  itemsFailed: new Counter(
    'openmigrate_items_failed_total',
    'Items that could not be migrated, by domain.',
  ),
  bytesTransferred: new Counter(
    'openmigrate_bytes_transferred_total',
    'Bytes read from the source and written to the target, by domain.',
  ),
  passDuration: new Histogram(
    'openmigrate_pass_duration_seconds',
    'Wall time of one completed domain pass.',
    [1, 5, 15, 60, 300, 900, 3600],
  ),
  itemDuration: new Histogram(
    'openmigrate_item_duration_seconds',
    'Mean per-item time within a pass, by phase (source fetch / target write).',
  ),
  passOverlap: new Gauge(
    'openmigrate_pass_overlap_ratio',
    'Work in flight during the last pass: sum of phase time over wall time. ' +
      'Approaches the configured concurrency when healthy; 1 means the pass ran serially.',
  ),
  itemsNeedingDecision: new Gauge(
    'openmigrate_items_needing_decision',
    'Items that exhausted their automatic retries and are waiting on an owner ' +
      'decision (retry, or accept leaving them behind). Non-zero means a cutover ' +
      'would leave data behind.',
  ),
  throttleEvents: new Counter(
    'openmigrate_throttle_events_total',
    'Times a target asked us to slow down (429/503/423), by domain.',
  ),
} as const;

/** Everything registered, for the exposition endpoint. */
const ALL: Array<{ render(): string[]; reset(): void }> = Object.values(metrics);

/** The full scrape body, in Prometheus text exposition format. */
export function renderMetrics(): string {
  return ALL.flatMap((m) => m.render()).join('\n') + '\n';
}

/** Drop every series (tests). */
export function resetMetrics(): void {
  for (const m of ALL) m.reset();
}

/** Content type Prometheus expects for the text format. */
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
