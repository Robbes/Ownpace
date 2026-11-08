# Trigger.dev's Redis (managed.yml's trigger-redis), built here: Redis's
# official image at the pinned digest, with the Debian packages nothing here
# runs or loads purged, and run as its own user, uid and gid 999, from its
# first process (workplan 0119 §3 item 11, extended to this image for alpha.6
# by the owner on 2026-11-07: "Redis purge in 6"). Redis itself, its command,
# its volume and its append-only file are as they were.
#
# WHY. `redis:7.4.12-bookworm` is Debian 12.15 (debian.sh's bookworm), tzdata
# from apt, and Redis 7.4.12 built from source with TLS: redis-server (also
# named redis-check-aof, redis-check-rdb and redis-sentinel), redis-cli and
# redis-benchmark. Security Scan run 42330688192 (Trivy 0.76.1, linux/arm64,
# 2026-11-07) read it at 1 critical, 34 high and 0 with a fix: 35 findings in
# 17 packages, none of them with a fix in Debian. 24 of the highs are three in
# each of the eight packages built from util-linux's source that it has. Of the
# rest, the one high in libsystemd0 and the one in libudev1 go too since
# 2026-11-08 (below), and these stay: the critical and two highs in zlib1g (the
# critical is zlib's minizip, CVE-2023-45853, which zlib1g does not ship and
# Redis does not use), and one high each in gzip, libacl1, libtinfo6,
# ncurses-base, ncurses-bin and perl-base.
#
# THE DEBIAN PACKAGES NOTHING RUNS (since 2026-11-07, for alpha.6; workplan
# 0119 §3 item 11, the owner's decision of 2026-11-03 for the appliance and the
# tasks' base, extended to the Trigger.dev webapp's image and confirmed by the
# owner on 2026-11-07, and to this one by the owner the same day: "Redis purge
# in 6"; libsystemd0 and libudev1 since 2026-11-08, for alpha.7, on the
# owner's answer that day, "Build the recommended for alpha 7.", where the
# recommendation for these two was yes). The list is the webapp's
# (deploy/compose/trigger.dev/Dockerfile), read again against this image:
#   - the eight packages built from util-linux's source: util-linux,
#     util-linux-extra, mount, bsdutils, libblkid1, libmount1, libsmartcols1
#     and libuuid1, three highs with no fix in Debian in each (24);
#   - apt 2.6.2 and libapt-pkg6.0 2.6.2, which carry no finding here (2.6.2 is
#     the release that fixed CVE-2026-109518, the tag's rebuild of 2026-11-05)
#     and which nothing here runs: nothing installs in this container, and a
#     change is a rebuild;
#   - e2fsprogs 1.47.0-2+b2, which carries no finding of its own and
#     pre-depends on libblkid1 and libuuid1, so dpkg refuses to purge those two
#     while it stays (the webapp's first build, 2026-11-06);
#   - libsystemd0 and libudev1 252.39-1~deb12u2, systemd's two libraries, one
#     high each with no fix in Debian, which only apt, libapt-pkg6.0,
#     util-linux and bsdutils depend on here, all four on this list.
# So 1, 34 and 0 became 1, 10 and 0 with the first eleven (measured on its
# branch: Security Scan run 42349123410), and the two take it to 1, 8 and 0.
# util-linux-extra goes with util-linux, which hard-depends on it in Debian 12,
# and libapt-pkg6.0 with apt, its one user here. e2fsprogs goes alone: its
# libraries (libext2fs2, libss2, libcom-err2) and logsave stay, and need only
# libc6 and libcom-err2. What libsystemd0 and libudev1 depend on stays (libc6,
# libcap2, libgcrypt20, liblz4-1, liblzma5 and libzstd1): dpkg purges only
# what it is given. This image's dpkg status (the fourth of its seven layers,
# sha256:1b21ec79… on linux/arm64 and sha256:f43705d7… on linux/amd64, read
# 2026-11-08 by their digests) has 89 packages installed, and no other
# installed package depends on one of the thirteen, and none on e2fsprogs.
# libsystemd0 and libudev1 are Priority optional, neither Essential nor
# protected, and run no maintainer script, only ldconfig's trigger. What else
# carries a finding stays because something that stays needs it: zlib1g
# (dpkg), libacl1 (coreutils, sed and tar), libtinfo6 (bash), and gzip,
# ncurses-base, ncurses-bin and perl-base, which Debian marks Essential
# (perl-base runs the checks below).
#
# WHY NOTHING RUNS THEM, read 2026-11-07 in the image's layers, each by its
# digest (linux/arm64):
#   - What starts in trigger-redis: managed.yml's `redis-server --appendonly
#     yes` through upstream's entrypoint, /usr/local/bin/docker-entrypoint.sh
#     (the last of the seven layers, sha256:ce6a4e98…; the file's SHA-256 is
#     f8122ddc…). As uid 999 (THE USER, below) the entrypoint is /bin/sh, dash,
#     and runs `id -u` and redis-server, and nothing else. The healthcheck is
#     `redis-cli ping`. What execs into the container is plane-tokens.sh's
#     redis-cli and the guide's `find`, which reads who owns /data (THE USER,
#     below). Redis forks itself to save and rewrite its files, and execs
#     nothing.
#   - None of those programs is apt's, util-linux's or e2fsprogs': dash,
#     coreutils (id), findutils (find), redis-server and redis-cli. Nothing
#     execs apt, apt-get, su, mount, setpriv, getopt, logger, more, mke2fs,
#     e2fsck or any other program of the thirteen into the container, and
#     nothing installs a package in it. libsystemd0 and libudev1 have no
#     program: they are libraries alone.
#   - What links their libraries (libuuid.so.1, libblkid.so.1, libmount.so.1,
#     libsmartcols.so.1, libapt-pkg.so.6.0, libapt-private.so.0.0,
#     libsystemd.so.0 and libudev.so.1): Redis's three binaries need libm,
#     libssl, libcrypto and libc (`readelf -d`), and OpenSSL 3.0.22's
#     libraries (libssl3, which upstream's build keeps for TLS) need libcrypto
#     and libc. No ELF file of the layer they are in names one of the first
#     six; ldconfig's two caches there do, which are not ELF files. Read again
#     for the two on 2026-11-08, `readelf -d` of every ELF file of the image
#     (702 on linux/arm64, 703 on linux/amd64): only util-linux's findmnt,
#     lsblk and lslogins, bsdutils' logger, apt's http method and
#     libapt-pkg.so.6.0.0 need libsystemd.so.0 or libudev.so.1, all six purged
#     with their packages, and no other ELF file but the two libraries
#     themselves names either. redis-server names libsystemd only in a
#     message, that it was built without it. The build reads the image itself
#     after the purge (below).
#
# HOW THEY ARE PURGED, AND PROVED. The one RUN as root, as the webapp's purge
# is the last of its own:
#   1. `dpkg-query -W` of exactly the thirteen, first: a package renamed or
#      gone stops the build before anything is purged (a list to read again,
#      not a name to skip).
#   2. `dpkg --audit` reads nothing in the image as upstream left it, and the
#      thirteen ship the eight libraries (`dpkg-query -L`), so the checks in 5
#      and 6 do not look for names nothing had.
#   3. `dpkg --purge --force-remove-essential --force-remove-protected`, the
#      two flags of the owner's decision, and no other force. Debian marks
#      util-linux and bsdutils Essential. Without --force-depends, dpkg refuses
#      to remove what an installed package still depends on, so a base where
#      one does stops the build, as e2fsprogs stopped the webapp's first one. A
#      package that joins the base and depends on one of the thirteen stops the
#      build here the same way: no dependency is left dangling.
#   4. `dpkg --audit` reads nothing after, and dpkg reads each of the thirteen
#      as gone (no record, or not-installed).
#   5. No file of the eight is left under / (the image's own file system,
#      walked whole) by its name, the library or a link to it, wherever it is.
#      And no ELF file needs one: its DT_NEEDED entries, read from its program
#      headers and its dynamic section as the dynamic loader reads them, 32- or
#      64-bit, either byte order. An ELF file whose dynamic section cannot be
#      read counts as needing a library when it names it, since what an ELF
#      file needs is a string in it; and the check fails when it read no ELF
#      file that needs a library at all.
#   6. No ELF file under / names one of the eight, so nothing left links them
#      or opens them by name. The checks are perl's, perl-base's, which Debian
#      marks Essential and this image keeps, as the webapp's are node's: this
#      image has no node. 5 and 6 run in this RUN, as root, who can read every
#      directory, and nothing after it installs a package.
#   7. The programs this stack runs here start: sh, id, find, redis-server and
#      redis-cli. The RUN after `USER 999:999` starts redis-server through
#      upstream's entrypoint, as the image's user, and asks it for the release
#      the FROM names.
# The appliance's purge ended with `apt-get check`, which needs apt, and apt is
# on this list. So `dpkg --audit` takes its place, and its output is read, not
# its exit status: dpkg exits 0 when it lists problems. The half of apt-get
# check a purge could break, a dependency left unmet, is dpkg's own refusal in
# 3. The build needs no network: dpkg purges from its own database.
# The risk accepted, as for the appliance and the webapp: Debian does not test
# a system without its Essential packages; this one runs Redis. And
# trigger-redis has no apt: nothing installs in it, and a fix is a rebuild.
# images.yml's `build (redis, amd64|arm64)` runs this RUN on the real image on
# both platforms, where a wrong reading stops the build (dpkg's refusal, or a
# check above), and E2E (managed) runs what it built.
# scripts/an-essential-nothing-runs.unit.test.ts holds the list, the shape and
# these reasons; scripts/a-binary-the-stack-never-runs.unit.test.ts runs the
# RUN over its stand-in, with a stand-in dpkg.
#
# THE USER. Upstream's image sets no USER: it starts as root, and its
# entrypoint, given redis-server as root, chowns whatever in /data is not
# redis's (`find . \! -user redis -exec chown redis '{}' +`) and drops to redis
# with util-linux's setpriv (`exec /usr/bin/setpriv --reuid redis --regid
# redis --clear-groups "$0" "$@"`). setpriv goes with util-linux, so this image
# runs as 999:999 from its first process: redis and its group, which
# upstream's first RUN made (`groupadd -r -g 999 redis; useradd -r -g redis -u
# 999 redis`), and no other group, as setpriv's --clear-groups left it. The
# entrypoint then takes its other branch only: it is not root, so it sets umask
# 0077 when it finds 0022 and execs the command, which is what setpriv's exec
# of it did as 999 before. managed.yml's trigger-redis adds no capability: the
# four it added (CHOWN, DAC_READ_SEARCH, SETGID, SETUID) were the root branch's.
# THE VOLUME CARRIES OVER. Upstream's entrypoint chowned every file in /data
# that was not redis's at every start, and the server wrote the rest as 999,
# so a volume that image ran on is 999's throughout; the server, as 999 again,
# reads its append-only file as before. A new volume takes the image's /data,
# which upstream's RUN made redis:redis. Nothing chowns /data any more, so a
# file put there by another user would stay that user's: docs/managed-bring-up.md
# gives the read-only check to run before a deploy that takes this, as uid 999
# (`find /data ! -user 999`, which prints nothing). The way back is a tag before
# this, which runs upstream's image as root again: its entrypoint finds /data
# 999's, as this left it, and drops to 999 as before. An exec into
# trigger-redis runs as uid 999 too; what this repository runs there is
# redis-cli, over TCP, which answers the same.
#
# THE NAME. managed.yml builds this as `localhost/redis:<base tag>-<12 hex>`,
# a name no registry serves, with `pull_policy: never`, as
# deploy/compose/postgres/Dockerfile's header says for the databases. The
# twelve hex digits are the SHA-256 of this file's instruction lines, comments
# and blank lines left out,
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/redis/Dockerfile | sha256sum | cut -c1-12
# so a changed instruction is a name the machine does not have yet, and `up`
# builds it. Nothing builds it while the machine has the name (managed.yml's
# header). scripts/an-essential-nothing-runs.unit.test.ts holds the image line
# to it, and when an instruction changes, its failure prints the `sed` that
# moves the line. A FROM, two RUNs and the USER between them, and nothing
# else: no parser directive, no COPY, no ADD and no --mount, so the name is the
# content.
#
# HOW IT MOVES.
#   - A newer Redis 7.4, or a rebuild of the tag: Dependabot's pull request
#     (.github/dependabot.yml, this directory's own entry, never a major). A
#     rebuild passes when the base still has the thirteen and nothing new
#     depends on them; a new release stops at the last RUN, which asks
#     redis-server for the FROM's release: re-read the image's packages and
#     scan, then move the release that RUN names and this header. That
#     changes the name, which fails the guard until managed.yml's image line
#     moves too, and the failure prints the `sed`. images.yml's `build (redis,
#     amd64|arm64)` builds it on the pull request, starts upstream's image on
#     a new volume as managed.yml ran it before this build, then this build on
#     that volume as managed.yml runs it now, and asks it for PONG and the key
#     written there; then dispatch E2E (managed) on the branch.
#   - Another major: the owner's call (0119 §3 item 3), and Dependabot is told
#     to leave it.
FROM redis:7.4.12-bookworm@sha256:2e3eb11462c4e3759e6972678dd051d150ff54b1e60714b3c33b701260172a90

# As root, the one RUN that is: the Debian packages nothing here runs or loads,
# purged (THE DEBIAN PACKAGES NOTHING RUNS, above).
RUN set -eu; \
    me=deploy/compose/redis/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read the header's THE DEBIAN PACKAGES NOTHING RUNS against this image; a package leaves the list, or joins it, only with its reason." >&2; exit 1; }; \
    purge="util-linux util-linux-extra mount bsdutils libblkid1 libmount1 libsmartcols1 libuuid1 apt libapt-pkg6.0 e2fsprogs libsystemd0 libudev1"; \
    libraries="libuuid.so.1 libblkid.so.1 libmount.so.1 libsmartcols.so.1 libapt-pkg.so.6.0 libapt-private.so.0.0 libsystemd.so.0 libudev.so.1"; \
    top=/; \
    needs='my ($top, @names) = @ARGV; my $dev = (stat $top)[0]; my ($read, $dyn, $unread) = (0, 0, 0); my @hits; sub needed { my ($b) = @_; my $l = length $b; my $u = sub { my ($at, $n, $f) = @_; die "short\n" if $at < 0 || $at + $n > $l; return unpack($f, substr($b, $at, $n)); }; my ($c, $o) = ($u->(4, 1, "C"), $u->(5, 1, "C")); die "class\n" unless ($c == 1 || $c == 2) && ($o == 1 || $o == 2); my $w = $c == 2 ? 8 : 4; my ($h, $i) = $o == 1 ? ("v", "V") : ("n", "N"); my $x = $w == 8 ? ($o == 1 ? "Q<" : "Q>") : $i; my ($phoff, $phsz, $phnum) = $w == 8 ? ($u->(32, 8, $x), $u->(54, 2, $h), $u->(56, 2, $h)) : ($u->(28, 4, $x), $u->(42, 2, $h), $u->(44, 2, $h)); my (@load, @dyn); for my $k (0 .. $phnum - 1) { my $p = $phoff + $k * $phsz; my $t = $u->($p, 4, $i); my @f = $w == 8 ? ($u->($p + 8, 8, $x), $u->($p + 16, 8, $x), $u->($p + 32, 8, $x)) : ($u->($p + 4, 4, $x), $u->($p + 8, 4, $x), $u->($p + 16, 4, $x)); push @load, \@f if $t == 1; @dyn = @f if $t == 2; } return [] unless @dyn; my ($str, @need); for (my $p = $dyn[0]; $p + 2 * $w <= $dyn[0] + $dyn[2]; $p += 2 * $w) { my ($t, $v) = ($u->($p, $w, $x), $u->($p + $w, $w, $x)); last if $t == 0; push @need, $v if $t == 1; $str = $v if $t == 5; } return [] unless @need; die "no DT_STRTAB\n" unless defined $str; my ($at) = map { $str - $_->[1] + $_->[0] } grep { $str >= $_->[1] && $str < $_->[1] + $_->[2] } @load; die "DT_STRTAB in no PT_LOAD\n" unless defined $at; return [map { my $s = $at + $_; my $e = $s < $l ? index($b, "\0", $s) : -1; die "a name past the end\n" if $e < 0; substr($b, $s, $e - $s) } @need]; } sub walk { my ($d) = @_; opendir(my $hd, $d) or die "cannot read $d: $!\n"; my @e = sort grep { $_ ne "." && $_ ne ".." } readdir $hd; closedir $hd; for my $e (@e) { my $p = $d eq "/" ? "/$e" : "$d/$e"; my @s = lstat $p or die "cannot stat $p: $!\n"; if (-d _) { walk($p) if $s[0] == $dev; next; } for my $n (@names) { push @hits, "$p: a file of $n is left" if $e eq $n || index($e, "$n.") == 0; } next if !-f _ || $s[7] < 4; open(my $f, "<:raw", $p) or die "cannot open $p: $!\n"; my $m = ""; read($f, $m, 4); if ($m ne "\x7fELF") { close $f; next; } my $b = do { local $/; <$f> }; close $f; $b = $m . (defined $b ? $b : ""); $read++; my $need = eval { needed($b) }; if (!$need) { $unread++; for my $n (@names) { push @hits, "$p: names $n, and its dynamic section cannot be read" if index($b, $n) >= 0; } next; } $dyn++ if @$need; for my $n (@names) { push @hits, "$p: needs $n" if grep { $_ eq $n } @$need; } } } walk($top); print STDERR "$read ELF files read under $top, $dyn of them needing a library, $unread whose dynamic section could not be read\n"; exit 2 if $dyn == 0; if (@hits) { print join(" ", @hits), "\n"; exit 1; }'; \
    elves='my ($top, @names) = @ARGV; my $dev = (stat $top)[0]; my $read = 0; my @hits; sub walk { my ($d) = @_; opendir(my $h, $d) or die "cannot read $d: $!\n"; my @e = sort grep { $_ ne "." && $_ ne ".." } readdir $h; closedir $h; for my $e (@e) { my $p = $d eq "/" ? "/$e" : "$d/$e"; my @s = lstat $p or die "cannot stat $p: $!\n"; if (-d _) { walk($p) if $s[0] == $dev; next; } next if !-f _ || $s[7] < 4; open(my $f, "<:raw", $p) or die "cannot open $p: $!\n"; my $m = ""; read($f, $m, 4); if ($m ne "\x7fELF") { close $f; next; } my $b = do { local $/; <$f> }; close $f; $b = $m . (defined $b ? $b : ""); $read++; for my $n (@names) { push @hits, "$p: $n" if index($b, $n) >= 0; } } } walk($top); print STDERR "$read ELF files read under $top\n"; exit 2 if $read == 0; if (@hits) { print join(" ", @hits), "\n"; exit 1; }'; \
    dpkg-query -W $purge || fail "dpkg-query does not find every one of: $purge (above). A package renamed or gone is a list to read again, not a name to skip; nothing was purged."; \
    audit="$(dpkg --audit)" || fail "dpkg --audit did not run; nothing was purged."; \
    [ -z "$audit" ] || fail "dpkg --audit reads problems in the image as upstream left it, before anything was purged: $audit"; \
    listed="$(dpkg-query -L $purge)" || fail "dpkg-query -L does not list the files of: $purge; nothing was purged."; \
    for l in $libraries; do case "$listed" in *"/$l"*) ;; *) fail "none of $purge ships $l, which this file was read for, so the scan after the purge would look for a name nothing had; nothing was purged." ;; esac; done; \
    dpkg --purge --force-remove-essential --force-remove-protected $purge || fail "dpkg did not purge every one of: $purge (above). Without --force-depends it refuses to remove what an installed package depends on: read the package it names, then take the one it would break off the list or put the one that depends on it on it, each with its reason; this image was not built."; \
    audit="$(dpkg --audit)" || fail "dpkg --audit did not run after the purge."; \
    [ -z "$audit" ] || fail "after the purge, dpkg --audit reads: $audit"; \
    for p in $purge; do st="$(dpkg-query -W -f '${db:Status-Status}' "$p" 2>/dev/null)" && rc=0 || rc=$?; case "$rc:$st" in 1:|0:not-installed) ;; *) fail "after the purge, dpkg reads $p as '$st' (dpkg-query exits $rc), not gone." ;; esac; done; \
    left="$(perl -e "$needs" "$top" $libraries)" && st=0 || st=$?; \
    [ "$st" = 0 ] || fail "after the purge, a file of a library it removed is left, or an ELF file needs one (DT_NEEDED), or the check read no ELF file that needs a library at all (perl exits $st): ${left:-none named}"; \
    found="$(perl -e "$elves" "$top" $libraries)" && st=0 || st=$?; \
    [ "$st" = 0 ] || fail "after the purge, an ELF file names a library it removed, or the scan read none (perl exits $st): ${found:-none named}"; \
    sh -c : || fail "sh, which runs upstream's entrypoint, does not start after the purge."; \
    for c in id find redis-server redis-cli; do "$c" --version >/dev/null 2>&1 || fail "$c, which this stack runs here, does not start after the purge."; done; \
    echo "$me: purged $purge; dpkg's audit reads nothing, no file of $libraries is left and no ELF file needs or names one, and sh, id, find, redis-server and redis-cli start."

# Redis's own user and group from the first process (THE USER, above).
USER 999:999

# As 999: upstream's entrypoint starts redis-server without its root branch,
# and redis-server is the release the FROM names.
RUN set -eu; \
    me=deploy/compose/redis/Dockerfile; \
    who="$(id -u):$(id -g)"; \
    [ "$who" = 999:999 ] || { echo "$me: this RUN runs as $who, not 999:999: the USER above is not redis's. Re-read the header's THE USER." >&2; exit 1; }; \
    said="$(docker-entrypoint.sh redis-server --version)" || { echo "$me: upstream's entrypoint did not start redis-server as $who. Re-read the header's THE USER against this image." >&2; exit 1; }; \
    case "$said" in "Redis server v=7.4.12 "*) ;; *) echo "$me: redis-server --version printed '$said', not Redis 7.4.12, the FROM's release: re-read the header" >&2; exit 1 ;; esac; \
    echo "$me: as $who, upstream's entrypoint starts redis-server: $said"
