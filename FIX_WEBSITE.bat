@echo off
REM Fix for blank website issue
REM This script clears browser cache and restarts servers

echo.
echo ========================================
echo  NASA Hackathon - Website Fix
echo ========================================
echo.

REM Stop any running servers
echo [1/4] Stopping any running servers...
taskkill /IM python.exe /F >nul 2>&1
taskkill /IM python3.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Clearing browser cache...
REM Clear browser cache for common browsers
if exist "%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cache" (
  rmdir /s /q "%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cache" >nul 2>&1
  echo  - Chrome cache cleared
)

if exist "%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache" (
  rmdir /s /q "%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache" >nul 2>&1
  echo  - Edge cache cleared
)

if exist "%APPDATA%\Mozilla\Firefox\Profiles" (
  for /d %%A in ("%APPDATA%\Mozilla\Firefox\Profiles\*") do (
    rmdir /s /q "%%A\cache2" >nul 2>&1
  )
  echo  - Firefox cache cleared
)

echo [3/4] Starting servers...
cd /d "%~dp0"

REM Start backend
start "Backend Server" cmd /c "cd /d "%~dp0" && backend\.venv\Scripts\uvicorn app:app --app-dir backend --reload --port 8000"
timeout /t 2 /nobreak >nul

REM Start frontend
start "Frontend Server" cmd /c "cd /d "%~dp0" && python3 -m http.server 5173 --directory frontend"

echo [4/4] Opening browser...
timeout /t 3 /nobreak >nul

REM Try to open browser
start http://localhost:5173

echo.
echo ========================================
echo  Fix Complete!
echo ========================================
echo.
echo If the page still shows blank:
echo 1. Press Ctrl+Shift+Delete in browser to clear cache
echo 2. Press Ctrl+R to refresh
echo 3. Check browser console (F12) for errors
echo.
echo Diagnostic page available at:
echo http://localhost:5173/test.html
echo.
pause
