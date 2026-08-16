# Workplan 0046 — "Prove it" in the wizard

## Status — 2026-08-16 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the probe, on the shapes create would store | ✅ **Done 2026-08-16** | `probe-connection.ts` (orchestration): sources built by the SAME builders a sync pass uses — the Google factories, the managed mail builder, `buildFileSourceFromConnection` — on the config blob and credential record the create route would store (`sourceConnectionConfig` + `sourceCredentialRecord`, factored for exactly this), asked the one read-only question every source answers (`listFolders`). Targets: DAV via the SOURCE connectors' PROPFIND (same `davEndpointFromCreds` URL resolution as the real target builders), IMAP via LIST, JMAP via its session document. A provider refusal is an ANSWER (`{ok:false, reason}`), verbatim (rule 9). 7 unit tests, including "an unknown kind is a wiring gap said honestly — never a vacuous pass". |
| T2 the route and the button | ✅ **Done 2026-08-16** | `POST /api/migrations/test-connection` (one side per call; documented in `openapi.yaml` — the drift lock demanded it). The wizard's credentials step gains a **Test connections** button probing both sides in parallel and rendering each outcome verbatim. Optional by design: Next never gates on it — a probe can time out on a slow provider, and the create API re-refuses everything anyway. |
| T3 the appliance | 📝 **Deliberately not built, stated** | The appliance's create path is a config file, and its "prove it" is the runbook's CLI probes (Stage 1's Drive script; a pass's own first listing). A probe API there would duplicate the managed route against no wizard. If the appliance grows a config-editing UI, this module is the seam it calls. |

## What this is

Every setup doc ends with "one read-only command that proves the credentials before anything
migrates" — and a managed operator has no shell to run it in. The wizard collected six steps
of credentials and the first evidence they worked arrived as a failed pass, hours later, in
a run log. This workplan moves that evidence to the moment of typing.

## The one decision

**The probe runs on the shapes create would store, interpreted by the builders a pass uses.**
Not a parallel "check" implementation — that would be a second interpretation of the same
credentials, and "test passed, create, first pass fails" would become possible by
construction. The create route's config-blob and credential-record shapers were factored so
the probe and the store cannot drift.
