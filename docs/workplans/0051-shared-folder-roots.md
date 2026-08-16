# Workplan 0051 — shared folders as migration roots

## Status — 2026-08-16 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the enumeration | ✅ **Done 2026-08-16** | `GoogleDriveSource.listSharedWithMeFolders()`: `files.list` over the shared-with-me view, folders only, `trashed=false`, paged, owner address riding along. Unit test pins the query (view, mime, untrashed, `owners(emailAddress)`) and that the browse stays one listing, never a crawl. |
| T2 both editions ask it | ✅ **Done 2026-08-16** | Managed: `listGoogleSharedFolders` (probe module) behind `POST /api/migrations/google-drive/shared-folders` (OpenAPI documented — drift lock); the wizard's browse button now fetches drives AND shared folders in one click, rendering them as two option groups, sharer's address disambiguating same-named shares. Appliance: `scripts/list-shared-folders.ts`, same factory, same env names. |
| T3 the docs say the mechanism | ✅ **Done 2026-08-16** | `google-workspace-setup.md` explains why "Shared with me" cannot be walked and that rooting a separate mapping at the folder's id is the supported move; `docs/feature-matrix.md` upgrades the shared-content row (shared folders ✅ by root, loose shared files stay ⛔, shortcuts stay loud refusals). |

## What this is

The feature matrix (PR #417) said it plainly: Drive content **shared with** an account did
not migrate, because "Shared with me" is a view, not a folder — its items carry no parent
under any root a mapping starts from, so the parent-scoped walk can never reach them.

The fix is NOT to crawl the view. It is to say out loud what the engine already supports:
**a folder id is a folder id.** The pass's listing is parent-scoped from `rootFolderId` and
already guarded with the all-drives parameters (the factory test pins `'folder-42' in
parents`); rooting a separate mapping at a shared folder's id migrates that folder with
every behaviour files already have — hashes, conflicts, relocations, evidence. What was
missing was the *onboarding answer*: which id? This workplan answers it the way 0049
answered it for shared drives — one read-only enumeration, surfaced in the wizard and as an
appliance script.

## The one decision

**One mapping per root, and the browse never becomes the pass.** A shared folder is
somebody else's data arriving in this account's target — a scoping decision an owner makes
per folder, usually with a `targetFolderPrefix`, never a bulk import the machine infers.
So the enumeration is read-only, is never called by a pass, and the id it surfaces lands in
the same written-down `rootFolderId` every other root uses.

**Loose shared files stay out.** A file shared without a folder around it has no root to
name. Enumerating those means importing the view itself — a different feature with
different ownership questions (whose bin? whose evidence?), and the matrix keeps it an
honest ⛔ rather than half-shipping it here.
