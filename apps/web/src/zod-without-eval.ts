// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ZOD WITHOUT EVAL (workplan 0158).
 *
 * The app is served under a policy that runs no evaluated code
 * (`script-src 'self'`, `apps/web/nginx.conf.template`). Zod 4 builds a faster
 * parser for an object schema with `new Function`, and asks first whether it
 * may: the first `z.object()` tries one and catches the refusal. The page
 * works either way, but a policy reports that try as a violation, so every
 * page load reported one, from the chunk zod ships in. Its own comment says
 * what this does: "Skip the probe under `jitless`: strict CSPs report the
 * caught `new Function` as a `securitypolicyviolation`".
 *
 * So `jitless` is set here, and this module is the entry's first import: the
 * answer is read once, when the first object schema is made, and the services
 * make theirs as they load. A schema made at the top of a module the bundler
 * puts in a chunk that runs before the entry's own code would be made before
 * this line runs. `test/ui/managed-ui.ui.test.ts` serves the built app under
 * the policy and fails on any violation, which is how that would show.
 *
 * Both editions build from this entry; on the appliance, which sends no
 * policy, it only means the same parser without the generated code.
 */
import { config } from 'zod';

config({ jitless: true });
