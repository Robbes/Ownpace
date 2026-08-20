# Copyright 2026 The Ownpace authors (Apache-2.0)
#
# Collect everything needed to diagnose a Windows appliance run, into one file
# (workplan 0015 T3; docs/windows-appliance-runbook.md, "What to send back").
#
# The point is to make one paste enough. Without this, diagnosing a Windows-only
# failure from a Linux machine costs several rounds of "and what did X say?",
# each one a day apart.
#
# It reads only. It starts nothing, changes nothing, and deletes nothing.
#
# UNTESTED ON WINDOWS -- written on Linux with no Windows available.

[CmdletBinding()]
param(
    # The payload directory, if you have one. Optional: the script still reports
    # the environment without it.
    [string] $PayloadPath,

    [string] $DataRoot = 'C:\ProgramData\OpenMigrate',

    # Where the appliance serves its operating surface. Only ever GET.
    [int] $Port = 8080,

    [string] $OutFile = 'windows-evidence.txt'
)

$ErrorActionPreference = 'Continue'
$out = [System.Collections.Generic.List[string]]::new()

function Section([string] $name) {
    $out.Add('')
    $out.Add("=== $name " + ('=' * [Math]::Max(0, 60 - $name.Length)))
}

function Try-Run([string] $label, [scriptblock] $block) {
    try {
        $result = & $block 2>&1 | Out-String
        $out.Add("${label}: " + $result.Trim())
    } catch {
        # Report the failure rather than omitting the line -- an absent tool is
        # itself a finding, and a silent gap reads as "fine".
        $out.Add("${label}: FAILED - $($_.Exception.Message)")
    }
}

Section 'environment'
$out.Add("collected      : $(Get-Date -Format o)")
$out.Add("os             : $((Get-CimInstance Win32_OperatingSystem).Caption)")
$out.Add("os version     : $([System.Environment]::OSVersion.VersionString)")
$out.Add("powershell     : $($PSVersionTable.PSVersion)")
$out.Add("architecture   : $env:PROCESSOR_ARCHITECTURE")
$out.Add("elevated       : $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))")
Try-Run 'node          ' { node --version }
Try-Run 'pnpm          ' { pnpm --version }
Try-Run 'git           ' { git --version }

Section 'long paths enabled'
# A disabled long-path policy shows up as a confusing ENOENT deep inside
# node_modules, so it is worth stating outright rather than inferring later.
Try-Run 'LongPathsEnabled' {
    (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled
}

if ($PayloadPath -and (Test-Path $PayloadPath)) {
    Section 'payload'
    $out.Add("path           : $PayloadPath")
    $bytes = (Get-ChildItem -Recurse -File $PayloadPath | Measure-Object -Property Length -Sum).Sum
    $out.Add("size           : $([Math]::Round($bytes / 1MB, 1)) MB")
    $out.Add('top level      :')
    Get-ChildItem $PayloadPath | ForEach-Object { $out.Add("  $($_.Name)") }
    $pglite = Join-Path $PayloadPath 'node_modules\@electric-sql\pglite'
    # WHICH BUILD this payload is. Two copies on one machine look identical,
    # and the answer to "did you test the fix or the copy you made before it"
    # should not require re-reading a terminal scrollback.
    $startMjs = Join-Path $PayloadPath 'start.mjs'
    if (Test-Path $startMjs) {
        $stamp = Select-String -Path $startMjs -Pattern 'const BUILD = (.+);' |
            ForEach-Object { $_.Matches[0].Groups[1].Value }
        $out.Add("build          : $(if ($stamp) { $stamp } else { 'not stamped - payload predates 2026-08-07' })")
    }
    $bundledNode = Join-Path $PayloadPath 'node.exe'
    $out.Add("bundled node   : $(Test-Path $bundledNode)")
    if (Test-Path $bundledNode) {
        # The version of the runtime we SHIP, which is the one that matters --
        # a system Node on PATH says nothing about what a customer would run.
        Try-Run 'bundled node ver' { & $bundledNode --version }
    }
    $out.Add("pglite present : $(Test-Path $pglite)")
    if (Test-Path $pglite) {
        # The two assets PGlite resolves via import.meta.url. If Phase 1 failed
        # at startup, whether these exist is the first thing to know.
        Get-ChildItem -Recurse -File $pglite -Include '*.wasm', '*.data' |
            ForEach-Object { $out.Add("  $($_.FullName.Substring($pglite.Length)) - $([Math]::Round($_.Length / 1MB, 1)) MB") }
    }
} else {
    Section 'payload'
    $out.Add('not supplied or not found - pass -PayloadPath to include it')
}

Section 'data directory'
$out.Add("root           : $DataRoot")
$out.Add("exists         : $(Test-Path $DataRoot)")
if (Test-Path $DataRoot) {
    Get-ChildItem -Recurse -Depth 2 $DataRoot |
        ForEach-Object { $out.Add("  $($_.FullName.Substring($DataRoot.Length))") }
}

Section 'scheduled task'
# A TASK, not a Service. This asked `Get-Service` until 2026-08-09 and reported
# "FAILED - Cannot find any service with service name 'OpenMigrateAppliance'"
# on a machine where everything was working: there is no service BY DESIGN
# (owner decision 2026-08-07, ADR-0027's second update). Evidence that reports a
# failure for something deliberately absent is worse than no evidence - it sends
# whoever reads it looking for a fault that is not there.
Try-Run 'OpenMigrateAppliance' {
    Get-ScheduledTask -TaskName 'OpenMigrateAppliance' -ErrorAction Stop |
        Get-ScheduledTaskInfo |
        Format-List TaskName, LastRunTime, LastTaskResult, NumberOfMissedRuns | Out-String
}
# 267009 is 0x41301, SCHED_S_TASK_RUNNING - "running now", not an error code.
$out.Add('note           : LastTaskResult 267009 = 0x41301 SCHED_S_TASK_RUNNING (running, not failed)')
$out.Add('note           : there is NO Windows Service by design - see ADR-0027')

Section 'listening ports'
Try-Run 'ports 8080/8081' {
    Get-NetTCPConnection -State Listen -LocalPort 8080, 8081 -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table | Out-String
}

# The three artefacts every diagnosis round on 2026-08-09 had to ask for in a
# SEPARATE round trip, each one a day apart when the machine is not yours:
# what the appliance said, what it reports about itself, and who can read the
# credentials file. All reads. The point of this file is one paste.

Section 'appliance log (last 60 lines)'
# -Encoding UTF8 is load-bearing, not style. The appliance writes UTF-8;
# PowerShell 5.1's Get-Content default reads a BOM-less file as the ANSI code
# page, which turned "applying migrations..." into mojibake in every paste
# until someone asked for the flag. The evidence must not need that knowledge.
Try-Run 'log tail' {
    $logFile = Join-Path $DataRoot 'logs\appliance.log'
    if (Test-Path $logFile) {
        Get-Content -Path $logFile -Tail 60 -Encoding UTF8 | Out-String
    } else {
        "no log file at $logFile"
    }
}

Section 'status endpoint'
# GET only -- this script starts nothing and changes nothing, and /status is
# the one endpoint that is a pure read. A refused connection here IS evidence:
# it means nothing is listening, which is a different diagnosis from a task
# that reports itself running.
Try-Run "GET /status on $Port" {
    (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/status" -UseBasicParsing -TimeoutSec 10).Content
}

Section 'secrets.cmd ACL'
# The ACL and ONLY the ACL. The file holds mail passwords; its contents must
# never enter an evidence file that gets pasted into chats and issues. What
# the ACL answers: the 2026-08-09 failure where the operator told to fill the
# file in could not write it (Administrators had :R), and the standing check
# that no ordinary user group has crept onto a credentials file.
Try-Run 'icacls' {
    $secretsFile = Join-Path $DataRoot 'config\secrets.cmd'
    if (Test-Path $secretsFile) {
        & icacls $secretsFile | Out-String
    } else {
        "no secrets file at $secretsFile"
    }
}

Section 'next'
$out.Add('Paste this file back. If a phase failed, include the console output of')
$out.Add('the failing command too - this script cannot capture what it did not run.')

$out | Set-Content -Path $OutFile -Encoding utf8
Write-Host "Wrote $OutFile ($($out.Count) lines). Send that file."
