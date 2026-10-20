@echo off
setlocal
set "PY=C:\Python312\python.exe"
set "PYW=C:\Python312\pythonw.exe"
set "SCRIPT=C:\Python312\Fixed Income\push_mm_yields.py"

echo ============================================================
echo   Money Market yields - Bloomberg PC scheduled push
echo ============================================================
echo.

if not exist "%SCRIPT%" (
  echo ERROR: Cannot find:
  echo   %SCRIPT%
  echo.
  echo Copy push_mm_yields.py into  C:\Python312\Fixed Income\  first,
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "%PYW%" set "PYW=%PY%"

echo Registering scheduled task "AylettMMYieldsPush"
echo   (runs every 4 hours, starting 07:45, while this PC is logged in)...
schtasks /Create /F /TN "AylettMMYieldsPush" /SC HOURLY /MO 4 /ST 07:45 /IT /TR "\"%PYW%\" \"%SCRIPT%\""
echo.

echo Running one push now to refresh the dashboard...
echo ------------------------------------------------------------
"%PY%" "%SCRIPT%"
echo ------------------------------------------------------------
echo.
echo Done. The money market reference will now refresh on its own,
echo every 4 hours, with no window popping up.
echo.
pause
