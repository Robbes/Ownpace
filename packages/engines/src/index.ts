// Copyright 2026 The Ownpace authors (Apache-2.0)
export const packageName = '@openmig/engines';

// NOTE ON WHAT IS NOT HERE.
//
// This package used to also export four "sync engines": `runImapsyncBulk`
// (shelling out to imapsync), `runCalDAVSync` and `runCardDAVSync`
// (vdirsyncer), and `runWebDAVSync` (rclone). All four were deleted rather
// than kept, because NOTHING IMPORTED ANY OF THEM. The migration path is
// `runShadowPass` -> `runDomainSync` (@openmig/core) over the connectors and
// the target writers below, which is pure JavaScript end to end.
//
// They were removed rather than left lying about because they were not merely
// unused, they were MISLEADING: their presence said this product needs
// imapsync, vdirsyncer and rclone installed to migrate anything, which is the
// first question anyone asks when packaging it (ADR-0019) and the answer was
// wrong. An operator reading the source, or an agent planning a Windows build,
// would have concluded a Perl runtime and two Python tools had to ship
// alongside. Git keeps them if the approach is ever wanted back.

// Target writers
export {
  CalDAVTargetWriter,
  type CalDAVTargetConfig,
} from './caldav-target-writer.ts';

export {
  CardDAVTargetWriter,
  type CardDAVTargetConfig,
} from './carddav-target-writer.ts';

export {
  WebDAVTargetWriter,
  type WebDAVTargetConfig,
} from './webdav-target-writer.ts';
