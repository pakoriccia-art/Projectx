# CLAUDE.md — Guida per Claude Code (sessione locale)

Questo file orienta un agente Claude Code che lavora su **PizzaMatrix** in locale
(tipicamente su Windows con Android Studio), soprattutto per il ciclo di
**sviluppo, test e build Android**.

## Cos'è il progetto

Web-app **Vite + React 18 + TypeScript** impacchettata con **Capacitor 6** dentro
una WebView Android. Lo stesso build web (`dist/`) diventa l'APK: **non c'è codice
nativo da scrivere**, la logica vive nella web-app (`src/`, `engine/`).

- `appId`: `com.pizzamatrix.app` (vedi `capacitor.config.ts`)
- Versione: `package.json` → `version` (allineare a `versionName` in `android/app/build.gradle`)

## Requisito critico per la build Android

La build Gradle di Capacitor 6 richiede **JDK 17**. Il JDK incluso in Android
Studio (cartella `jbr`) è **JDK 25** e **fa fallire** la build ("Unsupported class
file major version" / errori Gradle). Serve un JDK 17 separato (es. Temurin) e
`JAVA_HOME` che punti a quello, più `ANDROID_HOME` sull'SDK.

➡️ Per impostarli in automatico: **`scripts\setup-env.bat`** (una tantum, usa `setx`).

## Due superfici di test

| Superficie | Come aggiornarla | Quando |
|---|---|---|
| **PWA in Chrome** | `npm run dev` + refresh | loop rapido di logica/UI (default quotidiano) |
| **APK sul telefono** | catena completa (sotto) | verifica finale, notifiche native, resa reale |

## Catena di build e scorciatoie

Una modifica al codice arriva sul telefono **solo** con questa catena (nessun
passaggio è automatico):

```
modifichi src/  ->  npm run build  ->  npx cap sync android  ->  gradlew assembleDebug  ->  adb install -r
```

Scorciatoie già pronte nel repo (Windows):

- **`scripts\setup-env.bat`** — imposta JAVA_HOME (JDK 17) + ANDROID_HOME (una tantum).
- **`scripts\update-app.bat`** — esegue tutta la catena e installa l'APK sul telefono (one-click).
- **`scripts\live-reload.bat`** — dev server sulla LAN per vedere le modifiche sul
  telefono **senza** ribuildare l'APK (vedi sotto).
- npm: `npm run cap:sync` (= `build` + `cap sync android`), `npm run cap:open`, `npm run cap:run`.

Per il loop rapido di sviluppo usa **`npm run dev`** (PWA in Chrome): è istantaneo.
Ribuilda l'APK solo quando serve provare sul dispositivo.

## Live-reload on-device

Il blocco `server` in `capacitor.config.ts` è **commentato**: decommentandolo e
impostando `url: 'http://<IP-LAN>:5173'` (con `cleartext: true`), l'APK carica dal
dev server e mostra le modifiche in tempo reale. `scripts\live-reload.bat` stampa
gli IP e avvia Vite in ascolto sulla rete.
**Importante:** rimetti il commento su `server.url` prima di una build **release**,
altrimenti l'APK di produzione punta al dev server.

## Test

- Tutti: `npm run test:all` — unit `npm run test:unit`, service `npm run test:service`,
  integration `npm run test:integration`, e2e `npm run test:e2e` (Playwright).

## Regole del repo

- **Non committare mai:** `android/`, `dist/`, `node_modules/`, `*.apk`, `*.aab`,
  `*.keystore` / `*.jks`, `key.properties` (già in `.gitignore`). Il progetto nativo
  `android/` si rigenera in locale con `npx cap add android` — vedi `docs/BUILD_ANDROID.md`.
- **Sync = Git manuale:** `git pull` a inizio sessione, `git push` a fine. Niente si
  sincronizza da solo da GitHub.
- Dettagli completi build debug/release, firma e versionamento: **`docs/BUILD_ANDROID.md`**.
