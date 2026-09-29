#!/bin/bash
# Copyright 2026 The Ownpace authors (Apache-2.0)
#
# nextcloud-no-phone-home.sh — Nextcloud asks nobody anything (workplan 0139,
# 2026-09-29; the owner, for ops-telemetry: "Switch it off everywhere").
#
# WHAT IT SENT. Nextcloud 34 ships three settings on (config/config.sample.php
# at stable34):
#
#   updatechecker            its version, PHP version, install and update time
#                            and release channel to updates.nextcloud.com
#   appstoreenabled          the app store at apps.nextcloud.com
#   has_internet_connection  the announcements feed at pushfeed.nextcloud.com
#                            (nextcloud_announcements, lib/Cron/Crawler.php)
#                            and a connectivity check to four public sites
#                            (apps/settings/lib/SetupChecks/InternetConnectivity.php)
#
# This Nextcloud is the demo's DAV target, brought up with the OTA stack every
# night, and the development one: it holds fixtures, never a tester's data, and
# needs none of the three.
#
# HOW IT RUNS. Mounted into /docker-entrypoint-hooks.d/before-starting/ by
# managed.yml and dev.yml. The image's entrypoint runs every executable *.sh
# there as www-data, after its install or upgrade and before Apache serves a
# request, at every start. So the values are in config.php before the first
# background job that would read them, on a new volume and an old one alike.
#
# WHY NOT A *.config.php MOUNTED INTO config/. Nextcloud does read every
# config/*.config.php, but a file mounted there makes that directory non-empty
# before the first install, and the entrypoint then skips copying the image's
# own config files into it (its `directory_empty` check), smtp.config.php among
# them, which is what points the demo's Nextcloud at the mail catcher (0103).
#
# BOOLEANS, NOT STRINGS. `--value=false` alone stores the string "false", which
# PHP casts to true (getSystemValueBool), and the connectivity check compares
# with `=== false`.
#
# `set -e`: the image stops the container when a hook exits non-zero, so an occ
# that fails is a Nextcloud that does not start, never one that starts with a
# switch unset. `scripts/a-service-that-phones-home.unit.test.ts` reads this
# file and runs it against a stand-in php.
set -euo pipefail

occ() { php /var/www/html/occ "$@"; }

occ config:system:set updatechecker --type=boolean --value=false
occ config:system:set appstoreenabled --type=boolean --value=false
occ config:system:set has_internet_connection --type=boolean --value=false
