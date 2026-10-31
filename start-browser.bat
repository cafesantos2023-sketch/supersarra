@echo off
title Sarra VRM - Navigateur
rem Mode historique : serveur PowerShell + navigateur par defaut, sans overlay.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open.ps1"
