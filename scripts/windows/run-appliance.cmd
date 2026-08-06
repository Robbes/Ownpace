@echo off
REM Copyright 2026 The Open Migration Stack authors (Apache-2.0)
REM
REM Run run-appliance.ps1 without fighting the execution policy.
REM See collect-evidence.cmd for why this wrapper exists at all: stock Windows
REM refuses unsigned .ps1 files, and that is the default on every machine this
REM product will be installed on rather than a local misconfiguration.
REM
REM `-ExecutionPolicy Bypass` applies to this one process and leaves the
REM machine's stored policy untouched.
REM
REM Example:
REM   run-appliance.cmd -PayloadPath "C:\Program Files\OpenMigrateTest"
REM
REM UNTESTED ON WINDOWS — written on Linux.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-appliance.ps1" %*
