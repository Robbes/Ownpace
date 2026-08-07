# Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
# UNTESTED ON WINDOWS — written on Linux with no Windows available.

[CmdletBinding()]
param(
    # The payload directory, if you have one. Optional: the script still reports
    # the environment without it.
    [string] $PayloadPath,

    [string] $DataRoot = 'C:\ProgramData\OpenMigrate',

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
        # Report the failure rather than omitting the line — an absent tool is
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

Section 'service'
Try-Run 'OpenMigrateAppliance' {
    Get-Service -Name 'OpenMigrateAppliance' -ErrorAction Stop | Format-List Name, Status, StartType | Out-String
}

Section 'listening ports'
Try-Run 'ports 8080/8081' {
    Get-NetTCPConnection -State Listen -LocalPort 8080, 8081 -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table | Out-String
}

Section 'next'
$out.Add('Paste this file back. If a phase failed, include the console output of')
$out.Add('the failing command too - this script cannot capture what it did not run.')

$out | Set-Content -Path $OutFile -Encoding utf8
Write-Host "Wrote $OutFile ($($out.Count) lines). Send that file."
