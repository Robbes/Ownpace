// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * INDICATIVE_PROFILES — what a visitor probably has, before anything is
 * measured (workplan 0088 T2).
 *
 * These are the rung-1 assumptions behind the pre-preflight calculator:
 * self-declared inputs, ±50% accuracy, costing the visitor nothing. Every
 * number here is a STARTING ASSUMPTION to be argued with rather than trusted
 * — which is why every cell carries its provenance, the table carries a
 * version and a date, and the calculator shows the numbers editable instead
 * of hiding them behind an answer. Replace them with measured medians from
 * `migration_discovery` as soon as enough real preflights exist to have a
 * median, bump the version, and say on the page that they were measured.
 *
 * WHY IT LIVES HERE. Beside `prices.mjs`, for the same reason: `site/`
 * deliberately imports nothing from the workspace, so the public pages can be
 * split out later without a migration (0086 T7), and the guard is a test
 * rather than an import. (Workplan 0088 wrote `site/pricing/profiles.js`
 * before the site build existed; `site/*.mjs` beside the pages is where that
 * intent lands now.)
 *
 * PATHS ARE DERIVED, NEVER DECLARED. ADR-0014's unit is one object type from
 * one account to one account, so the path count follows from what is ticked
 * times how many accounts are moving — `pathsFor` below is the ONE place that
 * arithmetic lives, and the guard test pins it to the plan's own worked
 * examples. A declared paths number that stopped following from the ticks is
 * the single easiest way for this table to start lying.
 */

/**
 * Version of the ASSUMPTIONS, not of the page. Bump it when any number
 * changes, and keep `measured: false` honest — it flips only when the
 * numbers come from `migration_discovery` medians rather than judgement.
 */
export const PROFILES_VERSION = {
  version: 2,
  date: '2026-10-04',
  measured: false,
  source:
    'Workplan 0088 T2 starting assumptions (owner-merged 2026-08-19), transcribed verbatim; ' +
    'tasks added 2026-10-04 (the owner, workplan 0152 T7), a judgement. ' +
    'To be replaced by measured medians from migration_discovery.',
};

/**
 * Who is moving, and how many source accounts that means. The `accounts`
 * number is what `pathsFor` multiplies — a family of four is four mailboxes,
 * four contact books, four of everything they tick.
 */
export const CUSTOMER_TYPES = /** @type {const} */ ([
  { id: 'individual', accounts: 1 },
  { id: 'family', accounts: 4 },
  { id: 'sme', accounts: 10 },
]);

export const OBJECT_TYPES = /** @type {const} */ ([
  'mail',
  'contacts',
  'calendar',
  'tasks',
  'files',
  'photos',
]);

/**
 * The sizes the estimate ASKS for: the ones a person can read off their
 * provider's own storage page (the owner, 2026-10-04: GB for contacts, tasks
 * and calendar *"does not make sense … They dont know that"*). The rest are
 * counted at their assumed size, and the page says so in one line rather than
 * asking a question nobody can answer.
 */
export const SIZE_ASKED = /** @type {const} */ (['mail', 'files', 'photos']);

/**
 * @typedef {{ items: number, gb: number, provenance: string }} ProfileCell
 *
 * `items` and `gb` are PER CUSTOMER TYPE (the whole household or org, not per
 * account) — the plan's table is written that way, and the calculator's "how
 * much" question is answered that way by every provider's own storage page.
 */

/** The plan's table, cell for cell. @type {Record<string, Record<string, ProfileCell>>} */
export const INDICATIVE_PROFILES = {
  individual: {
    mail: {
      items: 20_000,
      gb: 8,
      provenance:
        'Workplan 0088 T2 starting assumption: a personal mailbox a few years old. Unmeasured.',
    },
    contacts: {
      items: 300,
      gb: 0.1,
      provenance:
        'Workplan 0088 T2 starting assumption; the plan writes "<0.1 GB" — carried as 0.1 so ' +
        'the size axis never reads zero for a non-empty book. Unmeasured.',
    },
    calendar: {
      items: 2_000,
      gb: 0.2,
      provenance: 'Workplan 0088 T2 starting assumption: a few years of appointments. Unmeasured.',
    },
    tasks: {
      items: 200,
      gb: 0.01,
      provenance:
        'Added 2026-10-04 (the owner, workplan 0152 T7), a judgement: a task list or two. A task ' +
        'is a line of text, so it is carried as 0.01 GB, as contacts are carried as 0.1, so the ' +
        'size axis never reads zero for a list that exists. Unmeasured.',
    },
    files: {
      items: 10_000,
      gb: 30,
      provenance: 'Workplan 0088 T2 starting assumption: a personal drive. Unmeasured.',
    },
    photos: {
      items: 15_000,
      gb: 60,
      provenance: 'Workplan 0088 T2 starting assumption: a phone-years photo library. Unmeasured.',
    },
  },
  family: {
    mail: {
      items: 80_000,
      gb: 30,
      provenance: 'Workplan 0088 T2 starting assumption: four personal mailboxes. Unmeasured.',
    },
    contacts: {
      items: 1_200,
      gb: 0.1,
      provenance:
        'Workplan 0088 T2 starting assumption; the plan writes "<0.1 GB" — carried as 0.1. ' +
        'Unmeasured.',
    },
    calendar: {
      items: 8_000,
      gb: 0.5,
      provenance: 'Workplan 0088 T2 starting assumption. Unmeasured.',
    },
    tasks: {
      items: 800,
      gb: 0.01,
      provenance:
        'Added 2026-10-04 (the owner, workplan 0152 T7), a judgement: four people’s lists, ' +
        'carried as 0.01 GB like the individual’s. Unmeasured.',
    },
    files: {
      items: 40_000,
      gb: 120,
      provenance: 'Workplan 0088 T2 starting assumption. Unmeasured.',
    },
    photos: {
      items: 60_000,
      gb: 250,
      provenance:
        'Workplan 0088 T2 starting assumption: four photo libraries with shared years. Unmeasured.',
    },
  },
  sme: {
    mail: {
      items: 400_000,
      gb: 160,
      provenance: 'Workplan 0088 T2 starting assumption: ten working mailboxes. Unmeasured.',
    },
    contacts: {
      items: 5_000,
      gb: 0.2,
      provenance: 'Workplan 0088 T2 starting assumption. Unmeasured.',
    },
    calendar: {
      items: 40_000,
      gb: 2,
      provenance: 'Workplan 0088 T2 starting assumption. Unmeasured.',
    },
    tasks: {
      items: 4_000,
      gb: 0.01,
      provenance:
        'Added 2026-10-04 (the owner, workplan 0152 T7), a judgement: ten people’s lists, ' +
        'carried as 0.01 GB like the individual’s. Unmeasured.',
    },
    files: {
      items: 250_000,
      gb: 600,
      provenance: 'Workplan 0088 T2 starting assumption: shared drives dominate. Unmeasured.',
    },
    photos: {
      items: 150_000,
      gb: 600,
      provenance:
        'The plan’s cell says "rare" and gives no number. When an SME ticks photos anyway, ' +
        'ten individual libraries is the least-wrong stand-in (10 × the individual cell) — ' +
        'stated here so the page never presents an invented zero. Unmeasured, doubly.',
    },
  },
};

/**
 * The ADR-0014 unit made arithmetic: one object type, from one account, to
 * one account. An individual ticking mail, contacts, calendar and files is
 * FOUR paths, not one; a family of four ticking the same is sixteen. Tasks
 * are a path of their own, as the app moves and bills them.
 *
 * Deliberately blind to shared mailboxes and shared drives: those are extra
 * accounts, and the page asks about accounts — it must not silently pad the
 * count with a guess about resources nobody named.
 *
 * This is one source that keeps every ticked type. Several sources, and a
 * type a source does not keep, are `calculator.mjs`'s `migrationsFrom`, which
 * the page runs and `calculator.unit.test.ts` holds to this for that case.
 *
 * @param {string} customerTypeId
 * @param {ReadonlyArray<string>} tickedTypes
 * @returns {number}
 */
export function pathsFor(customerTypeId, tickedTypes) {
  const who = CUSTOMER_TYPES.find((c) => c.id === customerTypeId);
  if (!who) throw new Error(`Unknown customer type: ${customerTypeId}`);
  const ticked = tickedTypes.filter((t) => /** @type {readonly string[]} */ (OBJECT_TYPES).includes(t));
  return who.accounts * ticked.length;
}

/**
 * Total indicative GB for a selection — the data-axis half of the tier
 * derivation (`max(paths, data)`, ADR-0014: "you are on the higher of them").
 *
 * @param {string} customerTypeId
 * @param {ReadonlyArray<string>} tickedTypes
 * @returns {number}
 */
export function indicativeGb(customerTypeId, tickedTypes) {
  const profile = INDICATIVE_PROFILES[customerTypeId];
  if (!profile) throw new Error(`Unknown customer type: ${customerTypeId}`);
  let gb = 0;
  for (const t of tickedTypes) {
    const cell = profile[t];
    if (cell) gb += cell.gb;
  }
  return gb;
}
