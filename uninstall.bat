@echo off
copy /y "%~dp0uninstall.ps1" "%TEMP%\roundtable-uninstall.ps1" >nul
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\roundtable-uninstall.ps1"
pause
