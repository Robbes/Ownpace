# Copyright 2026 The Ownpace authors (Apache-2.0)
#
# Register the appliance to start on boot, via Windows Task Scheduler
# (workplan 0015 T3 Phase 3; owner decision 2026-08-07, ADR-0027 update).
#
# WHY TASK SCHEDULER AND NOT A SERVICE. A Windows Service cannot run a plain
# node.exe -- it never answers the service control manager, so Windows reports it
# as failing to start even while it runs. Something has to wrap it, and every
# available wrapper is a third-party binary we would vendor into a customer's
# machine, sign, and patch: WinSW's v3 line has been in alpha since 2021 and its
# stable v2.12.0 is 19 months old with nothing since; nssm has been unmaintained
# since 2017.
#
# The one thing such a wrapper buys is translating SERVICE_CONTROL_STOP into
# something start.mjs can act on, because a service never receives a POSIX
# signal -- without which PGlite is killed mid-write. On 2026-08-07 that
# assumption was tested rather than trusted: `Stop-Process -Force`, the hardest
# kill Windows offers, and the appliance came back with `schema up to date`.
# PGlite is Postgres, and surviving abrupt termination is what Postgres does for
# a living. So the requirement that justified the dependency is not load-bearing,
# and the dependency goes.
#
# Task Scheduler is built in, vendors nothing, signs nothing extra, and delivers
# what ADR-0027 actually asks for: "starts on boot and keeps syncing whether or
# not anyone is logged in".
#
# RUN ON REAL WINDOWS: 2026-08-09 (install, boot survival, a 510-message
# migration) and 2026-08-13 (re-run over an in-place payload upgrade, which is
# now part of the documented upgrade rather than a recovery step). Still
# deliberately explicit rather than clever -- and there is no Windows in CI, so
# a change here can only be verified by somebody running it.

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    # The installed payload: the directory holding start.mjs and node.exe.
    [Parameter(Mandatory = $true)]
    [string] $PayloadPath,

    [string] $DataRoot = 'C:\ProgramData\OpenMigrate',

    [string] $TaskName = 'OpenMigrateAppliance',

    [int] $Port = 8080,

    # Loopback by default. The appliance holds live mail credentials for a
    # migration; putting it on a routable interface is a decision an operator
    # makes deliberately, not something an installer does for them.
    [string] $BindHost = '127.0.0.1',

    # LocalService is the least-privileged account that can still do this job:
    # the appliance only makes OUTBOUND connections and authenticates to mail
    # servers with its own configured credentials, so it needs no machine
    # identity on the network. SYSTEM would work and is over-privileged for
    # something that talks to the internet all day.
    [string] $RunAsUser = 'NT AUTHORITY\LocalService'
)

$ErrorActionPreference = 'Stop'

$node  = Join-Path $PayloadPath 'node.exe'
$start = Join-Path $PayloadPath 'start.mjs'
foreach ($required in @($node, $start)) {
    if (-not (Test-Path $required)) {
        throw "Not a complete payload: '$required' is missing. Build it with " +
              "'pnpm package:appliance --with-node win-x64' and copy the whole directory."
    }
}

$pgliteDir = Join-Path $DataRoot 'pglite'
$configDir = Join-Path $DataRoot 'config'
$logDir    = Join-Path $DataRoot 'logs'
New-Item -ItemType Directory -Force -Path $pgliteDir, $configDir, $logDir | Out-Null

# The data directory must be writable by the account the task runs as, and it
# lives OUTSIDE the payload on purpose: an upgrade or uninstall replaces
# Program Files, and the migration ledger must not go with it (hard rule 2).
$acl = Get-Acl $DataRoot
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $RunAsUser, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -Path $DataRoot -AclObject $acl
Write-Host "granted Modify on $DataRoot to $RunAsUser"

# A launcher, written beside the payload rather than crammed into the task's
# argument string. Task Scheduler actions carry no environment, and building a
# `cmd /c set X=... && ...` one-liner with paths that contain spaces is a
# quoting problem nobody should have to debug through the Task Scheduler UI.
# A file you can open and read is worth the extra artefact.
# CREDENTIALS, and why they are not in the launcher.
#
# A mapping names its secrets by ENVIRONMENT VARIABLE (`passwordFromEnv`,
# `tokenFromEnv`) and never inline, so the appliance needs those variables set.
# Task Scheduler actions carry no environment, which is what the launcher below
# exists to fix -- so the obvious move is to write the passwords into it.
#
# Do not. `C:\Program Files` is readable by every local user, so a mapping's
# mail passwords would be world-readable on that machine. That is a bad trade in
# a product whose entire job is holding somebody's mail credentials.
#
# Instead the launcher reads a file in the DATA directory, which install-task
# has already ACL'd to the service account. `secrets.cmd` is created empty, with
# an explicit ACL of its own, and the operator fills it in.
$secretsFile = Join-Path $configDir 'secrets.cmd'
if (-not (Test-Path $secretsFile)) {
    @"
@echo off
REM Credentials for the mappings in this directory, one 'set' per line:
REM
REM   set TARGET_JMAP_PASSWORD=...
REM   set SOURCE_IMAP_PASSWORD=...
REM
REM A mapping references these BY NAME (passwordFromEnv / tokenFromEnv) and
REM never holds a secret itself. This file is read by service-launch.cmd at
REM start-up. It lives here, not beside the payload, because Program Files is
REM readable by every local user and this is not.
"@ | Set-Content -Path $secretsFile -Encoding ascii
    Write-Host "created $secretsFile (empty - put credentials there, not in the payload)"
}

# Administrators + SYSTEM + the run-as account, and nobody else.
#
# ADMINISTRATORS GET MODIFY, NOT READ. This file exists to be FILLED IN by an
# operator: the message printed above says "put credentials there", the runbook
# says the same, and until 2026-08-09 the very next thing anyone did was
#
#   Set-Content : Toegang tot het pad ...\secrets.cmd is geweigerd.
#
# from an ELEVATED shell, because /inheritance:r had dropped the inherited
# write and the explicit grant was ':R'. An instruction the tool's own ACL
# forbids is not a permission model, it is a bug that reads like one.
#
# Modify for Administrators costs nothing: a local administrator can take
# ownership of any file and re-grant whatever they like, so read-only here
# bought no protection at all -- it only made the documented workflow fail. The
# thing this ACL actually defends against is every OTHER local user, and they
# are still excluded. SYSTEM and the service account get R: they only ever
# `call` this file, and neither of them should be editing credentials.
#
# BY SID, NOT BY NAME. Account names are LOCALISED; SIDs are not. The first
# version of this passed 'BUILTIN\Administrators' and died on a Dutch Windows
# with icacls 1332 (ERROR_NONE_MAPPED) -- "geen toewijzing tussen accountnamen en
# beveiligings-id's". S-1-5-32-544 is the Administrators group on every Windows
# ever shipped, in every language.
#
# `icacls` rather than the .NET ACL object model on purpose: this script cannot
# be syntax-checked or run anywhere but Windows, so the fewer moving parts the
# better. /inheritance:r drops ProgramData's permissive defaults, which would
# otherwise come straight back and undo the point of the file.
$ADMINISTRATORS_SID = 'S-1-5-32-544'
$LOCAL_SYSTEM_SID   = 'S-1-5-18'

# The run-as account is a PARAMETER, so it has to be resolved rather than
# assumed. Translate() handles the well-known names ('NT AUTHORITY\LocalService')
# and any real account, and reports which name failed if it cannot.
try {
    $runAsSid = (New-Object System.Security.Principal.NTAccount($RunAsUser)).Translate(
        [System.Security.Principal.SecurityIdentifier]).Value
} catch {
    throw "Cannot resolve '$RunAsUser' to a SID: $($_.Exception.Message). " +
          'Pass -RunAsUser with an account that exists on this machine.'
}

& icacls $secretsFile /inheritance:r /grant:r `
    "*${ADMINISTRATORS_SID}:M" "*${LOCAL_SYSTEM_SID}:R" "*${runAsSid}:R" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict permissions on $secretsFile (icacls exit $LASTEXITCODE). " +
          'Refusing to continue: that file is about to hold mail passwords, and a ' +
          'failure here would leave them readable by every local user.'
}
Write-Host "restricted $secretsFile to Administrators (modify), SYSTEM and $RunAsUser (read)"

# GENERATED INTO THE PAYLOAD DIRECTORY, which makes it the one installed file
# that exists in no payload -- and therefore the one a mirror-style upgrade
# deletes. On 2026-08-13 a `robocopy /MIR` of a new payload over a running
# install removed it and left the task's Execute target pointing at nothing;
# the appliance could not start until this script was re-run. The upgrade in
# docs/windows-appliance-runbook.md now passes `/XF service-launch.cmd` AND
# re-runs this script, because the paths written below are absolute: a launcher
# preserved across an upgrade is only correct while the payload directory it
# names is.
#
# It is not moved out to $DataRoot instead, which would survive the mirror,
# because uninstall-task.ps1 deliberately does NOT delete $DataRoot -- that is
# the migration ledger. A launcher there would outlive its own uninstall.
$launcher = Join-Path $PayloadPath 'service-launch.cmd'
@"
@echo off
REM Generated by install-task.ps1 -- safe to delete with the task.
REM The appliance's writable state lives outside this directory on purpose.
set SELFHOST_PERSISTENCE=pglite
set SELFHOST_PGLITE_DIR=$pgliteDir
set CONFIG_DIR=$configDir
set HOST=$BindHost
set PORT=$Port
REM Credentials, from the data directory rather than from here: this file sits
REM in Program Files, which every local user can read.
if exist "$secretsFile" call "$secretsFile"
"$node" "$start" >> "$logDir\appliance.log" 2>&1
"@ | Set-Content -Path $launcher -Encoding ascii
Write-Host "wrote $launcher"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "replacing the existing '$TaskName' task"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action  = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $PayloadPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
# ExecutionTimeLimit of zero means NO limit. The default is three days, after
# which Task Scheduler would stop a perfectly healthy appliance -- the single
# most likely way for this to go wrong quietly, so it is set explicitly.

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Ownpace appliance. Serves the operating UI on http://${BindHost}:${Port}/ui and runs scheduled syncs. Starts on boot." | Out-Null

# A Start Menu entry for the operating UI (workplan 0015 T3 -- the last piece
# of the install story that still required typing a URL). A .url file, not a
# .lnk: the UI is a web page served by the appliance itself (ADR-0026, one
# operating UI), a .url is plain text this script can write without COM, and
# double-clicking it opens the default browser exactly like the shortcut a
# real installer would create. All-users Start Menu, because the task runs as
# a service account and the person operating it is whoever logs in.
$startMenuDir = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'
$shortcut = Join-Path $startMenuDir 'Ownpace.url'

# The product was renamed (ADR-0040). An install over a pre-rename machine must
# REMOVE the old entry, not leave it: both .url files point at the same UI, so
# keeping both means two identical Start Menu items and a stale brand. Removing
# it here -- not only in the uninstaller -- is what makes an in-place upgrade
# clean, since most machines upgrade and never uninstall.
$legacyShortcut = Join-Path $startMenuDir 'Open Migration Stack.url'
if (Test-Path $legacyShortcut) {
    Remove-Item $legacyShortcut
    Write-Host "removed pre-rename Start Menu shortcut '$legacyShortcut'"
}
@"
[InternetShortcut]
URL=http://${BindHost}:${Port}/ui
"@ | Set-Content -Path $shortcut -Encoding ascii
Write-Host "wrote Start Menu shortcut '$shortcut'"

Start-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host "registered and started '$TaskName'"
Write-Host "  UI   : http://${BindHost}:${Port}/ui"
Write-Host "  logs : $logDir\appliance.log"
Write-Host "  state: $DataRoot  (NOT removed by uninstall-task.ps1)"
Write-Host ''
Write-Host "Check it with:  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
