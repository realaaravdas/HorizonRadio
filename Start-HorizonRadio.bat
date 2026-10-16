@echo off
title Horizon Pulse Radio - Studio Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-HorizonRadio.ps1" %*
