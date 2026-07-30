@echo off
REM Test Status API - Verifies the /api/status endpoint response structure

echo ==========================================
echo Open-Audit Status API Test
echo ==========================================
echo.

REM API endpoint
if "%API_URL%"=="" set API_URL=http://localhost:3000/api/status

echo Testing endpoint: %API_URL%
echo.

REM Make request
echo Making request...
curl -s -o response.json %API_URL%
curl -s -o nul -w "HTTP Status Code: %%{http_code}" %API_URL%
echo.
echo.

REM Display response
echo ==========================================
echo Response:
echo ==========================================
type response.json
echo.
echo.

REM Basic verification
echo ==========================================
echo Response Structure Verification:
echo ==========================================
echo.

REM Check if response file exists and is not empty
if not exist response.json (
    echo X API did not respond
    exit /b 1
)

findstr /C:"status" response.json >nul
if %errorlevel% equ 0 (
    echo * status field: Found
) else (
    echo X status field: Missing
)

findstr /C:"timestamp" response.json >nul
if %errorlevel% equ 0 (
    echo * timestamp field: Found
) else (
    echo X timestamp field: Missing
)

findstr /C:"components" response.json >nul
if %errorlevel% equ 0 (
    echo * components field: Found
) else (
    echo X components field: Missing
)

findstr /C:"stellarRpc" response.json >nul
if %errorlevel% equ 0 (
    echo * stellarRpc component: Found
) else (
    echo X stellarRpc component: Missing
)

findstr /C:"database" response.json >nul
if %errorlevel% equ 0 (
    echo * database component: Found
) else (
    echo X database component: Missing
)

findstr /C:"redis" response.json >nul
if %errorlevel% equ 0 (
    echo * redis component: Found
) else (
    echo X redis component: Missing
)

findstr /C:"worker" response.json >nul
if %errorlevel% equ 0 (
    echo * worker component: Found
) else (
    echo X worker component: Missing
)

findstr /C:"metrics" response.json >nul
if %errorlevel% equ 0 (
    echo * metrics field: Found
) else (
    echo X metrics field: Missing
)

findstr /C:"circuitBreakerState" response.json >nul
if %errorlevel% equ 0 (
    echo * circuitBreakerState field: Found
) else (
    echo X circuitBreakerState field: Missing
)

findstr /C:"lastHeartbeat" response.json >nul
if %errorlevel% equ 0 (
    echo * lastHeartbeat field: Found
) else (
    echo   lastHeartbeat field: Not found (worker may be down)
)

echo.
echo ==========================================
echo Test Complete
echo ==========================================

REM Check if jq is available for pretty printing
where jq >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo Pretty-printed response:
    echo ==========================================
    type response.json | jq .
) else (
    echo.
    echo Install jq for pretty JSON formatting
)

REM Cleanup
del response.json

echo.
echo To install jq on Windows:
echo   - Download from: https://stedolan.github.io/jq/download/
echo   - Or use: winget install jqlang.jq
echo.
