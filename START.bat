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
if exist "backend\.venv\pyvenv.cfg" if exist "backend\.venv\Scripts\python.exe" goto venv_ready
echo Creating or repairing virtual environment...
python3 -m venv backend\.venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    pause
    exit /b 1
)
:venv_ready
if not exist "backend\.venv\pyvenv.cfg" (
    echo ERROR: Virtual environment is incomplete after setup
    pause
    exit /b 1
)
if not exist "backend\.venv\Scripts\python.exe" (
    echo ERROR: Virtual environment is incomplete after setup
    pause
    exit /b 1
)

echo [2/3] Installing backend dependencies...
call backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
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
echo Rover:    http://localhost:5175/lunar-rover-simulation/frontend/terrain.html
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
start "Rover Simulation Server" /D "%~dp0" python3 -m http.server 5175

echo.
echo All three servers are starting in separate windows...
echo Close those windows to stop the servers.
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173/?welcome=1"
pause
