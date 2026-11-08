@echo off
rem Residue launcher for environments that cannot run a shebang script:
rem zip extraction, Explorer double-click and package-manager shims.
rem npm installs its own shims from package.json "bin" and does not use this file.
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Residue needs Node.js 22.6 or newer: https://nodejs.org/
  exit /b 127
)
node "%~dp0residue.mjs" %*
exit /b %errorlevel%
