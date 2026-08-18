@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fogewise-dev-windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [Fogewise] Launcher exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
