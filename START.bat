@echo off
REM Simple batch script to run the NASA Hackathon app
REM Just double-click this file to start everything!

echo.
echo ========================================
echo  NASA Hackathon - Starting Servers
echo ========================================
echo.

REM Get the directory where this script is located
cd /d "%~dp0"

REM Check if Python is installed
python3 --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python 3 is not installed or not in PATH
    echo Please install Python 3 from python.org
    pause
    exit /b 1
)

echo [1/3] Checking Python virtual environment...
if not exist "backend\.venv" (
    echo Creating virtual environment...
    python3 -m venv backend\.venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment
        pause
        exit /b 1
    )
)

echo [2/3] Installing backend dependencies...
call backend\.venv\Scripts\pip install -q -r backend\requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo [3/3] Starting servers...
echo.
echo ========================================
echo  Servers Starting
echo ========================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Once you see "Application startup complete" below,
echo open http://localhost:5173 in your web browser
echo.
echo Press Ctrl+C to stop all servers
echo ========================================
echo.

REM Start both servers - use a workaround for parallel execution on Windows
start "Backend Server" cmd /c "cd /d "%~dp0" && backend\.venv\Scripts\uvicorn app:app --app-dir backend --reload --port 8000"
timeout /t 2 /nobreak >nul
start "Frontend Server" cmd /c "cd /d "%~dp0" && python3 -m http.server 5173 --directory frontend"

echo.
echo Both servers are starting in separate windows...
echo Close those windows to stop the servers.
pause
