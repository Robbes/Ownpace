@echo off
REM Copyright 2026 The Open Migration Stack authors (Apache-2.0)
REM
REM Run collect-evidence.ps1 without fighting the execution policy.
REM
REM Stock Windows ships PowerShell's policy as `Restricted`, so an unsigned
REM .ps1 refuses to run at all: "running scripts is disabled on this system".
REM That is not a misconfiguration to complain about — it is the default on
REM every machine this product will ever be installed on, and it was hit on the
REM first real run of the runbook (2026-08-06).
REM
REM `-ExecutionPolicy Bypass` on a single invocation changes nothing on the
REM machine: it does not touch the stored policy, and it applies only to this
REM process. That is deliberately the narrowest thing that works. Telling an
REM owner to run `Set-ExecutionPolicy RemoteSigned` would weaken their machine
REM permanently to read a diagnostic file, which is a bad trade.
REM
REM `%~dp0` is this file's own directory, so the .ps1 is found wherever the
REM pair is copied to. `%*` passes arguments through: -PayloadPath, -DataRoot,
REM -OutFile all still work.
REM
REM UNTESTED ON WINDOWS — written on Linux, like everything else in here.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-evidence.ps1" %*
