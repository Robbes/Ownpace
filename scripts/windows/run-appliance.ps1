# Copyright 2026 The Open Migration Stack authors (Apache-2.0)
#
# Start the packaged appliance the way an INSTALLED copy has to run it
# (workplan 0015 T3, Phase 2 of docs/windows-appliance-runbook.md).
#
# The difference from `node start.mjs` is one thing and it is the point: the
# writable state goes to %ProgramData%, not next to the payload. `start.mjs`
# defaults both to `<payload>/data/...`, which is fine from `dist\appliance`
# and WRONG once an installer has put the payload in `C:\Program Files\`,
# where a service account cannot write. This script is what the service will
# do, so that the thing you test is the thing that ships.
#
# UNTESTED ON WINDOWS — written by reading the code, on Linux, with no Windows
# available to run it. Read it before you run it; it is short on purpose.

[CmdletBinding()]
param(
    # The payload directory: the one containing start.mjs and appliance.mjs.
    [Parameter(Mandatory = $true)]
    [string] $PayloadPath,

    # Where the database and config live. Anything the running account can write.
    [string] $DataRoot = 'C:\ProgramData\OpenMigrate',

    [int] $Port = 8080,

    [string] $BindHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'

$start = Join-Path $PayloadPath 'start.mjs'
if (-not (Test-Path $start)) {
    throw "No start.mjs in '$PayloadPath'. Point -PayloadPath at the directory " +
          "`pnpm package:appliance` produced (dist\appliance), or at the installed copy."
}

# Fail early and in words if Node is too old, rather than letting the bundle
# die on syntax it cannot parse.
$nodeVersion = (& node --version) -replace '^v', ''
$major = [int]($nodeVersion -split '\.')[0]
if ($major -lt 22) {
    throw "Node $nodeVersion found; the appliance bundle targets node22 and start.mjs " +
          "uses top-level await. Install Node 22 or newer."
}

$pgliteDir = Join-Path $DataRoot 'pglite'
$configDir = Join-Path $DataRoot 'config'
New-Item -ItemType Directory -Force -Path $pgliteDir, $configDir | Out-Null

Write-Host "payload    : $PayloadPath"
Write-Host "node       : v$nodeVersion"
Write-Host "pglite dir : $pgliteDir"
Write-Host "config dir : $configDir"
Write-Host "listening  : http://${BindHost}:${Port}/ui"
Write-Host ''

$env:SELFHOST_PERSISTENCE = 'pglite'
$env:SELFHOST_PGLITE_DIR  = $pgliteDir
$env:CONFIG_DIR           = $configDir
$env:HOST                 = $BindHost
$env:PORT                 = "$Port"

# Run in the foreground. Ctrl+C sends the interrupt start.mjs handles, which is
# what closes PGlite cleanly — the database is the thing being written, so an
# abrupt kill is the one failure mode worth avoiding while testing.
& node $start
