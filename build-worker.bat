@echo off
setlocal EnableExtensions

REM Builds a deployable Worker bundle without publishing it to Cloudflare.
REM Any configured proxy is used only for npm install; Wrangler runs direct.

cd /d "%~dp0"

set "PROXY_URL="
if defined CF_PROXY_URL set "PROXY_URL=%CF_PROXY_URL%"
if not defined PROXY_URL if defined HTTPS_PROXY set "PROXY_URL=%HTTPS_PROXY%"
if not defined PROXY_URL if defined https_proxy set "PROXY_URL=%https_proxy%"
if not defined PROXY_URL if defined HTTP_PROXY set "PROXY_URL=%HTTP_PROXY%"
if not defined PROXY_URL if defined http_proxy set "PROXY_URL=%http_proxy%"

if defined PROXY_URL (
  echo Proxy detected. It will be used only for npm install.
) else (
  echo Using direct connection without proxy.
)

if not exist "node_modules\.bin\wrangler.cmd" (
  echo Local dependencies are missing. Installing them...
  if defined PROXY_URL (
    call cmd /c "set HTTP_PROXY=%PROXY_URL%&& set HTTPS_PROXY=%PROXY_URL%&& set http_proxy=%PROXY_URL%&& set https_proxy=%PROXY_URL%&& set ALL_PROXY=%PROXY_URL%&& set all_proxy=%PROXY_URL%&& set npm_config_proxy=%PROXY_URL%&& set npm_config_https_proxy=%PROXY_URL%&& npm install"
  ) else (
    call npm install
  )
  if errorlevel 1 exit /b %errorlevel%
)

if /I not "%SKIP_TESTS%"=="1" (
  echo Running tests before build...
  call npm test
  if errorlevel 1 exit /b %errorlevel%
)

echo Checking Cloudflare authentication...
call node scripts\ensure-cloudflare-auth.mjs
if errorlevel 1 exit /b %errorlevel%

if not exist "build" mkdir "build"

echo Building worker bundle into build\ ...
call node scripts\build-worker.mjs %*
if errorlevel 1 exit /b %errorlevel%

echo Build complete.
exit /b 0
