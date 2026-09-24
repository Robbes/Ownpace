# Workplan 0136 — A host we are asked to reach

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that the
managed edition connects to any host a signed-in person types, from inside the network that holds
the rest of the stack, and shows the person what the remote answered. The owner's answer to that
blocker was *"Explain risk and Advice"* (§2). §4 is the explanation. The advice is short: T1 and
T3 before the first invitation, because they close most of the risk and neither changes the
stack's networks or the host's firewall. The rest can follow after the alpha opens. Nothing is
built. #1137, merged 2026-09-24, fixed nothing this plan carries: `SECURITY.md`'s stale sentence
about an *"open owner decision"* and the architecture doc's "egress controls" in §16 and §17.1 are
still on `main` (T7), and none of the code §1 cites changed in a way that alters what §1 says.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137 merged.**
Testers use a second stack, `ownpace-live`, on the same machine and the same Docker daemon as the
OTA stack (D6). A container in one stack can usually reach the other stack's host-published ports
through the host, so T1's deny-list now takes in the Docker networks and their gateways, checked
at bring-up against what the daemon hands out, and leans on 0132 T3's 127.0.0.1 binds (T1f) in
both stacks for whatever it misses. §1 gains *Two stacks on one machine*, §2 gains D6, and T2,
T4, T7 and §4 are re-worded for two stacks.

Names used from here on: **live** is the `ownpace-live` stack; **the OTA stack** is
`ownpace-managed`, the nightly gate's target and the demo. D2 and D3 below were asked before D6:
"the tester stack" is live, and D3's answers describe the one stack the machine had then, now the
OTA stack.

The review's findings this plan carries are `sec-ssrf-no-egress-control` (blocker, confirmed),
`sec-archive-disk-path-on-managed` (medium, confirmed) and `sec-threat-model-missing` (medium,
confirmed only in part: the claim that the threat-model decision is open is stale, see §1).

| Task | Status | Notes |
|---|---|---|
| T1 Refuse internal addresses after DNS, on every connection and every redirect | 📋 **Proposed**, advised before the first invitation (D1) | §3. Managed only, on in both stacks. Loopback, private, link-local, CGNAT, unique-local, compose names, and the Docker networks and their gateways (D6): the bring-up refuses to go on if a network on the machine lies outside the ranges. 0132 T3's 127.0.0.1 binds are the other half. One new dependency (`undici`) for the `fetch` half. |
| T2 An operator allowlist for the demo targets | 📋 **Proposed**, with T1 | §3. Empty on live. The OTA stack, the gate's, names its demo hosts. |
| T3 A probe answer that says what happened, not what the remote said | 📋 **Proposed**, advised before the first invitation (D1) | §3. On the managed API: a status and a category, not the remote's body; the full text in a log line with a reference. A per-member limit on tests. The failures route is a second step. |
| T4 The API and the task runners off the control plane's network | 📋 **Proposed**, after the first invitation | §3. The docker-socket proxy and the Trigger.dev control plane on a network the tenant-facing processes cannot reach, in both stacks. The host rule covers both stacks' `egress` bridges. |
| T5 No archive "disk" path on the managed edition | 📋 **Proposed** | §3. Both doors and the probe refuse it. The gate's archive fixture step breaks with it. Needs the owner's answer on how the managed archive card is shown (open question 3). |
| T6 Guard tests for each | 📋 **Proposed**, with each task | §3. Each code task names the test that fails without it. |
| T7 The threat model says what is true | 📋 **Proposed** | §3. §17.1 gets rows for SSRF, exposure (two stacks on one daemon included) and the worker plane. "Egress controls" goes until it exists. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, and the files #1137 changed
that this section cites were read again on `main` after it merged. Nothing was exercised against
either stack on the reference machine.

### Where a tenant types a host

- **The create door.** `CreateMappingSchema` in `apps/api/src/routes/migrations/index.ts` takes
  `sourceConfig.host`, `targetConfig.host`, `targetConfig.url` and `targetConfig.mailHost` as
  `z.string().optional()`. There is no format check on any of them. The superRefine only asks
  whether they are present.
- **The strings become addresses unchanged.** `targetConnectionConfig` builds a JMAP base URL as
  `` `${scheme}://${cfg.host}:${cfg.port}` ``. So `host` is a free string placed inside a URL, and
  it can carry more than a name. `davUrl` in `packages/orchestration/src/dav-endpoint.ts` returns
  a stored `url` as it is, and otherwise builds one from host and port. `useSsl: false` makes it
  plain `http`.
- **The connection door** (`apps/api/src/routes/connections.ts`) takes the same fields through
  the same zod object (`configShapeFor`). The credential descriptors in
  `packages/shared/src/credential-fields.ts` offer `host` for the IMAP source and for every
  target but Nextcloud, `url` for the DAV targets and Nextcloud, and `mailHost` for the Soverin
  target.

### Where the API connects to it, and who can ask

The API process connects to that host itself, through five routes:

- `POST /api/connections`: the typed host, probed before it is stored.
- `POST /api/connections/:id/test`: the stored host, probed again on every press.
- `PUT /api/connections/:id/credentials`: the stored host, probed before the new secret
  replaces the old one.
- `POST /api/migrations/test-connection`: a typed host, probed and nothing stored.
- `GET /api/permissions/report` (`apps/api/src/routes/permissions.ts`): the organisation's
  stored DAV target, measured again through `qualifyAccount` or `measureTargetScheduling`.

After each of the three `/api/connections` routes, `qualifyAndRemember` runs `qualifyAccount`
(`packages/orchestration/src/account-qualification.ts`). It measures the account's other
protocol faces, so one typed host can be contacted on more than one protocol.

Every one of these routes is behind `authenticate` and nothing else. `authenticate`
(`apps/api/src/middleware/auth.ts`) requires an active `tenant_member` row outside dev mode. So
any member of any organisation can call these doors, whatever their role (0137). No limit counts
these calls. The one refusing limiter, `knock-limit.ts`, guards the access-request and
problem-report routes only.

The task runners connect to the same stored hosts when a pass runs. That is the worker plane,
and it is on the same network (below).

### What nothing refuses

A search of `packages/` and `apps/` for destination filtering (`ssrf`, `169.254`, `isPrivate`,
`rfc1918`, `link-local`, `100.64`, `fc00`, `fe80`, `BlockList`, `denylist`) finds none. Its only
hits are two test fixtures that use a mesh-range address as sample data. The only
loopback checks are `google-consent.ts`, which is about Google redirect URIs, and
`apps/api/src/config-guards.ts`, which is about the operator's own `API_URL` and `WEB_URL`.
Nothing refuses a loopback, private, link-local, CGNAT or unique-local address, or a compose
service name.

**Redirects are followed silently.** The DAV clients call Node's `fetch` with no `redirect`
option. `caldav-source.ts` says so in its own comment: *"fetch ALWAYS follows redirects
transparently"*. So even a check on the typed host would not see where a redirect sends the
request.

**A JMAP server names further URLs, and the clients do not follow them to another host.** The
session document (`jmap-session.ts`, `JmapSessionLike`) carries `apiUrl`, `uploadUrl` and
`downloadUrl`. The JMAP clients ignore the first two and build their own from the typed base
URL, and `blobDownloadUrl` keeps the download template's path but re-bases it on the typed
origin. That was done because Stalwart advertises hosts that do not route, and it also keeps the
JMAP clients on the host that was typed. What still takes them elsewhere is a redirect, since
they use `fetch` too. So a check has to sit where the connection is made, not only at the form.

### What the answer shows the person

- `providerRefused` in `packages/orchestration/src/probe-connection.ts` returns `reason: text`,
  which is `err.message`, for any error it does not recognise. The route returns that reason in
  its JSON (`res.status(201).json({ id, ...probe, … })` on add, `res.json({ ...result, … })` on
  test). The docblock of the add route says why: *"The provider's own words come back so the
  person can act on them."*
- The DAV connectors put the response body into that message: `` `PROPFIND failed with status
  ${response.status}: ${davRefusalBody(response.body)}` `` in `caldav-source.ts`,
  `carddav-source.ts` and `webdav-source.ts`, and the same pattern in the three DAV writers in
  `packages/engines`. `davRefusalBody` (`packages/shared/src/dav-refusal.ts`) strips a Google or
  Sabre error envelope. For any other body it ends `return body;`, unchanged and uncapped. The
  body is read in full (`await response.text()`).
- The JMAP session loader puts the first 300 characters of a non-OK body into its message, and
  for a request that never reached a server it adds the underlying error text.
- The IMAP source rethrows the socket's error unchanged. Node's connection errors name the
  address and port they tried.
- The qualification that follows a connection probe puts the same message into each face it
  could not measure (`askListable`: *"Unmeasured — the probe was refused: …"*), and the route
  returns the qualification beside the probe (`qualificationField`).
- A probe that runs past 20 seconds answers *"The test did not answer within 20 seconds"*
  (`PROBE_DEADLINE_MS`), and the work goes on in the background.
- A pass run by the task runners records the same kind of message as a failure's `lastError`,
  and `GET /api/migrations/:mappingId/failures` returns it to the organisation. That route is
  slower to use than a Test button, but it is a second way back.

So the answer tells the person whether something answered at that name and port. If it did, the
answer gives its status and, for a non-success, its body. If nothing answered, the answer says
whether the connection was refused or timed out. The probe is not blind.

### What shares the network

`deploy/compose/managed.yml` has one application network, `ownpace-network`. Every service
below is on it. Each stack started from the file gets its own copy (next part). The only other
network is `status-probe`, `internal: true`, which carries the identity provider's name for the
status page.

| On `ownpace-network` | What it is |
|---|---|
| `postgres`, `pgbouncer` | The application database and its pooler |
| `trigger-db`, `trigger-redis`, `clickhouse`, `minio` | Trigger.dev's database, queue, event store and object store |
| `trigger-api`, `trigger-supervisor`, `trigger-registry`, `trigger-tls` | Trigger.dev's control plane |
| `trigger-docker-proxy` | `tecnativa/docker-socket-proxy` with `CONTAINERS: 1`, `IMAGES: 1`, `NETWORKS: 1`, `VOLUMES: 1`, `POST: 1`, in front of the host's Docker socket |
| `zitadel` | The identity provider |
| `api`, `web`, `gatus`, `mailpit`, `nextcloud` | The product, the status page, the mail catcher and the demo DAV server |

- **The socket proxy accepts writes.** The comment above it says the whitelist is *"exactly what
  running task containers needs (create/manage containers, pull images, attach networks)"*. With
  `POST: 1`, the proxy lets through requests that change state in the sections it enables. The
  socket is mounted `:ro`, and that does not stop requests over it. The proxy's variables are
  what limit them. Creating a container through the Docker API is, in effect, control of the
  host.
- **Run containers join the same network.** `trigger-supervisor` sets
  `DOCKER_RUNNER_NETWORKS: ownpace-managed_ownpace-network`. Its comment says why: *"so tasks
  reach postgres, stalwart and nextcloud by the same names the worker container uses"*. The
  network is written out with the project name in it (next part).
- **The demo targets live there too.** `setup-managed-demo.sh` joins a Stalwart to the network,
  and `apps/api/src/scripts/seed-managed.ts` points the demo tenants at `stalwart` and
  `http://nextcloud/remote.php/dav/` by compose name. That is the OTA stack. Live is brought up
  without the demo (0132 T1b).
- **The gate asks the probe for an address off the network.** `smoke-managed.sh`'s Nextcloud
  step builds `http://${nc_host:-localhost}:${nc_port:-8083}/remote.php/dav`, with `nc_host`
  read from `NEXTCLOUD_BIND` in `.env`, posts it to `test-connection` and expects `ok: true`.
  `managed.env.example` gives a placeholder in the mesh range as its example for
  `NEXTCLOUD_BIND`. With the value unset, `localhost` inside the API container is the API
  container itself, where no Nextcloud listens. So when the step passes, the API container
  has reached whatever address `NEXTCLOUD_BIND` names, and with a mesh address that is through
  the host. This plan did not read the reference machine's `.env` or a run log, so it states
  the path, not the result. The gate runs on the OTA stack only.

### Two stacks on one machine

D6 puts live beside the OTA stack, on one Docker daemon. What that means for a host a tester
types:

- **Compose names do not cross.** No network or volume in `managed.yml` carries a `name:` of its
  own, so Compose prefixes each with the project. `postgres` asked for from live's API is live's
  database.
- **One literal does.** `DOCKER_RUNNER_NETWORKS: ownpace-managed_ownpace-network` names the OTA
  stack's network in full. A second stack started from this file would put its task runs on the
  OTA stack's network, where `postgres` is the OTA stack's database. 0132 T1 derives it from the
  project name, and nothing of live starts before that.
- **The gateway does.** A container reaches the ports its host publishes through its network's
  gateway address (0132 §1), which is the host. `managed.yml` publishes seven ports on all
  interfaces (the database, the API, the web app, the status page, the identity provider, and
  two for Trigger.dev); the registry, Mailpit and Nextcloud default to 127.0.0.1. So a request
  from live's API or task runs to a gateway address meets the OTA stack's published ports, its
  Postgres included, and live's own, and the OTA stack's containers reach live's the same way.
  A port published on all interfaces also answers on every other address the host holds. A port
  bound to 127.0.0.1 is reached from neither stack, because inside a container that address is
  the container itself. 0132 T3 binds every port that need not be reachable that way, in both
  stacks (0132 T1f).
- **Where the networks' addresses come from.** `managed.yml` sets no subnet, so the daemon hands
  each network one from its address pools. Docker's built-in pools lie inside `172.16.0.0/12` and
  `192.168.0.0/16`. A daemon's pools can be configured to lie elsewhere, and this plan could not
  see the reference machine's daemon configuration.
- **The socket proxy is not limited to its project.** Each stack's supervisor can start a
  container on any network on the machine, the other stack's included (0132 §1). The separation
  is by names, not a boundary, which D6 accepts for the alpha.

### The archive path on managed

`parseArchiveSource` (`packages/shared/src/config.ts`) leaves `where` out when the input has
none. The archive branch of `sourceConnectionConfig`, which both `POST /api/migrations` and
`POST /api/connections` use, passes only `provider` and `path`, and the schema has no `where`
field. So every managed archive is `disk`. `probeArchive` returns early only for
`where === 'target'`, and otherwise calls `reader.open({ provider, path })` in the API process.
`qualifyArchive` does the same. `localStore()` (`packages/connectors/src/archive-store.ts`) stats
and reads any path it is handed, with no root. The reader answers differently for "nothing is
at", "is a tar archive" and "is a file, not a folder or a .zip download", and walks a folder
(`folderTree`). `parseArchiveWhere`'s own sentence says `disk` *"is the appliance only"*. The
typed path reaches the API container's own filesystem.

### What the architecture doc claims

`docs/architecture/solution-architecture.md` lists "egress controls" in §16 (*"per-tenant
workspace/namespace, secret scope, concurrency/rate budget; egress controls"*) and as a
mitigation in §17.1's row *"Multi-tenant isolation breach"*. Nothing in the code or the compose
files implements them. §17.1 has six rows, and none covers tenant-supplied destinations, a
published port, the shared network with the socket proxy, or the worker plane's database role.

`SECURITY.md` still says that whether a full threat model is written *"is an open owner
decision (workplan 0026 T3 row 11)"*. That sentence is stale. Row 11 reads *"DECIDED 2026-08-05:
DEFER with a trigger (owner)"*, and the trigger is *"a customer's security review asks, or the
first non-rc release"*. The alpha is neither, so this plan does not reopen row 11. It only makes
§17.1 true (T7).

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — an explanation, then advice.** *The managed edition connects to any host a tester types,
from inside the stack's own network, and shows the tester what came back (the review's blocker
B7, SSRF). What should happen?* — *"Explain risk and Advice"*

§4 explains the risk, and its last part is the advice. The advice becomes a decision when the
owner accepts it, or writes a different one beside it, in this block (open question 1).

Four other answers from the same day bear on this plan:

**D2 — the tester stack.** *A stack for testers, separate from CI and the nightly gate, would be
reachable by people from outside (B1). Is that the plan?* — *"Yes, but its a controlled rest. I
Let people in and support them. Max 10/20 people"* ("rest" is read as "test"). 0131 carries it.
Here it sets who can reach the doors of §1: people the owner let in, and whoever gets into one of
their accounts (§4). D6 makes that stack live.

**D3 — the ports and the passwords.** *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from
outside, were the database passwords changed, and does the live identity provider hold other
organisations (Q1)?* — *"No, these ports are not reachable outside of private network/NetBird.
Usernamea changed. No other organisations are hosted."* And on the blocker that Postgres is
published with the `app_user` password this repository contains (B6): *"Ill change user and
pass. But not reached from internet."* Both concern reaching the machine from outside. This plan
is about the machine reaching inward on a tester's behalf, which a closed port does not prevent.
Those answers describe the OTA stack, the one the machine had then (D6). 0132 carries the ports,
in both stacks (T3), and the passwords (T2 on the OTA stack; live's are set before its first
bring-up, T1b).

**D4 — nobody joins the mesh.** *If the current stack is reused, should the demo secrets that
left the machine be rotated (B11)?* — *"Who would need/het credentials? I aupporrthe test. No
one will be added to NetBird network. Devs need to setup own private test/dev environments.
GitHub PRs and git is the bridge."* So no tester is on the mesh. The only way from a tester to
the mesh is through the service itself, which is what §4 is about.

**D5 — label, for unproven sources.** *Source cards that were never run against a real account:
prove them, hide them, or label them experimental (Q9)?* — *"Label"*. That answer is about
sources nobody has proven, and 0131 T2 carries it. T5 asks the same question of a card that
cannot work on managed at all (open question 3).

**D6 — a second stack for testers, beside the OTA stack (0132 D-new).** Later the same day the
owner asked: *"check, can't i just (as a start) host a 'ownpace-live' as production, next to the
current 'ownpace-managed' on OTA-domain? What would i need to do to keep alle seperate from each
other?"* The proposal back was to make that 0132's decision, with testers on `ownpace-live`. The
owner's answer: *"Yes! The spark has a lot free memory and disk, it will fit."* So testers use
live, on the production names, and the OTA stack stays the nightly gate's target and the demo.
0132 records that the separation is by names on one Docker daemon, not a boundary, and accepts
it for a hand-picked alpha. For this plan, "keep all separate" has one gap a typed host can use:
a container in one stack can usually reach the other stack's host-published ports through the
host (§1, *Two stacks on one machine*). T1's deny-list takes in the Docker networks and their
gateways for that reason, and 0132 T3 binds what need not be reachable to 127.0.0.1 in both
stacks.

## 3. What each task does

### T1 — refuse internal addresses after DNS, on every connection and every redirect

**One module, one rule.** A module in `@openmig/shared` (the working name is
`reachable-host.ts`) answers one question: may this deployment connect to this address? It
refuses:

- loopback: `127.0.0.0/8`, `::1/128`;
- "this network": `0.0.0.0/8`, which on Linux reaches the local host;
- private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`;
- the Docker bridge networks and their gateways (D6): the subnet of every network the machine's
  daemon has made, both stacks' and the default bridge's. A network's gateway is the host, and a
  container in one stack can usually reach the other stack's host-published ports through it
  (§1). The module holds no range of its own for them. On a daemon with Docker's built-in pools
  these subnets lie inside the private ranges above, which is one more reason those ranges may
  never be narrowed. A daemon's pools can be set elsewhere, and the API cannot see the daemon, so
  the bring-up, which runs on the host, reads the subnet of every network on the machine
  (`docker network inspect`), not only its own project's, and refuses to go on, naming the
  network, when one lies outside T1's ranges. Which case the reference machine is in is what that
  check's first run says. Neither covers an address the host holds outside these ranges;
  0132 T3's 127.0.0.1 binds (T1f), in both stacks, close that path whatever this list misses;
- link-local: `169.254.0.0/16`, `fe80::/10`. On a cloud virtual machine this range holds the
  metadata service. The rule does not depend on where a deployment runs;
- shared address space (CGNAT): `100.64.0.0/10`, the range mesh VPNs such as NetBird use;
- unique-local: `fc00::/7`;
- multicast and reserved: `224.0.0.0/4`, `240.0.0.0/4`, `ff00::/8`;
- an IPv4-mapped IPv6 address (`::ffff:0:0/96`), judged as the IPv4 address inside it;
- a host that is not a DNS name or an address literal (a path, a user part, a port inside the
  host field): refused at the door, before any lookup;
- a single-label name (`postgres`, `trigger-docker-proxy`): refused by name, because compose
  names resolve through Docker's own DNS to private addresses anyway, and the refusal is clearer
  that way. A compose name reaches only its own stack's services (§1); the way between the
  stacks is the gateway, which the Docker entry above covers.

Node's `net.BlockList` holds the ranges, so the rule itself needs no dependency. The fetch half
of the next paragraph does: Node's `fetch` accepts a `dispatcher`, but the `Agent` that builds
one comes from the `undici` package, which no workspace depends on today. Adding it, at the
version the Node runtime bundles, is the build's first decision.

**After resolution, and on the address actually used.** A check on the typed name alone is
defeated by a name that resolves to an internal address, or by one that answers differently the
second time (DNS rebinding). So the check runs on every address the lookup returned, and the
connection is made to the address that was checked, with no second lookup. TLS still verifies the
certificate against the typed name.

- For `fetch` (DAV, JMAP, the qualification and scheduling probes), a dispatcher whose connect
  step checks the address it is about to use. Redirects become `redirect: 'manual'`. Each
  `Location` is checked the same way before it is followed, with a small bound on hops. The JMAP
  clients already stay on the typed origin (§1), and their calls go through the same dispatcher
  anyway, so a later change there cannot open a path.
- For IMAP (`imapflow`, in `imapflow-source.ts` and `imapflow-dav-target.ts`), the host is
  resolved and checked first, and the client connects to the checked address with the typed name
  for TLS. The build's first step is to confirm which option the library offers for this. If it
  offers none, IMAP relies on T4's host rule until one is found, and this block says so.
- SMTP is out of scope. The only SMTP client (`smtp-transport.ts`, `nodemailer`) sends the
  operator's notifications to a host in the operator's settings, not one a tester types.

**Managed only.** The appliance is untouched. A Nextcloud on the owner's own LAN is the
appliance's ordinary case, and its only user is its owner. The rule is switched on by the managed
API and by the managed task environment, and it is off unless they switch it on. The two
together cover the probe doors and the passes. Both stacks run the managed edition from the same
`managed.yml`, so both switch it on: live because testers type hosts there, and the OTA stack
because its containers can reach live's published ports through the gateway in the same way,
whoever types a host there. The OTA stack admits its demo names through T2.

**The refusal** is a sentence of ours, in both languages: *this address is inside the service's
own network, so we do not connect to it*. It names the host as typed and never the address it
resolved to.

**Guard:** `a-host-we-are-asked-to-reach.unit.test.ts` in shared. It asserts a refusal for one
address in each range above, for an IPv4-mapped IPv6 address, for a single-label name, and for a
name whose stubbed lookup returns a private address. It asserts that a public address passes. It
fails if any range is removed. In orchestration, the same test drives `probeTargetConnection`
against a stub server that answers a redirect to a loopback address. It fails if the redirect is
followed. In the API, with the rule on, it drives each of the five routes of §1 with a
private-address host, typed or stored on the row the route reads. It fails if any route
connects. The bring-up's network check gets a case in `scripts/bootstrap-managed.unit.test.ts`,
fed recorded `docker network inspect` output for two projects: subnets inside T1's ranges pass,
and a subnet outside them fails and names its network, also when that network is the other
project's. It fails if the check reads only its own project's networks.

### T2 — an operator allowlist for the demo targets

`OWNPACE_REACHABLE_HOSTS` in `.env` is a list of exact host names, with no wildcards and no
ranges, that T1 admits although they resolve inward. It is empty by default, and the bring-up's
summary prints what it holds.

- **On live it stays empty.** An entry admits that name for every tenant on the deployment. It
  is not a per-tenant exception. Live never has the demo (0132 T1b), so there is nothing to name.
  Each stack reads its own `.env`, so the OTA stack's entries never reach live.
- **On the OTA stack, the gate's,** it names `nextcloud` and `stalwart`. The smoke's
  `test-connection` step changes to ask for `http://nextcloud/remote.php/dav` by its compose
  name, which the default `NEXTCLOUD_TRUSTED_DOMAINS` (`localhost nextcloud`) already lists,
  rather than for the address in `NEXTCLOUD_BIND`. The smoke's host-side `curl` calls keep
  `NEXTCLOUD_BIND`.
- `seed-managed.ts` and `setup-managed-demo.sh` say, where they write a compose name, that the
  name needs the allowlist.

**Guard:** in the same shared test. A name on the list passes, and the same name off the list is
refused. An entry with a wildcard or a range is refused at start-up. It fails if the list is read
as a pattern.

### T3 — a probe answer that says what happened, not what the remote said

On the managed API, when the host is one the tester typed, the probe's `reason` and the
qualification's per-face detail carry:

- the outcome category, as `ProbeOutcome` already has it (`credentialsRefused`, `timedOut` and
  the rest), plus `unreachable` for a connection that was refused or never answered;
- the HTTP status, when there was one;
- the provider's own words **only when they parse as a provider's error document**: a DAV
  `d:error`, Google's GData envelope or JSON error document, a JMAP problem document or an IMAP
  `NO`/`BAD` response line, capped at a few hundred characters. Anything else, such as an HTML
  page, a JSON document of some other shape or plain text, is replaced by *"the server answered
  with something that is not a DAV, JMAP or IMAP error"*.

A socket error is reported by its category, without the address it tried.

**Where the cut is made.** `davRefusalBody` is shared by both editions and by the DAV writers,
whose messages the operator reads in the ledger. Its fallback is pinned on purpose:
`dav-refusal.unit.test.ts` asserts *"passes through untouched — a plain-text refusal is not ours
to reshape"*, with a JSON body among its cases. So the helper keeps its behaviour. The DAV sites
throw a refusal that carries the status and the stripped body as fields beside the message, and
the managed API chooses what to answer from those fields. The appliance, whose only user is its
owner, keeps the full text.

**The operator keeps the full text.** Today a probe's refusal is answered and not logged at all.
T3 adds one log line with the full text and a 0129 T1 event (a new name on its closed list), and
the answer carries that event's reference. That keeps hard rule 9: the failure still surfaces,
with its category, its status and a reference the operator can find. Only the remote's bytes
stop reaching the tester.

The known providers keep what 0080 and 0115 T5 built. Google's `accessNotConfigured` still reads
as Google wrote it, because it is a GData document. Google's JSON error document (the
`{"error":{"code":…,"message":…,"status":…}}` shape of the contacts refusal that
`a-refusal-that-pastes-its-envelope` records) is on the list for the same reason. The rule
removes only bodies that are not an error document from a mail or DAV server or from Google.

**What T3 does not cover yet.** The failure records a pass writes (`lastError`, §1) carry the
same messages. They reach the organisation more slowly than a Test button, and the operator
needs them as they are. T3's second step applies the same rule to what the failures route
returns, and leaves the ledger row untouched.

**A limit on tests.** The five routes of §1 share one refusing limit per member, using
`createKnockLimiter` (`apps/api/src/knock-limit.ts`). A person pressing Test by hand never meets
it. A script trying names and ports does.

**Guards:** `a-probe-that-does-not-read-aloud.unit.test.ts` in the API, with the managed answer.
A stub server that answers 500 with an HTML body, and another that answers 200 with non-DAV
JSON, must produce a reason and a qualification detail without any of their bytes. A GData 403,
a Google JSON 400 and a Sabre 500 keep their code and message. It fails if the answer carries the
remote's body. `scripts/a-refusal-that-pastes-its-envelope.unit.test.ts` already refuses a DAV
site that interpolates `response.body` raw; it is widened to the JMAP session loader's
`body.slice(0, 300)`. In the API, a test posts to `test-connection` past the limit and expects a
refusal. It fails without the limiter.

### T4 — the API and the task runners off the control plane's network

After the first invitation. `managed.yml` gets three networks in place of one. Both stacks read
the file, so both get them, each under its own project's names (0132 T1):

| Network | Members | Why |
|---|---|---|
| `control` (`internal: true`, see "Published ports" below) | `trigger-api`, `trigger-supervisor`, `trigger-docker-proxy`, `trigger-db`, `trigger-redis`, `clickhouse`, `minio`, `trigger-registry`, `trigger-tls` | Trigger.dev's own plane. Nothing tenant-facing joins it. |
| `app` | `api`, `pgbouncer`, `postgres`, `zitadel`, `gatus`, `mailpit`, `web`, and the runners | What the product needs to serve a request and run a pass. |
| `egress` | `api`, the runners | The way out to the internet. |

- **The socket proxy is on `control` only.** Only the supervisor reaches it.
- **`trigger-api` and `trigger-supervisor` also join `app`** under the names the API and the
  runners use today. Those two are the ports the product needs from the control plane (to
  trigger tasks and to run them). Whether the runners also need `minio` for large payloads is the
  build's first check: the object store's URL is whatever `trigger-api` hands out.
- **`DOCKER_RUNNER_NETWORKS`** names this stack's `app` and `egress`, derived from the project
  name as 0132 T1 derives today's one network, and never `control`.
- **Published ports.** `trigger-api` (3090), `trigger-tls` (3443) and `trigger-registry` publish
  ports on the host. The registry's matters most: the host's Docker daemon pulls run images from
  it (`DOCKER_REGISTRY_URL: localhost:${REGISTRY_PORT:-5000}`). As far as this plan knows,
  Docker does not publish a port for a container whose only network is `internal`. So these
  three also join a small non-internal network that nothing tenant-facing joins, or `control` is
  left non-internal and the guard checks membership alone. The build confirms the behaviour on
  the Docker release in use before it picks.
- **Host routing.** A container on a Docker bridge can reach the host's other interfaces, the
  mesh among them, unless the host refuses it. The runbook gets a `DOCKER-USER` rule that drops
  traffic from each stack's `egress` bridge to `100.64.0.0/10`, the private ranges and the Docker
  networks of T1. That is the network-layer twin of T1, so a client T1 missed still cannot reach
  the mesh or the other stack's containers. `DOCKER-USER` sees forwarded traffic only. A
  connection to an address the host holds, the gateway among them, that Docker does not rewrite
  to a container is delivered to the host and not forwarded, so the rule needs a counterpart on
  the host's input path for the same bridges. The build confirms on the machine which path each
  case takes, and that nothing on `egress` needs the host itself. 0132 T3's 127.0.0.1 binds stay
  the first answer for published ports.

This does not make T1 unnecessary. The API still shares `app` with `postgres` and `pgbouncer`,
and only T1 stops a request to those by name. T4 takes the worst targets out of reach: the socket
proxy and the unauthenticated or shipped-password services of the control plane. Nor does it
make the two stacks a boundary: each stack's socket proxy can still start a container on the
other's networks (§1), which is the limit D6 accepts.

**Guard:** `a-network-the-tenant-cannot-see.unit.test.ts` in `scripts/` reads `managed.yml`. It
asserts that `trigger-docker-proxy` is on no network that `api` or the runners
(`DOCKER_RUNNER_NETWORKS`) join, and that neither joins `control`. It fails on today's file. It
is a cross-cutting guard, so `docs/LESSONS.md` is regenerated with it
(`node scripts/lessons.mjs --write`).

### T5 — no archive "disk" path on the managed edition

On the managed API, both doors refuse an archive source whose `where` is absent or `disk`, with a
sentence that says where a managed archive goes instead. `probeArchive` and `qualifyArchive`, when
called by the managed API, never open a local path. The shared parser stays edition-neutral,
because the appliance's mapping file needs `disk`. The refusal lives in `apps/api`, which serves
only the managed edition.

That leaves the managed archive card with no working shape today. The create door cannot express
`where: 'target'`, and the wizard has no relay (`guides-archive-managed-path-unusable`). So T5
comes with open question 3's answer. The advice is to hide the card on managed until an upload or
relay path exists, or the door learns `where: 'target'`. Label or hide is the owner's call, the
same one Q9 answered with *"Label"* for the unproven source cards (D5).

**Guard:** in the API, a test posts an archive with a path and no `where` to
`POST /api/connections`, `POST /api/migrations` and `test-connection`. It expects a refusal and no
call to the reader. It fails on today's code.

**The gate loses a proof.** `smoke-managed.sh`'s archive section has two steps that both depend
on the disk path. The first posts `path: "/tmp"` and expects the file face to be `unknown`; it
changes to expect the refusal. The second writes a small Takeout fixture inside the API
container (`ARCHIVE_ROOT="/tmp/smoke-takeout"`) and expects a measured count of three items. T5
breaks it, and with it the step the gate uses to show that the archive reader reached the
deployed image. It moves to `where: 'target'` once the door can express that. Until then the
managed gate has no live proof of the archive reader, and its output says so rather than
skipping the step in silence.

### T6 — guard tests for each

Named in T1 to T5. Each is written first and fails on today's code. Each fix goes in its own PR
with its guard. Mutations are run the way 0129 and 0130 ran them, and the count goes in the
status block.

### T7 — the threat model says what is true

In `docs/architecture/solution-architecture.md`:

- §16 and §17.1 lose "egress controls" until T1 and T4 exist. After that they say what those two
  tasks built, and no more.
- §17.1 gets three rows, each with its real mitigation status:
  - **A host a tenant types (SSRF).** Mitigation: T1 and T3 once built. Until then: none; the
    alpha's members are people the owner let in (0131).
  - **Published ports, the ingress, and two stacks on one daemon.** Mitigation: 0132 T3, with
    127.0.0.1 binds in both stacks, and T1's Docker ranges. The row says that the separation
    between the stacks is by names, not a boundary (D6).
  - **The worker plane.** The runners share the application network, and tasks run as the
    database owner. Mitigation: T4 here and 0138.
- `SECURITY.md`'s sentence about an *"open owner decision"* becomes what row 11 decided: deferred,
  with its trigger. This is a mechanical correction of a stale line.

No guard pins prose here. T7 is checked by reading.

## 4. Explaining the risk

**What it is.** Server-side request forgery: the service is asked to connect somewhere, and it
connects from where it stands, not from where the person stands. Ownpace has to connect to hosts
people type, because that is how a mailbox or a Nextcloud is reached. The problem is that
nothing distinguishes a mail server on the internet from a service inside Ownpace's own network.

**Who could use it.** Any signed-in member of any organisation on the deployment, whatever their
role (§1). 0137 T1 would narrow the probes to owners and admins, which is a smaller set of people,
not a fix. In the alpha these are 10 to 20 people the owner let in and supports (D2), and that
lowers the likelihood a great deal. It does not remove it. An account can be phished, a password
can be reused and leaked elsewhere, and a laptop can be shared. Someone who gets into one
tester's account has the same doors the tester has.

**What they could reach.**

- **Every service on the stack's own network, by its compose name.** For a tester that is
  live's `ownpace-network`; compose names do not cross to the OTA stack (§1). That includes the
  application database and its pooler, Trigger.dev's database, queue, event store and object
  store, the identity provider, the mail catcher where it runs, and the docker-socket proxy (§1).
  Several of these authenticate with values this repository publishes, or not at all. 0132
  replaces those values, and T4 takes the worst of them out of reach. The docker-socket proxy
  stands out. It accepts requests that change state, and control of the Docker API is control of
  the host. Whether a working path to it exists through Ownpace's own requests was not tested,
  and this plan does not claim one. The point is that nothing but the supervisor should be able
  to try.
- **The other stack, through the gateway.** A request to the gateway address of live's network,
  or to any other address the host holds, meets every port the machine publishes on all
  interfaces (§1): the OTA stack's database, API, identity provider and Trigger.dev API among
  them, and live's own. The OTA stack's database keeps the passwords this repository contains
  until 0132 T2 is done there. The same path runs the other way, from the OTA stack's containers
  to live's ports. T1's Docker ranges refuse the gateway by address, and 0132 T3's 127.0.0.1
  binds close the path whatever T1 misses. Whether a given request from live reaches the OTA
  stack's ports today was not tested; the path is stated, not the result.
- **The machine's mesh, likely.** Containers on a Docker bridge reach the host's other
  interfaces unless the host refuses it. NetBird uses the shared address space `100.64.0.0/10`.
  So a request from the API or a runner to a mesh address likely leaves through the host's mesh
  interface. The gate's own smoke, on the OTA stack, suggests this path is used (§1). Whether it
  reaches a given peer depends on the host's routing and the mesh's access rules, which this plan
  could not see. No tester is added to the mesh (D4), so this path is the one way a tester's
  request could get there.
- **The API container's own disk**, through the archive path (T5). Names and kinds of files, and
  a walk of any folder.

**What the echoed errors add.** Without them, a probe would be blind: the tester would learn
"worked" or "failed" and little more. With them, the tester learns whether something answered at
a name and port, whether it refused or stayed silent, its HTTP status, and for a non-success its
body, which for a DAV client is not capped. That turns the Test button into a way to map the
internal network and read the error pages of what is on it. T3 takes that away from the probe
and qualification answers, and it is what makes T1's gaps, if any remain, much harder to use.

**What a closed port does not change.** The owner's answer on the ports is that they cannot be
reached from outside (D3). That protects the machine from the internet. This risk runs the other
way: a tester asks the machine to connect inward on their behalf, from inside. A firewall at the
edge does not see that traffic.

**The advice.**

1. **Before the first invitation: T1 and T3.** Neither changes a stack's networks or the host's
   firewall. T1 is one module with a list of ranges, applied where connections are made, one
   check in the bring-up, and one new dependency for the `fetch` half. T3 changes what the
   managed API answers, adds one log line and adds one limit. Together they close most of the
   risk: the internal names and ranges, the Docker networks' included, are refused, redirects
   included, and what comes back no longer reads aloud. 0132 T3's 127.0.0.1 binds in both stacks
   belong beside them; they are already in 0131 T5's minimum for 0132, and they close the path
   between the stacks whatever T1 misses. 0131 T5's go/no-go row for this plan names T1's part
   (internal hosts refused, the Docker networks among them, redirects checked) and not T3. This
   plan advises T3 as part of the same minimum, and 0131's row should say so if the owner
   accepts.
2. **After the alpha opens: T4, T5 and T7.** T4 is the second lock, for whatever T1 misses. It
   touches the compose file and the host's firewall, and it deserves its own bring-up on the OTA
   stack first, where the gate runs every night. It reaches live by a tag (0132 T1g), not as a
   change under testers. T5 waits on how the managed archive card is shown. T7 follows the
   code.
3. **If T1 and T3 cannot be ready in time,** the alternative that 0131 T5 records is the owner's
   written acceptance of this section, and this plan advises that it be dated. It is given knowing
   that every tester is someone the owner let in, and that the alpha's conditions (0139) say a
   tester must not share their account. Until then, 0132 T1b, T2 and T3 matter more: they
   replace the values this repository publishes, which a forged request would otherwise meet, and
   the 127.0.0.1 binds keep it from the other stack's ports.

## Cross-references

- 0129 T1: the recorded event and reference that T3's log line uses.
- 0131 T5: the go/no-go row for this plan. It names T1's part today (§4, advice 1).
- 0132: D-new (D6 here), live beside the OTA stack. T1, which derives the container names and the
  runners' network from the project name. T1b, live's own `.env`, values and ports, without the
  demo. T3 with T1f, 127.0.0.1 binds in both stacks, the other half of T1's Docker ranges. T2 and
  T5, the OTA stack's passwords and demo. Together they decide what a forged request would meet.
- 0137: roles. The probe routes are open to every role today, and 0137 T1 narrows who can
  trigger them.
- 0138: tasks under row security, the other half of the worker plane's row in T7.
- 0139: the alpha conditions, which say a tester keeps their account to themselves.

## Open questions

1. **Accept the advice?** T1 and T3 before the first invitation, and the rest after (§4). Or the
   written acceptance in its place.
2. **The allowlist's name and shape.** `OWNPACE_REACHABLE_HOSTS` with exact names only (T2). Is
   there any real target during the alpha that sits on a private address and must be admitted?
   The answer here assumes none.
3. **The managed archive card.** Hide it on managed until an upload or relay exists, or label it
   (T5). Q9's answer for unproven sources was *"Label"* (D5). An archive that cannot be read on
   managed is a different case from one that is only unproven. 0131 open question 4 asks the same
   question, with an "Appliance only" tag on a disabled card as its proposal; one answer serves
   both plans.
4. **The host firewall rule in T4.** Does the owner want the `DOCKER-USER` rule on the reference
   machine itself, given that CI and both stacks run there (0132)? It changes what containers on
   the two `egress` bridges can reach, and CI's own job containers are on neither. The build
   confirms that before it lands.
