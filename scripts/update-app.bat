@echo off
setlocal
REM ============================================================
REM  PizzaMatrix - Aggiorna l'app sul telefono (one-click)
REM  Catena: build web -> cap sync -> gradlew assembleDebug -> adb install
REM
REM  Uso: doppio click, oppure  scripts\update-app.bat
REM  Requisiti: aver lanciato una volta scripts\setup-env.bat
REM             + telefono in USB con "Debug USB" attivo.
REM ============================================================

REM --- Vai alla root del repo (cartella padre di scripts\) ---
cd /d "%~dp0.." || goto :err

echo.
echo === PizzaMatrix - Aggiorna app (debug) ===
echo.

REM --- Assicura JAVA_HOME (17) e ANDROID_HOME per questa sessione ---
set "PM_SESSION_ONLY=1"
call "%~dp0setup-env.bat"
if errorlevel 1 goto :err
set "PM_SESSION_ONLY="

echo.
echo [1/4] Build web (npm run build)...
call npm run build
if errorlevel 1 goto :err

if not exist "android\" (
  echo.
  echo [info] Progetto nativo android\ assente: lo genero una tantum (cap add android)...
  call npx cap add android
  if errorlevel 1 goto :err
)

echo.
echo [2/4] Sync Capacitor (npx cap sync android)...
call npx cap sync android
if errorlevel 1 goto :err

echo.
echo [3/4] Build APK debug (gradlew assembleDebug)...
call android\gradlew.bat -p android assembleDebug
if errorlevel 1 goto :err

set "APK=android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "%APK%" (
  echo [ERRORE] APK non trovato: %APK%
  goto :err
)

echo.
echo [4/4] Installazione sul telefono (adb install -r)...
call adb install -r "%APK%"
if errorlevel 1 (
  echo.
  echo [ATTENZIONE] adb non e' riuscito a installare l'app.
  echo   - Collega il telefono via USB con "Debug USB" attivo, oppure
  echo   - copia manualmente questo APK sul telefono e aprilo:
  echo       %CD%\%APK%
  goto :end
)

echo.
echo [FATTO] App aggiornata sul telefono.
echo APK: %CD%\%APK%
goto :end

:err
echo.
echo [INTERROTTO] Errore in uno degli step sopra.
echo Leggi il messaggio piu' in alto (per Gradle, la parte dopo "What went wrong").
endlocal
exit /b 1

:end
endlocal
