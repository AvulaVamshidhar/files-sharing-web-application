@echo off
echo ========================================
echo    FileShare App - Starting...
echo ========================================
echo.

cd /d "%~dp0"

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

:: Start the server
echo Starting FileShare server...
echo.
node server.js
pause
