@echo off
REM ============================================================
REM  PizzaMatrix - Setup ambiente build Android (Windows CMD)
REM  Imposta JAVA_HOME (JDK 17) e ANDROID_HOME.
REM
REM  Uso:
REM    scripts\setup-env.bat                    (auto-detect)
REM    scripts\setup-env.bat "C:\percorso\Sdk"  (SDK esplicito)
REM
REM  NB: nessun "setlocal", cosi' le variabili valgono anche per
REM      lo script chiamante (update-app.bat le riusa in sessione).
REM ============================================================

if not defined PM_SESSION_ONLY (
  echo.
  echo === PizzaMatrix - Setup ambiente Android ===
  echo.
)

REM --- 1. Trova un JDK 17 (NON il JDK 25 di Android Studio) ---
set "JDK17="
for %%B in ("C:\Program Files\Eclipse Adoptium" "C:\Program Files\Java" "C:\Program Files\Microsoft" "C:\Program Files\Zulu" "C:\Program Files\Amazon Corretto") do (
  if exist "%%~B" (
    for /d %%D in ("%%~B\jdk-17*" "%%~B\jdk17*") do set "JDK17=%%~fD"
  )
)

if not defined JDK17 (
  echo [ERRORE] Nessun JDK 17 trovato.
  echo Il JDK di Android Studio ^(cartella jbr^) e' troppo recente per Gradle di Capacitor 6.
  echo Installa Temurin JDK 17:  https://adoptium.net/temurin/releases/?version=17
  echo   Windows / x64 / JDK / versione 17  ^(file .msi^)
  echo Poi rilancia questo script.
  exit /b 1
)

REM --- 2. Trova l'Android SDK ---
set "SDK="
if not "%~1"=="" (
  set "SDK=%~1"
) else if exist "%ANDROID_HOME%\platform-tools" (
  set "SDK=%ANDROID_HOME%"
) else if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools" (
  set "SDK=%LOCALAPPDATA%\Android\Sdk"
) else if exist "%ProgramFiles%\Android\Sdk\platform-tools" (
  set "SDK=%ProgramFiles%\Android\Sdk"
)

if not defined SDK (
  echo [ERRORE] Android SDK non trovato in "%LOCALAPPDATA%\Android\Sdk".
  echo In Android Studio: Settings ^> Languages ^& Frameworks ^> Android SDK,
  echo copia "Android SDK Location" e rilancia cosi':
  echo   scripts\setup-env.bat "C:\percorso\del\Sdk"
  exit /b 1
)

REM --- 3. Imposta per QUESTA sessione ---
set "JAVA_HOME=%JDK17%"
set "ANDROID_HOME=%SDK%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

REM --- 4. Rendi permanente (salta se chiamato in session-only) ---
if not defined PM_SESSION_ONLY (
  setx JAVA_HOME "%JDK17%" >nul
  setx ANDROID_HOME "%SDK%" >nul
  echo [OK] JDK 17 ........ %JAVA_HOME%
  echo [OK] Android SDK ... %ANDROID_HOME%
  echo.
  echo Verifica versione Java ^(deve dire "17"^):
  "%JAVA_HOME%\bin\java" -version
  echo.
  echo [FATTO] Variabili impostate in modo permanente.
  echo Chiudi e riapri CMD perche' abbiano effetto in tutte le finestre.
)

REM --- cleanup variabili temporanee ---
set "JDK17="
set "SDK="
