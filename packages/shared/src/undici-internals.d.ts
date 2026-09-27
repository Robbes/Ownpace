// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the two undici modules `reachable-host.ts` imports by path rather
 * than through the package's index (see the imports there for why). undici
 * ships types for its public API only, and these two ARE its public Agent and
 * buildConnector, so they take those types.
 */

declare module 'undici/lib/dispatcher/agent.js' {
  import type { Agent } from 'undici';
  const AgentClass: typeof Agent;
  export default AgentClass;
}

declare module 'undici/lib/core/connect.js' {
  import type { buildConnector } from 'undici';
  const build: typeof buildConnector;
  export default build;
}
