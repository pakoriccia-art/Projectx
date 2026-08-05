@echo off
setlocal
REM ============================================================
REM  PizzaMatrix - Live reload sul telefono (dev server Vite)
REM  Mostra le modifiche a src/ in tempo reale SENZA ribuildare l'APK.
REM ============================================================

cd /d "%~dp0.." || goto :err

echo.
echo === PizzaMatrix - Live reload su telefono ===
echo.
echo Indirizzi IP di questo PC sulla rete locale:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%A:5173
echo.
echo PASSI (una tantum):
echo   1) In capacitor.config.ts decommenta e imposta il blocco server:
echo        server: { url: 'http://IL_TUO_IP:5173', cleartext: true }
echo      (usa uno degli IP qui sopra; telefono e PC sulla STESSA rete Wi-Fi)
echo   2) Applica al contenitore nativo e reinstalla l'APK UNA volta:
echo        scripts\update-app.bat
echo   3) Da qui in poi, per sviluppare, lancia solo questo script.
echo.
echo [ATTENZIONE] Prima di buildare una RELEASE rimetti il commento su server.url,
echo              altrimenti l'APK di produzione puntera' al dev server e non
echo              funzionera' offline.
echo.
echo Avvio del dev server Vite in ascolto sulla rete (Ctrl+C per fermare)...
echo.
call npm run dev -- --host
goto :end

:err
echo [ERRORE] Impossibile posizionarsi nella cartella del progetto.

:end
endlocal
