@echo off
setlocal EnableDelayedExpansion

title SpearSim Launcher
color 0B

echo.
echo  =========================================
echo   SpearSim ^| Security Awareness Platform
echo  =========================================
echo.

:: Resolve paths
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "VENV=%BACKEND%\venv"
set "ACTIVATE=%VENV%\Scripts\activate.bat"

:: ============================================================
:: PREFLIGHT: Python
:: ============================================================
echo [1/5] Checking Python...
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Python not found. Install Python 3.11+
    pause & exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo         Found Python %PY_VER%

:: ============================================================
:: PREFLIGHT: Node.js
:: ============================================================
echo [2/5] Checking Node.js...
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js not found. Install Node.js 18+
    pause & exit /b 1
)
for /f %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo         Found Node.js %NODE_VER%

:: ============================================================
:: PREFLIGHT: .env
:: ============================================================
echo [3/5] Checking backend .env...
if not exist "%BACKEND%\.env" (
    echo  [WARN] .env not found - copying from .env.example
    copy "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
    echo  [ACTION] Fill in your API keys in backend\.env then re-run.
    pause & exit /b 1
)
echo         Found backend\.env

:: ============================================================
:: PREFLIGHT: Venv + dependencies
:: ============================================================
echo [4/5] Checking Python virtual environment...
if not exist "%ACTIVATE%" (
    echo         Creating virtual environment...
    python -m venv "%VENV%"
    echo         Installing dependencies...
    call "%ACTIVATE%"
    pip install -r "%BACKEND%\requirements.txt" --quiet
    call deactivate
    echo         Done.
) else (
    echo         Virtual environment exists - skipping.
)

:: ============================================================
:: PREFLIGHT: Node modules
:: ============================================================
echo [5/5] Checking frontend node_modules...
if not exist "%FRONTEND%\node_modules" (
    echo         Running npm install...
    cd /d "%FRONTEND%"
    npm install --silent
    cd /d "%ROOT%"
    echo         Done.
) else (
    echo         node_modules exists - skipping.
)

:: ============================================================
:: LAUNCH BACKEND
:: ============================================================
echo.
echo  Starting backend  (http://localhost:8000)...
start "SpearSim Backend" cmd /k "color 0A && call "%ACTIVATE%" && cd /d "%BACKEND%" && uvicorn app.main:app --reload --port 8000"

timeout /t 2 /nobreak >nul

:: ============================================================
:: LAUNCH CELERY WORKER
:: ============================================================
echo  Starting Celery background worker...
start "SpearSim Celery Worker" cmd /k "color 0B && call "%ACTIVATE%" && cd /d "%BACKEND%" && celery -A app.celery_app worker --loglevel=info --pool=solo"

timeout /t 2 /nobreak >nul

:: ============================================================
:: LAUNCH FRONTEND
:: ============================================================
echo  Starting frontend (http://localhost:3000)...
start "SpearSim Frontend" cmd /k "color 0E && cd /d "%FRONTEND%" && npm run dev"

:: ============================================================
:: DONE
:: ============================================================
echo.
echo  =========================================
echo   Frontend  ^>  http://localhost:3000
echo   Backend   ^>  http://localhost:8000
echo   Celery    ^>  Running in background
echo   API Docs  ^>  http://localhost:8000/api/docs
echo  =========================================
echo.

timeout /t 4 /nobreak >nul
start "" "http://localhost:3000"

endlocal