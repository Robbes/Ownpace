# WebDAV Sync Integration Guide

> ⚠️ **SUPERSEDED (2026-07-27) — merged into [`dav-sync.md`](./dav-sync.md).**
>
> The CalDAV, CardDAV and WebDAV guides were ~85 % identical boilerplate, and all three
> documented a `GenericSyncEngine` API that was **removed in PR #38** (workplan 0007) — their
> code samples no longer compiled against the tree. They are now one guide covering the shared
> design plus the per-domain differences.
>
> **WebDAV (files) lives in [`dav-sync.md`](./dav-sync.md).** That includes how a large file
> reaches the target: above 64 MiB on Nextcloud, its chunked upload (`MKCOL`, numbered `PUT`s,
> one `MOVE`), and one `PUT` otherwise — see *Files — large files* there (workplan 0156).
