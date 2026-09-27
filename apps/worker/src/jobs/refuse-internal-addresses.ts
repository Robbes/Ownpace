// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE RULE, ON IN EVERY TASK RUN (workplan 0136 T1 (a), T2).
 *
 * A pass connects to the hosts a tenant typed: its IMAP and DAV sources and
 * targets, its JMAP server. On managed, a host inside this service's own
 * network is refused (`@openmig/shared/reachable-host`), but for the names the
 * operator's OWNPACE_REACHABLE_HOSTS admits: the demo targets on the gate's
 * stack, by compose name. The API switches the rule on at its own start-up;
 * this is the task runtime's half.
 *
 * This repository gives the tasks no start-up hook. Trigger.dev can load an
 * `init.ts` from the tasks' directory, but its own build decides that, and
 * nothing here could prove the file was loaded: a rule that silently stayed
 * off would look exactly like one that is on. So every task module imports
 * this, and `scripts/a-rule-nothing-switched-on.unit.test.ts` holds that each
 * one does. The clients read the rule when they connect, so the rule is on
 * before any pass builds one. A list it cannot read throws as the module loads, naming
 * the entry, and the run fails before it reaches anything. The appliance never
 * loads these modules: its passes run in its own process, with the rule off.
 */

import { log } from '@openmig/shared';
import { refuseInternalAddressesFromEnv, refusesInternalAddresses } from '@openmig/shared/reachable-host';

if (!refusesInternalAddresses()) {
  const { admitted } = refuseInternalAddressesFromEnv({
    OWNPACE_REACHABLE_HOSTS: process.env.OWNPACE_REACHABLE_HOSTS,
  });
  log.info(
    `[tasks] refusing hosts inside this service's network; admitted by name: ${admitted.join(', ') || 'none'}`,
  );
}
