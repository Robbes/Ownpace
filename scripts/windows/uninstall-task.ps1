# Copyright 2026 The Open Migration Stack authors (Apache-2.0)
#
# Remove the scheduled task, and DELIBERATELY NOT the data
# (workplan 0015 T3 Phase 3).
#
# The counterpart to install-task.ps1. It exists in the same commit as the
# installer on purpose: a thing that installs itself and cannot be removed is
# not finished, and "we will write the uninstaller later" is how a machine ends
# up with a task nobody can name pointing at a directory nobody remembers.
#
# WHAT IT WILL NOT DO. `C:\ProgramData\OpenMigrate` holds the migration ledger --
# the record of every item copied, which is what makes a re-run idempotent
# rather than duplicating a customer's mailbox. Removing the software must never
# remove that (hard rule 2: non-destructive by default). `-IncludeData` exists
# for someone who genuinely means it, and it asks first.
#
# UNTESTED ON WINDOWS -- written on Linux.

#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $TaskName = 'OpenMigrateAppliance',

    [string] $DataRoot = 'C:\ProgramData\OpenMigrate',

    # The installed payload, so the generated launcher can be cleaned up too.
    [string] $PayloadPath,

    # Delete the ledger as well. Off by default, and prompts even when set.
    [switch] $IncludeData
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $TaskName
        Write-Host "stopped '$TaskName'"
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "removed the '$TaskName' task"
} else {
    # Say so rather than succeeding silently: "nothing happened" and "it was
    # already gone" look identical from the outside, and only one of them means
    # you were looking at the right machine.
    Write-Host "no task named '$TaskName' -- nothing to remove"
}

if ($PayloadPath) {
    $launcher = Join-Path $PayloadPath 'service-launch.cmd'
    if (Test-Path $launcher) {
        Remove-Item $launcher
        Write-Host "removed $launcher"
    }
}

# The Start Menu shortcut install-task.ps1 wrote. Removed unconditionally --
# it points at a UI that is no longer served, and a shortcut to nothing is the
# classic uninstall leftover.
$shortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Open Migration Stack.url'
if (Test-Path $shortcut) {
    Remove-Item $shortcut
    Write-Host "removed Start Menu shortcut '$shortcut'"
}

if ($IncludeData) {
    Write-Warning "$DataRoot holds the migration ledger: the record of what has already been"
    Write-Warning "copied. Without it, a re-run cannot tell a copied item from a new one and"
    Write-Warning "will duplicate mail on the target."
    if ($PSCmdlet.ShouldProcess($DataRoot, 'DELETE the migration ledger')) {
        Remove-Item -Recurse -Force $DataRoot
        Write-Host "deleted $DataRoot"
    }
} else {
    Write-Host ''
    Write-Host "LEFT IN PLACE: $DataRoot"
    Write-Host "  That is the migration ledger, not scratch space. Pass -IncludeData if you"
    Write-Host "  really want it gone."
}
