// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Did the consent runbook actually work? (workplan 0027 T0, the proof half)
 *
 * `docs/o365-application-access.md` ends with a PowerShell test that proves the
 * Application Access Policy allows one mailbox and denies another. That proves
 * the POLICY. It does not prove that THIS PRODUCT can read anything — the
 * client secret could be wrong, the consent could be granted on a different app
 * registration, a permission could have been added and never consented, and
 * every one of those looks identical from PowerShell.
 *
 * Without this, the first evidence either way is a scheduled detector at 06:30
 * the next morning, in a log, per tenant. That is a bad feedback loop for a
 * fifteen-minute setup task with six places to go wrong.
 *
 * SO: one probe per capability, each making the SMALLEST request that proves
 * the permission — `$top=1` everywhere, no paging, nothing written. What it
 * reports is per capability and not a single verdict, because the permissions
 * are consented individually and fail individually: `Group.Read.All` can work
 * while `Mail.Read` is blocked by the access policy, and "it doesn't work"
 * would send somebody to re-run the whole runbook instead of the one step.
 *
 * A FAILURE IS NOT A DIAGNOSIS, and this deliberately does not pretend
 * otherwise. It reports the capability, the status, Graph's own words, and —
 * where the status is one whose meaning is genuinely ambiguous — what the two
 * possibilities are. A 403 on `/users` most often means consent was granted but
 * the Application Access Policy excludes this app, and it can also mean the
 * permission was added and never consented; guessing between them is how an
 * operator ends up re-doing the step that was already right.
 */

import type { HttpClient } from './dav-http.types';

/** What one permission's smallest possible proof came back with. */
export interface AccessProbe {
  /** The capability in the operator's terms, not the endpoint's. */
  readonly capability: string;
  /** The Graph application permission this proves. */
  readonly permission: string;
  readonly ok: boolean;
  /** Graph's own words on failure, or what was read on success. */
  readonly detail: string;
  /** Where the ambiguity is, when the status has more than one meaning. */
  readonly ambiguity?: string;
}

export interface AccessCheckResult {
  readonly probes: readonly AccessProbe[];
  /** True only when every probe passed. Never used to hide a failing one. */
  readonly allOk: boolean;
}

/** The mailbox to probe with, when the caller names one. */
export interface AccessCheckOptions {
  /**
   * A mailbox INSIDE the access policy's group. Omit and the mailbox-scoped
   * probes are skipped with that stated — skipping is not passing.
   */
  readonly mailbox?: string;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * The four consented permissions, each with the smallest request that needs it.
 *
 * `$top=1` rather than a full listing: this asks *may I*, not *what is there*,
 * and a probe that pulled a tenant's whole directory to answer that would be a
 * surprising thing for a setup command to do.
 */
function endpoints(mailbox: string | undefined): ReadonlyArray<{
  capability: string;
  permission: string;
  url: string | undefined;
  ambiguity?: string;
}> {
  const box = mailbox ? encodeURIComponent(mailbox) : undefined;
  return [
    {
      capability: 'List the tenant’s mailboxes',
      permission: 'User.Read.All',
      url: `${GRAPH}/users?$top=1&$select=id`,
      ambiguity:
        'a 403 here is usually the Application Access Policy excluding this app, ' +
        'and can also be a permission added but never consented (runbook step 3)',
    },
    {
      capability: 'List mail-enabled groups',
      permission: 'Group.Read.All',
      url: `${GRAPH}/groups?$top=1&$select=id`,
    },
    {
      capability: 'Read a shared mailbox’s mail',
      permission: 'Mail.Read',
      url: box ? `${GRAPH}/users/${box}/messages?$top=1&$select=id` : undefined,
      ambiguity:
        'a 404 here means the address is not a mailbox this tenant knows, ' +
        'which is a different problem from a permission',
    },
    {
      capability: 'Read a mailbox’s calendar sharing',
      permission: 'Calendars.Read',
      url: box ? `${GRAPH}/users/${box}/calendars?$top=1&$select=id` : undefined,
    },
  ];
}

/**
 * Probe every consented capability once. Never throws, never writes.
 *
 * @param getToken an APPLICATION token — the delegated flow cannot answer any
 *   of these, and a caller on delegated credentials should be refused by
 *   `directoryAvailability` before reaching here.
 */
export async function checkGraphAccess(
  getToken: () => Promise<string>,
  http: HttpClient,
  options: AccessCheckOptions = {},
): Promise<AccessCheckResult> {
  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    // The token endpoint failing is its own finding, and a common one: a
    // rotated or mistyped client secret fails HERE, before any permission is
    // consulted, and reporting it as four failed permissions would send
    // somebody to the portal to check consent that is perfectly fine.
    const said = err instanceof Error ? err.message : String(err);
    return {
      allOk: false,
      probes: [
        {
          capability: 'Obtain an application token',
          permission: 'OAUTH2_CLIENT_ID + OAUTH2_CLIENT_SECRET',
          ok: false,
          detail: said,
          ambiguity:
            'no permission was tested — this failed before Graph was asked anything. ' +
            'Check the client id, the secret and the tenant id first.',
        },
      ],
    };
  }

  const probes: AccessProbe[] = [];
  for (const e of endpoints(options.mailbox)) {
    if (!e.url) {
      // Skipped is reported as NOT ok. A capability nobody tested must never
      // read as one that passed (hard rule 9) — this is the line where a
      // "0 failures" summary would otherwise become a lie.
      probes.push({
        capability: e.capability,
        permission: e.permission,
        ok: false,
        detail:
          'not tested: this probe needs a mailbox to ask about. Re-run with ' +
          '--mailbox <an address inside the access policy’s group>.',
      });
      continue;
    }
    probes.push(await probe(e.capability, e.permission, e.url, token, http, e.ambiguity));
  }

  return { probes, allOk: probes.every((p) => p.ok) };
}

async function probe(
  capability: string,
  permission: string,
  url: string,
  token: string,
  http: HttpClient,
  ambiguity: string | undefined,
): Promise<AccessProbe> {
  try {
    const res = await http.request({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status >= 200 && res.status < 300) {
      return { capability, permission, ok: true, detail: `Graph answered ${res.status}` };
    }
    return {
      capability,
      permission,
      ok: false,
      // Graph's own body verbatim, truncated only so a console stays readable.
      // It carries the error code an operator can search for; a summarised
      // version of it would carry nothing.
      detail: `Graph answered ${res.status}: ${res.body.slice(0, 400)}`,
      ...(ambiguity ? { ambiguity } : {}),
    };
  } catch (err) {
    // A transport failure is not a permission failure, and saying so keeps
    // somebody from re-running a consent step over a proxy or a DNS problem.
    return {
      capability,
      permission,
      ok: false,
      detail: `the request could not be made: ${err instanceof Error ? err.message : String(err)}`,
      ambiguity: 'nothing was learned about this permission — the request never reached Graph',
    };
  }
}

/** The probe results as console lines. Pure: no clock, no colour, no I/O. */
export function renderAccessCheck(result: AccessCheckResult): string {
  const lines: string[] = [];
  for (const p of result.probes) {
    lines.push(`${p.ok ? 'OK  ' : 'FAIL'}  ${p.capability}  (${p.permission})`);
    lines.push(`        ${p.detail}`);
    if (p.ambiguity) lines.push(`        note: ${p.ambiguity}`);
  }
  lines.push('');
  lines.push(
    result.allOk
      ? 'Every consented capability answered. Discovery, drift detection and the ' +
          'permission report will produce real findings on their next run.'
      : 'At least one capability did not answer. Until it does, the features that ' +
          'need it report that they could not look — see docs/o365-application-access.md.',
  );
  return lines.join('\n');
}
