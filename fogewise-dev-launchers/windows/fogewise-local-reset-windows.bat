@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fogewise-local-reset-windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [Fogewise] Reset exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
