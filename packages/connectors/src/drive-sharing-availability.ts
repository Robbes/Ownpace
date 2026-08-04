// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * May this deployment read OneDrive/SharePoint sharing? (workplan 0029 T1)
 *
 * The drive scan is written and tested; what it lacks is consent. `Files.Read.All`
 * was **considered and declined** for the reference tenant (owner decision,
 * 2026-08-04): the Application Access Policy that narrows every other scope in
 * `docs/o365-application-access.md` is an Exchange mechanism, so it reaches
 * `Mail.Read` and `Calendars.Read` and does not reach SharePoint at all.
 * `Files.Read.All` has no narrowed variant — it is read over every file in
 * every OneDrive and every site collection, with nothing able to fence it in.
 * That is a large standing grant to buy one section of a handover report.
 *
 * SO THIS IS A FLAG, NOT A DELETION, and both halves of that matter.
 *
 * A flag, because the decision belongs to whoever runs the product. Somebody
 * who has granted the scope — or who scopes their tenant differently — sets
 * `GRAPH_FILES_READ_CONSENTED=true` and gets the section, with no code change
 * and no fork. Deleting the scan would make that a patch.
 *
 * And a flag rather than simply letting the scan run and fail, because the two
 * produce the same shape and opposite meanings. An unconsented scan returns
 * Graph's `403 Insufficient privileges`, which reads as a misconfiguration —
 * and sends an operator to the portal to fix a consent that is missing on
 * purpose. Stating the decision instead costs one request less and one wrong
 * errand fewer.
 *
 * What it must NEVER become is silence. Off means the report carries a stated
 * blind spot naming the scope and the decision; it never means the drive
 * section is absent, and it never means "nothing is shared" (hard rule 9).
 */

export interface DriveSharingEnv {
  readonly GRAPH_FILES_READ_CONSENTED?: string | undefined;
}

export type DriveSharingAvailability =
  /** The scope is consented; the drive scan may run. */
  | { readonly ok: true }
  /** It may not, and this is the sentence the report carries. */
  | { readonly ok: false; readonly reason: string };

/**
 * The refusal, in one place because three doors say it: the managed route, the
 * appliance route, and the runbook that documents both.
 */
export const DRIVE_SHARING_NOT_CONSENTED =
  'OneDrive and SharePoint sharing was NOT inventoried. Reading it needs the ' +
  '`Files.Read.All` application permission, which this deployment has deliberately ' +
  'not been granted: unlike the other scopes, an Exchange Application Access Policy ' +
  'cannot narrow it, so it would grant read over every file in the tenant. Nothing ' +
  'was looked at — this is not a statement that nothing is shared. Capture file and ' +
  'folder sharing by hand before cutover, or grant the scope and set ' +
  'GRAPH_FILES_READ_CONSENTED=true (see docs/o365-application-access.md, ' +
  '"Two scopes, one granted").';

/**
 * Default OFF. A deployment that has said nothing has not consented, and the
 * direction has to fall that way: the failure of guessing "off" is a stated
 * blind spot somebody reads, and the failure of guessing "on" is a tenant-wide
 * file read nobody asked for.
 */
export function driveSharingAvailability(env: DriveSharingEnv): DriveSharingAvailability {
  return env.GRAPH_FILES_READ_CONSENTED === 'true'
    ? { ok: true }
    : { ok: false, reason: DRIVE_SHARING_NOT_CONSENTED };
}
