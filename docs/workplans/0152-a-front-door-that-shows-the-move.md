# Workplan 0152 — A front door that shows the move

> **In one line:** The public site explains a move at a glance: old account and new home in one picture, the destinations named, the alpha said, a shorter menu, a calculator that ends in a button, monthly and yearly prices (a year costs six months), and a page per provider a person leaves.

## Status — 2026-10-31 (update this block at the end of every session)

**2026-10-31: `llms.txt` links the maintained documentation, as ADR-0029 says** (branch
`claude/ownpace-public-readiness-y7orc6-llms-txt-maintained-docs`). The entry below left it owed,
with no task holding it; it is T5 (c)'s now, beside the pages' lines. After the two language
sections come five more, one per topic an assistant explaining the product is asked about, with
fourteen documents between them: *What it is* (`README.md`, the feature matrix, `OPERATIVE.md`),
*How data moves* (the solution architecture, rollback), *Security and privacy* (`SECURITY.md`,
the RLS guide, the breach procedure), *Self-hosting* (the quickstart, the Windows runbook, ending
the service) and *The Alpha* (0131, 0134, `CHANGELOG.md`). The list is `MAINTAINED_DOCS` in
`site/maintained-docs.mjs`. No visible sentence changes, and no legal text.
- **Listed, not restated.** Each line is `- [the document's own first heading](its address)`, with
  no notes after the link; the topic names are the only words written for `llms.txt`.
- **The Markdown on `main`, not a release tag, and not GitHub's page.** The address is
  `https://raw.githubusercontent.com/Robbes/Ownpace/main/<path>`, derived from `REPOSITORY_URL`
  in `site/proof.mjs`. `main`, because a check can only vouch for the tree it runs in, which is
  what lands on `main`; because these are the maintained documents and `main` is where they are
  maintained, where a tag would keep a workplan's Status as it stood at the release; and because
  the site's other links into the repository are on `main` too. The raw file, because GitHub's
  `blob` page for `SECURITY.md` was 214,016 bytes of HTML with the text in a JSON payload for its
  script, against 7,293 bytes of `text/plain; charset=utf-8` Markdown, and ADR-0029's first rule
  is content readable without JavaScript. All fourteen answered `200 text/plain; charset=utf-8`
  on 2026-10-31. The cost, in the module's header: live's site is built from a tag and links
  `main`, so a document renamed on `main` after the tag is a dead link on live until the next
  release's deploy.
- **A rename fails the change that makes it.** `node scripts/llms-docs.mjs --check` checks that
  every listed document is a Markdown file in the tree and opens with the `# ` heading the list
  copies, and names what to change when one does not. It runs in CI's `docs-hygiene`, on every
  change, docs-only ones included: three of the fourteen are on paths `detect-changes` skips the
  unit suite for. Not in `site/build.mjs`, because live's deploy test-builds the site from
  `git archive <tag> site package.json`, where no document is; the build reads the list, never
  the documents.
- **Guard:** `scripts/a-doc-an-assistant-is-sent-to.unit.test.ts`, 10 cases: the real tree passes
  the check, over the five topics and the fourteen paths spelled out, so a document dropped from
  the list is a change made twice and `docs/LESSONS.md` names the guard under thirteen of them
  (the root README's basename is ambiguous, so the index cannot place it); the heading read past a
  comment and a fence; `llms.txt` holding
  exactly the list after the pages, in the Alpha's build and the other, at the raw address on
  `main`, no notes, no `/blob/`; the raw address derived, not written again; the check naming a
  rename, a removal, a retitling, a path out of the repository, a title no link can carry and a
  document twice; the check run as `docs-hygiene` runs it, from another directory with nothing
  installed, exit 1 then 0; the step in `docs-hygiene` with no `needs` or `if`, and the check's
  imports Node's own and the two site modules; and the build on a copy of `site/` alone writing the
  same `llms.txt`. `site/a-page-that-names-its-address-in-full.unit.test.ts` reads the
  documentation's sections after the languages'. Fourteen mutations, each caught: the build without
  the sections; GitHub's `blob` page; a tag for `main`; a listed path renamed; a title that is not
  the heading; the step out of `docs-hygiene`; the check ignoring the heading, a missing file, a
  path out of the repository or a fence; the check importing a package; the build reading a
  document; notes after each link; and a document dropped from the list.
- **`README.md`, the first document listed, says what is true now.** Its opening line said
  "starting with **O365 → Soverin / Nextcloud** (Proton later)"; it now names the six kinds of
  account the *Leaving…* pages cover and the four destinations the home page's *Where to* does,
  and says Proton is deferred (ADR-0025). Its *Get it* pulled `0.1.0-rc.1` from the pre-rename
  path; it now pulls `ownpace-selfhost:0.2.0-alpha.3`, which that tag's images run published and
  signed on 2026-10-30, and keeps rc.1's path as a note. The Windows zip is from `v0.2.0-alpha.1`
  on, and the SBOM line names alpha.1 as the release without one, as the releases page shows.

**2026-10-30: T5 (c) is built: every page names its address and its other language's in full,
and `llms.txt` lists them** (branch `claude/ownpace-public-readiness-y7orc6-site-search-metadata`;
ADR-0029). The inventory of 2026-10-30 marked (c) as blocking the first invitation (0131 T5),
and the owner wants it in alpha.3. What it waited for, the site's own address, is
`https://www.ownpace.eu`, which serves live's site since 2026-10-28; the site writes it once,
as `PUBLIC_SITE_URL` in `site/security-txt.mjs`, and the build now reads it from there
(`addressOf` in `site/build.mjs`). No visible sentence changes, and no legal text. Reviewed
the same day (pull request #1743); the five findings are in the bullets below, each where it
belongs: the Alpha's pages leave `llms.txt`, nginx names the charset, the address is held by
behaviour, the documentation's lines are owed, and 0131's row says where (c) is.
- **Every page's `<head>`:** one `<link rel="canonical">` to its own address in full; one
  `<link rel="alternate" hreflang>` per language, itself included, so the links are reciprocal;
  and `x-default`. The hreflang links were relative (`/nl/prijzen.html`) and are now absolute;
  no page carries both. `x-default` stays, now absolute, on the English page: the root serves the
  default locale's pages and nothing negotiates a language (`www-nginx.conf`), so English is what
  a visitor whose language is neither is served. ADR-0029 says nothing of it.
- **The 404 page names no address**, and no other language's: nginx serves it at whatever address
  was wrong. Until now it carried Home's hreflang links, because it is rendered with Home's key
  for the nav.
- **`llms.txt` at the site's root,** in llmstxt.org's shape: `# Ownpace` (the header's name), the
  English home page's description as the `>` summary, and a section per language, *English* and
  *Nederlands* (each language's own name in `copy.mjs`), with one line per page a visitor reaches
  from the home page: `- [its <title>](its canonical address): its meta description`. One line
  per page per language, not per page with both: each language's page has its own title and
  description in its own words, and one line holding both would give one page the other
  language's. Nothing in it is written for it.
- **The Alpha's pages are not in `llms.txt`** (after review). The conditions and the tester guide
  are kept out of the nav because a link there "would offer conditions to people who cannot take
  part" (`OUTSIDE_NAV`, `ALPHA_ONLY`); the app and the texts that name them link them, and the
  guide links the conditions, and no page a visitor reaches from the home page does. The first `llms.txt` listed every
  page with an address, and so offered them to every assistant that read it. It now leaves out
  `UNLISTED` (`site/build.mjs`, those two lists), and offers what the site offers every visitor.
  Their canonical and hreflang links stay: they describe a page, and offer it to nobody.
- **nginx says the text is UTF-8** (after review). `charset` is off by default, so `llms.txt`, the
  first file the site serves with text outside ASCII (a dash in every title, and Dutch), went out
  as `Content-Type: text/plain` with no charset; an HTML page names its own in `<meta charset>`.
  `www-nginx.conf` now says `charset utf-8;` once, at server level, which every location inherits
  (unlike `add_header`). Served by a local nginx 1.24 from the `--public` build, before and after:
  `/llms.txt`, `/robots.txt` and `/.well-known/security.txt` went from `text/plain` to
  `text/plain; charset=utf-8`, every page from `text/html` to `text/html; charset=utf-8`, the logo
  stayed `image/png`, and every answer kept its CSP. Not seen on the live host, and not under the
  image's nginx 1.31.8.
- **A test host carries the same addresses.** `rel="canonical"` names the preferred address of a
  page's content, which for a copy on a test host is production's; the test build is `noindex`
  and its robots.txt disallows everything, so nothing reads them there, and they take effect where
  `--public` makes the site indexable, which live's deploy does with `WWW_LIVE=true`. The robots
  meta is unchanged. security.txt is the opposite case and stays as it was: RFC 9116's `Canonical`
  says where that file is, which on a test host is not production. None of these links is one a
  visitor follows, and none names an app (`the-test-site-sent-people-to-production` still passes).
- **robots.txt and sitemap.xml:** robots.txt is unchanged (`Allow: /` under `--public`,
  `Disallow: /` otherwise) and names no address, so it has nothing to disagree with. There is no
  sitemap.xml, and none is added: ADR-0029's operative rules name `llms.txt` and robots.txt, and
  mention a sitemap only as one of the scanners' criteria in its context.
- **Guard:** `site/a-page-that-names-its-address-in-full.unit.test.ts`, 11 cases, run on the build
  for the Alpha and the one without: exactly one canonical per page, in `<head>`, absolute, equal
  to the address nginx serves its file at; none on the 404 pages; hreflang absolute, one per
  language, reciprocal, covering exactly the languages the page is rendered in, `x-default` on the
  default locale's page; `llms.txt` holding only a title, a summary, sections and page lines, each
  line's title and description the page's own, under its own language, listing once exactly the
  pages a visitor reaches from the home page by following the site's `<a href>` links, and the
  pages it leaves out exactly the Alpha's conditions (and, in the Alpha's build, its guide) in both
  languages; the build, run as it is run on a copy of `site/`, writing `llms.txt` at the root,
  every address in it a file it wrote and every HTML file a visitor reaches in it; a `--public`
  render naming the same addresses and the same `llms.txt` while a test page keeps its one
  `noindex`; a copy of `site/` whose `security-txt.mjs` names `https://site.example` naming that
  origin in every canonical, hreflang and `llms.txt` address and nothing else changed; and
  `https://www.ownpace.eu` written as a literal in one module of the site. The charset is held
  beside the CSP in `site/calculator.unit.test.ts`, which reads `www-nginx.conf` as nginx reads it
  (`scripts/nginx-config.ts`): `charset utf-8` once, at server level, no location's own, no
  `charset_types` without text/plain, nothing that re-encodes.
  Mutations of `site/build.mjs`, nineteen at first, each caught: the canonical naming the other
  language's page, relative, or written twice; hreflang relative, without the page itself, naming
  this language's page for every language, written in `<body>`, or without `x-default`; the 404
  page given an address; `llms.txt` without Terms, with an address that is no page, with each
  page's title as its description, with the 404 pages, with a section headed by the other
  language, with the home page's title as its summary, or not written to `dist`; the address
  written as a literal in `build.mjs`; the links written by `--public` builds only; and the test
  build without its `noindex`. The review ran fourteen of its own and one survived: the address
  written in two halves in `build.mjs` and not imported, which a count of the literal cannot see.
  After the fixes, twenty-two, each caught: that one, and the address in halves for the `llms.txt`
  lines alone or for `x-default` alone (the copy with another origin); `llms.txt` listing the
  Alpha's pages again, only the conditions, only the guide, or leaving out the estimate as well
  (the reach cases and the written file); without Terms, with the 404 pages, with a `/sitemap.xml`,
  with CRLF, or with the Dutch summary; not written to `dist`; `x-default` on the page's own
  language; the links in `--public` builds only; and seven of `www-nginx.conf`: no `charset`,
  one commented out, another charset, one in `location /` alone, `charset off` in a location,
  `charset_types text/xml`, and a `source_charset`.
- **0131's go/no-go row for 0152** said (c) is not on main. Its *Today* cell now says (c) comes to
  main with #1743, the pull request that carries that line, and is not in `v0.2.0-alpha.2`.
- **Owed: `llms.txt`'s links to the maintained documentation.** ADR-0029 decided what `llms.txt`
  is made from: "curated from the existing documentation rather than written fresh", the ADRs,
  workplans and runbooks, linked rather than restated. This one lists the site's own pages, which
  is T5 (c)'s "a line each" and not the ADR's whole rule, so it is not optional and not done. Which
  documents is the selection the ADR calls the curation job; nobody has made it, and no task holds
  it yet. T0, the owner's read of the site's new sentences, is unchanged: this adds none.

**2026-10-25, after review: issues are kept from main only, the pull request builds the image,
and Dependabot moves its base in a pull request of its own** ([#1675](https://github.com/Robbes/Ownpace/issues/1675)).
A review of the branch at `4ff19520` found two faults that held, and five smaller ones.
- **A dispatch on this branch would have closed #1675 before the merge.** The report job ran
  `image-scan.mjs report image-reports --issue` on every dispatch with `image_scans`, whatever the
  branch, and `keepIssue` closes the issue of an image it reads as supported. So the Security Scan
  dispatch the entry below asks for would have closed #1675 while main and live still ran 3.20,
  and the next scan on main would have opened a second issue for the same image. (0146's entry of
  2026-10-22 records the reverse: a dispatch on #1674's branch opened #1675.) Now `image-scan.mjs`
  keeps the issues only when `GITHUB_REF` is `refs/heads/main` (`ISSUES_REF`): the Monday schedule,
  or a dispatch on main. On any other ref the report still warns, writes its summary and fails on
  a missing report, and says that it kept no issue.
- **Dependabot's move of the Alpine pin would have been merged unbuilt.** `/deploy/compose/goaccess`
  sat in the `docker` entry that groups minor and patch updates across the apps' Dockerfiles, so
  3.24 to 3.25 would have come in one `chore(images)` pull request whose checks build only the
  apps' images. It now has an entry of its own (`chore(goaccess)`). A new workflow,
  `.github/workflows/script-images.yml` (*Images the scripts build*), builds every directory with a
  Dockerfile beside deploy's scripts on a pull request that changes one: natively on
  `ubuntu-24.04-arm`, with `--pull --progress=plain`, with `contents: read`, pushing nothing. This
  pull request changes that directory, so its own check is the first build of the Dockerfile.
- **Smaller:**
  - `site-visits.sh` builds with `--progress=plain`, not `--quiet`: BuildKit's quiet mode drops each
    step's own output, so a failed `apk add` would have shown only "did not complete successfully";
  - the script's header, the Dockerfile and `docs/managed-bring-up.md` say "a supported Alpine (its
    `FROM` lines)" where they said 3.24, so a pin Dependabot moves leaves them true; 3.24.3's
    package versions stay, as what was read on 2026-10-25;
  - the issue body for a built image no longer says Dependabot stays within the Alpine line;
  - *The image* in `docs/managed-bring-up.md` is a paragraph of its own;
  - the entry below gave the wrong reason for the move (corrected there).
- **Guards:**
  - `an-image-nobody-scanned`, 41 of 41, five new: run from the command line with a recording `gh`
    on the PATH, a report on a pull request's branch, a `release-gate/` branch, a tag, or no ref
    keeps no issue and says so, and one on main opens the issue; every directory with a Dockerfile
    beside deploy's scripts is in the new workflow's matrix and its paths; the workflow runs on
    pull requests only, with `contents: read`, on arm64, and pushes nothing; and each such
    directory has a Dependabot `docker` entry of its own.
  - `a-visit-count-that-kept-the-visitor`, 56 of 56: the build says `--progress=plain` and never
    `--quiet`.
  - `every-pr-check-is-classified` (at the root, so outside the local run of `scripts/`; CI's
    unit-tests shard 3 on `fc2b10c0` found it): the new check, `Build (${{ matrix.context }})`, is
    classified as not requirable, because the workflow's `paths:` filter leaves it unreported on
    most pull requests. `docs/testing.md` names the workflow and says not to require it.
  - Five mutations, each caught: the `GITHUB_REF` check removed, `/deploy/compose/goaccess` put
    back into the apps' Dependabot entry, its directory dropped from the workflow's matrix, its path
    dropped from the workflow's trigger, and `--quiet` put back.
- **The image built, for the first time:** *Images the scripts build* on this pull request's head
  after the merge of main (`fc2b10c0`, run 40198074117, `ubuntu-24.04-arm`), green in 32 seconds.
  Its log: `alpine:3.24.3@sha256:be265606…` resolved for arm64; the build stage installed clang22
  `22.1.3-r2`, gettext and gettext-dev `1.0-r0`, autoconf `2.73-r0` and automake `1.18.1-r1`;
  `autoreconf` ran gettext 1.0's `autopoint` without error; `configure` and `make` passed with
  warnings only (`-Wshadow`, `-Wunused-variable`); `ldd` passed; the run stage installed libintl
  `1.0-r0` and libncursesw `6.6_p20260516-r0` among its five, and its `goaccess --version` printed
  `GoAccess - 1.12.`; the image is `linux/arm64 sha256:af64b4b2c40d…`. So the open question of the
  entry below (gettext 1.0, the run stage's library list, 3.24's clang) is answered on arm64. What
  is still unproved before the merge is the scan leg: Trivy reading that build from the runner's
  Docker.

**2026-10-25: GoAccess is built here, on Alpine 3.24** ([#1675](https://github.com/Robbes/Ownpace/issues/1675)).
The entry of 2026-10-22 below kept upstream's `allinurl/goaccess:1.12`, on Alpine 3.20, until
upstream's next release turned out to be on 3.20 too, or the scan found a HIGH or CRITICAL in musl,
and then an image of our own. Neither has happened: 1.12 is still upstream's newest release. The
move is made now because the owner asked on 2026-10-25 for every vulnerability fixed and the
lifecycle upgrades done, and because upstream's Dockerfile at `master` is still on 3.20, so no
upstream image on a supported base is in sight. Merged as #1703 on 2026-10-28 (`fcb3d50f`), for
alpha.3, after the alpha.2 tag (Tuesday 2026-10-27), which still carries upstream's image.
- **Read today, and what it showed:**
  - upstream's tags (`git ls-remote`): `v1.12` (`ef3c4f3c`) is still the newest release;
  - upstream's `Dockerfile` at `master` and at `v1.12`: identical, `FROM alpine:3.20` in both
    stages;
  - Docker Hub: `latest` was rebuilt on 2026-10-21, and its arm64 config's first layer is
    `alpine-minirootfs-3.20.10`;
  - aports (GitHub's mirror): GoAccess is 1.10.2 in `3.24-stable` and 1.12 only on `master`
    (edge). `libmaxminddb` depends on `curl` on 3.24 and installs a weekly GeoIP job, and gettext
    is 1.0. Its `autopoint` still carries the 0.19 infrastructure GoAccess's `configure.ac` asks
    for. The 3.24 branch fixed musl's `regcomp` (CVE-2026-107891, `1.2.6-r3`) on 2026-10-21;
  - `alpine:3.24.3`: the index digest `be265606…` (HEAD of the tag), amd64 and arm64 among its
    platforms, pushed 2026-10-23. Its arm64 layer's package database has musl `1.2.6-r3`,
    libcrypto3 and libssl3 `3.5.9-r0`, zlib `1.3.2-r1` and ca-certificates `20261020`.
  - Trivy v0.76.1's Alpine table (`pkg/detector/ospkg/alpine/alpine.go`): 3.20 ended 2026-04-01;
    3.24 runs to 2028-06-01.
- **One choice against the three-day wait.** 3.24.3 is two days old today, and the policy waits
  three. It is taken for the security fixes it carries over 3.24.2 (musl's `regcomp`, OpenSSL
  3.5.9, zlib). It is five days old by the time this can merge, after the tag.
- **What changed:**
  - `deploy/compose/goaccess/Dockerfile`: upstream's at `v1.12`. Both stages are on
    `alpine:3.24.3@sha256:be265606…`. The source is fetched by its commit and checked against it.
    The run stage takes the five libraries the binary loads (libintl, libmaxminddb-libs,
    libncursesw, libssl3, libcrypto3) and tzdata, where upstream took `gettext-libs`,
    `libmaxminddb` (curl and a GeoIP job) and `openssl`, and it runs `goaccess --version` once.
    Configure flags, compiler, volume, port, entrypoint and command are upstream's.
  - `site-visits.sh` builds it as `localhost/goaccess:1.12`, a name no registry serves. The
    build runs once per run, after the containers are listed and before any log is read. A
    build that fails shows Docker's last 40 lines through `own_address_redact`, reads nothing and
    exits 1. `docker run` gains `--pull never`. *THE IMAGE* in its header says so.
  - The image scan (`image-scan.mjs`, `security-scan.yml`): a script's `localhost/<name>` image is
    listed with `context: <dir>/<name>`, and refused if that Dockerfile is missing. Its leg runs
    on `ubuntu-24.04-arm`, checks out and builds the context under the script's reference, and
    Trivy reads it with `TRIVY_IMAGE_SRC=docker`. The name stays `goaccess`, so #1675 and the
    `trivy-image-goaccess` category close on the first scan on `main` that reads 3.24. Its issue
    body for a built image names the Dockerfile and Dependabot.
  - The pin watch's GoAccess row reads the release from the Dockerfile's `# GoAccess v1.12` line.
    It errors when the script's tag is another release, and compares with upstream's git tags,
    two-part and three-part: the Docker Hub row would never have seen a `1.12.1` beside `1.12`.
  - `.github/dependabot.yml` gives its `docker` updater `/deploy/compose/goaccess`, so the Alpine
    pin moves with tag and digest.
  - `docs/managed-bring-up.md`: *Counting its visits* gains *The image*, with the two commands to
    build and check it by hand; *Nothing phones home* says the base was past its end of life and
    how it is built now.
- **Run here:**
  - GoAccess built from `ef3c4f3c` with the Dockerfile's `autoreconf`, `configure` and `make`
    lines (Ubuntu 24.04, glibc, gettext 0.21), and the real `site-visits.sh` run with a `docker`
    stub that hands the filter's output to that binary: as 65534 under `setpriv --no-new-privs`,
    in a network namespace with no interface (`unshare -n`). Exit 0, HTML of 8 valid requests and
    0 failed, and none of the log's addresses or personal words in it.
  - **Not run: the image build.** This session has no Docker daemon. A Security Scan dispatched
    on this branch with `image_scans` builds it on arm64 (its `goaccess` leg); the first daily
    run on live builds it on the machine.
- **Guards:**
  - `a-visit-count-that-kept-the-visitor`: the build, from `goaccess/`, once and before `logs`;
    `--pull never`; a failed build reads nothing and keeps the earlier report. 56 of 56.
  - `a-service-that-phones-home`: the commit, its check, every `FROM` by tag and digest,
    `--pull never` and the build line. 39 of 39.
  - `an-image-nobody-scanned`: the context, the refusal without a Dockerfile, the summary marker,
    the issue's route and the workflow's build steps. 36 of 36.
  - `a-pin-that-knows-it-is-behind`: the row current, behind on a three-part patch, and in error
    on a name that is not the release. 58 of 58.
  - Seven mutations, each caught: `--pull never` dropped (2 tests), the build moved after `logs`
    (1), a failed build ignored (2), the scan's `context` dropped (1), the commit check removed
    (1), a `FROM` without its digest (1), the three-part tags ignored (1).
- **Live, after this merges:** it takes effect from the first release tag that carries it, with
  `deploy-live.sh`. The daily duty builds the image on its first run after that deploy, or by
  hand with the commands in *The image*. Nothing in a stack's database moves, and the reports
  under `~/.persistent/ownpace-live/site-visits/` are kept. The OTA stack does not run the count.

**2026-10-22: GoAccess stays on 1.12 for now, and the visit count takes nginx's own time, never a
visitor's** ([#1675](https://github.com/Robbes/Ownpace/issues/1675)). The weekly image scan
(#1674), dispatched on that PR's branch, found the pinned `allinurl/goaccess:1.12` on an operating
system past its end of life. A read-only investigation that day checked the way out, and found a
gap in the filter on the way.
- **The checked facts:**
  - `1.12` and `latest` are both built on Alpine 3.20.10, past its end of life.
  - Upstream's `master` Dockerfile is still `FROM alpine:3.20`, in both of its stages (read again
    for this entry), and `latest` is a build of `master`. So no upstream image on a supported base
    exists yet.
  - Alpine 3.20 released one musl fix after the image was built (`r4`, in `regcomp`). It cannot be
    reached from a log line.
  - No release tag carries `site-visits.sh` yet. It came with #1557 (`94c23dbf`, 2026-10-11), and
    neither `v0.1.0-rc.1` nor `v0.2.0-alpha.1` contains that commit, so live does not run it.
- **Decided: stay on 1.12.** `GOACCESS_IMAGE` is unchanged. GoAccess runs offline
  (`--network none`), read-only, as 65534, on input the filter has cut to a few fields of a small
  character set, and only musl lies on that input's path.
- **What moves it:**
  - An upstream release built on a supported Alpine, taken through a pull request like any pin. The
    pin watch says when a newer tag exists.
  - Or an image of our own, GoAccess built on a supported base. That happens if upstream's next
    release is still on 3.20, or if the weekly image scan reports a HIGH or CRITICAL finding in
    musl. That scan is the image jobs of `security-scan.yml`, which #1674 brought to `main` the
    same day (`51a0d267`), after this branch was cut.

  The script's header (*THE IMAGE*) and `docs/managed-bring-up.md` (*Nothing phones home*) say the
  same.
- **The gap: the time GoAccess was given could be a visitor's text.** nginx fills `$remote_user`
  from any Basic Authorization header, though the site has no `auth_basic`, and escapes only
  quotes, backslashes and bytes below 32 or above 126 (its default escaping, which `ownpace_site`
  uses). The filter's first-piece check accepted any user, and it took the time from the FIRST
  bracketed group. So a Basic user `[jan.devries at example dot nl]` became the time GoAccess
  received. That put typed text into GoAccess's input, which the script promised it never gets. A
  user `[01/Jan/2020:00:00:00 +0000]` backdated the hit. And if the first 10 forwarded requests to
  a fresh container were crafted that way, GoAccess (whose parser tests the first 10 lines) would
  give up on every daily run of that container until the next deploy.
  The investigation reproduced this in mawk 1.3.4 20240123 with main's filter.
- **The fix, in the filter of `deploy/compose/site-visits.sh`:**
  - The first piece must END in nginx's `$time_local`, in its exact shape
    (`[dd/Mon/yyyy:hh:mm:ss +zzzz]`, bracket expressions only, so mawk reads it). A line that does
    not end that way counts as `other`.
  - The time is taken from that same anchored match, the group nginx wrote last.
  - The user is never handed on. GoAccess always gets `-`, and the filter's comment and the
    header's item 2 now say so.

  Normal lines are byte-identical. main's filter and this one gave the same output and counts, in
  mawk, on the existing guard's request lines and on zones `-0130` and `+1400`.
- **Guard: `scripts/a-visit-count-that-kept-the-visitor.unit.test.ts`, extended first.**
  - The log gains:
    - a Basic user with spaces and an at-style address;
    - a backdating user;
    - a user that opens a bracket and never closes it (`[marie`). This one was not in the
      investigation's list. With nginx's time it makes one bracketed group, so a fix taking "the
      last bracketed group" in any shape would still have handed the user on;
    - a first piece that does not end in a time, which counts as `other`.
  - `PERSONAL` gains those users' words.
  - The counts are now 17 requests and 2 lines that are not requests (a new assertion), and 17
    quoted lines.
  - Every existing expected line is unchanged.

  Red against main's filter: 5 of 53. GoAccess was given 18 lines for 17, `jan.devries` was in what
  it was given, and 18 lines were quoted for 17. Green: 53 of 53.
- **Mutations, each caught (failing tests of 53):**
  - the anchor reverted to main's check and first-group match (5);
  - the check anchored but the time from the first bracketed group (4);
  - the time from the last bracketed group of any shape (4);
  - the check reverted with the time match anchored (3).

  The file was restored and `cmp`-identical after each.
- **The branch's review, applied the same day.** No code changed; the guard stays 53 of 53.
  - nginx's escaping was said to be "only quotes, backslashes and control bytes". Its default
    escaping also writes every byte above 126 as `\xXX`. The filter's comment, the guard's header
    and this entry now say "bytes below 32 or above 126". Spaces and brackets still pass, so the
    gap stands as described.
  - Two more fields still carry what a visitor chose, as on `main` before this branch: words of
    the User-Agent, which *What it cannot stop* already named, and the Referer's host
    (`https://jan.devries.example.nl/` is handed on as `https://jan.devries.example.nl`). The
    header's *What it cannot stop* and `docs/managed-bring-up.md` (*Counting its visits*) now name
    the Referer's host too, and the header's opening promise points at that paragraph. Tightening
    the referring site is not part of this fix.
  - The header's *THE IMAGE* dates its claim that no release tag carries the script
    (2026-10-22). It and `docs/managed-bring-up.md` name the weekly image scan by its workflow and
    PR (#1674, merged after this branch was cut), and the docs paragraph is rewrapped to its
    width.
  - The guard's *WHAT THIS CANNOT SEE* now says the GoAccess 1.12 run of 2026-10-06 saw the log as
    it was then. The three lines added for the Basic users were not run through it; they are of the
    same combined shape, with nginx's own time.

**2026-10-16: T8 (c) is built: the company in the footer.** The owner, asked whether the footer
may say *Archico B.V.*, its KvK and VAT numbers and the contact address, with no postal address
during the Alpha: *"yes"*. That is privacy §1's own line, so the footer reads it from privacy §1
of the page's language (`companyLineOf` in `site/build.mjs`) rather than keeping a copy, and the
two cannot drift. `site/a-footer-that-names-the-company.unit.test.ts` holds it: §1 names the
company, a KvK and a VAT number, and every page's footer carries §1's line in its own language.
It failed against the old footer on every page, then passed. T5 (c) still waits for the site's own
address, which A5 publishes.


**2026-10-06: the visit count, after its review: nothing a visitor or a link chose reaches the
report, and nothing is counted before the policy says so.** Same branch, a second commit. The
owner's words stand, verbatim: *"go with GoAccess on the logs and the sentence. id and status we
skip for now, no netbird api tokens..."* Still nothing on `id.` or `status.ownpace.eu`, and no
NetBird API token. This entry replaces the 2026-10-05 one below where they differ.
- **Text GoAccess copies word for word.** Each case was run through the first version and
  GoAccess 1.12, and stood in the report:
  - the UTM_CAMPAIGNS panel (an email address in `utm_content`, a name in `utm_term`);
  - NOT_FOUND and REQUESTS (a mistyped personal link; `/<a name>/../prices.html`, answered 200);
  - BROWSERS and OS (`Firefox/128.0-` and an email address);
  - REFERRING_SITES (a Referer on a bare address).

  The filter now hands on no query string, the path only of a request answered 2xx or 3xx that is
  a plain path of the site (`/(not shown)` for every other), a referring site that is an address as
  `(an address)`, and a User-Agent with every version cut to its digits and dots and every word
  that holds a character no browser's own string holds (an `@`, a `%`) left out whole.
  `--ignore-panel=UTM_CAMPAIGNS` besides.
  **No campaigns are counted**: the sentence names none. Should the owner want them, see the
  comment beside §4.5 on 0139's branch: only `utm_source`, `utm_medium` and `utm_campaign`, from a
  short list of our own names, and the sentence then names them.
- **What it cannot stop:** a word a visitor writes into their own browser's User-Agent, joined to
  a browser's or a system's name, shows as they wrote it.
- **`-o html` would have failed every run on the machine.** GoAccess 1.12 checks that the
  directory of an `-o` path is writable (`util.c`, `is_writable_path`), `-o html`'s `.` too, and
  refuses as 65534 on a read-only disk. Found by running the pinned amd64 image's own
  `/usr/bin/goaccess`, taken from its layers, as 65534 under `setpriv --no-new-privs`, on its own
  root file system mounted read-only, with no network. With no `-o`, and its output not a
  terminal, GoAccess writes the HTML there. The same run took every flag, accepted every line of
  the guard's log, left the crawler out, and wrote a report whose panels hold no address, no
  query string and no personal word.
- **No copy of the log.** The filter streams from `docker logs` into `docker run`, so a run killed
  outright leaves nothing behind. What the filter and Docker say is held in memory. Of GoAccess's
  words, only its lines that quote nothing are shown; a format error quotes the line.
  Docker's own words on exit 125 are shown.
- **Only once the policy says so: privacy 1.2 merges first.** The script refuses (exit 2, nothing
  read) while the checkout's `site/legal/privacy.md` or `privacy.nl.md` lacks §4.5's sentence
  (*"From these logs we also count visits to this website"* / *"Uit deze logs tellen we ook
  bezoeken aan deze website"*) or §5's purpose (*"counting visits in totals"* / *"bezoeken in
  totalen tellen"*) outside a comment. Live's duty runs from the tag live serves, so the counting
  starts with that text and not before. On this branch, which has neither, the duty `visits`
  would fail on live. Merge 0139's privacy 1.2 first, then this.
- **The reports go when the website goes.** `docs/managed-bring-up.md` has *Taking it down for
  good*: take the site down and `rm -rf ~/.persistent/ownpace-live/site-visits`. That is privacy
  §9's *"as long as we run this website"* on 0139's branch.
- **The image is verified, not pulled.** A HEAD of `allinurl/goaccess:1.12` on Docker Hub returns
  `sha256:9e6dfd4a…`, the pinned digest: the tag's index, for amd64 `sha256:ce8fc587…` and arm64
  `sha256:faedaedb…`, built 2026-09-16. Its config sets no `USER`, so `--user 65534:65534` is what
  drops root. It declares `VOLUME /var/www/goaccess` and `EXPOSE 7890`. Docker gives each run an
  empty anonymous volume, which only root may write to and which `--rm` removes. `EXPOSE`
  publishes nothing without `-p`. The image has no `/etc/goaccess` configuration.
- **Guards:**
  - `scripts/a-visit-count-that-kept-the-visitor.unit.test.ts`, extended first. Its `docker` stub
    refuses `-o` as the image does, notes any file holding requests while GoAccess runs, and
    quotes every line it was given when it fails. The log adds the review's cases. The guard also
    checks:
    - the privacy refusals;
    - `--ignore-panel=UTM_CAMPAIGNS`, `--no-progress`, `--user 65534:65534`, `--cap-drop ALL`
      and `--security-opt no-new-privileges`;
    - docker's words on exit 125;
    - the take-down paragraph.

    NetBird's address is the placeholder `100.64.0.1`, and the `.env`'s binds moved off it. The
    first version used another mesh address, so `an-address-that-was-not-an-example` failed on it.
    Red: 25 of 53 against the first version (24 once the take-down paragraph was written). A
    case added later, an email address as a word of its own in the User-Agent, was red (4 of 53)
    against an interim version that cut the string at the `@` and so kept the address's first
    half. Green: 53 of 53.
  - `an-address-that-was-not-an-example`: green again (5 of 5).
- **Mutations, each caught by the guard (18 of 18; failing tests of 53 in brackets):**
  - the raw request line handed on (4), or its query string (2);
  - the path of a 404 handed on (4);
  - the 2xx path check without its `..` test (4);
  - the User-Agent's word check (4), or the cut of its versions (2);
  - a referring site's address kept (4);
  - `--ignore-panel=UTM_CAMPAIGNS` dropped (1), or `-o html` back (14);
  - `--user 65534:65534` dropped (1);
  - the privacy refusal taken out (7), or the check that ignores comments (1);
  - GoAccess's quoted lines shown (1);
  - a copy of the filtered log written beside the reports (11);
  - re-run from the first round: `--anonymize-ip` (1) or `--ignore-panel=HOSTS` (1) dropped,
    the OTA `.env` refusal (2) or the `WWW_LIVE` no-op (3) taken out.
- **Not done:** `deploy-live.sh` still does not run the count right before it recreates the site.
  A deploy should not wait on, or fail on, a count. The docs ask for a run by hand first, and
  the daily duty bounds the loss.

**2026-10-05, later: visits to `www.ownpace.eu` are counted from its own log, by GoAccess, as
totals.** (In part replaced by 2026-10-06, above: no campaigns, no `-o html`, no working copy,
and the image verified.) The owner, 2026-10-05, verbatim: *"go with GoAccess on the logs and the sentence. id and
status we skip for now, no netbird api tokens..."* It answers the recommendation to measure live's
copy of the site with GoAccess reading the access log its nginx already writes
(`deploy/compose/www-nginx.conf`, format `ownpace_site`): no script, cookie or banner on the page,
nothing leaving the machine, no counting on `app.`, `id.` or `status.ownpace.eu` (*"id and status
we skip for now"*), and no NetBird API token, so NetBird's own log is not read. The sentence is
0139's (privacy 1.2 §4.5, §5 and §9, on its own branch). This is the run that makes it true. On
branch `claude/ownpace-public-readiness-y7orc6-site-visits-counted-from-the-log`, from `main` at
`0e7e3e26`, not merged. It merges after the `v0.2.0-alpha.1` tag, with alpha.2.
- **`deploy/compose/site-visits.sh`**, from live's checkout, no arguments:
  - It reads the output of live's site container, `<project>-www`, from Docker, the whole of it on
    every run. It never reads nginx's error lines.
  - It keeps only the requests that came through the public name, the ones NetBird gave an
    `X-Forwarded-For`. The healthcheck and the deploy's own checks have none. The status page's
    *Website* row asks through the public name every 60 seconds once `STATUS_SITE_ENABLED=true`,
    as `Gatus/1.0` (Gatus v5.36.0, `client/client.go`), and is left out by that name; found while
    building this, since step 2 of switching the site on sets it.
  - It hands GoAccess **no address**. Each visitor's address becomes a number that lasts as long
    as the run (`v1`, `v2`), NetBird's mesh address is dropped, and the Referer is cut to its
    site.
  - GoAccess (`allinurl/goaccess:1.12`, pinned by digest) runs with `--network none`, read-only,
    with no port and no mount, and keeps **no database**.
  - What is kept is GoAccess's HTML report of totals, one per container of the site, in
    `~/.persistent/<project>/site-visits/`, the owner's alone. A deploy recreates the container
    and its log, so each report covers one release's time on the site, and the earlier ones stay.
  - The filtered working copy is deleted when the run ends.
  - It refuses the OTA stack's `.env`, a project the reader refuses, a `WWW_LIVE` that is neither
    true nor false, and an argument. While `WWW_LIVE` is not true it reads nothing and exits 0.
  - It prints counts, a container's short id and a path, never an address.
- **Why no database, read in GoAccess's source at the tag `v1.12` (`ef3c4f3c`)**:
  - `--persist` writes, for every day, a fingerprint per visitor, an unsalted FNV hash of the
    full address and the browser (`U6432_UNIQUE_KEYS.db`), and per panel which visitor asked
    for what (`U648_*_MTRC_UNIQMAP.db`).
  - Given a log file, it also keeps the file's first 4096 bytes (`IGLP_LAST_PARSE.db`). Run here
    on a raw log with `--anonymize-ip --anonymize-level=3 --ignore-panel=HOSTS`, that file held
    a visitor's address in plain text.
  - `--anonymize-ip` masks only the HOSTS panel as it is drawn (`gholder.c`).
  - GoAccess's format errors print the token they could not read. Without the filter, that
    token could be an address.
- **The flags, and why each.** The header of `site-visits.sh` gives the list:
  - `--log-format=COMBINED` and `--no-ip-validation`: a host is `v1`, not an address.
  - `--ignore-panel=` `HOSTS`, `GEO_LOCATION`, `ASN`, `REFERRERS` (the whole address of the page
    a visitor came from; *"the site you came from"* is `REFERRING_SITES`) and `REMOTE_USER`.
  - `--anonymize-ip --anonymize-level=3`. They change nothing while HOSTS is ignored and its
    hosts are numbers, and show a /8 or a /32 if a later edit draws the panel.
  - `--no-query-string`: pages without their parameters. The UTM panel still counts campaigns.
  - `--ignore-crawlers`, `--no-global-config`, `--no-progress`, and `-o html` with `-` for the
    input.
  - Never `--persist`, `--restore`, `--db-path`, `--keep-last`, `-a`, `--real-time-html`,
    `--enable-html-resolver` or `--geoip-database`.
- **Daily, as `box-duties.sh`'s eighth duty, `visits`; and by hand before a deploy.** The log goes
  with its container at every deploy, so what no run counted before then is never counted. By
  hand only, a release nobody remembered to count before its deploy would be lost whole. Daily,
  the loss is at most the hours since the last run, and none when the owner runs it right before
  `deploy-live.sh`. Each run reads the whole log again, so a second run changes nothing. The
  service's `TimeoutStartSec` goes from 150 to 170 minutes (eight duties of 20): copy the units
  again after the tag that carries this.
- **Guards, first, red then green:**
  - `scripts/a-visit-count-that-kept-the-visitor.unit.test.ts` (new) runs the script with a
    `docker` stub whose GoAccess puts everything it is given into its report. It holds:
    - what GoAccess is given, line for line;
    - that no recorded address, the visitors', NetBird's, the healthcheck's or nginx's error
      line's, reaches anything printed or written, on success and on either failure;
    - the flags, and the flags it never passes;
    - the digest, `--network none`, `--read-only`, and no port or mount;
    - one report per container under the live persistent directory, the earlier one kept;
    - the refusals, and the no-op while `WWW_LIVE` is not true.
    Red: 37 of 37 failed (no script). Green: 37 of 37.
  - `scripts/a-service-that-phones-home.unit.test.ts` names the image, pinned by digest, and its
    `--network none`. Red: 1 of 39. Green: 39 of 39.
  - `scripts/a-duty-the-gate-used-to-do.unit.test.ts`: eight duties, `visits` last. Red: 17 of
    69. Green: 69 of 69.
- **Mutations, each caught:**
  - in the script, dropping `--anonymize-ip`, `--anonymize-level=3`, `--ignore-panel=HOSTS`,
    `--ignore-panel=GEO_LOCATION` or `--network none`, or adding `--persist`;
  - the filter handing on the address, counting lines without `X-Forwarded-For`, or keeping the
    whole Referer; and, before the filter left it out, the status page's probe (2 of 37 red);
  - the OTA `.env` refusal or the `WWW_LIVE` no-op taken out;
  - in `box-duties.sh`, the duty taken out (15 of 69 failed).
- **Run for real, by hand:** GoAccess 1.12 built from the tag `v1.12`, run through the script on
  the guard's recorded log. It took every flag and wrote HTML with no hosts, referrers or place in
  it, and no address, number or whole Referer. It loads nothing from another host. It counted 2
  visitors and 5 requests; the crawler is in no panel, and the campaign shows as `linkedin`.
- **Not verified:**
  - The image itself. No Docker daemon runs here, so its digest (`sha256:9e6dfd4a…`, the tag
    `1.12`) was read from Docker Hub's listing, not pulled: Docker Hub refused the manifest
    request for its rate limit.
  - That build had no GeoIP, and the image's has `--enable-geoip=mmdb`, with no database given.
  - `--read-only`, `--user 65534:65534` and `--cap-drop ALL` are untried with the image.
  - The first run on the machine is that check (`docs/managed-bring-up.md`, *Counting its
    visits*).
- **Docs:**
  - `docs/managed-bring-up.md`: *Counting its visits* under *`www.ownpace.eu`: live's copy*, with
    how to read the report from the mesh only (`scp` from the box, then opened in a browser; it
    is never served); the duty's row; the unit; and *Nothing phones home*.
  - `docs/operator-runbook.md`: a paragraph beside the logs' addresses.

**2026-10-05, later: the app screen joins the drawing** (T3, D8: *"drawing now, app screen
later"*; the owner, 2026-10-05: *"yes! but it will have to move along with changes in text in the
future"*). After How it works, the home page shows the app itself, under *What you see in the app*.
- **The pictures** are `site/app-screen/`: a wide one, and a phone's below 48rem, where the wide
  one would shrink its words past reading, in each language. They are WebP at twice the pixels,
  load lazily and sit in a frame. They show a person's page: Anna Jansen, an example person, with
  three migrations, at a fixed moment, with the numbers of the 0154 drawings. A caption says it is
  a real screen with an example person, and the `alt` says what it shows.
- **A script takes them:** `scripts/shoot-the-app-screen.mjs` builds the app as it ships, serves
  it the answers in `test/ui/app-screen.ts`, and photographs the page's head and its card of
  migrations (`data-app-screen` in `Person.tsx`). It records each picture's size, and the words in
  it, in `screen.json`.
- **They move along with the text:** the UI smoke opens the same page, with the same answers, at
  the same moment, and fails while its words are not the pictures' words. Its message names the
  script to run. With *Add a migration* changed in the app, it fails.
- **A fault the pictures showed, in the app:** the way back to Migrations sat 5 pixels above the
  person's name, on their page and on their report. Tailwind 4's `space-y` spaces children with
  a bottom margin, which an inline link ignores. Both links are inline blocks now, and the smoke
  holds the gap: with the old link, it fails at 4 pixels.
- **Guard:** `scripts/the-home-page-shows-the-app.unit.test.ts`:
  - every picture is twice the size `screen.json` records;
  - each home page shows it once, after How it works and before Where to, at those sizes;
  - every name in the `alt` is in the picture's words;
  - the build ships the pictures, and not the words.

  Mutations caught: a recorded height 2 pixels off, *Outlook* in the alt, the build's copy
  removed, the section moved after Where to.
- **T0:** the section's title, its sentence, the caption and the alt, in both languages, are new
  words for the owner's reading.

**2026-10-05, later: the hero's drawing carries tasks** (the owner, asking why it did not).
The drawing was planned on 2026-09-28 with five rows: mail, calendar, contacts, files and photos.
Tasks became a data type of the site's own on 2026-10-04 (*Several sources, and Tasks*, below),
and the drawing was not redrawn. Its guard had even been written around the gap: *"the app's
data types but tasks, which it does not draw"*.
- **The drawing** (`hero-move.svg`, and `site/hero.mjs` line for line) has six rows on each side:
  mail, calendar, contacts, tasks, files and photos. The cards grow by one row, and Ownpace's
  ring, its arrows and their words move down half a row, so the middle stays centred.
- **Its description and the hero's sentence** name tasks in both languages.
- **`the-hero-is-the-drawing`** now asks for every data type the app has, on both sides. Run
  against the five-row drawing, it fails with *"task is not on both sides"*.

**2026-10-05, the site is warm paper, always light** (the owner, 2026-10-05, asked why the site
looked greenish where screenshots had shown it white, and picked option C of four, drawn for
them side by side: *"C. Warm paper, always"*). It had followed a device set to dark into a dark
green (`#0b1716`).
- **The four options:** (A) white, always; (B) white, with a neutral charcoal dark mode; (C) warm
  paper, always; (D) as it was. The suggestion was A. The owner chose C.
- **Now:** the page is paper (`#FAF9F5`), panels a shade darker (`#F2F0E8`), lines and text warm
  (`#E5E1D6`, `#1D2421`, muted `#5D6763`), the teal and mint as before. Form fields stay white on
  the paper, and the browser's own tick boxes and radio buttons take the teal (`accent-color`).
- **It reads:** `site/site.unit.test.ts` holds every text colour to WCAG's 4.5:1 on the paper and
  on a panel, the body text to 7:1 (15:1 measured), and a button's white on the teal (9.4:1).
- **No dark version.** The page declares `color-scheme: light`, in its CSS and a `<meta>`, so a
  browser in dark mode draws its controls light too. `theme-color` is the paper.
- **The app follows** in its own pull request: the owner, asked whether the app would look calmer
  in C too, answered *"Yes, paper + teal"*. That means a paper page, white cards, warm greys,
  the site's teal for buttons and links, and stage labels that keep their own colours (0153's
  Status, 0152 T9 (b)).

**2026-10-05, later: the withdrawal button's words are decided** (T6 (f); the owner, 2026-10-05,
asked which label to use: *"Ok. As you would suggest."*). The suggestion is the words of article
11a of the Consumer Rights Directive, as Directive (EU) 2023/2673 inserted it.
- **English:** the button *Withdraw from contract here*, and the confirmation *Confirm withdrawal*.
- **Dutch:** *Hier de overeenkomst herroepen* and *Herroeping bevestigen*.

The Dutch wording was read from secondary sources quoting article 11 bis, because EUR-Lex itself
could not be reached from here. The lawyer confirms it, as §3 T6 (f) already asks. The button is
built with 0111's credit notes, since a withdrawal is refunded by one: 0111 slice 7c, 2026-10-11.

**2026-10-05: T1 (a) is built: the Alpha, said to a visitor who was not invited** (open question
5; the owner, 2026-10-05, choosing the plan's suggestion: *"Do suggestions for non alpha
viewers"*). T1 is whole.
- **Members keep the welcome.** *"Welcome to the Alpha! Try Ownpace at your own pace, and help
  others move to European alternatives more easily."* stays where it was: the signed-in pages,
  `/invitations`, the acceptance screen, `/login`, `/request-access` and the mails. Nothing
  changed there. `/login` and `/request-access` keep it by the owner's earlier choice (0131 D4's
  amendment).
- **A visitor reads a fact instead:** *"Ownpace is in its Alpha, by invitation. Nothing is charged
  during the Alpha."*, then *Request access*. In two places:
  - **every page of the site** while it is built with `OWNPACE_STAGE=alpha`, the tester guide's
    setting. One line under the header, first in `<main>`, muted, with the header's rule under
    it: not a banner. The 404 pages and the tester guide carry it too. Its link is the site's
    other *Request access* (`orderHref`). It sits outside the sticky header, so the header stays
    one row on a phone. At 390 pixels the line takes two rows in English and three in Dutch, and
    the hero's buttons still end in the first screen (643 and 666 of 844 pixels);
  - **the app's guides, for a visitor without a session** (`PublicDocs`): under the title, while
    the bundle runs the alpha, never on the appliance (`AlphaVisitorLine` in `AlphaNote.tsx`).
    Its link opens `/request-access`. Signed in, a guide sits in the layout under the welcome, as
    before.
- **The words** are a new key, `alpha.visitor.line`, and the approved `alpha.nothingCharged`. The
  link is named by the request page's own title, `access.title`. The site copies the three
  (`alphaVisitor` and `ctaOrder` in `site/copy.mjs`).
- **Search engines** (also left to the suggestion): `apps/web/index.html` carries
  `<meta name="robots" content="noindex" />`. Every address of the app answers with that file,
  in both editions. The app is a tool behind sign-in. A stranger can open only the request form,
  the sign-in page and the guides, and the guides' home to be indexed is meant to be 0151's help
  section on the site, so the same text is not indexed on two hosts. On the appliance it is
  harmless.
- **Guards:**
  - `scripts/the-alpha-said-to-a-visitor.unit.test.ts`:
    - the site's words are the app's, in both languages, the link's name too;
    - an Alpha build says the line once on every page, first in `<main>`, with the request link
      in the page's language, and `OWNPACE_STAGE=alpha` turns it on;
    - a build without the setting says it nowhere, and no page of the site says the welcome;
    - `PublicDocs` draws the line, not the note.
  - `a-guide-you-can-read-before-you-sign-in.unit.test.tsx`: without a session, the line under the
    title in both languages, with its one link, and no welcome. Signed in, the welcome and no
    line. Neither without the setting, or on the appliance.
  - `an-alpha-said-out-loud.unit.test.tsx`: no page that says the welcome says the line.
  - `test/ui/site.ui.test.ts`, on an Alpha build, at 1200 and 390 pixels: the line under the
    header in each language, in the footer's muted colour with no background, and no sideways
    scroll. The header stays one row, the hero's buttons stay in a phone's first screen, and the
    open menu falls over the line. The build without the setting has none.
  - `the-app-is-not-a-search-result.unit.test.tsx`: `index.html` has one robots tag, in its head,
    and it says noindex.

  Mutations caught:
  - the site's Dutch line changed and the app's not;
  - the line on the home page only;
  - the robots tag removed;
  - the guides showing a visitor the welcome;
  - the line added to `/login`;
  - the line held on one row, which scrolls sideways at 390 pixels.
- **The runbook** (`docs/ending-the-alpha.md`) lists the line among what the stage switches, with
  a check that it has gone.
- **T0:** one new sentence, for the owner's reading (the owner, 2026-10-05: *"Texts: ok (I'll read
  later, you go ahead)"*): *"Ownpace is in its Alpha, by invitation."* / *"Ownpace is in de Alpha,
  op uitnodiging."* The rest was approved before: *"Nothing is charged during the Alpha."* /
  *"Tijdens de Alpha wordt niets in rekening gebracht."*, and *Request access* / *Toegang
  aanvragen*.

**2026-10-04, night: T7 (a)'s site half and T7 (b) are built**, so T7 is whole, with the form
half (#1481) on main:
- **The estimate ends in *Request access*,** under the result, and its script builds the link
  from the answers on screen: the tier the card shows, every source ticked, what moves from them
  (a type no ticked source brings is left out, as the count leaves it out) and who. Without the
  script, the link is the plain one. The form matches each against its own list and builds its
  note from them (T7 (a)'s form half).
- **Each *Leaving…* page's *Request access*** carries its case, the source and the typical data
  types, as its estimate link already did; T5 (a) 5's source no longer waits.
- **The result says which payment suits *Until when?*** (T7 (b)), in the line the three-month
  total had: a month or three paid monthly, in all; six months, or until ready, the year, *"for
  twelve months, the price of six"*. A sentence, not a choice: the tier stays derived. Free says
  none.
- **The CSP:** the calculator's hash is re-pinned in `deploy/compose/www-nginx.conf`.
- **Guards:** `test/ui/site.ui.test.ts` reads the link's answers in a browser as they change,
  and the payment line for each answer; `leaving-pages-say-what-the-app-says` (8.) holds each
  Leaving page's link to its case. Mutation caught: a Leaving page's plain link.
- **T0:** the four payment sentences, in both languages.

**2026-10-04, night: T8 (a) and (b) are built** (R8 step 12). The site's claims link what holds
them, in the public repository:
- the footer's *Open source* links the repository, and *Run it yourself* the self-host quickstart;
- the hero's fact *Nothing is deleted at the source* (T3) and *the software has no way to delete
  from a source* link `a-source-that-only-reads`, the guard that counts every source connector's
  methods;
- *Whatever cannot be moved* links the scope manifest;
- *open source* in *European, all the way down* links the repository.

`site/proof.mjs` names the files once.
- **Guard:** `scripts/claims-you-can-check.unit.test.ts`:
  - every link to a file in the repository names a file in the tree;
  - each claim links its own proof in both languages, every page's footer included;
  - the repository is the one the README clones.

  Mutations caught: the guard renamed, the Dutch claim unlinked.
- **Not built:** (c), the company in the footer, waits for 0139.
- **T0:** no new words; four phrases and the footer's two became links.

**2026-10-04, night: the guides are public** (the owner: *"Guide links on the Leaving pages: yes,
make public"*). Each Leaving page links a guide section per limit, such as `/docs/google#gmail`,
and the app sent a visitor without an account to its sign-in page instead.
- **`/docs` and `/docs/<guide>` open for everybody on managed.** With a session nothing changes:
  the guide is inside the app's layout. Without one, the same guide is drawn in the front door's
  look (T9), as `/login` draws it: *← ownpace.eu*, the site's mark, the language switch, and
  under the guide the request page's *Already have an account? Sign in* and the build stamp
  (`PublicDocs.tsx`). Every other page still sends a visitor without a session to sign in. The
  appliance has nobody to sign in, and is unchanged.
- **One reading of "signed in"** (`stores/signed-in.ts`). The route table's redirect, the guides'
  frame and the guide page all read it.
- **Without a session the guide asks the API nothing.** The app's client takes a 401 for a dead
  session and sends the browser to the sign-in page, which is the bounce this removes. So the
  own-app section stays open, as it does where the answer never comes.
- **The guide opens in the page's language.** Each guide link carries the Leaving page's
  `?locale=`, as the Request access link does, and `PublicDocs` takes it once, before the first
  paint, so a reader of the Dutch page whose browser is set to English reads the Dutch guide.
- **Not shown to a visitor:** the alpha note, since which line a visitor who was not invited reads
  is open question 5.
- **Guards:**
  - `apps/web/src/pages/a-guide-you-can-read-before-you-sign-in.unit.test.tsx`, over the real
    route table: every guide section a Leaving page links (read off `site/sources.mjs`) opens on
    its section without a session, in the front door's look and at the address asked for, and
    nothing goes through the app's clients; the Dutch guide leads back to the Dutch site;
    `?locale=nl` opens the Dutch guide for an English browser, and an unknown value nothing; a link
    to another guide stays in the frame and starts at the top; with a session, the layout's menu
    and the deployment's facts, as before; every other page still leads to sign-in; the
    appliance keeps its layout.
  - `test/ui/managed-ui.ui.test.ts`, in the shipped bundle: `/docs/google#gmail` without a
    session, with the guide's one read answering 401, stays on its section in the site's teal and
    asks the API only for the build stamp.
  - `Docs.unit.test.tsx` signs its reader in, and reads the page without a session once.
  - `scripts/leaving-pages-say-what-the-app-says.unit.test.ts` (7.): each built Leaving page links
    its guide sections in its own language.
  - `a-version-you-can-see-before-you-sign-in` now finds `PublicDocs` outside the layout, and
    holds it to its build stamp.

  Mutations caught: the guide asking without a session (in the browser it lands on `/login`), the
  guides sent to sign in again, the appliance taken for signed out, a link to another guide that
  kept the old scroll, and `?locale=` left unread.
- **T0:** the label's new words, *In the guide* / *In de handleiding*, without *(sign in first)* /
  *(eerst aanmelden)*.
**2026-10-04, night: T7 (a)'s form half is built.** The request form reads the answers the site
already has: `?from=`, `?what=` and `?who=`, each matched against its list as `?tier=` is.
*What are you moving?* arrives with one sentence built from them, in the language the site asked
for: *"Moving away from Google: email, calendar, contacts, and files, for one person."*
- **Nothing new is stored.** It is the note, which the person edits like anything they type. An
  unknown value is left out, and with nothing known there is no sentence.
- **Several sources, and Tasks** (the owner, 2026-10-04): `?from=` may be a list, as the estimate
  now ticks several, and the sentence names each: *"Moving away from Google and Dropbox: email,
  tasks, and files, for one person."* Tasks is one of the data types, in the app's word for it.
- **The site half is #1489:** the estimate's *Request access* and each *Leaving…* page carry
  their answers; T7's row turns ✅ with it.
- **Guard:** `RequestAccess.unit.test.tsx`:
  - the form arrives with the sentence, and sends what the person leaves in the field;
  - it says it in Dutch when the site asks for Dutch, before the page switches;
  - it names every known source in a list, once, and tasks as the app names them;
  - an unknown value is left out, and nothing known means no sentence.
- **T0:** the sentence's words, in both languages.

**2026-10-04, night: T3 is built** (R8 step 10, after T5). The home page's hero shows the move:
- **The picture** is `hero-move.svg`, inlined by `site/hero.mjs`: the old account, Ownpace
  copying and then keeping in step, the new home. Its data types are the app's words, the rest
  is in the page's language. It sits beside the hero's words on a wide screen and under its
  buttons on a phone, follows the page into dark mode, and is an image named by its own title
  and description. Its icons come from the page's one sprite, which moves to the top of the page.
- **Three facts** under the hero, as cards: nothing is deleted at the source; kept in step until
  you switch; a list of what arrived, item by item. None says *read-only* (0144 T3).
- **(b):** How it works in three steps, linking the whole page.
- **(c):** How it works ends with *Request access* and *See what it costs*. Its step 5 says what
  switching is: pointing your apps at the new provider, and for a domain of your own, changing
  where its mail is delivered.
- **Guard:** `scripts/the-hero-is-the-drawing.unit.test.ts`:
  - the picture's shapes are the drawing's, line for line, and only its words differ;
  - the drawing's symbols are `icons.svg`'s, which the page's sprite carries;
  - every word is in the page's language, the data types as the app names them;
  - each home page shows it once, after its buttons, then the facts and the three steps;
  - How it works ends with both buttons.

  Mutations caught: a ring moved one pixel, the picture before the buttons, an English word in
  the Dutch picture, a fact dropped. `test/ui/site.ui.test.ts`: at 1280 pixels the picture
  is beside the lede and over 400 pixels wide; at 390 the buttons are in the first screen and the
  picture follows them, on the screen.
- **Not built:** the app screen that joins the drawing (D8), and the link from each fact to the
  guard that holds it (T8).
- **T0:** the picture's words, the three facts, the three steps and the switching sentence, in
  both languages, are new words for the owner's reading.

**2026-10-04, night: T6 (b) is built** (R8 step 11, after T6 (e)). The pricing page's eleven
rules are questions now, each answered by the paragraph that was there, word for word:
- *Is there a free way?*, *Does the bill go down when I finish?*, *Does pausing lower it?*, *What
  if I keep copying after I switch?*, and seven more, in both languages (*Kan het gratis?*, …).
- Each is a `<details>` that opens without a script, written by `build.mjs`, because the
  Markdown renderer escapes raw HTML. The Markdown keeps its bold-led paragraphs.
- `copy.mjs` pairs each lead with its question, in the page's order. A rule that is not the next
  lead, or a question left over, stops the build.
- The exception to *finishing lowers your bill* stays within three answers of it.
  `a-sixth-state-added-to-only-one-list` says answers rather than paragraphs now.
- **Guard:** `site/site.unit.test.ts`:
  - every rule under the heading is a question, in order, in both languages, and each question
    ends in a question mark;
  - the rendered exception sits within three answers of its promise.

  `test/ui/site.ui.test.ts`: the answers are closed until a question is opened, from the
  keyboard.
- **T0:** the eleven questions, in both languages, are new words for the owner's reading.

**2026-10-04, night: T6 (e) is built** (R8 step 11). The pricing page opens on yearly, as D10 asks:
- **The switch:** *How you pay: Yearly · Monthly* (*Hoe u betaalt: Per jaar · Per maand*). It is a
  fieldset of two radio inputs with no script: `:has(:checked)` shows one of each paid card's
  two answers, and a browser without `:has()` shows both. D3's rule sits under it: *"Done within
  six months? Pay monthly. Longer, or not sure? A year costs the same as six months."*
- **On yearly,** each paid tier shows:
  - the year divided by twelve: €2.50, €6, €20, €40 a month;
  - the year's total in bold under it, *€30 a year*;
  - *paid yearly, in advance*, and *half the monthly price*.
- **On monthly,** each paid tier shows its monthly price and *No minimum term: stop whenever you
  like*.
- **Free** shows the same three lines in both: *Free*, *for as long as it runs*, *No invoice, no
  card, no billing details*. That is how `wf-pricing.svg` draws it, and the cards' lists now
  line up.
- **The guardrails hold:** no price struck through, none called a former price, no countdown, and
  the year's total always beside its per-month figure. A year that does not divide into whole
  cents stops the build.
- **Guard:** `site/site.unit.test.ts`:
  - the page opens on yearly, with a labelled switch and no form;
  - each paid card has its per-month figure for a year with the year's total beside it, and its
    monthly price;
  - no `<s>`, `<del>` or `line-through`, no former price, no countdown.

  `test/ui/site.ui.test.ts`:
  - the page opens on yearly: Small shows €2.50 and €30 a year;
  - Monthly, by a click and by an arrow key, shows €5;
  - the prices line up in both views;
  - the Dutch page fits 390 pixels.
- **T0:** *How you pay*, *Yearly*, *Monthly*, *paid yearly, in advance*, *half the monthly price*,
  *No minimum term: stop whenever you like* and the rule, in both languages, are new words for the
  owner's reading, and for the lawyer's (0139).

**2026-10-04, night: the estimate takes several sources, and Tasks** (the owner's two remarks of
2026-10-04, T7 (e); T7 (d) with them):
- **Moving away from?** is tick boxes, so a person leaving Google and Dropbox ticks both. *Box* is
  one of them (T7 (d)), and its Leaving page now opens the estimate on Box. A `?from=` may carry a
  list.
- **One migration per data type per source,** as the app counts them: Google and Dropbox both
  with files are two. `calculator.mjs`'s `migrationsFrom` counts it from what each source brings,
  which `build.mjs` reads off the Leaving pages' verdicts:
  - a data type that moves is a migration of its own;
  - photos a source keeps among its files travel with *Files* (Microsoft, Dropbox, Box);
  - a data type a source does not keep, or that cannot move, is not counted, and the page says
    so: *"Not counted, because we cannot move this from what you ticked: Files."*
  - *Somewhere else* may keep anything.
- **Tasks is a data type of its own,** so a whole Google move is six: mail, contacts, calendar,
  tasks, files, and the Takeout's photos. The profiles are version 2; tasks are a judgement,
  carried as 0.01 GB.
- **Sizes are asked only for mail, files and photos,** which a storage page shows. Contacts,
  calendars and tasks come from the profile, in one line: *"Contacts, calendars and tasks take
  little room, so we count them for you: less than 1 GB."*
- **(d) needed no profile row:** the profiles are per person and data type, not per source.
- **Guards:**
  - `site/calculator.unit.test.ts`: Google and Dropbox with files are two; photos travel with
    files; Apple's files are not counted; no source counts nothing; one source that keeps
    everything agrees with `pathsFor`; what each source brings; every source a Leaving page
    sends here is offered.
  - `site/profiles.unit.test.ts`: tasks, the sizes asked, version 2.
  - `test/ui/site.ui.test.ts`: tick boxes; Google and Dropbox are five, said per source; tasks
    make six with no size field; Apple's files said and greyed; no source, no tier; a list
    arriving on the Dutch page. The script changed, so `$csp_calc` is re-pinned.
- **With today's table** a whole Google move, six, lands on Medium. The owner's new table of
  2026-10-04 (Free and Small six, Medium twelve) is ADR-0014's next amendment, and puts it on Free.
- **T0:** new words for the owner's reading: the hint under *Moving away from?*, the small line,
  the not-counted line, *Files from Dropbox* in the count, and *Box*.

**2026-10-04, night: T5 (a) and (b) are built** (R8 step 10). Six pages in each language:
*Leaving Google*, *Leaving Microsoft 365*, *Leaving Apple iCloud*, *Leaving Dropbox*, *Leaving Box*
and *Leaving another mail provider*, *Weg bij …* in Dutch. Each has the plan's five parts:
- **What moves:** a row per data type, *moves*, *moves, with a limit* or *does not move*. A row
  carries the app's *Experimental* tag where the app tags that card's face, and names where its
  data type can go, as *Where to* names it. Photos from a Takeout go only to Nextcloud or a WebDAV
  provider, where the app reads an export from. Google and Microsoft 365 also say what stays
  behind, from the scope manifest.
- **Limits you should know:** Gmail's 2.5 GB a day, Google's documents and its Takeout, the
  registration Microsoft needs for other mailboxes, Apple's Reminders, iCloud Drive and export,
  Dropbox Paper, Box's trash, and mail only over IMAP. Each links its guide section in the app.
- **What you will do:** a button, a password, an app of your own or an export, read from the
  card's own credential.
- **A typical cost,** from the calculator's profile through `deriveTier`. *Work out what yours
  costs* opens the estimate on the same case: `?from=` chooses the source and `?what=` ticks the
  data types, each matched against the estimate's own options. The calculator's hash is re-pinned.
- **The next step:** *Request access*.
- **(b):** *Leaving…* joins the header after Pricing, a `<details>` list of the six with their
  tiles, and folds inside the phone's menu. That menu now folds at 48rem, not 40: between 641
  and 768 pixels the header's five did not fit beside the name and the language switch. The hero
  names the six under its buttons, three by two, as `wf-site-home.svg` draws it. Each link is
  named by its page's title, and each tile is hidden from a screen reader.
- **Guard:** `scripts/leaving-pages-say-what-the-app-says.unit.test.ts`:
  - a row moves only by a card of its page that carries its data type, and a row that does not
    move has no card on its page that carries it;
  - a row is experimental exactly when `sourceFaceIsExperimental` says so, in the app's words;
  - each step is what its card's credential asks;
  - what stays behind is the manifest's *Does not migrate* rows, row for row;
  - photos go where `ARCHIVE_READABLE_TARGETS` says, and each tile is `TILE_LETTERS`'s;
  - each limit's guide section exists in both languages;
  - the cost is the calculator's own answer, and the estimate opens on it;
  - every page links all six, from both navs and the hero.

  Mutations caught: eight, among them a task row untagged, a Dropbox password, Planner dropped,
  photos sent to JMAP and a page priced one migration at a time.
  `test/ui/site.ui.test.ts`:
  - at 780 pixels the header is one row in both languages;
  - at 1200 the list opens on screen;
  - on a phone *Leaving…* opens from the keyboard inside the menu;
  - three of the pages fit 390 pixels;
  - Dropbox's estimate lands on Free, as its page says;
  - a value the estimate does not offer changes nothing.
- **Not built:** (a) 5's *Request access* carrying the source waits for T7 (a), since the request
  has no place for it yet. (c) waits for the site's own address. The guide links open the app's
  guide sections, which a visitor without an account can read since *the guides are public*
  (above); 0151's help section is where they should point once it exists (T5 (d)).
- **T0:** every sentence on the six pages, and *Leaving…* / *Weg bij…*, in both languages, are new
  words for the owner's reading.

**2026-10-04, evening: T7 (c) is built** (R8 step 11's first part). The estimate's three faults
are fixed, as the audit found them:
- **at 1280 pixels**, Calendar's *"2,000 items assumed"* ran into *Files*. Each field now puts its
  label above the box and wraps its count under it;
- **at 390 pixels**, the *THIS ONE DECIDES* badge covered *"Migrations at the same time"*. Both
  cards now reserve the room above their heading, so the badge sits there and the two headings
  stay on one line whichever card decides;
- **sizes from 1 TB up** printed every digit (*1.2345 TB*). `sizeOf` moved into
  `site/calculator.mjs`, where the tested arithmetic lives, and writes one decimal (*1.2 TB*).

The result (`#paths-line`, the two cards and `#tier-card`) sits in one `aria-live="polite"`
region, so a screen reader hears the new tier. The script changed, so `$csp_calc` is re-pinned.
- **Guards:**
  - `test/ui/site.ui.test.ts`, at 1280 and 390 pixels: no field's parts leave its cell, no two
    fields overlap, and no badge covers its heading; the region is polite and holds the result.
    The old field and badge styles each fail it.
  - `site/calculator.unit.test.ts`: `sizeOf`'s GB and one-decimal TB, and the hash.

**2026-10-04, evening: T4 is built** (R8 step 9). The home page's *Where to*, after the hero
until T3's three steps exist, names where a person's data can go:
- **Soverin**, **Nextcloud**, **a JMAP server** such as Stalwart, and **any other provider** that
  speaks IMAP, CalDAV, CardDAV or WebDAV. Each card lists the data types it takes, with the
  drawing's icons and the app's own words for them (*Email*, *E-mail*). The card that is four
  protocols says which protocol carries each type.
- **The list is a guarded copy** (T4 (b)): `site/destinations.mjs` against the app's
  `TARGET_TYPE_DOMAINS`, and `site/icons.mjs` against `docs/design/0152-0154/icons.svg`, the
  sprite the app's `an-icon-drawn-twice` already expected the site to inline.
- **No third-party claim** (T4 (c)): data types only, never a price, hosting or quality.
- **Guard:** `scripts/where-to-is-the-apps-own-list.unit.test.ts`:
  - every target type is on one card, and the site names none the app lacks;
  - each card shows exactly what its types carry, by the type that carries it;
  - the words are the app's `domain.*` strings, in both languages, and `targetTypeName`'s;
  - the icons are the drawing's, character for character;
  - both home pages draw it, with the sprite once and no price.
- **T0:** *Where to* / *Waar naartoe* and its sentence, and *A JMAP server, such as Stalwart* /
  *Any other provider, that speaks …*, in both languages, are new words for the owner's reading.

**2026-10-04, evening: T1 (b) is built, with a defect it found.** No page says what *"most people"*
choose any more, since nothing counts it.
- **The home page's cost line** says *"**Small**, for one person moving everything at once: €5 a
  month…"*, in the drawing's words, in both languages.
- **The badge goes.** Its proposed words, *"One person moving everything at once"*, would repeat
  the line printed under it, *"One person, everything at once"*. The card keeps its outline.
  Small's note drops *"Most people who are leaving one provider for another want this one."*
- **The Dutch pricing page printed each tier's subtitle and note in English.** They lived in
  `prices.mjs` in English only. They are copy now, per language (`tierText` in `copy.mjs`), and
  `prices.mjs` holds the numbers.
- **Guard:** `site/site.unit.test.ts`:
  - each tier's subtitle and note are in the page's own language;
  - no page says *most people*, *meeste mensen* or *meest gekozen*;
  - the home page's sentence is pinned in both languages.

  Mutation caught: an English note on the Dutch page.
- **T0:** the Dutch subtitles and notes are new words for the owner's reading.

**2026-10-04, evening: T9 is built** (R8 step 9). `/login` and `/request-access`, the pages the
site's *Sign in* and *Request access* lead to, take the site's look:
- **the site's mark** where the app's blue icon was: `SiteMark.tsx`, the shapes of
  `site/brand/logo.svg`, inline because the appliance serves the bundle under `/ui`;
- **the site's teal** for their buttons, links and focus rings (`--color-site-teal` and
  `--color-site-mint` in `index.css`);
- ***← ownpace.eu*** above the mark (`BackToSite.tsx`). It leads to the site's home page in the
  reader's language, `/nl/` for Dutch, and is built from the deployment's own site setting
  (`services/site-home.ts`, on `legal-links.ts`'s origin), never a fixed host. The arrow is
  drawn, not read.

The rest of the app keeps its colours (T9 (b)).
- **Guards:** `scripts/one-look-from-the-site-to-the-app.unit.test.ts`:
  - the palette is the site's;
  - the mark is the site's file, shape for shape;
  - both pages draw the mark and the way back, and none of the app's blue;
  - the way back is the setting's site, refused as the legal links refuse.

  `a-way-back-to-the-site.unit.test.tsx`: on both pages, in both languages, the link named for
  the site goes home, and the mark is hidden from a screen reader.

**2026-10-04, evening: T2 and T6 (c) are built** (R8 step 9, its first part). The header reads
*Home · How it works · Pricing · Sign in*, then the language switch.
- **Sign in** goes to the app's sign-in page, built from `APP_URL` (`SIGN_IN_URL` in
  `site/prices.mjs`), so a test site never sends anybody to production's.
- **On a phone** (40rem and narrower) the four fold into a `<details>` menu that opens without a
  script, under the site's CSP. The name, the language switch and *Menu* share one row, 56
  pixels high. A drawn chevron turns when it opens; the browser tells a screen reader whether it
  is open. The language switch stays outside the menu, as the answer to open question 4 asked.
- **The estimate leaves the header,** and T6 (c) links it: *Work out what yours costs* sits
  under the tier cards, and leads the home page's *What it costs*, beside *All five tiers, in
  full*, as `wf-site-home.svg` draws it. That block's *How a migration works* goes, since the
  header carries it. Privacy and Terms stay in the footer only.
- **Guards:** `site/site.unit.test.ts`:
  - every page's header lists the four, the phone's menu the same four, *Sign in* the app's,
    and the language switch beside them;
  - the estimate is linked from pricing and home, and Privacy and Terms from the footer;
  - the guide stays out of both navs, and so does the 404 page
    (`pages-that-do-not-exist`, which looked for the old `<nav class="site">` exactly and would
    have matched nothing once the nav gained a label; it now fails on a page with no nav).

  `test/ui/site.ui.test.ts`, at 390 pixels:
  - one row under 64 pixels, with the wide header hidden and the language switch shown;
  - the menu is closed until Tab reaches it and Enter opens it, and its links fit the screen;
  - at 1200 pixels the header shows its pages, and no menu.

  Mutations caught: the estimate back in the header, and the pricing page's button removed.
- **T0:** *Sign in* / *Aanmelden* (the app's own word), *Menu*, and *Work out what yours costs* /
  *Reken uit wat het u kost* are new words for the owner's reading.

**2026-10-04, later: D11 changes. A year is never refunded and never renews** (the owner: *"C,
nog refund of the first year"*; on credit left at the year's end, *"i, go ahead"*). ADR-0014
records it (*Amendment 2026-10-04*). A year is still credit at six months' price, and each of its
twelve months takes its own tier at half its monthly price. Nothing of it is refunded, also not
on cancelling; the right of withdrawal (terms §7) stands. What is left after the twelve months
pays the months that follow, at their monthly price, until it runs out; then the subscription
runs month to month.
- **Built:** the pricing page's year paragraph, and terms §8, in both languages, with question 27
  in the lawyer's briefing. The renewal line in `wf-pricing.svg` is now the year's line.
- **T6 (f) shrinks** to the withdrawal button: no renewal, no reminder before one, and no
  refunds to build. 0111's yearly invoice still draws the credit month by month.
- **Confirmed by the owner, 2026-10-04** (*"Yes, full"*): after the twelve months the credit pays
  the *full* monthly price, as it was read, since C makes those months month to month.
- **T0:** the new sentences are for the owner's reading, in both languages.

**2026-10-04: a new question for the owner, open question 5: which line the site shows during
the Alpha.** T1 (a) copies the app's alpha sentence to every site page. Since 0131 D4's
amendment that sentence is the owner's welcome, *"Welcome to the Alpha! Try Ownpace at your own
pace, and help others move to European alternatives more easily."*, and no longer the facts. So
every visitor would read it, invited or not. §3 T1 (a) says why; the owner decides before T1 is
built. The home wireframe's alpha line is now a placeholder (§5). Nothing here is built. On
branch `claude/ownpace-public-readiness-y7orc6-the-alpha-by-its-name`, not merged.

**2026-10-03, night: T6 (d) is built, and the price list is in force** (the owner's *"go"* on
the remaining work). One pull request changes ADR-0014's operative table, `site/prices.mjs` and
the managed code together, as the amendment asked:
- **The list:** Free (id `free`, was `tiny`) · Small €5 / €30 · Medium €12 / €72 · Large €40 /
  €240 · Extra large €80 / €480. No setup fees. `site/prices.mjs` and
  `packages/managed/src/tier-calculator.ts` are in integer cents with a yearly price; both guards
  parse the new table and now also hold *a year is six months* for every tier.
- **The cards** lead with the price a month and show the year's total under it, with *no setup
  fee* and a three-month total; the derived first month is gone. The home page says *"Free: one
  migration at a time, up to 250 GB."* A guard fails on any page that still names Tiny or quotes
  a setup fee (the legal texts aside).
- **The calculator** prices a top-up at the tier's monthly, once (the answer (b)), against the
  next tier's monthly difference, and says the break-even in days. `$csp_calc` is re-pinned.
- **The pricing page's rules:** *no setup fee*, *a year costs six months* (as credit, refunded
  when you stop), the top-up at the monthly, and *Why it is priced this way* now says *"Costs
  include our work"* (T6 (g)'s principle). The terms' §6 and §8 follow for Free and the setup fee;
  §8's paragraph on a prepaid term still says it is not refunded, which is T6 (f)'s and the
  lawyer's (0139) to rewrite.
- **The app:** the Billing and Support screens show the month and the year in cents, and the
  access form offers Free.
- **Still open:** T6 (e) (the switch and the price a month on yearly), (f) (renewal, refund,
  withdrawal), and 0111's yearly invoice. T0: every new sentence above is for the owner's reading.

**2026-10-03, later: the amendment is accepted, and a year is credit** (the owner, after *"the
pricing model doesn't have setup costs anymore"*: *"a"*). Question 2 is answered (a): a year is
credit at six months' price, and each month takes its own tier at half its monthly price. The
acceptance T6 (d)–(f) and T7 were waiting for is given; what they still wait on is 0111's yearly
invoice. The list comes into force with T6 (d)'s pull request, which changes ADR-0014's table,
`site/prices.mjs` and the managed code together.

**2026-10-03: the owner answered the amendment's top-up question: (b)** (*"Take b"*). Top-ups
stay, at the tier's monthly price, once. The year question is still open, and the amendment still
waits for acceptance; the answer is recorded in ADR-0014's *Pending* section. The rules in force
changed the same day: every step up is consented and paid for, and at the data ceiling new first
copies hold until the yes (ADR-0014, *Amendment 2026-10-03*).

**2026-09-29, morning: T6 (g)'s ADR-0014 amendment is drafted, for the owner's acceptance**
(R8 step 11's first need; the owner's answer 9, *"Yes"*, after checking it had not landed). The
amendment is appended to ADR-0014 as proposed, and the operative rules are unchanged until the
owner accepts:
- D9's list, with a yearly column and no setup fees;
- D11's year, which renews, can be stopped, and refunds;
- D12's principle, which replaces *"No profit" STANDS*.

It asks the owner two questions, each with a recommendation:
- **Top-ups**, which were paid with the setup fee: recommended, none; the tier moves up.
- **How a year meets a tier derived each month:** recommended, a year is credit at six months'
  price, and each month takes its own tier at half its monthly price.

The table changes with `site/prices.mjs` in T6 (d)'s pull request, because the price guards read
it.

**2026-09-29, morning: the owner's answers (asked by the writing session).**

- **T0 for D6 on the site's own pages:** #1339's Dutch is approved as written (*"Yes"*), as its
  own entry below says.
- **Open question 4: English at the root.** `/` stays English, and Dutch stays under `/nl/`.
- **T6 (g), the ADR-0014 amendment:** the writing session drafts it for the owner's acceptance
  (*"Yes"*, once it was checked that none had landed overnight). T6 (d)–(f) and T7 still wait on
  the amendment's acceptance and on 0111's yearly invoice.

**2026-09-28, night: D6 on the site's own pages, and T6 (a)'s guard (R8 step 2, by the writing
session at the owner's word *"continue on the rest"*).**

- **D6 is built for what the site writes.** Every form of *verhuizen* in `site/copy.mjs`,
  `site/pages/nl/` and `build.mjs`'s Dutch page titles is a form of *migratie* or *migreren*
  (52 places). Where a straight swap read worse, the sentence is rewritten:
  - *"Wie verhuist er?"* becomes *"Voor wie is het?"*, the app's *Voor wie?*;
  - *"Wat verhuist er?"* becomes *"Wat wilt u migreren?"*;
  - *"nadat ze zijn verhuisd"* becomes *"nadat ze zijn overgestapt"*.

  The owner read them and approved them as written on 2026-09-29 (*"Yes"*), *migreer uw eigen
  gegevens* in the footer and the home title included. Later that morning, asked again by session
  M, the owner chose the other wording for those two: *"'neem uw gegevens'. Rest is ok"*. The
  footer now says *neem uw gegevens mee, in uw eigen tempo* and the home page's title *Ownpace —
  neem uw gegevens mee, in uw eigen tempo*.
- **A guard** in `site/site.unit.test.ts` fails on `/verhui[sz]/i` in any Dutch page the build
  writes. The legal texts are excused by name: the privacy policy, the terms, and the Alpha
  conditions, which #1360 made a page of their own. They are 0139's, and still say *verhuizing*
  as the Alpha conditions' own word. The excuse fails when they follow D6.
- **T6 (a):** #1317 already took *"VAT is added where it applies"* off both pricing pages. The
  guard is new: no page may say both that prices include VAT and that VAT is added. #1317's
  briefing asks the lawyer whether one sentence covers both audiences, which is T6 (a)'s question
  to 0139.

**2026-09-28, evening: the owner's second answers settle every open choice but one.** Nothing is
built. The answers, quoted in §2:

- **All of it before the alpha (D5):** *"before we start Alpha i want this fixed/completed."* So
  T5 and T8 no longer wait for `WWW_LIVE`, and T6's price work no longer waits for the first
  invoice. Open question 1 is answered: *No*.
- ***Migratie*, never *verhuizing*, in Dutch (D6).** The site's *"4 verhuizingen tegelijk"*
  becomes *"4 migraties tegelijk"* (T0).
- **The price list (D9):** Free (replaces Tiny) · Small €5 a month or €30 a year · Medium €12 or
  €72 · Large €40 or €240 · Extra large €80 or €480.
  - VAT is included, and there are no setup fees.
  - The limits (migrations at the same time, data moved) are ADR-0014's, unchanged.
- **The price page (D10):** a switch that opens on yearly and shows the price per month and the
  discount against monthly. There is no strike-through, and the yearly total is always visible.
- **Renewal (D11):** a year renews by itself, the customer can stop at any time, and unused months
  are refunded.
- **The principle (D12):** *"Costs include our work"*. The price pays for the servers, the
  support and the time spent building the service, and self-hosting stays free. That replaces
  *"not to make a margin"* on the page. ADR-0014 is amended by the owner (T6 (g)).
- **The rest:**
  - the destinations the app supports are named (T4, T5);
  - a drawing now, and an app screen later (T3);
  - R builds from this session's drawings in [`docs/design/0152-0154/`](../design/0152-0154/README.md)
    (D8).

0131 T5's row for this plan is now the whole plan.

**2026-09-28: opened from the owner's request, with four answers from the owner.** The owner
asked, on 2026-09-28, for the website and the app to become more intuitive, from a UX and UI
point of view, with questions and recommendations, written up as workplans. This plan covers the
site (`site/`) and the two app pages its buttons lead to. 0153 covers the app's migrations and
the flow that creates them. 0154 covers progress and proof. The three plans were written
together, from one audit of the site and the app on `main` at `83eb73e` (§1).

| Task | Status | Notes |
|---|---|---|
| T0 The owner reads the new copy | ⏳ **Owner; before the first invitation, before each task merges. D6's *migratie* is built on the site's own pages; the legal texts are 0139's** | §3. Site copy is the owner's to approve (0144 T0). Every new sentence here is a proposal, in both languages. It includes *migratie* for *verhuizing* (D6) and the new *Why it is priced this way* (T6 (g)). |
| T1 The alpha, said on the site | ✅ **Built: (b) 2026-10-04, (a) 2026-10-05 (open question 5); its new sentence waits for T0** | §3. A line about the Alpha on every site page while the alpha setting is on, and in the app's guides for a visitor without a session: a fact for a visitor, *"Ownpace is in its Alpha, by invitation. Nothing is charged during the Alpha."*, while the welcome stays the members' (open question 5, answered 2026-10-05). The unbacked *"Most people"* and *"Meest gekozen"* become a fact about the tier. |
| T2 A shorter menu, and a header that fits a phone | ✅ **Built 2026-10-04, with T6 (c); *Leaving…* joined it with T5 (b); its words wait for T0** | §3. The header reads Home · How it works · Pricing · Sign in, plus the language switch. Privacy and Terms move to the footer. On a phone the menu folds into a `<details>`, which needs no script. |
| T3 The hero shows the move | ✅ **Built 2026-10-04, and the app screen joined it 2026-10-05 (D8); its words wait for T0** | §3. The drawing `hero-move.svg`, inlined: the old account's data, then Ownpace, then the new home, with our own icons (D4). Three facts sit under it, and a three-step strip links to *How it works*. After the strip, the app itself: a person's page, photographed by `scripts/shoot-the-app-screen.mjs` and held to the app's words by the UI smoke. |
| T4 The destinations, named | ✅ **Built 2026-10-04; its words wait for T0** | §3. A *Where to* section names what the app supports, from a site copy of the app's list with a guard that it matches. It says plainly that the new account is one the person opens and pays for themselves. |
| T5 A page per provider a person leaves | ✅ **(a) and (b) built 2026-10-04; (c) built 2026-10-30, on `claude/ownpace-public-readiness-y7orc6-site-search-metadata`, and its links to the maintained documentation in `llms.txt` (ADR-0029) 2026-10-31, on `claude/ownpace-public-readiness-y7orc6-llms-txt-maintained-docs`; its words wait for T0** — *was:* 🟡 **(a) and (b) built 2026-10-04; (c) waits for the site's address; its words wait for T0** | §3. *Leaving Google*, *Leaving Microsoft 365*, *Leaving iCloud*, *Leaving Dropbox*, *Leaving Box*, *Leaving another mail provider*: what moves, the limits, what the person does, the destinations it can go to, a typical cost. Built from copies of the app's own verdicts, each guarded. |
| T6 Pricing that reads in one pass | ✅ **(a) to (g) done**: (a) the sentence by #1317 and its guard beside D6's by #1339, both merged 2026-09-29; (b) in #1486, merged 2026-10-05; (c) with T2 in #1471, (d) the new list with ADR-0014's amendment of 2026-09-29 in force and (g)'s principle on the page and the architecture document's dated §16 note, both in #1435, (e) in #1477 and (f)'s words on the page and in the terms in #1470, all merged 2026-10-04; (f)'s button, its label decided 2026-10-05, in #1562 (0111 slice 7c), merged 2026-10-11, and the email a month before a year's credit runs out in #1579, merged 2026-10-12. Its words wait for T0 — *was:* 🟡 **(a) done: the sentence by #1317, its guard beside D6's. (c) built 2026-10-04, with T2 (#1471). (d) built 2026-10-03, with (g)'s principle on the page. (b) and (e) built 2026-10-04. (f)'s words on the page and in the terms built 2026-10-04; the button's label decided 2026-10-05, the button built 2026-10-11 (0111 slice 7c). The rest proposed, before the first invitation (D5)** | §3. (a) One VAT statement. (b) The rules as questions and answers. (c) A button to the calculator. (d) The new list, a year = six months (D9). (e) The monthly / yearly switch (D10). (f) The withdrawal button, and the year's end (D11, amended 2026-10-04). (g) The principle, the price that pays for the work (D12). |
| T7 A calculator that ends in a button | ✅ **Built 2026-10-04: (a) in two halves, the form's and the site's, and (b) to (e); its words wait for T0** | §3. (a) *Request access* carries the answers along. (b) *Until when?* says which payment suits it. (c) The layout faults and a live region. (d) Box as a source. (e) Several sources at once, and Tasks. |
| T8 Claims you can check | ✅ **(a) and (b) built 2026-10-04; (c) built 2026-10-16, merged in #1599 (`72977aa6`)** | §3. "Open source" links the repository. Each proof point links the guard that holds it. The footer names the company once 0139 publishes it; until then that line is the one part that waits. |
| T9 One look from the site to the app | ✅ **Built 2026-10-04** | §3. `/request-access` and `/login` take the site's palette and logo, and link back to the site. The identity provider's own branding stays 0135 T6. |

## 1. What there is today

Every file and line below was read on `main` at `83eb73e` on 2026-09-28. The site was rendered
into a scratch folder with the CSP from `deploy/compose/www-nginx.conf` and photographed at 1280
and 390 pixels wide. `site/dist` was never written.

### The pages

`site/build.mjs` renders seven pages in each of two languages. English is at the root and Dutch
is under `/nl/`: home, how it works, pricing, estimate, privacy, terms and 404. `PAGE_KEYS`
(`build.mjs`:434) is `['home', 'how', 'pricing', 'calculator', 'privacy', 'terms']`, and the
header's menu is generated from it (`build.mjs`:473). So Privacy and Terms sit in the main menu,
and there is no *Sign in*. At 390 pixels the sticky header wraps onto three lines and takes 146
pixels.

### The home page

The home page is four blocks (`build.mjs`:605-634):

- the hero, with *"Move off Google or Microsoft. At your own pace."*;
- *What makes this different*, four cards;
- *What it will not do*, three cards;
- *What it costs*.

It has 423 words. The only image is the logo, and there is no SVG. A `.step` class is defined
(`build.mjs`:364) and never used.

The lede says where the data goes only as *"a European provider you choose"* (`copy.mjs`:63).
The site names no destination anywhere: not Soverin, not Nextcloud, not a JMAP server. Nothing
says the new account is one the person opens and pays for themselves. Target provisioning was
retracted (ADR-0008), and target providers are *"operated by somebody who is not us"*
(`docs/target-providers.md`:7).

### The alpha

The alpha is free, invite-only, Dutch, and has 10 to 20 testers (0131 D1). The site never says
so. The only sign is the button *Request access* and the build stamp in the footer. The alpha
sentence appears first on the app's `/request-access` and `/login`.

The site calls Small the choice of *"Most people"* (`copy.mjs`:99, :112), and *"Meest gekozen"*
in Dutch (:263). Nobody has chosen yet.

### Pricing

The pricing page shows ADR-0014's five tiers from `site/prices.mjs`. Each card leads with the
first month, setup included. Ten rules in bold-lead paragraphs follow (`pages/en/pricing.md`).

The page says *"All prices include VAT."* (`copy.mjs`:106) and, further down, *"VAT is added
where it applies."* (`pricing.md`:71; `prijzen.md`:73 *"Btw komt erbij waar die van toepassing
is."*). The two contradict each other on one page.

Pricing does not link the calculator. The calculator ends with a ghost button back to pricing
(`build.mjs`:867) and no way forward. *How it works* has no button at all.

There is no annual price. Billing monthly and annually is decided (0111 T9), and how far apart
the two are was decided on 2026-09-28 (§2, D3).

### The calculator

The calculator asks five questions (`copy.mjs`:136-137, `build.mjs`:816-828). Several answers
do less than the question suggests:

- **Until when?** changes only the Gmail sentence (`build.mjs`:751). The price line always says
  a three-month total.
- **Moving away from?** has no Box, which the product supports.
- **The layout at 1280 pixels.** The Calendar hint overlaps the Files label by 26 pixels.
- **The layout at 390 pixels.** The *THIS ONE DECIDES* badge covers its own heading.
- **An unrounded size.** A business on Microsoft reads *"1.3622 TB"* (`build.mjs`:668).
- **Screen readers.** The recomputed results have no live region, so a screen reader hears
  nothing when they change.

### The two app pages the buttons open

`/request-access` (`apps/web/src/pages/RequestAccess.tsx`) and `/login` (`Login.tsx`) use the
app's blue and a generic icon, with no Ownpace logo and no link back to the site. The site's teal
(`TEAL #0E4F4A`, `build.mjs`) stops at the click. The form reads `?tier=` only, so the
calculator's answers are typed again as free text.

### What must stay true

Any change here keeps these, all read in the files named:

- **One pinned script.** The site is server-rendered HTML that reads without a script (ADR-0029).
  The one script is the calculator, pinned by its sha256 in `www-nginx.conf`. Changing
  `calculator.mjs` or its glue means re-pinning `$csp_calc`, and
  `site/calculator.unit.test.ts` checks the hash.
- **The CSP:** `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action
  'none'`. Inline SVG and self-hosted images work. Web fonts, `data:` images, embeds and fetch
  do not.
- **No imports.** `site/` imports nothing from the workspace or npm (`build.mjs`:14-19). Any
  fact the app owns is copied into `site/` and guarded against its source, as `prices.mjs` is
  guarded against ADR-0014.
- **Markdown limits.** The site's Markdown renderer has no images and escapes raw HTML. New
  components are written in `build.mjs`.
- **No forms, no mailto buttons.** *Request access* stays a link to the app (0093).
- **Both languages.** Every `COPY` key exists in both (`site/site.unit.test.ts`). Translate the
  frame, never the finding (ADR-0013).
- **ADR-0014's words:**
  - "at the same time", never "concurrent";
  - "free", never "€0";
  - the calculator derives the tier and never offers it as a choice;
  - the bill-goes-down promise and its floor are said together.
- **VAT.** *"All prices include VAT."* appears on every page that shows a price, with no rate in
  the copy.
- **Fixed file names.** The legal files keep their names, because the app's link module is
  guarded against them.
- **"Read-only"** is said only beside Drive, Tasks and *Connect with Microsoft*
  (`scripts/a-read-only-claim-with-its-scope.unit.test.ts`). *How it works* is on its pending
  list for the owner's rewrite (0144 T3 (b)).
- **Two pricing paragraphs.** *Finishing lowers your bill* and *Unless you ask us to keep
  copying* stay within three paragraphs of each other
  (`scripts/a-sixth-state-added-to-only-one-list.unit.test.ts`).
- **The UI test.** `test/ui/site.ui.test.ts` finds the page by `.wrap`, `.btn-primary`, `.tier
  .price`, `nav.site a.lang`, `#what-*`, `#tier-*` and `#topup-line`. It checks that nothing
  scrolls sideways at 390 pixels.
- **Accessibility:** WCAG 2.2 AA.

## 2. The owner's decisions (2026-09-28)

The owner answered four questions in the session that wrote this plan.

- **D1 — One move per person.** The question: today a person leaving Google builds up to four
  migrations through a four-step form each. Should the app be built around one move per person,
  with the migrations set up underneath? The answer: *"as 1 (One move per person), but i think
  this is simular to the current 'Migrations' page, but just better fitting UX? One can add
  multiple migration paths (for example when one person is moving away from Google and Microsoft
  and Dropbox)."* 0153 builds it. For this plan it means the site's picture is one person's move,
  from one or more old accounts to a new home, never a copy job.
- **D2 — Before the first invitation.** The question was how this work sits against 0131 T5. The
  answer: *"Before the first invitation"*. This plan first read that as covering only what a
  tester meets, and asked (open question 1). D5 answers it: all of it.
- **D3 — A year costs six months.** The question: how many months of the monthly price should a
  year cost? The answer: *"A year = 6 months"*. So every paid band has two prices, the monthly
  and six times the monthly for a year. The page says the rule in plain words: *"Done within six
  months? Pay monthly. Longer, or not sure? A year costs the same as six months."* Nothing is
  struck through. The amounts and the page came the same evening, in D9 and D10. D10 replaces
  this line's *no percentage badge*.
- **D4 — Names and our own icons.** The question: how should Google, Microsoft, Apple, Dropbox,
  Soverin and Nextcloud appear? The answer: *"Names + our own icons"*. So no third-party logo
  file appears on the site or in the app. A provider is named in text next to our own icon: the
  initial tiles 0107 T2 built, and data-type icons for mail, contacts, calendar, files and
  photos. This settles 0107 T2's open *"real logos need the owner's go-ahead"*: there are none.
  The option the owner chose read *"our own neutral monogram tiles"*, so the tiles are neutral
  (`docs/design/0152-0154/tiles.svg`). That answers open question 3.

The owner answered the rest the same evening:

- **D5 — All of it before the alpha.** *"before we start Alpha i want this fixed/completed."*
- **D6 — *Migratie*, never *verhuizing*.** *"Yes, but dutch know 'één migratie en 4
  migraties'. So we use 'migratie' in instead of 'verhuizing'."* The site's Dutch follows (T0).
- **D7 — The destinations the app supports are named.** The owner chose *"Name what the app
  supports"*. On the homepage (T4) and on each *Leaving…* page (T5), a destination is named with
  the data types it takes, from the app's own list. The pages give no prices or ratings of
  theirs.
- **D8 — Drafted here, built by R.** *"you draft the workplans and UX/visual image elements we
  might need or explain in the workplans how/with what the other session should make those."*
  - The drawings are in `docs/design/0152-0154/`.
  - §5 says how each is built.
  - The tasks are group R8 in 0131 §6.
  - The homepage picture is *"Drawing now, app screen later"*.
- **D9 — The price list.** The owner asked for one free tier replacing Tiny and a very cheap one
  under €10 a month: *"Make it 5 euro per month, leaving it 30 euro if one pays anually. change
  the other tiers in accourdance. Do validate with me."* Validating the proposed table, the owner
  set it: *"Free · Small €5/€30 · Medium €12/€72 · Large €40/€240 · Extra large €80/€480."*
  - Setup fees: *"Drop setup fees"*.
  - VAT is included.
  - The limits stay ADR-0014's.
- **D10 — The page opens on yearly.** *"Yearly preselected, with montly/yearly switch that
  opens on yearly. It shows the monthly price (yearly divided by 12) and discount against the
  monthly price."*
- **D11 — A year renews, and stopping refunds.** The owner chose *"Auto-renew a year, refund"*.
  **Amended 2026-10-04:** *"C, nog refund of the first year"*, and on what is left at the year's
  end, *"i, go ahead"*. A year is never refunded and never renews, and what is left pays the
  months after it (ADR-0014, *Amendment 2026-10-04*).
- **D12 — The price pays for the work.** On the page's *"not to make a margin"*: *"yes, but i do
  need a pricing model that supports the efforts."* Asked how the page should say it, the owner
  chose *"Costs include our work"*.

## 3. What each task does

### T0 — the owner reads the new copy (owner; before each task merges)

Every sentence this plan adds is a proposal. 0144 T0 made the site's copy the owner's to approve,
and nothing here changes that. Each pull request carries its sentences in both languages in its
description, and merges after the owner's word on them. What this plan proposes is in the task
below it, marked *proposed wording*.

**One change is decided rather than proposed (D6): Dutch says *migratie*, never *verhuizing*.**

- Every form of *verhuizen* in `site/copy.mjs` and `site/pages/nl/` (*verhuizing*, *verhuizingen*,
  *verhuist*, *verhuisd*) becomes a form of *migratie* or *migreren*. For example,
  `copy.mjs`:258's *"verhuizing tegelijk"* becomes *"migratie tegelijk"*, and `copy.mjs`:224's
  *"Hoe een verhuizing verloopt"* becomes *"Hoe een migratie verloopt"*.
- A sentence that reads worse for it is rewritten, not patched, and the owner reads it first.
  For example, *"Het is een verhuizing, geen kopie"* becomes *"Het is een migratie, geen
  kopie"*.
- A case in `site/site.unit.test.ts` fails on `/verhui[sz]/i` anywhere in the Dutch pages, so
  *verhuist* and *verhuisd* are caught as well as *verhuizing*.

### T1 — the alpha, said on the site (before the first invitation)

(a) **The alpha sentence on every page** while the build carries the alpha setting. The setting
is the one 0144 T1 gives the site build for the tester guide. The sentence is the one the app
shows on `/login` and `/request-access`. It is copied into `copy.mjs`, and a guard compares it
with the app's string, so the two cannot drift. Proposed placement: one line under the header, in
the site's muted style, not a yellow banner.
*(2026-10-04: the app's sentence is now the owner's welcome (0131 D4's amendment): *"Welcome to
the Alpha! Try Ownpace at your own pace, and help others move to European alternatives more
easily."* Copied as proposed, every visitor of the public site would read it, invited or not.
Which line the site shows is for the owner to decide before this is built: open question 5.)*
*(2026-10-05: answered, *"Do suggestions for non alpha viewers"*. The welcome stays the members'.
A visitor reads a fact, the app's new `alpha.visitor.line` and its `alpha.nothingCharged`, then
*Request access*: *"Ownpace is in its Alpha, by invitation. Nothing is charged during the
Alpha."* The copy and its guard are as proposed, and so is the placement. The app's guides say
the same to a visitor without a session. Built: see the Status block.)*

(b) **"Most people" becomes a fact about the tier.**

- In `copy.mjs`:99 and the tier badge (:112, :263), the proposed wording is *"One person moving
  everything at once"*, and *"Eén persoon die alles tegelijk migreert"* in Dutch (D6).
- It changes back only when there is a count to base it on.
- `site/site.unit.test.ts` pins the home page's sentence and is updated in the same pull request.

### T2 — a shorter menu, and a header that fits a phone (before the first invitation)

(a) **The header** reads *Home · How it works · Pricing · Sign in*, then the language switch.

- *Estimate* leaves the menu. Its page stays, is linked from pricing (T6 (c)) and the home page,
  and keeps its place in `PAGE_KEYS` for the language switch and hreflang.
- *Privacy* and *Terms* leave the header. The footer already carries them.
- *Sign in* links `${APP_URL}/login`. It is built from `APP_URL`, never a fixed host
  (`the-test-site-sent-people-to-production`).
- T5 adds *Leaving…* when its pages exist.

(b) **On a phone** the menu folds into `<details><summary>`, which opens without a script and
passes the CSP. The header stays under 64 pixels at 390 wide.

- A new case in `test/ui/site.ui.test.ts` measures the header at 390 pixels and opens the menu
  with the keyboard.
- The 404 page stays out of the menu (`pages-that-do-not-exist`), and the status link stays in
  the footer.

### T3 — the hero shows the move (before the first invitation)

(a) **A picture beside the lede, as inline SVG:** `docs/design/0152-0154/hero-move.svg`,
*"Drawing now, app screen later"* (D8). A real screen of a person's migrations joins it once
0153 T5 exists.

- On the left, the old account: tiles for mail, contacts, calendar, files and photos.
- In the middle, Ownpace, with two arrows: *copies*, then *keeps in step*.
- On the right, the new home: the same tiles.
- Under it sit three short facts, in the site's card style. Proposed wording:
  - *"Nothing is deleted at the source."* This is the site's existing claim, not "read-only",
    which T0 keeps within 0144 T3's scope.
  - *"Kept in step until you switch."*
  - *"A list of what arrived, item by item."*
- The drawing uses the site's palette, works in dark mode, carries a `<title>` and an
  `aria-label` in the page's language, and scales down on a phone. On a phone it sits below
  the buttons, so the buttons stay in the first screen.

(b) **A three-step strip after the hero.** It is the five steps of *How it works* folded into
three, using the `.step` class `build.mjs` already defines:

1. *Connect the account you are leaving.*
2. *We copy, then keep copying.*
3. *Switch when you are ready.*

The strip links to the full page.

(c) ***How it works* gains a button at the end.** It is *Request access*, with *See what it
costs* beside it. It also gains one sentence that says what "switching" is for a person: their
mail app points at the new provider, and a person with their own domain changes where its mail
is delivered. Proposed wording goes to T0. The page's "read-only" rewrite stays 0144 T3 (b)'s.

### T4 — the destinations, named (before the first invitation)

(a) **A *Where to* section on the home page**, after the three steps.

- **What it says.** Proposed wording: *"Your new home is an account you open with a European
  provider, paid to them. Ownpace moves your data into it and keeps it in step."*
- **What it names:**
  - **Soverin**: mail, calendar, contacts and tasks.
  - **Nextcloud**: files, calendar, contacts and tasks.
  - **A JMAP server** such as Stalwart: mail, contacts and files.
  - **Any provider that speaks IMAP, CalDAV, CardDAV or WebDAV**, each for what its protocol
    carries.

  These are `TARGET_TYPE_DOMAINS` in `packages/shared/src/target-domains.ts` on 2026-09-28. The
  page takes them from the guarded copy (b), never from this list.
- **Each destination** shows the data types it takes, as T3's icons with their names.

(b) **The list is a copy with a guard.** `site/` cannot import `packages/shared`. So the
destinations and their data types are copied into a site module (`site/destinations.mjs`).

- A guard reads the app's target list (`packages/shared/src/target-domains.ts` and the cards in
  `credential-fields.ts`) and fails when the two disagree. This is the same pattern as
  `prices.mjs` against ADR-0014.
- A destination the app drops disappears from the site in the same pull request, or the guard
  fails.

(c) **No third-party claim beyond what the app proves.** The section says which data types a
destination takes. It does not say what the provider costs, where it is hosted or how good it is.
`docs/target-providers.md` keeps that, with its dates.

### T5 — a page per provider a person leaves (before the first invitation, D5)

(a) **Six pages in each language:** Google, Microsoft 365, Apple iCloud, Dropbox, Box, and
another mail provider. Each has the same five parts, all generated. The destinations each data
type can go to are named in the first part (D7), from the same guarded list as T4.

1. **What moves.** One row per data type, with *moves*, *moves with a limit* or *does not move*.
   The verdicts come from the same source as the app's cards and the scope manifest
   (`SOURCE_PROOFS` and the front-door cards in `packages/shared`). They are copied and guarded
   as in T4 (b). An *experimental* card says so, as it does in the app (0131 T2).
2. **Limits you should know.** These are the provider facts the product already states and tests:
   - Gmail's 2.5 GB a day, from `calculator.mjs`;
   - Google Photos only through Takeout (0112, 0116);
   - Apple's export (0115);
   - Dropbox Paper (0150);
   - Microsoft's app registration (0114).

   Each links its customer guide section (0148). A limit is never softened.
3. **What you will do.** Which steps are a button (a consent) and which need a password the person
   creates at their provider. This comes from the card's credential descriptor, so a step the
   wizard does not have is never written.
4. **A typical cost.** The calculator's profile for one person with that source, run through
   `deriveTier`, and a link to the calculator with the source already chosen (`?from=`).
5. **The next step.** *Request access*, carrying the source.

(b) **In the menu.** *Leaving…* joins the header as a `<details>` list of the six. The home
page's hero gets a row of the six names under the buttons. Each is text with its initial tile
(D4), not a logo.

(c) **Search.** The pages carry canonical URLs, hreflang with absolute URLs, and a line each in
`llms.txt` (ADR-0029's operative rule, not built yet). They are built before the alpha with the
rest (D5), and take effect once `WWW_LIVE` makes the site indexable.

(d) **Where this meets 0151.** 0151 T1, parked, would render `docs/guides` on the site. The pages
here link the app's guide sections today, and link the site's own help section when 0151
unparks. Neither copies the other's text.

### T6 — pricing that reads in one pass (before the first invitation, D5)

(a) **One statement about VAT.** The sentences *"VAT is added where it applies."*
(`pricing.md`:71) and *"Btw komt erbij waar die van toepassing is."* (`prijzen.md`:73) go.
*"All prices include VAT."* stays.

- A new case in `site/site.unit.test.ts` fails on any page that says prices include VAT and also
  says VAT is added.
- The same pull request asks 0139 whether the terms say the same.

(b) **The rules as questions and answers.** The ten bold-lead paragraphs become questions, each
answered in the paragraph that is there now. Proposed questions:

- *Is there a free way?*
- *Does the bill go down when I finish?*
- *Does pausing lower it?*
- *What if I keep copying after I switch?*
- …

Each is a `<details>` written by `build.mjs`, because the Markdown renderer escapes raw HTML. The
two paragraphs `a-sixth-state-added-to-only-one-list` holds together stay within three answers of
each other. The guard's comment is updated to say answers rather than paragraphs.

(c) **A button to the calculator.** *Work out what yours costs* sits under the tier cards and
links `estimate.html`. The home page's *What it costs* block gets the same button.

(d) **The new list (D9)**, drawn in `wf-pricing.svg`.

- **`site/prices.mjs` becomes:**

  | Tier | Id | Monthly | A year |
  |---|---|---|---|
  | Free | `free`, replaces `tiny` | free | free |
  | Small | | €5 | €30 |
  | Medium | | €12 | €72 |
  | Large | | €40 | €240 |
  | Extra large | | €80 | €480 |

  Each tier keeps its limits (at the same time, data moved). The `setup` field goes, because no
  tier has one. `annual` joins it.
- **ADR-0014's operative table is amended by the owner.** The tier name, the two prices, no
  setup column. `site/site.unit.test.ts` keeps reading the table and checks `prices.mjs`
  against it, and now also that every annual price is six times its monthly. A tier that
  breaks either fails the build.
- **The derived first month goes.** Setup plus monthly was the card's headline. The cards now
  lead with the price per month (e).
- **Every place that names Tiny follows**, in the same pull request:
  - the guarded home sentence *"Tiny is free: one migration at a time, up to 250 GB."* becomes
    *"Free: one migration at a time, up to 250 GB."*;
  - the calculator's derived tier;
  - `packages/managed/src/tier-calculator.ts`, which its own test holds equal to
    `site/calculator.mjs`.
- **ADR-0014's wording rules stand:** *free*, never *€0*, and *at the same time*.
- **Invoices follow in 0111:** no setup line, and a yearly line. The page never offers a price
  0111 cannot bill.

(e) **The monthly / yearly switch (D10).**

- **The switch.** Above the cards sits a two-option switch, *Yearly · Monthly* / *Per jaar ·
  Per maand*, opening on *Yearly*.
  - It is built without a script: two radio inputs and `:checked` sibling selectors in the
    inline style. The CSP needs nothing new, the site's no-`<form>` rule holds, and it works
    with JavaScript off.
  - It is a real radio group with a visible label, so a keyboard and a screen reader can use it.
- **On yearly, each paid tier shows:**
  - the price per month, the year divided by twelve: €2.50, €6, €20, €40;
  - the year's total, in bold on the line under it and never in small print: *"€30 a year"*;
  - the comparison: *"half the monthly price"* / *"de helft van de maandprijs"*.
- **On monthly,** each paid tier shows its monthly price.
- **Free** shows *Free* in both views.
- **Cents.** €2.50 needs them. So `prices.mjs` moves to integer cents, and its formatter learns
  cents. `prices.mjs`'s own header asks for exactly this (*"change this to integer cents and fix
  the formatter — do not introduce a float"*).
- **The guardrails, from the Dutch rules on price comparisons:**
  - no price is struck through;
  - no price is called a former or "was" price;
  - the discount compares two prices on sale now, never a price cut;
  - the yearly total is always visible;
  - VAT is included;
  - there is no countdown or "limited time".

  The owner's lawyer confirms the wording (0139). Two cases in `site/site.unit.test.ts` hold the
  guardrails: no `<s>`, `<del>` or `line-through` on the pricing page, and every per-month yearly
  figure has its yearly total in the same card.
- **Under the switch,** the plain sentence can stay for anyone who wants the reason: *"Done
  within six months? Pay monthly. Longer, or not sure? A year costs the same as six months."*
  Its Dutch is in D3. It stays if the owner keeps it in T0.
- **`test/ui/site.ui.test.ts`:**
  - the page opens on yearly;
  - switching shows the monthly prices, with a click and with the keyboard;
  - nothing scrolls sideways at 390 pixels.

(f) **The withdrawal button, and the year's end (D11, amended 2026-10-04).**

- **Amended 2026-10-04.** A year is never refunded and never renews (ADR-0014, *Amendment
  2026-10-04*). The renewal, its reminder 30 days before, and refunds of unused months are gone
  from this task.
- **What the page says** is built, in the pricing page's year paragraph, in both languages: *"…
  Apart from the 14 days the law gives you to change your mind, the credit is not refunded, not
  even when you stop. What is left after the year is not lost: it pays for the months that
  follow, at their monthly price, until it runs out. Then you pay month by month. A year never
  renews by itself."* For T0 and the lawyer. The old *"Cancel whenever. No minimum term…"* keeps
  its truth for monthly.
- **The law behind it.** After the year, the subscription runs month to month, and stopping takes
  at most a month's notice (art. 6:236 sub j BW).
- **Proposed, for the owner: a notice before the credit runs out.** With no renewal there is no
  reminder before one. A month before the credit runs out, an email says when billing month by
  month starts and what a month on the current tier costs, in 0030's email channel and in both
  languages. It is what *we do not take money from inattention* asks, once the credit stops
  paying.
- **The withdrawal button.** A contract made online has needed a clearly labelled function to
  withdraw during the withdrawal period since 19 June 2026: Directive (EU) 2023/2673, which adds
  article 11a to the Consumer Rights Directive.
  - It takes two steps, and the confirmation arrives on a durable medium (an email).
  - It goes on the app's Billing page (`Billing.tsx`), with the label the Dutch law uses, which
    the lawyer confirms.
  - **The words, decided 2026-10-05** (the owner: *"Ok. As you would suggest."*): the directive's
    own. English: *Withdraw from contract here*, then *Confirm withdrawal*. Dutch: *Hier de
    overeenkomst herroepen*, then *Herroeping bevestigen*.
  - Terms §7 says it is there, beside the email route (0139).
  - **Built 2026-10-11** (0111 slice 7c): the card on the Billing page, its two steps, and the
    confirmation by email.
- **A withdrawal is refunded by credit note.** 0111 builds them (slices 7a and 7d). A year has no
  other refund.

(g) **The principle: the price pays for the work (D12).**

- ***Why it is priced this way* is rewritten.** Proposed wording, for T0:
  - English: *"Ownpace is priced to pay for what it takes to run and build it: the servers, the
    support, and the time spent building and improving the software. There are no investors to
    answer to. Running it yourself is free, and always will be."*
  - Dutch: *"Ownpace is zo geprijsd dat het betaalt wat nodig is om het te laten draaien en te
    bouwen: de servers, de ondersteuning en de tijd voor het bouwen en verbeteren van de
    software. Er zijn geen investeerders om verantwoording aan af te leggen. Zelf draaien is
    gratis, en blijft dat."*
- ***"The larger tiers are priced above their own cost on purpose"*** goes with the old
  principle.
- **ADR-0014 is amended by the owner.** Its *cost-recovery* framing becomes this principle, and
  its operative rules are regenerated into `OPERATIVE.md`. The architecture document's §16 line
  *"Billing is cost-recovery, not for profit"* gets a dated note in the same pull request. This
  task drafts both and waits for the owner's word.

### T7 — a calculator that ends in a button (before the first invitation, D5)

(a) ***Request access* at the end, with the answers carried along.**

- **The link.** The result card ends with *Request access* to `/request-access`, with the answers
  as query parameters: `?tier=`, `from=`, `what=`, `who=`.
- **The form.** `RequestAccess.tsx` reads them and fills *"What are you moving?"* with a sentence
  built from them, which the person can edit.
- **Nothing else.** No new field is stored and the free-text field keeps its limits. The rate
  limit and the identical response (0093) do not change.
- **The CSP.** The link is built by the pinned script, so the hash is re-pinned in the same pull
  request.

(b) ***Until when?* says which payment suits it** (D9, D10).

- *1 month* or *3 months* leads to *"Paying monthly suits this: €M a month."*
- *6 months* or *When I am ready* leads to *"A year suits this: €6M, which is half the monthly
  price."*
- This is a sentence under the result, not a choice, so the tier stays derived (ADR-0014). The
  three-month total line gives way to the answer the person chose.

(c) **The layout faults and a live region.**

- The Calendar and Files overlap at 1280 pixels.
- The *THIS ONE DECIDES* badge covers its heading at 390 pixels.
- Sizes above 1 TB round to one decimal.
- The result card, `#paths-line` and `#tier-card` sit in one `aria-live="polite"` region, so a
  screen reader hears the new tier.
- A case in `test/ui/site.ui.test.ts` asserts no overlap at both widths.

(d) **Box as a source.** *Moving away from?* gains *Box*, with a profile row in
`profiles.mjs` and its provenance (`profiles.unit.test.ts` requires one).

(e) **Several sources at once, and Tasks** (the owner, 2026-10-04: *"'moving away from' should
offer multiple sources instead of radio options. And i dont think it makes sense to let people
fill in GB for contacts, tasks and calander. They dont know that"*).

- *Moving away from?* is tick boxes, and the count is one migration per data type per source.
- *Tasks* is a data type of its own, as the app moves and bills it.
- Sizes are asked only for mail, files and photos; contacts, calendars and tasks are counted
  from the profile and said in one line.

### T8 — claims you can check (before the first invitation, D5)

(a) **"Open source" links the repository.** The phrase in `copy.mjs`:45, :81 and :83 links
`https://github.com/Robbes/Ownpace`. The footer's *"Run it yourself"* links the self-host
quickstart there.

(b) **Each proof point links its guard.**

- *"The software has no way to delete from a source"* links
  `scripts/a-source-that-only-reads.unit.test.ts` on GitHub.
- *"Nothing is deleted at the source"* links the same guard.
- *"Whatever cannot be moved is reported to you"* links the scope manifest's source.

A guard fails when a linked file no longer exists in the tree, so a claim cannot outlive its
proof.

(c) **The company in the footer.** The name, KvK number and address come once 0139 publishes
them. A `--public` build already refuses the placeholders, so this is wording only.

### T9 — one look from the site to the app (before the first invitation)

(a) **The two pages take the site's look.** `/request-access` and `/login` use the site's palette
(`TEAL`, `MINT`) and the logo from `site/brand/`, served by the web build. Each carries a link
back to the site, *"← ownpace.eu"*, built from the deployment's own site address. It is never a
fixed host.

(b) **The rest of the app** kept its colours until 0153 reviewed the palette with its layout. On
2026-10-05 the owner chose for it: the site's warm paper, and teal for the app's blue (*"Yes,
paper + teal"*). It is built centrally in `apps/web/src/index.css` (0153's Status). The identity
provider's pages stay 0135 T6.

## 4. Order

1. **T0**, the owner's reading. It runs alongside everything else and blocks merges, not work.
2. **All of it before the first invitation (D5), in this order:**
   1. T6 (a), the VAT sentence. It is the smallest, and it matters under consumer law.
   2. T1.
   3. T2.
   4. T9.
   5. T3.
   6. T4.
   7. T7 (a), (c) and (d).
   8. T6 (c).
   9. T5.
   10. T8.
   11. T6 (b).
   12. T6 (d) and T7 (b) together, then T6 (e), then T6 (f) and (g).

**What only someone else can unblock.** None of it moves a task later (D5). It is:

- **The owner's ADR-0014 amendment:** the list, no setup, and the principle. This comes before
  T6 (d) and (g).
- **0111's yearly invoicing,** which draws a year's credit month by month (since 2026-10-04 there
  are no refunds and no renewal reminder to build). It comes before T6 (d) to (f) show a price a
  customer could pay. **Built 2026-10-12** (0111 T11, Y1 to Y3): a year can be bought on the
  Billing page, its credit drawn month by month, with one email a month before it runs out. The alpha is free (0131 D1), so the pages can show the list
  while nothing is billed. The Billing page and the terms say so.
- **The lawyer's check of the discount, no-refund and withdrawal wording** (0139; the terms'
  briefing, question 27), before T6 (e) and (f) merge.
- **The company's details from 0139,** for T8 (c).

**Who builds it (D8).** Session R, as group R8 in 0131 §6, from the drawings in
`docs/design/0152-0154/` and §5.

The site is one folder, and 0144 T3 (b) and T1 are changing it in 0131's group R5. Each task here
is built on top of R5's merged state, or waits for it. The pull request says which (0131 §6,
*Out of turn*).

## 5. The drawings, and how R builds from them (D8)

They are in [`docs/design/0152-0154/`](../design/0152-0154/README.md), drafted in this session.
They are references for layout, order and wording, not specifications to the pixel.

| Drawing | For | How to build it |
|---|---|---|
| `hero-move.svg` | T3 | It is inlined by `build.mjs`, never linked, so it needs no image request and nothing new in the CSP. A function returns it with its `<title>` and labels in the page's language. Its colours are the site's CSS custom properties (the palette `build.mjs` declares), so dark mode needs no second file. `role="img"` and an `aria-label` say what it shows in one sentence. On a phone it sits below the buttons. |
| `icons.svg` | T3, T4, T5 | Six data-type icons (mail, calendar, contacts, files, photos, tasks), each a `<symbol>` in one inline sprite, used with `<use href="#…">`. The stroke is `currentColor`. They are the same drawings 0153 builds as React components, so the site and the app draw the same six. |
| `tiles.svg` | T4, T5 | The neutral provider and destination tiles (D4): the initial on the site's teal, with the name written beside it. The same table of initials as 0153 §5. |
| `wf-site-home.svg` | T1–T5, T6 (c) | The home page's order: the alpha line; the hero with its drawing, and the six *Leaving…* names under its buttons (T5 (b)); three facts; the three steps; *Where to*; the sections that stay; and one price line with its buttons. *(2026-10-04: the alpha line drew the app's note as it read before 2026-09-29, with *"nothing is backed up"*. It is now a placeholder until the owner answers open question 5.)* *(2026-10-05: it draws the visitor's line, the question's answer.)* |
| `wf-pricing.svg` | T6 | The labelled switch opening on yearly; the five cards on yearly (per month, the year's total in bold under it, *half the monthly price*); the calculator's button; one card on monthly; the year's line (renewal until 2026-10-04); the questions and answers; and the principle. |

## Lessons that apply

- **`the-test-site-sent-people-to-production`.** Every link to the app comes from `APP_URL`.
  *Sign in* (T2) and the calculator's link (T7) are the two new ones.
- **`a-read-only-claim-with-its-scope`.** T3's facts do not say "read-only".
- **`a-sixth-state-added-to-only-one-list`.** T6 (b) keeps its two paragraphs together.
- **The pinned calculator hash.** Any change to `calculator.mjs` re-pins `$csp_calc` in
  `www-nginx.conf`, in the same pull request (T7).

## Not in this plan

- **The app's migrations, the new-move flow and its words** are 0153.
- **The progress view and the report of what arrived** are 0154.
- **A help center** is 0151, parked.
- **Analytics on the page.** The CSP forbids fetch, and no page carries a script, a cookie or a
  banner to count with. Visits are counted from the site's own log instead, as totals, by
  `deploy/compose/site-visits.sh` (Status, 2026-10-05; privacy §4.5).
- **Testimonials.** There are none to show during the alpha.
- **Third-party logos.** D4 decides against them.
- **The destination providers' prices, hosting or quality.** `docs/target-providers.md` keeps
  those, dated.

## Open questions

1. ~~**The split of D2.**~~ **Answered 2026-09-28 (D5):** no split. All of it comes before the
   alpha.
2. ~~**T4's list of destinations.**~~ **Answered 2026-09-28 (D7):** *"Name what the app
   supports"*. The site names what the app's own list names, through the guarded copy (T4 (b)).
   mosa.cloud and openDesk appear by name when that list names them, and as *a JMAP server* or
   *an IMAP/DAV provider* until then.
3. ~~**Colours of the initial tiles (D4).**~~ **Answered by D4's own wording,** *"our own neutral
   monogram tiles"*: neutral, in the site's palette (`tiles.svg`).
4. ~~**The Dutch site at the root.**~~ **Answered 2026-09-29: English at the root** (*"English at
   root"*). `/` keeps serving English and Dutch stays under `/nl/`, so no URL moves; T2 makes the
   language switch more visible on phones.
5. ~~**Which line does the site show during the Alpha: the welcome, or another line?**~~
   **Answered 2026-10-05:** *"Do suggestions for non alpha viewers"*. Asked on 2026-10-04 because
   the app's sentence had become the owner's welcome, which every visitor of the site would read,
   invited or not. The welcome stays the members'. A visitor who was not invited reads a fact, on
   every page of the site and in the app's guides: *"Ownpace is in its Alpha, by invitation.
   Nothing is charged during the Alpha."*, then *Request access* (T1 (a)). The owner left the
   search engines to the same suggestion: the app carries `noindex`.
