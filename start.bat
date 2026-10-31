@echo off
setlocal EnableExtensions
title Sarra VRM - Overlay
cd /d "%~dp0"

set "ELECTRON_RUN_AS_NODE="
set "HERE=%~dp0"
set "APP_DIR=%HERE%desktop"
set "ELECTRON=%APP_DIR%\vendor\electron\electron.exe"
set "LOG=%APP_DIR%\start.log"
set "TRIES=0"

if not exist "%ELECTRON%" goto no_electron
goto check_running

:check_running
rem 1) Is a Sarra electron process alive?
powershell -NoProfile -Command "$exe=[IO.Path]::GetFullPath($env:ELECTRON); $app=[IO.Path]::GetFullPath($env:APP_DIR); $found=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $exe -and $_.CommandLine -and $_.CommandLine.IndexOf($app,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1; if ($found) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 goto start_setup

rem 2) Process found: is the HTTP server actually responding?
rem    (distingue une instance vivante d'un processus fantome/bloque)
powershell -NoProfile -Command "$listeners=Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 8642 -and $_.LocalPort -le 8660 }; foreach ($listener in $listeners) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:'+$listener.LocalPort+'/') -TimeoutSec 1; if ($response.StatusCode -eq 200 -and $response.Content -match '<title>Sarra') { exit 0 } } catch {} }; exit 1" >nul 2>&1
if not errorlevel 1 goto app_already_running

rem 3) Stale process (no server): kill it automatically and retry.
>>"%LOG%" echo [%DATE% %TIME%] Stale Sarra process detected (no HTTP server); killing it.
powershell -NoProfile -Command "$exe=[IO.Path]::GetFullPath($env:ELECTRON); $app=[IO.Path]::GetFullPath($env:APP_DIR); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $exe -and $_.CommandLine -and $_.CommandLine.IndexOf($app,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
ping -n 3 127.0.0.1 >nul
goto check_running

:start_setup

:start_electron
>>"%LOG%" echo [%DATE% %TIME%] Starting Electron: "%ELECTRON%"
ver >nul
start "" "%ELECTRON%" "%APP_DIR%" --no-sandbox %*
>>"%LOG%" echo [%DATE% %TIME%] Electron launch requested

:wait_for_server
powershell -NoProfile -Command "$listeners=Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 8642 -and $_.LocalPort -le 8660 }; foreach ($listener in $listeners) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:'+$listener.LocalPort+'/') -TimeoutSec 1; if ($response.StatusCode -eq 200 -and $response.Content -match '<title>Sarra') { exit 0 } } catch {} }; exit 1" >nul 2>&1
if not errorlevel 1 goto app_ready
set /a TRIES+=1
if %TRIES% GEQ 20 goto server_timeout
ping -n 2 127.0.0.1 >nul
goto wait_for_server

:app_ready
>>"%LOG%" echo [%DATE% %TIME%] Sarra HTTP server is ready
exit /b 0
:app_already_running
echo.
echo Sarra est deja ouverte.
echo   - Fermez-la depuis l'icone de notification (clic droit -^> Quitter Sarra)
echo     pour charger les dernieres modifications.
echo   - Si l'icone n'est pas visible, forcez la fermeture ci-dessous.
echo.
echo Choisissez une option :
echo   [R] Reessayer (apres fermeture manuelle)
echo   [K] Forcer la fermeture et redemarrer
echo   [C] Annuler
choice /C RKC /N /M "Votre choix (R/K/C) : "
if errorlevel 3 goto cancelled
if errorlevel 2 goto force_kill
goto check_running

:force_kill
>>"%LOG%" echo [%DATE% %TIME%] Force kill requested by user.
powershell -NoProfile -Command "$exe=[IO.Path]::GetFullPath($env:ELECTRON); $app=[IO.Path]::GetFullPath($env:APP_DIR); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $exe -and $_.CommandLine -and $_.CommandLine.IndexOf($app,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
ping -n 3 127.0.0.1 >nul
goto check_running

:cancelled
echo Annule.
exit /b 1

:no_electron
>>"%LOG%" echo [%DATE% %TIME%] ERROR: Electron not found at "%ELECTRON%"
echo Electron is missing. Starting Sarra in the browser instead.
goto browser_fallback

:electron_launch_failed
>>"%LOG%" echo [%DATE% %TIME%] ERROR: Electron could not be launched
echo Electron could not be launched. See "%LOG%" for details.
goto browser_fallback

:server_timeout
>>"%LOG%" echo [%DATE% %TIME%] ERROR: Electron did not expose the Sarra server on ports 8642-8660
echo Sarra did not finish starting in Electron. Online voice tests and the floating avatar require Electron.
echo See "%LOG%" and "%APP_DIR%\boot.log" for details, then close any blank Sarra Electron window and restart.
exit /b 1

:browser_fallback
if not exist "%HERE%start-browser.bat" goto launch_failed
call "%HERE%start-browser.bat"
exit /b %errorlevel%

:launch_failed
>>"%LOG%" echo [%DATE% %TIME%] ERROR: Browser fallback start-browser.bat not found
echo Sarra could not be started. See "%LOG%" for details.
pause
exit /b 1

