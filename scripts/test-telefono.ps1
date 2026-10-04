<#
  PizzaMatrix — test sul telefono collegato in debug USB.

  Compila l'app, la installa in build di debug sul telefono e la guida con
  scripts/test-telefono.mjs: cambio fase, annulla, ripresa dopo la chiusura,
  salvataggio in IndexedDB, Storico. Screenshot e risultati in test-results\telefono.

  Uso (dalla cartella del progetto):
    powershell -ExecutionPolicy Bypass -File scripts\test-telefono.ps1
    powershell -ExecutionPolicy Bypass -File scripts\test-telefono.ps1 -SkipBuild -WaitSeconds 120

  Parametri:
    -SkipBuild      non ricompila né reinstalla (app già aggiornata sul telefono)
    -WaitSeconds N  secondi ad app chiusa prima di riaprirla (default 60)
    -Keep           lascia la sessione di test aperta alla fine (scenario nuovo)
    -Scenario X     nuovo | pianifica | prefermento | tutti (default tutti)
#>
param(
  [ValidateSet('nuovo', 'pianifica', 'prefermento', 'tutti')][string]$Scenario = 'tutti',
  [switch]$SkipBuild,
  [int]$WaitSeconds = 60,
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# adb: dal PATH o dall'SDK Android
Step 'Controllo adb e telefono'
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) {
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $candidate = Join-Path $sdk 'platform-tools\adb.exe'
  if (Test-Path $candidate) {
    $adb = $candidate
    $env:PATH = "$(Split-Path $candidate);$env:PATH"   # serve anche a Playwright
  } else {
    throw "adb non trovato. Installa Android SDK Platform-Tools o aggiungi platform-tools al PATH."
  }
}
& $adb start-server | Out-Null
$devices = & $adb devices | Select-String -Pattern "`tdevice$"
if (-not $devices) { throw "Nessun telefono autorizzato. Collega il cavo, abilita il debug USB e accetta la richiesta sul telefono." }
$serial = ($devices[0].ToString() -split "`t")[0]
Write-Host "Telefono: $serial"

if (-not $SkipBuild) {
  Step 'Build web'
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build non riuscito' }

  Step 'Sincronizzo Capacitor'
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'npx cap sync android non riuscito' }

  Step 'Installo l''app di debug sul telefono'
  npx cap run android --target $serial
  if ($LASTEXITCODE -ne 0) { throw 'npx cap run android non riuscito' }
}

Step "Eseguo il test, scenario $Scenario (app chiusa per $WaitSeconds s durante le prove di ripresa)"
$nodeArgs = @('scripts/test-telefono.mjs', '--scenario', $Scenario, '--wait', $WaitSeconds)
if ($Keep) { $nodeArgs += '--keep' }
node @nodeArgs
$code = $LASTEXITCODE

switch ($code) {
  0 { Write-Host "`nTutti i controlli superati." -ForegroundColor Green }
  1 { Write-Host "`nAlcuni controlli non sono passati: vedi sopra e test-results\telefono." -ForegroundColor Yellow }
  3 { Write-Host "`nC'era già una sessione in corso: terminala nell'app e rilancia." -ForegroundColor Yellow }
  default { Write-Host "`nIl test si è interrotto (codice $code)." -ForegroundColor Red }
}
exit $code
