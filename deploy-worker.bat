@echo off
setlocal EnableExtensions

REM Deploys the Worker from the repository root.
REM Uses CF_PROXY_URL / HTTP_PROXY / HTTPS_PROXY for npm and Wrangler Cloudflare requests.

cd /d "%~dp0"

set "PROXY_URL="
if defined CF_PROXY_URL set "PROXY_URL=%CF_PROXY_URL%"
if not defined PROXY_URL if defined HTTPS_PROXY set "PROXY_URL=%HTTPS_PROXY%"
if not defined PROXY_URL if defined https_proxy set "PROXY_URL=%https_proxy%"
if not defined PROXY_URL if defined HTTP_PROXY set "PROXY_URL=%HTTP_PROXY%"
if not defined PROXY_URL if defined http_proxy set "PROXY_URL=%http_proxy%"

if defined PROXY_URL (
  echo Proxy detected. It will be used for npm and Wrangler Cloudflare requests.
  set "HTTP_PROXY=%PROXY_URL%"
  set "HTTPS_PROXY=%PROXY_URL%"
  set "http_proxy=%PROXY_URL%"
  set "https_proxy=%PROXY_URL%"
  set "ALL_PROXY=%PROXY_URL%"
  set "all_proxy=%PROXY_URL%"
  set "npm_config_proxy=%PROXY_URL%"
  set "npm_config_https_proxy=%PROXY_URL%"
) else (
  echo Using direct connection without proxy.
)

if /I "%FORCE_WRANGLER_UPDATE%"=="1" (
  echo Updating local Wrangler...
  call npm install -D wrangler@latest
  if errorlevel 1 exit /b %errorlevel%
)

if not exist "node_modules\.bin\wrangler.cmd" (
  echo Local dependencies are missing. Installing them...
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

echo Ensuring Wrangler configuration...
call node "%~dp0scripts\ensure-wrangler-config.mjs"
if errorlevel 1 exit /b %errorlevel%

if /I not "%SKIP_TESTS%"=="1" (
  echo Running tests before deploy...
  call npm test
  if errorlevel 1 exit /b %errorlevel%
)

echo Checking Cloudflare authentication...

REM Use Wrangler OAuth for this deploy flow and ignore broken API-token env vars.
REM This does not delete permanent Windows environment variables.
set "CLOUDFLARE_API_TOKEN="
set "CF_API_TOKEN="
set "CLOUDFLARE_API_KEY="
set "CLOUDFLARE_EMAIL="

call node "%~dp0scripts\ensure-cloudflare-auth.mjs"
if errorlevel 1 exit /b %errorlevel%

echo Cloudflare authentication OK.

echo Ensuring D1 database exists...
call node "%~dp0scripts\ensure-d1.mjs"
if errorlevel 1 exit /b %errorlevel%

echo Applying migrations...
call node "%~dp0scripts\run-wrangler.mjs" d1 migrations apply vpnhub_bot --remote
if errorlevel 1 exit /b %errorlevel%

echo Deploying worker...
call node "%~dp0scripts\run-wrangler.mjs" deploy %*
exit /b %errorlevel%