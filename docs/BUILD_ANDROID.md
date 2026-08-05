# Build Android (APK / AAB) — PizzaMatrix

PizzaMatrix è una web-app Vite + React già predisposta per **Capacitor 6**: lo
stesso build web (`dist/`) viene impacchettato in una WebView nativa Android.
Non c'è codice da riscrivere. Questa guida copre la build **debug** (sideload sul
tuo telefono) e la build **release firmata** (Google Play).

> ⚠️ La build Android (Gradle) **non** gira nell'ambiente cloud di sviluppo:
> richiede Android SDK + JDK. Esegui questi passi **sulla tua macchina** con
> Android Studio installato.

---

## Prerequisiti

| Requisito | Note |
|-----------|------|
| **Android Studio** | Ultima versione stabile. |
| **JDK 17** | **Obbligatorio** per Capacitor 6. Con JDK 11 o 21 il primo build fallisce. Android Studio ne include uno (Embedded JDK) — impostalo in _Settings ▸ Build ▸ Gradle ▸ Gradle JDK_. |
| **Android SDK + platform-tools** | Installati dall'SDK Manager di Android Studio. |
| `ANDROID_HOME` | `~/Android/Sdk` (Linux) o `~/Library/Android/sdk` (macOS). Aggiungi `platform-tools` al `PATH` per usare `adb`. |
| **Node 18+** | Per il build web. |

---

## 1. Setup iniziale (una tantum)

Dalla radice del repo:

```bash
npm ci
npm run build            # genera dist/ (icone da public/icons/ incluse)
npx cap add android      # crea il progetto nativo android/ (SOLO la prima volta)
npx cap sync android     # copia gli asset web E installa i plugin nativi
npx cap open android     # apre il progetto in Android Studio
```

> **`cap sync`, non `cap copy`.** `sync = copy + update`: installa i moduli nativi
> di `@capacitor/local-notifications` e `@capacitor/push-notifications` in Gradle.
> Con il solo `copy` i plugin restano scollegati e le notifiche falliscono a
> runtime. Lo script `npm run cap:sync` usa già `cap sync`.

> **`android/` è git-ignored.** Il progetto nativo si (ri)genera in locale con
> `cap add android` e non va committato. Questa guida è l'unica fonte per
> ricrearlo: se cambi macchina, ripeti dal punto 1.

Dopo ogni modifica al codice web, prima di ribuildare l'app Android:

```bash
npm run cap:sync         # = npm run build && npx cap sync android
```

---

## 2. Build DEBUG (sideload sul tuo telefono)

Non richiede firma. In Android Studio: **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)**.
Oppure da CLI:

```bash
cd android
./gradlew assembleDebug
```

APK prodotto in:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Installalo su un dispositivo collegato in USB (con debug USB attivo):

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 3. Build RELEASE firmata (Google Play)

### 3.1 Crea il keystore (una tantum)

```bash
keytool -genkey -v \
  -keystore pizzamatrix-release.keystore \
  -alias pizzamatrix \
  -keyalg RSA -keysize 2048 -validity 10000
```

> Conserva il keystore **fuori dal repo** e in un posto sicuro: perderlo significa
> non poter più aggiornare l'app su Play. Il `.gitignore` blocca comunque
> `*.keystore`, `*.jks`, `key.properties`, `*.apk`, `*.aab` come rete di sicurezza.

### 3.2 `android/key.properties` (git-ignored)

```properties
storeFile=/percorso/assoluto/pizzamatrix-release.keystore
storePassword=LA_TUA_STORE_PASSWORD
keyAlias=pizzamatrix
keyPassword=LA_TUA_KEY_PASSWORD
```

### 3.3 Configura la firma in `android/app/build.gradle`

In cima al file, sopra il blocco `android { … }`:

```groovy
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Dentro `android { … }`:

```groovy
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
```

### 3.4 Builda

```bash
cd android
./gradlew assembleRelease      # APK firmato → app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease        # AAB per Play  → app/build/outputs/bundle/release/app-release.aab
```

Per il Play Store carica l'**AAB** (`app-release.aab`).

---

## 4. Versionamento

Capacitor **non** propaga la versione da `package.json`. Impostala in
`android/app/build.gradle` → `android { defaultConfig { … } }`:

```groovy
        versionCode 1            // intero, +1 a OGNI upload su Play
        versionName "2.4.0"      // stringa visibile, allinea a package.json
```

`versionCode` deve crescere a ogni caricamento su Play; `versionName` è
l'etichetta mostrata all'utente.

---

## 5. (Opzionale) Notifiche brandizzate

La config `LocalNotifications` in `capacitor.config.ts` è stata ridotta al solo
`iconColor` per garantire un primo build senza errori (icona e suono di default).
Per icona/suono personalizzati:

1. Aggiungi l'icona di stato **monocromatica** (Android la rende come maschera
   bianca/trasparente) come drawable, es.:
   `android/app/src/main/res/drawable-mdpi/ic_stat_notification.png`
   (e le varianti `-hdpi/-xhdpi/-xxhdpi/-xxxhdpi`).
2. Aggiungi il suono: `android/app/src/main/res/raw/beep.wav`.
3. Rimetti i campi in `capacitor.config.ts`:
   ```ts
   LocalNotifications: {
     smallIcon: 'ic_stat_notification',
     iconColor: '#ff8c32',
     sound: 'beep.wav'
   }
   ```
4. `npx cap sync android` e ribuilda.

> Ricorda: essendo `android/` git-ignored, queste risorse native vanno
> riaggiunte dopo ogni `cap add android` su una macchina nuova.

---

## Riferimento rapido

| Azione | Comando |
|--------|---------|
| Rebuild web + sync | `npm run cap:sync` |
| APK debug | `cd android && ./gradlew assembleDebug` |
| APK release firmato | `cd android && ./gradlew assembleRelease` |
| AAB per Play | `cd android && ./gradlew bundleRelease` |
| Installa su device | `adb install -r <path-apk>` |

- appId: `com.pizzamatrix.app`
- Icone app: `public/icons/` (rigenerabili con `node scripts/generate-icons.mjs`)
