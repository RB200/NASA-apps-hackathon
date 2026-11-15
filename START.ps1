# NASA Hackathon - Easy Startup Script
# Right-click and select "Run with PowerShell" to start

$ErrorActionPreference = "Stop"

function Write-Header {
    Write-Host "`n" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  NASA Hackathon - NASA Apps" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message, [int]$Step)
    Write-Host "[$Step/3] $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ ERROR: $Message" -ForegroundColor Red
}

Write-Header

# Check Python
Write-Step "Checking Python installation..." 1
try {
    $pythonVersion = python3 --version 2>&1
    Write-Success "Python found: $pythonVersion"
} catch {
    Write-Error "Python 3 is not installed or not in PATH"
    Write-Host "Please install Python 3 from https://python.org" -ForegroundColor Red
    Write-Host "Make sure to check 'Add Python to PATH' during installation" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Create virtual environment
Write-Step "Setting up virtual environment..." 2
if (-not (Test-Path "backend\.venv\pyvenv.cfg") -or -not (Test-Path "backend\.venv\Scripts\python.exe")) {
    Write-Host "  Creating or repairing venv..." -ForegroundColor Gray
    python3 -m venv backend\.venv
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment"
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Success "Virtual environment created"
} else {
    Write-Success "Virtual environment already exists"
}
if (-not (Test-Path "backend\.venv\pyvenv.cfg") -or -not (Test-Path "backend\.venv\Scripts\python.exe")) {
    Write-Error "Virtual environment is incomplete after setup"
    Read-Host "Press Enter to exit"
    exit 1
}

# Install dependencies
Write-Host "  Installing dependencies..." -ForegroundColor Gray
& backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install dependencies"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Success "Dependencies installed"

# Start servers
Write-Step "Starting servers..." 3
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Servers Starting" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend:  http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Backend:   http://localhost:8000" -ForegroundColor Cyan
Write-Host "  API Docs:  http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  Rover:     http://localhost:5175/lunar-rover-simulation/frontend/terrain.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ⏳ Waiting for servers to start..." -ForegroundColor Yellow
Write-Host ""

# Start backend server in a new window
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$pwd'; Write-Host 'Backend Server Starting...' -ForegroundColor Green; backend\.venv\Scripts\uvicorn app:app --app-dir backend --reload --port 8000"
) -WindowStyle Normal

# Wait a moment
Start-Sleep -Seconds 2

# Start frontend server in a new window
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$pwd'; Write-Host 'Frontend Server Starting...' -ForegroundColor Green; python3 -m http.server 5173 --directory frontend"
) -WindowStyle Normal

# Serve the repository root so the rover page can load its shared and local assets.
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "python3 -m http.server 5175 --directory '$PSScriptRoot'"
) -WindowStyle Normal

# Wait for servers to start
Start-Sleep -Seconds 3

# Try to open browser
Write-Host "  ✓ Servers launched in separate windows" -ForegroundColor Green
Write-Host ""
Write-Host "  Opening the app in your browser..." -ForegroundColor Yellow
Write-Host ""

try {
    Start-Process "http://localhost:5173"
    Write-Success "App opened"
} catch {
    Write-Host "  Could not auto-open browser - please manually visit:" -ForegroundColor Yellow
    Write-Host "  http://localhost:5173" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✓ Ready to Use!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Close the server windows to stop." -ForegroundColor Yellow
Write-Host ""

# Keep this window open
Read-Host "Press Enter to close this window"
