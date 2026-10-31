@echo off
setlocal
call "%~dp0..\start.bat" %*
exit /b %errorlevel%
