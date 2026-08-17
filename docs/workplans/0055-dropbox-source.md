# Workplan 0055 — Dropbox as a file source

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the connector | ✅ **Done 2026-08-17** | `connectors/dropbox-file-source.ts` + `dropbox-token-provider.ts`, MODELLED ON THE DRIVE SOURCE and inheriting its written-down decisions: no delta (`list_folder/continue` reports the whole subtree — the same per-folder-cursor mismatch that made `changes.list` wrong; every pass lists, the ledger provides idempotency), `removed` never populated (turning a `deleted` tag into ADR-0024 evidence is its own later decision), the natural key is the DISPLAY path relative to the configured root, `sourceRef` is Dropbox's rename-stable `id` (how `fetch` finds bytes and relocations correlate), `content_hash` as the change signal (compared only against itself, like Drive's md5). Listing never carries bytes; the download endpoint's header-argument protocol is honoured; pagination is followed to the end or refused as partial. The token provider is a third `TokenProvider` implementation (Dropbox's endpoint, Dropbox's `invalid_grant` causes named). 6 connector tests. |
| T2 both ways in | ✅ **Done 2026-08-17** | `orchestration/dropbox-source-factory.ts` — one builder, refusals naming every missing value at once in the edition's vocabulary (`DROPBOX_APP_KEY/…` env on the appliance; the shared trio keys on managed, mapped to Dropbox's own words "App key"/"App secret" by the naming). Appliance: config `type: "dropbox"` (+ optional `rootPath`) parsed by the shared parser, `build-deps` file branch. Managed: migration 0018 widens `connection.kind`; the create API gained the source type (BOTH schema enums — the client response schema too, the 0046 live-bug lesson), the trio refusal naming Dropbox's words and the setup doc, engine-shaped config storage; `build-deps-from-mapping` and the connection probe route through the same file-source builder, so test-connection proves exactly what a pass builds. Wizard: Dropbox card pinning the file domain, App-key field on the source step, the setup box mapping the App Console's words onto the shared fields. EN/NL. 3 factory + 4 create-coherence tests; the feature-matrix drift lock now enforces the `dropbox` mention. |
| T3b tombstones | ✅ **Done 2026-08-17** (follow-up) | `listTrashedPaths()` — one `list_folder` with `include_deleted`, `.tag: "deleted"` entries root-relative. The evidence class is **`trashed`** (a tombstone is a bin state — deleted files stay restorable for the retention window), NOT `reported`; the ordinary listing still never asks for tombstones. 2 tests. |
| T3d shared-folder browse | ✅ **Done 2026-08-17** (follow-up) | `listSharedFolders()` (`sharing/list_folders` + continue, needs the optional `sharing.read` scope; refusal arrives in Dropbox's words). A MOUNTED folder answers the path that goes in `rootPath`; an unmounted one is listed path-less (mountable only in Dropbox). Probe fn, `POST /api/migrations/dropbox/shared-folders` (+OpenAPI), wizard rootPath field + one-click browse (mounted selectable, unmounted disabled), `scripts/list-dropbox-shared-folders.ts`, setup-doc scope note. EN/NL. |
| T3 not done, honestly | ⛔ | (a) Real-endpoint proof — ⏳ in the matrix; the consent flow in `docs/dropbox-setup.md` is documented Dropbox behaviour, unproven here. (c) Team folders/namespaces (Dropbox Business namespace headers) — untouched; a Business team migration may need `Dropbox-API-Select-User`, its own slice. |

## What this is

The third file provider, and deliberately the cheapest kind of addition: every decision was
already made and written down by the Drive source, so this connector's job was to NOT
invent — same no-delta stance, same absent `removed`, same path-relative natural keys, same
never-carry-bytes listing. What is genuinely Dropbox's: the RPC-over-POST protocol, the
header-argument download endpoint, `content_hash`, and an App Console that names the
client credentials differently than the wire does — the naming maps the words so refusals
speak App Console, not RFC.
