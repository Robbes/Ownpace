# Workplan 0158 — What a browser may do with the app

> **In one line:** The managed app tells the browser which scripts may run in it, where it may send, that no page may frame it, that it is reached over HTTPS only, and that no request carries its address as a Referer; and the sign-in moves out of the browser's storage.

## Status — 2026-10-05 (update this block at the end of every session)

**2026-10-05: opened, and T1 built.** The public-readiness audit (item 10, finding
`sec-spa-no-csp-token-in-localstorage`) found that the web image's nginx served the app with no
Content-Security-Policy, no Strict-Transport-Security, nothing against framing, no `nosniff` and
no Referrer-Policy. The API sent all of them on its own answers, through helmet, and the public
site has had a strict policy since 2026-08-20. The app, which keeps its sign-in in the browser's
storage, had none. The audit's fix: *"CSP, HSTS at the proxy, Referrer-Policy: no-referrer on
/grant and /view"*.

T1 adds a policy and four headers to `apps/web/nginx.conf.template`, in each location that
serves the app, and none to `/api/` (D1 to D6). Zod's probe for `eval` is switched off at the
app's entry, so the built app runs under the policy with no violation (D7). The image takes the
sign-in host for the policy from the argument the bundle is built with (D8), and refuses an API
anywhere but a path of the app's origin (D10). Moving the sign-in out of `localStorage` is T2,
proposed and not built here. The appliance's screens send no policy yet (T3).

**Evidence.** Guards first, red on the unchanged tree:
`scripts/what-a-browser-may-do-with-the-app.unit.test.ts` 27 failed, 28 passed (55), with nginx
1.24 on the machine; `test/ui/managed-ui.ui.test.ts` 1 failed, 28 passed (29), because no policy
was served. With the policy and without D7, the UI suite failed 22 of 29, and every violation was
zod's probe (`script-src eval` in the chunk zod ships in, 77 times). With D7: 55 of 55 and 29 of
29. Mutations of the template and the Dockerfile, each alone: 40 of 40 turned the guard red (each
of the ten header lines dropped, each `always` dropped, a policy or HSTS added on `/api/` or at
the server's level, seven looser policies, four other header values, an opener policy added, the
variable renamed, the issuer's `ENV` removed or cut from its argument, the image's check of the
issuer's path removed or narrowed). The smoke's new check, run against nginx here, passed on the
new template and went red on the old one, on a policy added at the server's level, and on another
issuer than the image's. The built app, with the managed build arguments and a stub sign-in host,
served through the rendered template by nginx and opened in Chromium: 17 loads of the app's page
and one at the issuer, 0 violations. They were the sign-in, request, grant, view and guide pages
and an unknown address without a session; a sign-in through the issuer; six signed-in screens; a
problem report sent with a screenshot; and a completion report downloaded from a `blob:` address.
The same run without the issuer in the policy stopped at the discovery document, with a
`connect-src` violation and *Failed to fetch*.

**2026-10-05, after review.** The review of T1 found these, each checked again here first:

- The policy did not say `worker-src`. A worker falls back to `script-src`, not to
  `default-src`, so a script of the app's own origin could run as one. Checked in Chromium: a
  worker from `/assets/` ran, and a `blob:` worker was refused. The policy now says
  `worker-src 'none'` (D1).
- A bundle built with an absolute `VITE_API_URL` could not reach its API under the policy, and
  `managed.env.example` still offered that. The image now refuses it (D10).
- An issuer whose token endpoint is on another host builds, then fails every sign-in, and an
  issuer with a path, Keycloak's among them, is refused. ADR-0042 said switching is four
  variables and a rebuild. It now says when that holds (D8, ADR-0042's amendment of this date).
- A script that runs can leave with the token over WebRTC: a peer connection to a host it names
  sent STUN packets where `fetch` to that host was refused. No policy governs it (§T2).
- Gaps in the guard: a sixth header on the app's pages passed it, and an `if` block, an
  `error_page` or a `proxy_hide_header` passed its reading and was caught only where nginx runs.
  It now fails on each without nginx.
- Words: a test name gave the wrong reason for leaving off `upgrade-insecure-requests`; D1 said
  five forms where there are 13; the plan dated the site's policy 2026-08-26, the day its
  calculator's script was added, where the policy reached main on 2026-08-20; 0108's known gap
  had no note that the Referer no longer carries the link.

**Evidence after review.** The guard, with the new checks, on the template and Dockerfile
of T1: 25 failed, 35 passed (60). After: 60 of 60. Mutations, each alone: 14 of 14 turned it red.
A sixth header in `location /` (two kinds) failed 13 tests of the reading, one in
`version.json` failed 1. An `if` block, an `error_page`, and `proxy_hide_header` for the policy,
HSTS or the opener policy each failed the reading. `worker-src` dropped or set to `'self'`, and
`upgrade-insecure-requests` added, failed 24 each. The API-address check removed, or letting
`//host` or `http…` through, failed 1 each. The same gap mutations on T1's own template, read by
T1's own guard, passed its reading with 0 failures. `test/ui/managed-ui.ui.test.ts`: 29 of 29 under
the new policy. The browser run, rebuilt and repeated: 17 loads of the app's page and one at the
issuer, 0 violations, and a worker started by hand afterwards was refused with `worker-src`.

| Task | Status | Notes |
|---|---|---|
| T1 The headers on the app | ✅ **Built 2026-10-05** | D1 to D10. The policy and four headers on every page, asset and `version.json`; none added to `/api/`; zod without `eval`; the issuer from the build argument; the API at a path of the app's origin. Guarded by the template's reading, a run on the real nginx, the UI suite under the policy, and the smoke's check through the image. |
| T2 The sign-in out of the browser's storage | 📋 **Proposed: later, a pull request of its own** | §T2. A cookie no script can read, set by the API at sign-in, with a defence against cross-site requests. Until then the policy narrows what an injected script could do with the token (§*What the policy does for the token meanwhile*). |
| T3 The appliance's screens under a policy | 📋 **Proposed** | The appliance serves the same bundle from Node (`apps/selfhost/src/static-ui.ts`), with `content-type` and `cache-control` only, and its API has no helmet. The same policy fits it, without the sign-in host; it needs its own guard and its own run. Not built here, so this plan stays about the managed image. |
| T4 The headers seen through NetBird on live | 📋 **Proposed** | The smoke reads them from the image on the stack the gate runs on, over plain http on loopback. Nothing yet reads them at live's https address, through NetBird's proxy. `deploy-live.sh` already asks `/version.json` there and throws the headers away; reading them would prove NetBird passes them on and HSTS arrives over TLS. |

## The decisions

**D1. The policy is the tightest the built app passes.**

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src data:;
connect-src 'self' <the issuer>; worker-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

Each part is what the built bundle needs, read from it and then run under it:

- `default-src 'none'`: the bundle loads no font, frame, media, object or manifest. The
  built CSS has no `url(`, no `@font-face` and no `@import`.
- `script-src 'self'`: `index.html` has no inline script, only one module script and its
  module preloads, all at the same origin. The lazy screens are chunks at the same origin.
  Nothing in `apps/web/src` uses `eval`, `new Function` or `dangerouslySetInnerHTML`; zod did,
  as a probe (D7).
- `style-src 'self'`: one stylesheet at the same origin, and no `<style>` element. React's
  `style` props set properties through the CSSOM, which the policy does not govern.
- `img-src data:`: the favicon, inline in `index.html`. The app shows no other image. The
  problem report's screenshot is read with `FileReader` and sent inside the JSON, never shown.
- `connect-src 'self' <the issuer>`: the API is at the same origin (`VITE_API_URL=/api`). Sign-in
  fetches the issuer's discovery document and posts to its token endpoint
  (`apps/web/src/services/oidc.ts`). Every other way out of the app is a navigation: the
  authorize and end-session pages, the providers' consent, Mollie's checkout. A policy does not
  govern those.
- `worker-src 'none'`: the bundle starts no worker. Said on its own because a worker does not
  fall back to `default-src`: it falls back to `script-src`. Without it, a worker from the app's
  own origin ran (checked in Chromium); with it, the browser refused one.
- `base-uri 'none'`, `form-action 'none'`: no `<base>`, and every form the app has (13 today, in
  11 files) is sent by script after `preventDefault`.
- `frame-ancestors 'none'`: nothing frames the app.

**D2. HSTS: one year, `includeSubDomains`, no `preload`.** `max-age=31536000; includeSubDomains`
is the value helmet sends on every `/api/` answer on the same host, and every page called
`/api/` on load. So any browser that opened the app already held it for a year. The page says the
same, so the page and its API calls do not reset each other. `includeSubDomains` on `app.…`
covers names below it, and there are none. `preload` is left off: the list takes only the
apex, `ownpace.eu`, and would force HTTPS on every name under it, the test stack's included. That
is a decision about the apex, for the owner. A browser ignores HSTS sent over plain http, so the
loopback address the smoke and the gate use stays reachable. The audit said *"HSTS at the
proxy"*: NetBird's reverse proxy has no setting that adds a response header, so the place in this
repository is the app's nginx.

**D3. `Referrer-Policy: no-referrer`, on every page, not on `/grant` and `/view` alone.** The
grant and view pages' address carries the link, a credential, and every call they made to
`/api/` sent that address as its Referer. Checked in Chromium: a page at
`/grant/<link>?from=mail` without the header sent that whole address as the Referer of its
`GET /api/version` and of its POST; with the header, neither did, and the POST still sent
`Origin`. The two access logs redact the Referer (0108); the web image's nginx error log does not
(0108's known gap), and for `GET /api/version` the Referer was the only copy of the link. On every page, because a single-page app keeps the
policy its first page loaded with, and because a header on `/grant` alone needed a location of
its own whose fallback to `index.html` loses it (checked on nginx 1.24), for an address the
router opens in any case and with escapes. helmet already sends `no-referrer` on `/api/`.
Nothing reads the Referer: not the API (only the access log), not the identity provider's
flow, not the site, not the status page.

0122 considered `no-referrer` on the consent callback and declined it, as *"a header with no leak
behind it"*. The callback page already had it, through helmet (0122 now says so). The app's
pages are the other case: a leak is behind it.

**D4. `frame-ancestors 'none'` and `X-Frame-Options: DENY`.** The first is the policy's; the
second says the same to a browser older than it. Nothing in this repository frames the app.

**D5. `X-Content-Type-Options: nosniff`.** A file is the type nginx serves it as.

**D6. In each location that serves the app; never at the server's level, never on `/api/`.**
nginx inherits `add_header` only into a level that sets none of its own. `location =
/version.json` sets its own `Cache-Control`, so a header at the server's level never reached it,
and `location /api/` sets none, so it would have inherited every one. The API's consent callback
pages replace helmet's policy with one that allows their inline script by hash, and keep their
opener (`callbackPageHeaders`). A second policy from nginx would be enforced beside theirs, and
their script would not run: the defect of 2026-09-02 again. So the policy is named once at the
server's level as `$ownpace_csp`, and `location /` and `location = /version.json` each state it
with the four others, as the public site's file does. Each has `always`, so nginx's own 404 and
301 carry them too.

**D7. Zod without `eval`, at the app's entry.** Zod 4 asks once, at the first object schema,
whether it may build a parser with `new Function`. Under the policy that try is refused, zod
falls back to its plain parser, and the browser reports a `securitypolicyviolation`. So every
page load reported one. Chromium logs nothing to the console for it; only the event shows it.
`apps/web/src/zod-without-eval.ts` sets zod's `jitless`, whose own comment says it exists for
this, and is the entry's first import. Loosening the policy with `'unsafe-eval'` would have let
any injected string run.

**D8. The issuer in the policy is the one the bundle was built with.** The image's runtime stage
declares `VITE_OIDC_ISSUER` again and hands it to the template step as `ENV`, so the bundle and
the policy name one host. A policy source with a path matches that one path, so an issuer with a
path is refused when the image is built: sign-in could not fetch its discovery document.
`setup-zitadel.sh` writes `scheme://host[:port]`. Empty, on a stack without sign-in, the policy
connects to `'self'` alone.

So on managed the issuer has two limits, and ADR-0042 says both (amended 2026-10-05). It is
`scheme://host[:port]`, with no path. And the token endpoint it names in its discovery document
is on that same origin, because the page posts to it and the policy names the issuer alone. An
issuer with the token endpoint on another host builds, then fails every sign-in at the callback
with *Failed to fetch*. Zitadel, the issuer in use, meets both. Keycloak, ADR-0042's named
fallback, has a path (`/realms/<name>`); switching to it means the policy names the issuer's
origin rather than the issuer, a change to the template and the image.

**D9. Left off, each for a reason.**

- `upgrade-insecure-requests`: behind NetBird's TLS it changes nothing. On an address served over
  plain http that is not loopback, it sent the app's own scripts to https, and the page never
  loaded (checked in Chromium).
- `Cross-Origin-Opener-Policy`: the consent window hands its result back to the page that opened
  it (`apps/web/src/services/consent-window.ts`). With `same-origin` the opener was gone.
- `Cross-Origin-Embedder-Policy`: the app needs nothing it would give.
- `Permissions-Policy`: the policy already decides which script runs, and the app opens no
  frame. If one is added, it keeps `clipboard-read` and `clipboard-write` for the app itself:
  the problem report reads a pasted screenshot, and the links panel copies a link.
- Trusted Types (`require-trusted-types-for 'script'`): the app passed the UI suite under it in a
  scratch run. Where the policy above refuses and reports, it makes the page's own code throw,
  so it is a step of its own, if wanted, with its own run.
- A report endpoint (`report-to`): nothing receives reports today. The UI suite is the gate.

**D10. The API is at a path of the app's origin.** The policy connects to `'self'` and the
issuer. A bundle built with an absolute `VITE_API_URL` called an API the policy refuses: the
sign-in page asked the API which sign-in it accepts, was refused, and offered nothing. So the
build stage of `apps/web/Dockerfile` refuses a `VITE_API_URL` that is not a path (`//host` is
not one). The default, `/api`, is what every stack uses, and the image's nginx proxies it. An
absolute address stays possible for `pnpm dev`, which sends no policy.

## The facts this plan stands on

Read from the code on 2026-10-05 (main at `5e2e32eb`).

- **The app's front is one nginx**, `apps/web/nginx.conf.template`, rendered by the nginx image's
  `envsubst` step with the variables the image defines (`apps/web/Dockerfile`). Its locations:
  `/api/` (proxied to the API), `= /version.json` (its own `Cache-Control`), and `/` (every other
  address, `index.html` as the fallback). Both stacks run this image (`deploy/compose/managed.yml`),
  behind NetBird's proxy, which ends TLS.
- **The API sends its own headers**: `app.use(helmet())` in `apps/api/src/index.ts`, helmet 8.3's
  defaults: a policy, `Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy: no-referrer`,
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `nosniff` and
  `X-Frame-Options: SAMEORIGIN`. The consent callback pages replace the policy and the opener
  policy (`apps/api/src/routes/migrations/google-consent.ts`, `callbackPageHeaders`).
- **The public site's nginx** (`deploy/compose/www-nginx.conf`) states its policy per location,
  for the reason D6 gives.
- **The sign-in token** is the identity provider's ID token, kept in `localStorage` as
  `auth_token` and in the `auth-storage` store (`apps/web/src/stores/auth-store.ts`). It is read by
  `services/api.ts`, `services/operating-service.ts` and `services/unreadable-answer.ts`.
- **What leaves the page**, from the built bundle: `fetch` and XHR to `/api`, `version.json`, and
  the issuer's discovery and token endpoints; top-level navigations to the issuer, the providers'
  consent and Mollie; one consent popup; five `blob:` downloads; the clipboard. No worker, no
  socket, no beacon, no peer connection, no frame.

## T1 — the headers on the app (built)

What changed:

- `apps/web/nginx.conf.template`: `set $ownpace_csp` at the server's level; the policy and the
  four headers in `location /` and `location = /version.json`, with `always`; a comment in
  `location /api/` saying why it adds none.
- `apps/web/Dockerfile`: the runtime stage takes `VITE_OIDC_ISSUER`, refuses one with a path,
  and hands it to the template. The build stage refuses a `VITE_API_URL` that is not a path
  (D10).
- `apps/web/src/zod-without-eval.ts`, imported first by `apps/web/src/index.tsx`.
- `scripts/nginx-config.ts`: the nginx parser and location choice of
  `a-screenshot-the-front-door-lets-through`, moved out of that test unchanged, with the image's
  `envsubst` and the headers nginx adds for an address.

How it is held:

- `scripts/what-a-browser-may-do-with-the-app.unit.test.ts` reads the template as nginx reads it:
  every address the app is opened at carries the five, word for word, with `always`, and no
  other; `/api/` and the server's level carry none, and nginx hides none of the API's; HSTS and
  the Referrer-Policy are helmet's; every `${NAME}` is defined in the image, and the image
  refuses an issuer with a path and an API address that is not a path. The template has no `if`
  and no `error_page`, which the reading does not see, so a machine without nginx still fails on
  them. Where the machine has nginx (the hosted runners do), it renders the
  template, runs it in front of helmet, and reads the headers off the wire, the 404 and the 301
  included. That run found one thing the reading missed: `/api` without its slash is nginx's 301
  from the API's location, with none of the five.
- `test/ui/managed-ui.ui.test.ts` serves the built app with the headers the template gives each
  file, listens for `securitypolicyviolation` on every page, and fails on one. It opens the
  sign-in page, the request page, a grant link, a view link and a guide without a session, and
  every signed-in screen it already opened.
- `deploy/compose/smoke-managed.sh` asks the image itself, on the stack the gate runs on: one
  policy on each page, naming the stack's issuer, the four beside it, and one policy on
  `/api/health`.

## T2 — the sign-in out of the browser's storage (proposed)

Move the sign-in into a cookie no script can read: `HttpOnly`, `Secure`, `SameSite`, host-only
with the `__Host-` prefix, as 0091 asks of any cookie. The API would set it at sign-in, and the
app would stop writing `auth_token` and `auth-storage`. A cookie goes with every request by
itself, so every request that changes something needs a defence against another site sending it
(`SameSite`, and a check of `Origin` or `Sec-Fetch-Site`, or a token). The link pages' client must
send no cookie: it promises to attach nothing (`apps/web/src/services/link-client.ts`), and a
same-origin request sends cookies unless told `credentials: 'omit'`. Privacy §5, in both
languages, says the app sets no cookie of its own, and changes with it.

### What the policy does for the token meanwhile

- **An injected script does not run.** No inline script, no event-handler attribute, no
  `javascript:` address, no script from another host, no `eval`.
- **A script that does run cannot send the token with `fetch` or XHR** to any host but the app's
  own and the sign-in host, and cannot send it in an image's address or a submitted form
  (`img-src data:`, `form-action 'none'`).
- **What it does not stop**: code inside the app's own bundle, a compromised package for one,
  reading `localStorage`; and a running script leaving with the token by navigating the page,
  opening a window, or over WebRTC, none of which the policy governs. Checked in Chromium: under
  the policy, a peer connection to a STUN host the script named sent it four packets, while a
  `fetch` to that host was refused. Chromium does not honour the draft `webrtc` directive. That
  is the supply-chain row of the threat model, and T2's reason.
