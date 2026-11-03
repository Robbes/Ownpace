# Trigger.dev's supervisor as upstream publishes it, by tag and index digest,
# with root's copy of pnpm deleted, which never runs in this stack, and tar
# deleted from node's, which runs (workplan 0146 T16; the owner's decisions of
# 2026-10-26, "Both", and of 2026-10-27, tar out of the copy that runs); since
# 2026-10-31 also npm and the rest of node-gyp's tree in node's copy, under
# tar's one risk (THE HIGHS NOTHING RUNS, below); and since 2026-11-02 node's
# copy is pnpm 10.34.9 in place of upstream's 10.33.2, hygiene and not a
# security fix (WHAT IS REPLACED: PNPM, below); and since 2026-11-03
# systeminformation is 5.33.19 in place of 5.31.7 (WHAT IS REPLACED:
# SYSTEMINFORMATION, below). The header of
# deploy/compose/trigger.dev/Dockerfile says the rest, and all of it holds
# here: the name and its hash, the version argument, read_at, what may not be
# in this file, how it fails when upstream moves, the pnpm swap's reasons, and
# the way out, and its WHAT IS REPLACED: FOUR PACKAGES, of which this is one.
#
# WHY. Trivy 0.76.1 read 2 critical findings in
# ghcr.io/triggerdotdev/supervisor:v4.8.1 (linux/arm64, 2026-10-26; v4.8.3 builds
# the same Containerfile, entrypoint and pnpm), both tar
# 7.5.13 (CVE-2026-59873) in corepack's pnpm 10.33.2: once in root's copy and
# once in node's (which since 2026-11-02 goes whole, for 10.34.9).
# managed.yml's trigger-supervisor sets no `user:`, so it runs as the image's
# user, node, with HOME /home/node, and its CMD, `pnpm run --filter
# supervisor start`, runs node's copy. Root's copy, left by the base
# stage's `corepack prepare` (apps/supervisor/Containerfile), runs nowhere: the
# entrypoint only sets NODE_OPTIONS and execs dumb-init, the healthcheck is
# `node -e fetch`, and nothing execs into the container but the smoke's own
# `node -e` fetch of DOCKER_HOST (since 2026-11-02). Node's copy keeps
# running without its tar, as the webapp's header says of root's copy there:
# only pnpm's bundled node-gyp requires tar (lib/install.js, for Node's
# headers in a native build), and the CMD runs one script, `node
# dist/index.js`, and installs nothing. The one risk, accepted by the owner
# on 2026-10-27: a `pnpm install` inside this container that builds a native
# add-on would fail. So 2 become 0.
#
# THE HIGHS NOTHING RUNS, as the webapp's header says them (since 2026-10-31).
# The image scan of the image built here at v4.8.3, Security Scan run
# 41159641513 (Trivy 0.76.1, linux/arm64, 2026-10-31), read 0 critical and 25
# high findings, all 25 with a fix, as at v4.8.1 (run 41130684117). Twelve are
# in the two trees the webapp's build removes for the same reasons, and this
# one removes them too:
#   - npm 11.19.1, which node:24.22.1-alpine bundles, under
#     /usr/local/lib/node_modules/npm, with Node's links /usr/local/bin/npm and
#     /usr/local/bin/npx: brace-expansion 5.0.9 (2 highs) and undici 6.28.0 (4).
#     The CMD runs pnpm, through corepack 0.36.0's shim, which stays; the
#     script it runs is `node dist/index.js`; the entrypoint runs dumb-init; the
#     healthcheck is `node -e` fetch; nothing execs into the container but
#     the smoke's `node -e` fetch of DOCKER_HOST, and the supervisor's source
#     spawns nothing.
#   - node-gyp's tree in node's copy of pnpm, the one that runs:
#     /home/node/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules (tar
#     went first) and dist/node-gyp-bin: brace-expansion 2.1.0 (5 highs) and
#     ip-address 10.1.0 (1); since 2026-11-02 the same tree in 10.34.9's
#     copy, /home/node/.cache/node/corepack/v1/pnpm/10.34.9, in which npm
#     lists no high. Without them the CMD's `pnpm run` runs its script as
#     before; only a script that calls node-gyp, or an install that builds a
#     native add-on, would fail, tar's risk again.
# So 25 become about 13: what was left is pnpm 10.33.2 itself (11) and the rest
# of what runs. The scan of 2026-11-02 (Security Scan run 41465604476) read 0
# critical, 13 high and 13 with a fix; without pnpm 10.33.2's 11 that is about
# 0, 2 and 2 (arithmetic, not measured), which the branch's own scan read
# (Security Scan run 41527113857): systeminformation 5.31.7 (below) and
# cross-spawn 5.1.0 (CVE-2024-21538, fixed only in 6; Security Scan run
# 41586744506 lists both, by path). The first RUN checks, before it
# removes anything, what the webapp's checks: that the copy names only the
# three packages of its dist/node_modules read, that npm is Node's 11.19.1
# with no npmrc and only its two links, and that corepack is 0.36.0; and the
# last RUN proves as node that pnpm 10.34.9 starts offline and runs a command
# in the supervisor's package.
#
# WHAT IS REPLACED: PNPM, the webapp's the other way round (since 2026-11-02).
# The webapp's header says why (18 advisories against 10.33.2, none reachable
# here; 10.34.9 is npm's latest-10 and npm lists none against it) and how.
# Here the copy that runs is node's, so the first RUN, as root and before it
# removes anything, reads the owner of node's copy of 10.33.2 (stat -c %u:%g
# of its .corepack), installs 10.34.9 into node's corepack home with
# `HOME=/home/node corepack install -g pnpm@10.34.9+sha512.<the sha512 npm
# published>`, and gives that owner to all of /home/node/.cache/node/corepack,
# the new copy and lastKnownGood.json with it, checking no other owner is left
# there. It removes root's copy and node's 10.33.2, rewrites packageManager in
# /app/package.json, reads it back, checks that node's corepack keeps pnpm
# 10.34.9 alone and root's keeps none, and proves as root that pnpm still does
# not start offline; the last RUN, as node, proves 10.34.9 does.
#
# WHAT IS REPLACED: SYSTEMINFORMATION 5.31.7 BY 5.33.19 (since 2026-11-03), as
# the webapp's build replaces it there (its WHAT IS REPLACED: FOUR PACKAGES
# says why, and HOW THE FOUR ARE SWAPPED how), at
# /app/apps/supervisor/node_modules/.pnpm/systeminformation@5.31.7/node_modules/systeminformation,
# where `pnpm deploy --legacy --prod` (apps/supervisor/Containerfile) put it
# and the scan reads it: 1 fixable high, GHSA-3f7j-7jwc-fxfj. The one package
# that links it is @opentelemetry/host-metrics 0.38.3, under @trigger.dev/core,
# which the supervisor's own source does not import. The deploy resolves the
# tree itself, so the second RUN finds who links the package by the links,
# not by a directory name read from the lockfile. The supervisor's own build,
# dist (tsc, no bundle), must not carry systeminformation's mark. The RUN is
# the webapp's with one row, and runs under BusyBox: so the check that
# nothing else changed is a stat of every entry, which BusyBox's find and
# stat can make (its find has -newer and no -cnewer). After it, about 0, 1
# and 1 (arithmetic): cross-spawn 5.1.0 stays, waiting on upstream
# (triggerdotdev/trigger.dev#5084).
#
# THE USER COUPLING, the webapp's the other way round. No `user:` here, so this
# removes root's copy, installs 10.34.9 in node's home, and proves node's
# starts offline. Upstream's own compose (hosting/docker/worker) runs the
# supervisor `user: root`, with pnpm in its command: a managed.yml that did
# the same would run root's copy, which is gone.
# managed.yml sets COREPACK_ENABLE_NETWORK: "0" on it, so that start stops
# instead of fetching pnpm, and the first RUN proves the refusal as root.
# scripts/a-binary-the-stack-never-runs.unit.test.ts holds the two together.
# Upstream decides the rest: the image's USER (node), its CMD (pnpm) and its
# entrypoint, which only sets NODE_OPTIONS and execs dumb-init. A release that
# ran the supervisor as root, or dropped users in its entrypoint, would run the
# copy that is gone. So the entrypoint read at read_at is pinned by its SHA-256
# below, and images.yml's `build (trigger, …)` checks the base's user, command
# and entrypoint are the ones read.
FROM ghcr.io/triggerdotdev/supervisor:v4.8.3@sha256:60808dded07c856481bd94ac0b6c64637dea828e57e918ca3ca270813feac74b

# Given by managed.yml from the .env, empty when the .env sets none. It only refuses.
ARG TRIGGER_IMAGE_TAG

USER root

RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read this file's header against the new tag, or drop the removal upstream fixed." >&2; exit 1; }; \
    read_at=v4.8.3; \
    core="v$(node -p "require('/app/packages/core/package.json').version")"; \
    if [ -n "${TRIGGER_IMAGE_TAG:-}" ] && [ "$TRIGGER_IMAGE_TAG" != "$core" ]; then \
      echo "$me: the .env names TRIGGER_IMAGE_TAG=$TRIGGER_IMAGE_TAG, and this checkout builds Trigger.dev $core. Either set TRIGGER_IMAGE_TAG=$core in the .env, or run a checkout that pins $TRIGGER_IMAGE_TAG: the release that ran it, or a move to it (trigger-version.sh pin $TRIGGER_IMAGE_TAG, docs/managed-bring-up.md, Upgrading Trigger.dev)." >&2; \
      exit 1; \
    fi; \
    [ "$core" = "$read_at" ] || fail "why the removal is safe was read in Trigger.dev $read_at's source, and this image is $core. Read the header's reasons again at $core (apps/supervisor/Containerfile, apps/supervisor/entrypoint.sh, the image's user and command), then move read_at, and entrypoint_sha256 if the entrypoint changed."; \
    entrypoint=/app/entrypoint.sh; \
    entrypoint_sha256=e3297568d24019a6b4fb597c7914a6510faacdf504a3c3394c73ad30ed6e01b7; \
    [ -f "$entrypoint" ] || fail "$entrypoint is not there."; \
    [ "$(sha256sum "$entrypoint" | cut -d' ' -f1)" = "$entrypoint_sha256" ] || fail "$entrypoint is not the one read at $read_at. Which user runs pnpm decides which copy this file may delete (THE USER COUPLING): read it, then move entrypoint_sha256."; \
    root_pkg=/app/package.json; \
    pm_upstream=pnpm@10.33.2; \
    pnpm_to=10.34.9; \
    pnpm_to_sha512=f49b5a8ea0fdedb44bb3c0c1d6575092a53c2950d95b7ad15df11f17974877a2de3a01c07e934e9b28ce716e51c09a94962c7306d09be2e1e4b18a8c8762fd32; \
    pm="$(node -p "require('$root_pkg').packageManager")"; \
    [ "$pm" = "$pm_upstream" ] || fail "the image names $pm, not $pm_upstream, so corepack keeps pnpm at other paths: upstream moved pnpm: drop the swap to pnpm $pnpm_to (the webapp's THE WAY OUT)."; \
    unused=/root/.cache/node/corepack/v1/pnpm/10.33.2; \
    node_corepack=/home/node/.cache/node/corepack; \
    replaced="$node_corepack/v1/pnpm/10.33.2"; \
    kept="$node_corepack/v1/pnpm/$pnpm_to"; \
    kept_modules="$kept/dist/node_modules"; \
    kept_gyp_bin="$kept/dist/node-gyp-bin"; \
    npm_dir=/usr/local/lib/node_modules/npm; \
    npm_link=/usr/local/bin/npm; \
    npx_link=/usr/local/bin/npx; \
    corepack_dir=/usr/local/lib/node_modules/corepack; \
    [ -f "$unused/.corepack" ] || fail "$unused/.corepack is not there: root's copy of pnpm is not where it was."; \
    [ -d "$unused/dist/node_modules/tar" ] || fail "$unused/dist/node_modules/tar is not there: root's copy of pnpm no longer carries tar."; \
    [ -f "$replaced/.corepack" ] || fail "$replaced/.corepack is not there: node's copy of pnpm $pm_upstream, which this file replaces with $pnpm_to, is not where it was."; \
    [ ! -e "$kept" ] || fail "$kept is there already: corepack would reuse it by its .corepack file alone, unchecked, so this file installs pnpm $pnpm_to only where no copy is."; \
    owner="$(stat -c %u:%g "$replaced/.corepack")"; \
    [ -f "$npm_dir/package.json" ] || fail "$npm_dir is not there: Node's npm is not where Node 24.22.1 puts it."; \
    [ "$(node -p "require('$npm_dir/package.json').version")" = 11.19.1 ] || fail "$npm_dir is not npm 11.19.1, Node 24.22.1's, which this file was read for."; \
    [ ! -e "$npm_dir/npmrc" ] || fail "$npm_dir/npmrc is there: pnpm reads it as its builtin configuration (@pnpm/npm-conf), so without npm pnpm would be configured otherwise."; \
    [ "$(readlink "$npm_link")" = ../lib/node_modules/npm/bin/npm-cli.js ] || fail "$npm_link is not Node's link to npm's bin/npm-cli.js."; \
    [ "$(readlink "$npx_link")" = ../lib/node_modules/npm/bin/npx-cli.js ] || fail "$npx_link is not Node's link to npm's bin/npx-cli.js."; \
    into="$(find /usr/local/bin -type l -exec sh -c 'for link; do case "$(readlink -f "$link")" in "$0"/*) echo "$link" ;; esac; done' "$(readlink -f "$npm_dir")" {} + | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$into" = "$npm_link $npx_link " ] || fail "these link into $npm_dir: ${into:-nothing}, not npm and npx alone."; \
    [ "$(node -p "require('$corepack_dir/package.json').version")" = 0.36.0 ] || fail "$corepack_dir is not corepack 0.36.0, Node 24.22.1's, which runs every pnpm here."; \
    HOME=/home/node corepack install -g "pnpm@$pnpm_to+sha512.$pnpm_to_sha512" || fail "corepack did not install pnpm $pnpm_to by the sha512 npm published for it; nothing is removed yet."; \
    chown -R "$owner" "$node_corepack"; \
    owners="$(find "$node_corepack" -exec stat -c %u:%g {} + | LC_ALL=C sort -u | tr '\n' ' ')"; \
    [ "$owners" = "$owner " ] || fail "under $node_corepack the owners are $owners, not $owner alone, the owner of node's copy of $pm_upstream."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack is not there after the install: corepack put pnpm $pnpm_to elsewhere."; \
    [ "$(node -p "require('$kept/package.json').version")" = "$pnpm_to" ] || fail "$kept is not pnpm $pnpm_to."; \
    [ "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).hash" "$kept/.corepack")" = "sha512.$pnpm_to_sha512" ] || fail "$kept/.corepack does not record the sha512 npm published for pnpm $pnpm_to."; \
    [ -f "$kept_modules/node-gyp/bin/node-gyp.js" ] || fail "$kept_modules/node-gyp/bin/node-gyp.js is not there: node's copy of pnpm does not carry node-gyp where pnpm $pnpm_to did."; \
    [ -d "$kept_gyp_bin" ] || fail "$kept_gyp_bin is not there: node's copy of pnpm does not carry node-gyp's shim where pnpm $pnpm_to did."; \
    names="$(cd "$kept_modules" && for d in *; do case "$d" in @*) for p in "$d"/*; do printf '%s|' "$p"; done ;; *) printf '%s|' "$d" ;; esac; done | sed 's/[.]/\\./g')"; \
    named="$(find "$kept" -path "$kept_modules" -prune -o -type f -name '*js' -exec grep -HoE "(require(\.resolve)?\(|import\(|resolveFrom\([^,()]*, *)[\"'](${names%|})(/[^\"']*)?[\"']" {} + | tr -d "\"'" | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$named" = "$kept/bin/pnpm.cjs:require(v8-compile-cache $kept/dist/pnpm.cjs:require.resolve(picomatch $kept/dist/pnpm.cjs:resolveFrom(__dirname, node-gyp/bin/node-gyp " ] || fail "in $kept, outside $kept_modules, these name a package inside it: ${named:-none}; this file was read for three, each in a try: bin/pnpm.cjs's v8-compile-cache, and dist/pnpm.cjs's picomatch and node-gyp/bin/node-gyp."; \
    rm "$npm_link" "$npx_link"; \
    rm -r "$unused" "$replaced" "$kept_modules" "$kept_gyp_bin" "$npm_dir"; \
    node -e "const fs = require('fs'); const [file, from, to] = process.argv.slice(1); const text = fs.readFileSync(file, 'utf8'); const field = /(\"packageManager\"[ \t]*:[ \t]*\")([^\"]*)(\")/g; const found = [...text.matchAll(field)].map((m) => m[2]); if (found.length !== 1 || found[0] !== from) { console.error(file + ' names packageManager as: ' + (found.join(', ') || 'nothing')); process.exit(1); } fs.writeFileSync(file, text.replace(field, (all, key, value, end) => key + to + end));" "$root_pkg" "$pm_upstream" "pnpm@$pnpm_to" || fail "$root_pkg's packageManager was not rewritten to pnpm@$pnpm_to: the file does not name it once, as $pm_upstream."; \
    pm="$(node -p "require('$root_pkg').packageManager")"; \
    [ "$pm" = "pnpm@$pnpm_to" ] || fail "$root_pkg names $pm after the rewrite, not pnpm@$pnpm_to: corepack would look for a copy this file removed."; \
    for p in "$unused" "$replaced" "$kept_modules" "$kept_gyp_bin" "$npm_dir" "$npm_link" "$npx_link"; do { [ ! -e "$p" ] && [ ! -L "$p" ]; } || fail "$p is still there."; done; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack went with the removal."; \
    pnpm_copies="$(find "${kept%/*}" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$pnpm_copies" = "$pnpm_to " ] || fail "${kept%/*} holds ${pnpm_copies}and not pnpm $pnpm_to alone: a copy this file was not read for."; \
    pnpm_copies="$(find "${unused%/*}" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort | tr '\n' ' ')"; \
    [ -z "$pnpm_copies" ] || fail "${unused%/*} still holds ${pnpm_copies}after the removals: a copy this file was not read for."; \
    [ "$(node -p "require('$corepack_dir/package.json').version")" = 0.36.0 ] || fail "corepack 0.36.0 went with npm."; \
    if (cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --version) >/dev/null 2>&1; then \
      fail "as root, pnpm still starts offline, so a copy of pnpm $pnpm_to is in root's home, or corepack reads another home."; \
    fi; \
    echo "$me: removed root's copy of pnpm, node's $pm_upstream for pnpm $pnpm_to (by the sha512 npm published, packageManager rewritten, owned as node's was), node-gyp's tree from node's and npm; corepack 0.36.0 stays, and as root pnpm does not start offline, as it should not: the supervisor runs as node."

# Still as root: systeminformation 5.31.7's files replaced by 5.33.19's, as npm
# published them (WHAT IS REPLACED: SYSTEMINFORMATION, above).
RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read deploy/compose/trigger.dev/Dockerfile's WHAT IS REPLACED: FOUR PACKAGES against this image, or drop the row of a package upstream moved (its THE WAY OUT)." >&2; exit 1; }; \
    s=/app/apps/supervisor/node_modules/.pnpm; \
    bundles=/app/apps/supervisor/dist; \
    top=/; \
    rows() { \
      "$@" systeminformation 5.31.7 77226a7b179b8ebd183348773c2f8505c10b1cc0825036541983037cda8be543 5.33.19 dc01111094ab84ace2da139f1c6e612a888c4d275cb993740f7a520b7851bb38 sha512-Zm7wGeCG7PqfvzegMJIzrxICopWqYCeLATVmvxOOci1isLcNVKgY4Fr0hhYQzvc7cgtK3377jQVChTFAnznOiA== 'cat /sys/class/net/' systeminformation,systeminformation/lib/network @opentelemetry/host-metrics@0.38.3; \
    }; \
    version() { node -p "require(process.argv[1] + '/package.json').version" "$1"; }; \
    files() { (cd "$1" && find . -path ./node_modules -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }; \
    own() { if [ -d "$1/node_modules" ]; then (cd "$1/node_modules" && find . ! -type d -exec sha256sum {} + | LC_ALL=C sort); fi; }; \
    tree() { files "$1" | sha256sum | cut -d' ' -f1; }; \
    state() { { find "$top" -xdev \( $prune \) -prune -o -type d -exec stat -c '%n %u:%g %a' {} + ; find "$top" -xdev \( $prune \) -prune -o ! -type d -exec stat -c '%n %u:%g %a %s %Y %Z' {} + ; } | LC_ALL=C sort | sha256sum | cut -d' ' -f1; }; \
    who="const fs = require('fs'); const path = require('path'); const [s, pkg, name] = process.argv.slice(1); const real = fs.realpathSync(pkg); const out = []; for (const d of fs.readdirSync(s)) { if (d === 'node_modules') continue; const nm = path.join(s, d, 'node_modules'); let st; try { st = fs.lstatSync(path.join(nm, name)); } catch { continue; } if (!st.isSymbolicLink() || fs.realpathSync(path.join(nm, name)) !== real) continue; const own = []; for (const e of fs.readdirSync(nm)) { for (const x of e.startsWith('@') ? fs.readdirSync(path.join(nm, e)).map((y) => e + '/' + y) : [e]) { const p = path.join(nm, x); if (!fs.lstatSync(p).isSymbolicLink() && fs.existsSync(path.join(p, 'package.json'))) own.push(p); } } if (own.length !== 1) { out.push('unknown ' + nm); continue; } const j = JSON.parse(fs.readFileSync(path.join(own[0], 'package.json'), 'utf8')); out.push(j.name + '@' + j.version + ' ' + own[0]); } if (out.length) console.log(out.sort().join('\n'));"; \
    same="const fs = require('fs'); const [n, v, ...files] = process.argv.slice(1); for (const f of files) { let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { console.log('unreadable:' + f); continue; } if (j.name === n && j.version === v) console.log(f); }"; \
    deps="const fs = require('fs'); const path = require('path'); const real = fs.realpathSync(process.argv[1]); const j = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8')); for (const d of Object.keys(j.dependencies || {})) { const p = fs.realpathSync(require.resolve(d, { paths: [real] })); require(p); console.log('dependency ' + d + ': ' + p); }"; \
    load="const fs = require('fs'); const path = require('path'); const [pkg, name, to, list] = process.argv.slice(1); const specs = list.split(','); const real = fs.realpathSync(pkg); const pj = fs.realpathSync(require.resolve(name + '/package.json')); const v = require(name + '/package.json').version; if (pj !== path.join(real, 'package.json') || v !== to) { console.error('require(' + name + '/package.json) is ' + pj + ' ' + v); process.exit(1); } for (const sp of specs) { const p = fs.realpathSync(require.resolve(sp)); if (!p.startsWith(real + path.sep)) { console.error('require(' + sp + ') resolves ' + p); process.exit(1); } const m = require(sp); for (const k of Object.keys(m)) void m[k]; console.log('require(' + sp + '): ' + p + ' ' + v); }"; \
    check() { \
      name=$1; from=$2; from_tree=$3; mark=$7; shift 8; pkg="$s/$name@$from/node_modules/$name"; \
      [ -f "$pkg/package.json" ] || fail "$pkg is not there."; \
      [ "$(version "$pkg")" = "$from" ] || fail "$pkg is $name $(version "$pkg"), not $from."; \
      [ -z "$(find "$pkg" -path "$pkg/node_modules" -prune -o ! -type f ! -type d -print)" ] || fail "$pkg holds more than files and directories (pnpm's own node_modules in it aside)."; \
      [ "$(tree "$pkg")" = "$from_tree" ] || { files "$pkg" >&2; fail "$pkg is not the published $name $from, file for file (above)."; }; \
      found="$(node -e "$who" "$s" "$pkg" "$name")" || fail "the packages that link $pkg could not be read."; \
      [ "$(printf '%s\n' "$found" | cut -d' ' -f1 | LC_ALL=C sort -u | tr '\n' ' ')" = "$(printf '%s\n' "$@" | LC_ALL=C sort -u | tr '\n' ' ')" ] || fail "$name $from is linked from: ${found:-nothing}; this file was read for $*."; \
      if [ -L "$s/node_modules/$name" ] && [ "$(readlink -f "$s/node_modules/$name")" = "$(readlink -f "$pkg")" ]; then echo "$me: pnpm hoists $name $from too: $s/node_modules/$name"; fi; \
      copies="$(find "$top" -xdev -type f -path "*/$name/package.json" -exec node -e "$same" "$name" "$from" {} +)" || fail "the copies of $name could not be read."; \
      [ "$copies" = "$pkg/package.json" ] || fail "$name $from's package.json is at: ${copies:-nowhere}; this file replaces $pkg alone (other versions of $name stay)."; \
      found="$(grep -rlF -e "$mark" $bundles)" && st=0 || st=$?; \
      [ "$st" = 1 ] || fail "the supervisor's own build carries $name's $mark (grep exits $st): ${found:-}. A copy bundled there is not the package this replaces."; \
    }; \
    pruned() { prune="$prune -o -path $s/$1@$2/node_modules/$1"; }; \
    fetched() { \
      name=$1; from=$2; to=$4; to_tree=$5; want=$6; pkg="$s/$name@$from/node_modules/$name"; url="https://registry.npmjs.org/$name/-/$name-$to.tgz"; \
      node -e "fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(process.argv[1] + ' answered ' + r.status); require('fs').writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); })" "$url" "$tmp/$name.tgz" || fail "$url could not be fetched; nothing was changed."; \
      got="$(node -p "'sha512-' + require('crypto').createHash('sha512').update(require('fs').readFileSync(process.argv[1])).digest('base64')" "$tmp/$name.tgz")"; \
      [ "$got" = "$want" ] || fail "$url is $got, not $want, the integrity npm published for $name $to; nothing was changed."; \
      mkdir "$tmp/$name"; \
      tar -xzf "$tmp/$name.tgz" -C "$tmp/$name" --no-same-owner || fail "$url does not unpack; nothing was changed."; \
      new="$tmp/$name/package"; \
      [ "$(version "$new")" = "$to" ] || fail "$url unpacks to $name $(version "$new"), not $to; nothing was changed."; \
      [ ! -e "$new/node_modules" ] || fail "$url unpacks a node_modules of its own; nothing was changed."; \
      { [ -z "$(find "$new" ! -type f ! -type d)" ] && [ "$(tree "$new")" = "$to_tree" ]; } || { files "$new" >&2; fail "$url unpacks to other files than the published $name $to (above); nothing was changed."; }; \
      chown -R "$(stat -c %u:%g "$pkg/package.json")" "$new"; \
      own "$pkg" > "$tmp/$name.own"; \
    }; \
    swapped() { if [ -e "$s/$1@$2/node_modules/$1/node_modules" ]; then mv "$s/$1@$2/node_modules/$1/node_modules" "$tmp/$1/package/node_modules"; fi; rm -r "$s/$1@$2/node_modules/$1"; mv "$tmp/$1/package" "$s/$1@$2/node_modules/$1"; }; \
    proven() { \
      name=$1; from=$2; to=$4; to_tree=$5; pkg="$s/$name@$from/node_modules/$name"; \
      { [ "$(version "$pkg")" = "$to" ] && [ "$(tree "$pkg")" = "$to_tree" ]; } || fail "$pkg is not the published $name $to after the swap."; \
      [ "$(own "$pkg")" = "$(cat "$tmp/$name.own")" ] || fail "$pkg/node_modules, pnpm's own (a bin shim), is not what it was before the swap."; \
    }; \
    loaded() { \
      name=$1; from=$2; to=$4; specs=$8; pkg="$s/$name@$from/node_modules/$name"; \
      node -e "$deps" "$pkg" || fail "a dependency $name $to declares does not load from $pkg."; \
      found="$(node -e "$who" "$s" "$pkg" "$name")" || fail "the packages that link $pkg could not be read."; \
      [ -n "$found" ] || fail "nothing links $pkg after the swap."; \
      for r in $(printf '%s\n' "$found" | cut -d' ' -f2); do \
        (cd "$r" && node -e "$load" "$pkg" "$name" "$to" "$specs") || fail "from $r, $name does not load $to from $pkg."; \
      done; \
    }; \
    for d in $bundles; do [ -d "$d" ] || fail "$d is not there: the build is not where it was read."; done; \
    rows check; \
    tmp="$(mktemp -d)"; \
    prune="-path $tmp"; \
    rows pruned; \
    before="$(state)"; \
    rows fetched; \
    rows swapped; \
    rows proven; \
    [ "$(state)" = "$before" ] || fail "outside the swapped directories, a path was added or removed, or an entry's owner, mode, size or times changed, while they were replaced."; \
    rm -r "$tmp"; \
    rows loaded; \
    echo "$me: systeminformation 5.31.7 is 5.33.19, as npm published it; nothing else in the image changed; from @opentelemetry/host-metrics, require loads it."

# Upstream's own user, which this image keeps.
USER node

# As node, the user the supervisor runs as, the kept copy starts offline and,
# without node-gyp's tree (tar was in it), runs a command in the supervisor's
# package as the CMD does.
RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    [ "$(cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --version)" = 10.34.9 ] || { echo "$me: as node, the user trigger-supervisor runs as, pnpm 10.34.9 does not start offline." >&2; exit 1; }; \
    (cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter supervisor exec node -e 0) || { echo "$me: as node, pnpm without node-gyp's tree does not run a command in the supervisor's package offline, as its CMD needs." >&2; exit 1; }; \
    echo "$me: as node, pnpm 10.34.9 starts and runs a workspace command offline."
