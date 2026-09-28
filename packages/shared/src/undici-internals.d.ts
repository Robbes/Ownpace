// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the three undici modules `reachable-host.ts` imports by path rather
 * than through the package's index (see the imports there for why). undici
 * ships types for its public API only. The first two ARE its public Agent and
 * buildConnector, so they take those types. The third, the adapter undici 8
 * puts in front of older callers, is a Dispatcher around a Dispatcher.
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

declare module 'undici/lib/dispatcher/dispatcher1-wrapper.js' {
  import type { Dispatcher } from 'undici';
  const Dispatcher1Wrapper: new (dispatcher: Dispatcher) => Dispatcher;
  export default Dispatcher1Wrapper;
}
