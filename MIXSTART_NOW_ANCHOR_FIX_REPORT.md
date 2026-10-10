# MIXSTART_NOW_ANCHOR_FIX_REPORT

## Step 1 — Percorso del mixStart futuro (prima del fix)

**File:riga del calcolo del mixStart futuro:**

- `engine/serviceWindowSolver.js:388` — backward solver:
  ```js
  const mixStart = new Date(serviceStart.getTime() - totalUpstreamH * HOUR_MS);
  ```
  `totalUpstreamH = puntataH + staglioH + tcHours + temperingH` calcolato a ritroso da serviceStart.

- `engine/plannerAlarmEngine.js:180` (vecchio) — Case A "OK":
  ```js
  suggestions.push(`Inizia a impastare tra ${formatDeltaH(deltaH)}`);
  ```
  Quando `deltaH >= 0.5h` (mixStart nel futuro), emetteva `alarmType: 'OK'` con messaggio "tra 17h17min".

- `src/components/tools/FermentationPlannerView.tsx:658` (vecchio) — display:
  ```tsx
  {mixStart && <PlanRow label="Impasta (ottimale)" value={fmt(mixStart)} />}
  ```

---

## Step 2 — Ancoraggio a now: `solveNowAnchoredWindow`

**Nuovo file:** `engine/serviceWindowSolver.js` — esportata `solveNowAnchoredWindow(input)`.

Parametro aggiunto: `now: Date` (istante della pianificazione).

**Strategia:**
1. `mixStart = now` — FISSO (non ottimizzato).
2. `totalH = (serviceEnd − now) / HOUR_MS` — finestra fissa.
3. `tcHours = totalH − serviceDurationH − temperingH − puntataKickoffH − staglioH` (residuale).
4. Bisezione su `fridgeTempC ∈ [fridgeTempMin, fridgeTempCUser]`:
   - `matAtServiceEnd(T)` è CRESCENTE in T (temp più alta → più maturazione).
   - `bisectIncreasing(matAtServiceEnd, targetMaturationPct=90%, fridgeTempMin, fridgeTempCUser)`.

**Gradi di libertà residui:** `fridgeTempC` (leva primaria maturazione), dose (C3/bolle, bisection separata), sale (già impostato dall'utente, agisce su lievitazione + proteolisi ma NON sull'orologio enzimatico).

**Casi di infeasibility:**
- `cannot_temper`: ambient ≤ 18°C.
- `cannot_slow_enough`: `matAtMin > target` → SOVRAMMATURAZIONE (non si rallenta abbastanza).
- `window_too_short_maturation`: `matAtMax < target` → SOTTOMATURAZIONE (finestra troppo corta).
- `window_too_short`: `tcHours < 0` al fridgeTempMin.
- `w_collapse`: struttura glutine collassata a serviceEnd.

**Risultati aggiunti (OK case):**
- `mixStartIsNow: true`
- `recommendedFridgeTempC: number | null` — null se nessun aggiustamento necessario.
- `fridgeTempAdjusted: boolean`

---

## Step 3 — Assorbimento slack via leve

**Funzionamento OK case:**

1. Con `mixStart = now`, `totalH = serviceEnd − now` è fissa e spesso più lunga dell'ottimale backward.
2. Il solver trova `fridgeTempC* < fridgeTempCUser` tale che maturazione(serviceEnd) = 90%.
3. Abbassando la temperatura frigo:
   - `temperingH` aumenta (più tempo per portare il cuore pallina a 18°C).
   - `tcHours` diminuisce (meno tempo in frigo).
   - `fArrhenius(T_frigo*)` diminuisce (tasso maturazione frigo minore).
   - Effetto netto: maturazione totale diminuisce fino a centrare il 90%.
4. `recommendedFridgeTempC` mostrato in UI come "Frigo consigliato: X°C".

**Dose (C3):** bisezione indipendente sulla soglia bolle (lievitazione ≤ `bubbleThresholdPct`). La dose NON tocca l'orologio enzimatico (confermato dalla separazione delle leve del two-clock).

---

## Step 4 — Motore allarme SOVRAMMATURAZIONE + opzioni esplicite

**`computeNowAnchoredAlarms`** (refactored in `engine/plannerAlarmEngine.js`):

- Chiama `solveNowAnchoredWindow` (mixStart = now, bisect fridgeTempC).
- Se `cannot_slow_enough` → `SOVRAMMATURAZIONE`:
  1. Chiama `solveServiceWindow` (backward) per calcolare `delayH` minimo.
  2. Opzioni in ordine:
     - **Anticipa il servizio** (inizia a servire prima).
     - **Riduci il target di maturazione** (attuale: 90%).
     - **[Ultima opzione] Ritarda l'inizio di Xh** — sempre mostrato come fallback esplicito, mai come default silenzioso.
- Se OK: `alarmType: 'OK'`, `suggestions` con frigo raccomandato e schedule.

**Eliminati** dalla versione precedente:
- Case A "Inizia tra Xh" (start futuro silenzioso).
- Case B "MARGINE_STRETTO".
- Case C "SOTTOMATURAZIONE" (in ritardo rispetto all'ottimale) → ora `window_too_short_maturation`.

---

## Step 5 — Tabella di verifica

| Caso | Configurazione | Vecchio comportamento | Nuovo comportamento |
|---|---|---|---|
| **Screenshot** | Servizio 04/06 19:00, 2h · 2850g, 76%, 2.9%, 0.5% · T_amb 22°C, T_tc 2.5°C, staglio 1.5h | `OK +17.3h "Impasta tra 17h17min"` | `SOVRAMMATURAZIONE — opzioni esplicite (anticipa / riduci target / [ultima] ritarda 11h6min)` |
| **Slack assorbibile** | Finestra ~44h, fridgeTempC=4°C, fridgeTempMin=2°C | `OK +Xh "Inizia tra..."` | `OK — Impasta ADESSO · Frigo → X°C` |
| **Finestra troppo corta** | Finestra <15h (puntata+staglio+tempering+service non si chiudono) | `SOVRAMMATURAZIONE` | `SOTTOMATURAZIONE — Finestra troppo corta` |
| **Target non raggiungibile** | Finestra 24h, matAtMax<90% | `SOTTOMATURAZIONE` | `SOTTOMATURAZIONE — maturazione Xx% < 90%` |
| **Sessione "Usa questo schema"** | fridgeTempAdjusted=true | `fridgeTempC = fridgeTempCUser` (ignorato aggiustamento) | `fridgeTempC = recommendedFridgeTempC` (propagato) |

**Comportamento screenshot:** La finestra 48.3h (now → June 4 21:00) dà maturation > 90% anche a fridgeTempMin=2°C (92% simulata), confermando che il piano corretto è SOVRAMMATURAZIONE con opzioni esplicite, NON un silenzioso "start tra 17h17min". Questo è coerente con Step 5.2 del prompt: "Caso in cui lo slack è troppo grande per essere assorbito (frigo già al minimo): scatta l'allarme con le opzioni".

---

## Vincoli non regrediti

- ThermalTimeline, two-clock, kEffective, gompertz, fArrhenius: **intoccati**.
- `buildInitialTimeline`, `applyPhaseTransition`: **intoccati**.
- `solveServiceWindow` (backward solver): **intatto** (usato internamente per calcolare `delayH`).
- Persistenza Dexie: **invariata**.
- `Sale NON tocca l'orologio maturazione`: **confermato** (bisezione solo su fridgeTempC).
- 68/68 test Vitest passano; build produzione pulita; 0 errori TypeScript.

---

## File modificati

| File | Modifica |
|---|---|
| `engine/serviceWindowSolver.js` | Aggiunta `solveNowAnchoredWindow` (esportata). Backward solver `solveServiceWindow` invariato. |
| `engine/plannerAlarmEngine.js` | Refactored `computeNowAnchoredAlarms`: usa `solveNowAnchoredWindow`, rimosse funzioni dead (`estimateMaturationDeficit`, `suggestLowerFridgeTemp`, threshold constants). |
| `src/engine/serviceWindowSolver.ts` | Aggiunto `SolveNowAnchoredWindowInput`; aggiornato `ServiceWindowInfeasibility.reason` (nuovi motivi); aggiornato `SolveServiceWindowResult` (`mixStartIsNow`, `recommendedFridgeTempC`, `fridgeTempAdjusted`). |
| `src/engine/plannerAlarmEngine.ts` | Aggiornato `NowAnchoredAlarmResult`: rimossi `deltaH`/`mixStartOptimal`/`estimatedFinalMat`, aggiunti `mixStartIsNow`/`recommendedFridgeTempC`/`fridgeTempAdjusted`/`delayH`. |
| `src/components/tools/FermentationPlannerView.tsx` | `ServiceWindowResultCard`: mostra "Impasta ADESSO" (non data futura), card SOVRAMMATURAZIONE con opzioni esplicite, frigo consigliato. `useServiceResult`: propaga `recommendedFridgeTempC` alla sessione. |
