// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one in-flight-consent store, shared by both beginnings (workplan 0108 T4).
 *
 * A consent has two halves in different files — it BEGINS in the owner's wizard
 * (`google-oauth-routes.ts`) or on a migrator's link (`grant-routes.ts`), and
 * it ENDS at the single callback address Google is told to redirect to. The
 * state that ties the halves together lives in process memory, so both
 * beginnings and the one ending must hold the same object: a second store would
 * mean every consent begun on one side and answered on the other simply failed
 * to be found — as an unsigned, unexpired, unrevoked "this is not a consent we
 * are waiting for", which is the hardest kind of bug to read.
 *
 * It is a module-level singleton because that is what "process memory" means
 * here. The consequence is deliberate and documented in `ConsentFlowStore`
 * itself: a restart loses every consent in flight, and the person is asked to
 * press the button again. Ten minutes of state is not worth a table.
 */

import { ConsentFlowStore } from './google-consent.ts';

export const consentFlows = new ConsentFlowStore();
