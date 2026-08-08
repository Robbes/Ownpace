@echo off
REM Copyright 2026 The Open Migration Stack authors (Apache-2.0)
REM
REM Run install-task.ps1 without fighting the execution policy, and from an
REM elevated prompt (both scripts declare #Requires -RunAsAdministrator).
REM See collect-evidence.cmd for why these wrappers exist: stock Windows
REM refuses unsigned .ps1 files, and that is the default on every machine this
REM product will be installed on rather than a local misconfiguration.
REM
REM UNTESTED ON WINDOWS -- written on Linux.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-task.ps1" %*
