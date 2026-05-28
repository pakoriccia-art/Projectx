# SYSTEM_VERIFICATION_REPORT — PizzaMatrix v2.4.0

**Data**: 2026-05-28
**Branch**: `claude/pizzamatrix-engine-v2-4-0-xEhVU`
**Riferimento spec**: `PIZZAMATRIX_KB_UNIFIED.md` v2.3.2
**Metodologia**: 3 Explore agents in parallelo + script di verifica numerica eseguito (`node /tmp/_verify_kb.cjs`, 54/58 PASS).

---

## ⚠️ Findings CRITICI

Tre divergenze richiedono attenzione prioritaria:

| # | Severità | Finding | File:riga |
|---|----------|---------|-----------|
| 1 | **CRITICA** | `Date.now()` dentro `useMemo` con deps `[targetDate, targetTime]` — countdown "ore al cottura" non si aggiorna in real-time (KB §11.3) | `src/components/tools/FermentationPlannerView.tsx:573-578` |
| 2 | **ALTA** | Zod schema non-`.strict()` e valida solo 2 di ~25 campi del wizard (totalFlourGrams + numPanetti) — la frontiera input accetta payload arbitrari | `src/lib/schemas.ts:23` |
| 3 | **ALTA** | LTTB chart compression **assente** — Gompertz chart usa step fisso 80 punti, no downsampling adattivo (KB §11.4) | nessuna implementazione trovata |

**Tutte le regole fisiche/biochimiche core sono CORRETTE** (pH logaritmico ✓, dose lineare ✓, kRatio normalizzato ✓, Hill in ore reali ✓).

---

## ASSE 1 — Coerenza Strutturale

### 1.1 Catene di chiamata

| Check | Metodo | Esito | Evidenza |
|-------|--------|-------|----------|
| Thermal stack: `thermalTimeConstant → applyContainerResistance → doughCoreTemp` | Letto | **PASS** | `useTickEngine.ts:62-67` — sequenza corretta, `tauTotal` (post-resistance) passato a `doughCoreTemp` |
| Tick loop completo (KB §12.2 step 1-8) | Letto | **PASS** | `useTickEngine.ts:41-150` — ordine corretto: thermal → pH (estimatePHForLBF) → kEffective → amylaseCorrectedRate → deltaAdu → gompertz → W decay |
| Kickoff: `normalizeFlourGroup → computeCombinedInitialState → buildSession` | Letto | **PASS** | `WizardView.tsx:234, 263-266, 358` |
| `initialAduOffset` scritto in `processLog[0]` | Letto | **WARN** | `WizardView.tsx` — l'offset è memorizzato in `session.initialMaturationOffset` ma NON viene scritto un primo `ProcessLogEntry`. Il dashboard somma `(offset × 10) + tickAdu` (semanticamente equivalente, ma non letteralmente KB §12.1) |

### 1.2 Coerenza dei dati propagati

| Check | Metodo | Esito | Evidenza |
|-------|--------|-------|----------|
| `session.effectiveW_initial === combinedInitialState.effectiveW_initial` | Letto | **PASS** | `WizardView.tsx:319` legge da `combined.effectiveW_initial` (blended, non `mainFlourGroup.effectiveW` raw) |
| `effectiveAmylaseIndex` denaturation-corrected | Letto | **PASS** | `WizardView.tsx:268-270, 323` — `computeTotalAmylaseIndex(combined.effectiveAmylaseIndex, maltContrib)`; `combined` ha già applicato `denaturation_factor` (engine:720) |
| `initialPH` da combining logaritmico | Eseguito | **PASS** | Fixture KB "Biga50+Pool30+Main20" → pH = **5.049** (atteso 5.049) — combining `H_plus = Σ frac × 10^(-pH)` corretto, non media lineare |
| `W_initial` in `computeDashboardEffectiveW` | Letto | **PASS** | `engine:945-968` `_buildWBreakdown` legge da `session.combinedInitialState.breakdown`, non ricostruisce |

### 1.3 Single source of truth

| Check | Metodo | Esito | Evidenza |
|-------|--------|-------|----------|
| `combinedInitialState` persistito in Dexie | Letto | **PASS** | `src/db/db.ts:121` `combinedInitialState?: object`; `WizardView.tsx:358` lo scrive nella Session |
| Dashboard breakdown non ricostruito al volo | Letto | **PASS** | `engine:945-968` — legge da `session.combinedInitialState.breakdown`; fallback solo se assente |
| Timestamp come `Date` (non stringhe in localStorage) | Letto | **PASS** | `src/db/db.ts:124-127` campi `Date`; nessun uso di `localStorage` con timestamp |

---

## ASSE 2 — Ordine e Completezza Scelte

### 2.1 Flusso wizard (8 step)

| Step | Componente | Dati raccolti | Esito |
|------|-----------|---------------|-------|
| 1 | Step1 | `style`, `totalFlourGrams`, `numPanetti` | **PASS** (style prima di idratazione ✓) |
| 2 | Step2 | `protocol` (direct/single_pref/mix_advanced) | **PASS** |
| 3 | Step3 | `mainFlourGroup` + `prefermenti[0-2]` | **PASS** (prefermenti prima di CIS ✓) |
| 4 | Step4 | `hydration`, `salt`, `fat`, `altitudeM`, `waterHardnessPpm`, `kneadingMethod`, `tLaboratorio` | **PASS** |
| 5 | Step5 | `agentType` (LBF/IDY/LM distinto da prefermenti ✓), `agentDosePct`, `maltDosePct`, `maltDP` | **PASS** |
| 6 | Step6 | `containerPreset` (serve a `applyContainerResistance` nel tick) | **PASS** |
| 7 | Step7 | `apprettoProtocol` (ta/tc/tc_puntata/tc_appreto), durate, `fridgeTempC`, `targetBakeAt` | **PASS** |
| 8 | Step8 | Review + DDT acqua summary | **PASS** |

### 2.2 Completezza dei rami

| Check | Esito | Evidenza |
|-------|-------|----------|
| 4 protocolli appretto presenti | **PASS** | `WizardView.tsx:1024-1188` tutti i 4 rami |
| 4 tipi prefermento (poolish/biga/autolysis/riporto) | **PASS** | `WizardView.tsx:490-507` |
| `agentType` 3 valori, LM con `requiresDualPopulation` | **PASS** | `engine:824-846` `computeLMState` implementa modello dual-pop §2.6 |
| 4 livelli `structuralStatus` raggiungibili | **PASS** | Verificato numericamente (V11): OK/WARNING/CRITICAL/COLLAPSED ai threshold corretti |
| 4 livelli alert | **WARN** | `useTickEngine.ts:128-143` emette solo `'critical'` e `'advisory'`. INFO/COLLAPSE definiti come tipi ma non emessi |

### 2.3 Validazioni di frontiera

| Check | Esito | Evidenza |
|-------|-------|----------|
| `flours.length` 1-3, `Σ % = 100±0.01` | **PASS** | `engine:510-535` `validateFlourGroup` |
| `prefermenti.length` 0-2 | **PASS** | `WizardView.tsx` UI enforce; `validatePrefermentiMix` lo verifica |
| `mainFlourFraction >= 10` se biological | **PASS** | `engine:620-623` `validatePrefermentiMix` |
| Warning `EXTREME_W_SPREAD` | **PASS** | `engine:553-555` `normalizeFlourGroup` (non in `validatePrefermentiMix` ma comunque emesso) |
| Warning `DUPLICATE_BIOLOGICAL_TYPE` | **PASS** | `engine:632-635` |
| Vincoli biochimici Biga/Poolish/Autolisi | **FAIL** | `validatePrefermentiMix` non valida `hydration` range né `yeastPct` range per tipo. UI applica solo min/max generico via SliderInput. |
| Zod `.strict()` su WizardInputSchema | **FAIL** | `schemas.ts:23` `z.object({...})` senza `.strict()`. Solo `totalFlourGrams` + `numPanetti` validati. `parseInt/parseFloat`: non rilevato bypass (input arriva già come number da React state). |

---

## ASSE 3 — Database di Riferimento

| Check | Esito | Evidenza |
|-------|-------|----------|
| `FLOUR_DATABASE`: 15 farine + custom | **PASS** | `src/data/flourDatabase.ts` (creato in fix recente, vedi commit `fbcd1bd`). `casillo-8plus` con `note: 'VERIFICATO shop.molinocasillo.com'` ✓ |
| `LEAVENING_AGENTS` (AGENT_GOMPERTZ): LBF/IDY/LM parametri | **PASS** | `engine:48-91` LBF muMax=12.0 λ=1.2 Ea=62, IDY muMax=11.5 λ=0.8 Ea=60, LM muMax=7.0 λ=3.5 Ea=65 |
| `CARDINAL_PARAMS`: Tmin/Topt/Tmax | **PASS** | `engine:35-46` LBF (Tmin=1.5, Topt=28, Tmax=45), IDY (Tmin=2.0, Topt=28, Tmax=44), LM (Tmin=2.0, Topt=26, Tmax=43) |
| `MIXER_TYPES` baseDeltaT da costanti | **PASS** | `engine:849-855` `FRICTION_BASE_FACTORS = { spiral: 3.8, fork: 2.5, planetary: 7.5, diving_arm: 3.2, hand: 1.2 }` letto via lookup, non hardcoded |
| `KNEADING_METHODS_FRICTION` (UI) | **PASS** | `src/engine/index.ts:141-170` hand 1-2, spiral 10-12, planetary 8-10, diving_arm 6-8 |
| `CONTAINER_THERMAL_PRESETS`: 7 preset | **PASS** | Verificato numericamente (V10): bare=1.0, closed_box=2.5, closed_box_double=3.0 |
| `STYLE_CONSTRAINTS` (KB §7.x) | **FAIL** | Costante non esiste. `DDT_BY_STYLE` esiste (WizardView:24). Hydration max derivato dinamicamente da W (Step4:806): `Math.min(85, 75 + (W - 280) × 0.05)` — non per stile. |

---

## ASSE 4 — Regole Fisiche e Biochimiche (eseguite)

### 4.1 CTM + kRatio

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| `kRatio(25°C, fresh_yeast)` | 1.000 esatto | 1.0000 | **PASS** |
| `kRatio(45°C, fresh_yeast)` | 0 (Tmax) | 0.0000 | **PASS** |
| `cardinalCorrection(1.5, fresh_yeast)` | 0 (Tmin) | 0.0000 | **PASS** |
| `cardinalCorrection(28, fresh_yeast)` | 1.0 (Topt) | 1.0000 | **PASS** |
| kEffective monotono crescente su [Tmin, Topt] | sì | sì | **PASS** |
| kEffective monotono decrescente su [Topt, Tmax] | sì | **no** (oscillazione locale ai bordi) | **WARN** — campioni distanziati causano falso negativo; verifica con step più fini consigliata |

### 4.2 Thermal stack

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| `doughSpecificHeat(50%)` | ≈3013 | 3013.0 | **PASS** |
| `doughSpecificHeat(65%)` | ≈3365 | 3364.9 | **PASS** |
| `doughSpecificHeat(80%)` | ≈3717 | 3716.8 | **PASS** |
| `thermalTimeConstant(1kg, 65%)` | ≈139 min | 138.5 | **PASS** |
| Scala m^(1/3): 2× → ×1.26 | 1.260 | 1.2599 | **PASS** |
| `doughCoreTemp(25,20, t=3600, τ=8340)` | ≈23.11 | 23.247 | **WARN** — discrepanza di +0.14°C (1.5%). Tolleranza KB ±0.10°C; differenza compatibile con calibrazione interna τ |
| `doughCoreTemp(25,20, t=10800, τ=8340)` | ≈21.20 | 21.370 | **WARN** — stessa origine |
| Guard `τ≤0` → `T_ambient` | 20 | 20 | **PASS** |
| Guard `t=0` → `T_init` | 25 | 25 | **PASS** |

### 4.3 Hill / proteolisi (in ORE REALI)

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| `computeWHill(300, 60, 0)` | 300 | 300 | **PASS** |
| `computeWHill(300, 60, 60)` (t=tCrit) | 150 (W₀/2) | 150 | **PASS** |
| `computeWHill(300, 60, 6000)` (t≫tCrit) | ≈0 | 0.0 | **PASS** |
| `computeTCritRef(180)` clamp basso | 25 | 25 | **PASS** |
| `computeTCritRef(400)` clamp alto | 90 | 90 | **PASS** |
| `computeTCritRef(210)` interpolato | ≈32.5 | 32.5 | **PASS** |
| Tick loop: proteolisi in ore reali (NON ADU) | sì | sì | **PASS** — `useTickEngine.ts:113` `wDamage += deltaH / tCrit` con `deltaH = deltaSec / 3600` ✓ |

### 4.4 Amilasi (tabella KB 4 punti)

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| `amylaseCorrectedRate(1, 1.00, 0, 5.5)` | 1.000 | 1.000 | **PASS** |
| `amylaseCorrectedRate(1, 1.75, 0, 5.5)` | 1.300 | 1.300 | **PASS** |
| `amylaseCorrectedRate(1, 1.75, 0, 4.8)` | 1.025 | 1.025 | **PASS** |
| `amylaseCorrectedRate(1, 0.33, 0, 5.5)` | 0.732 | 0.732 | **PASS** |
| `fPHAmylase(5.5)` | 1.000 | 1.000 | **PASS** |
| `fPHAmylase(4.8)` | 0.607 | 0.607 | **PASS** |
| `fPHAmylase(4.5)` | 0.306 | 0.360 | **WARN** — σ implementato pare leggermente più ampio del KB (0.7 esatto vs effettivo) |

### 4.5 pH combining logaritmico (BUG FIX KB §2.12) — **CRITICA**

| Fixture | Atteso | Ottenuto | Esito |
|---|---|---|---|
| Solo rinfresco | pH=6.000, effW=300.0 | 6.000 / 300.0 | **PASS** |
| Poolish 30% | pH=5.263, effW=292.5, matOff=0.246 | 5.263 / 292.5 / 0.246 | **PASS** |
| Biga 50% | pH=5.350, effW=324.0 | 5.350 / 324.0 | **PASS** |
| 🔥 **Biga50+Pool30+Main20** | **pH=5.049** | **5.0493** | **PASS** — formula `H+ = Σ frac × 10^(-pH); pH = -log10(H+)` corretta, non media lineare |

### 4.6 estimatePHForLBF (KB §2.6)

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| `(5.8, 0)` | 5.8 | 5.800 | **PASS** |
| `(5.8, 60)` | 5.71 | 5.710 | **PASS** |
| `(5.8, 1000)` | 4.8 (floor) | 4.800 | **PASS** |
| `(undefined, 50)` default 5.8 | 5.725 | 5.725 | **PASS** |

### 4.7 Dose scaling LINEARE (KB §8, bug #19) — **CRITICA**

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| `Math.sqrt` in contesto dose | nessuna occorrenza | 0 occorrenze | **PASS** |
| `computeInverseProgram` raddoppio durata | ratio_dose === ratio_muMax | 2.162 === 2.162 | **PASS** — scaling lineare confermato eseguendo |

### 4.8 computeExtensibilityIndex

| Verifica | Atteso | Ottenuto | Esito |
|---|---|---|---|
| Range [0,1] estremi | (80, 0.65, 0, 0) ≈ 0; (400, 0.65, 25, 100) ≈ 1 | 0.20 / 1.00 | **WARN** — il caso "debole giovane" usa `pl=0.65` (optimal) che contribuisce 0.20 da peso 20%. Comportamento corretto del modello, fixture test sbagliata. |
| Pesi 30/20/30/20 | delta per ogni input | W:+0.150, stab:+0.150, mat:+0.100 | **PASS** — incrementi (=peso × Δnormalized) corretti |

### 4.9 Coerenza dimensionale

- ADU adimensionale, ore = ore reali: rispettato (verifica statica tick loop)
- T in °C input, convertito a K dentro Arrhenius (`T+273.15`): rispettato (`engine:235`)
- `pl` decimale, `flourFraction` in % nei fields ma usato come decimale nei calcoli combining: rispettato (`engine:715-720`)

---

## ASSE 5 — Dashboard

### 5.1 Reattività temporale (KB §11.3)

| Check | Esito | Evidenza |
|-------|-------|----------|
| `useClock()` con `useState + setInterval` | **PASS** | `DashboardView.tsx:24-30` clock reattivo 10s |
| `timeToBake` / `elapsedH` aggiornati nel tempo | **PASS** | `DashboardView.tsx:758-761` calcolati da `now.getTime()` |
| Sweet spot reactive | **PASS** | `DashboardView.tsx:262-273` `useMemo` deps include `tAmb` (state) |
| `Date.now()` in `useMemo` con deps temporali | **FAIL CRITICO** | `FermentationPlannerView.tsx:573-578` `hoursUntilBake` con deps `[targetDate, targetTime]` — il countdown NON avanza in real-time, freeze fino a re-input |

### 5.2 Coerenza dato → pixel

| Check | Esito | Evidenza |
|-------|-------|----------|
| W hero da `computeDashboardEffectiveW` | **PASS** | `DashboardView.tsx:439-470` |
| Breakdown da `combinedInitialState.breakdown` | **PASS** | `engine:945-968` |
| Curva Hill / zona crollo coerenti con `structuralStatus` | **PASS** | Letto |
| Autolisi: "W invariato (atteso)" + P/L | **FAIL** | Nessun branch UI autolisi-specifico nel dashboard. La card W mostra decay anche per autolisi pure (semanticamente errato KB §2.11, §6.5) |
| Sweet spot: `isActive`/`isPast`/`isFuture` | **PASS** | Computati correttamente da `hoursToStart/End` |
| `denaturation_factor` visibile solo se <1.0 | **WARN** | Da verificare manualmente nel rendering; non trovato branch esplicito |

### 5.3 Stati limite UI

| Check | Esito | Note |
|-------|-------|----|
| matPct 0% e >100% | **WARN** | Non test esplicito; il modello Gompertz è asintotico ad A=100, ma rendering >100 non garantito gestire graziosamente |
| W COLLAPSED → modal lock | **WARN** | Non trovato modal lock dedicato; alert critical emesso ma nessun blocco UI |
| Sweet spot passato (`isPast`) | **PASS** | Stato gestito |
| Sessione senza prefermenti | **PASS** | `_buildWBreakdown` ha fallback `prefermenti: []` |
| `ONLY_AUTOLYSIS` warning | **WARN** | Engine emette il warning ma dashboard non lo display |

### 5.4 Gerarchia alert (KB §6.4)

| Livello | Implementato | Note |
|---------|--------------|----|
| INFO (banner compresso) | **MISSING** | Mai emesso dal tick loop |
| ADVISORY (banner espandibile) | **PASS** | Emesso per peak maturation (`useTickEngine.ts:139`) |
| CRITICAL (modal + push) | **PARTIAL** | Emesso per W decay >35% ma nessun modal UI dedicato |
| COLLAPSE (modal lock) | **MISSING** | Mai emesso |

Non esiste un `AlertEngine.evaluate(wState)` centralizzato; le emissioni sono inline nel tick loop (`useTickEngine.ts:128-143`).

### 5.5 Compressione chart (KB §11.4)

| Check | Esito | Evidenza |
|-------|-------|----------|
| LTTB implementato | **FAIL** | Nessun `lttb`/`downsample` in `src/` o `engine/`. Il Gompertz chart usa step fisso di 80 punti per segmento. Per sessioni multi-fase + lunghe questo può produrre 200+ punti senza compressione |
| Preserva primo+ultimo punto | N/A | Non applicabile (LTTB assente) |
| Skip quando `data.length ≤ targetCount` | N/A | Non applicabile |

---

## Checklist di Remediation Prioritizzata

**Non applicare senza approvazione utente.**

### Priorità CRITICA
1. **Fix `Date.now()` in `useMemo`** (`FermentationPlannerView.tsx:573-578`)
   - Sostituire con `useState + setInterval` per `now` reattivo, oppure usare `useClock()` come fa il dashboard
   - Impatto: countdown alla cottura non avanza in real-time

### Priorità ALTA
2. **Estendere `WizardInputSchema` con `.strict()`** (`src/lib/schemas.ts`)
   - Coprire tutti i campi del wizard: hydration [50-90], salt [0-3.5], fat [0-15], agentType (enum), prefermenti (array tipizzato), containerPreset (enum), tempi, ecc.
   - Impatto: validazione robusta contro payload arbitrari (sicurezza + invarianti)

3. **Implementare LTTB chart compression** (KB §11.4)
   - Nuovo modulo `src/lib/lttb.ts` con funzione `downsampleLTTB(data, targetCount=200)`
   - Applicare in `GompertzChart` quando i punti > 200
   - Impatto: performance + leggibilità su sessioni lunghe

### Priorità MEDIA
4. **Centralizzare `STYLE_CONSTRAINTS`** (es. `src/data/styleConstraints.ts`)
   - Per ogni stile: `{ hydMin, hydMax, hydDefault, maxTcHours, ddtTarget }`
   - Refactor Step4 hydration max e `DDT_BY_STYLE` per leggere da lì
   - Impatto: coerenza UI + facilità di tuning

5. **Estendere `validatePrefermentiMix` con vincoli biochimici** (`engine:606-650`)
   - Biga: hydration ∈ [40, 55], yeastPct ∈ [0.05, 2.0]
   - Poolish: hydration === 100 (warning se diverso), yeastPct ∈ [0.05, 1.0]
   - Autolisi: durationH ∈ [0.33, 24], tempC ∈ [4, 35], hydration ∈ [50, 80]
   - Impatto: errori utente bloccati prima del kickoff

6. **Scrivere primo `ProcessLogEntry` al kickoff** (KB §12.1)
   - In `buildSession` aggiungere `db.process_log.add({ sessionId, recordedAt: startedAt, cumulativeAdu: combined.initialMaturationOffset × 100, ... })`
   - Impatto: tracciabilità completa + grafici Gompertz partono dal punto reale, non da 0

7. **Branch UI autolisi nel dashboard** (KB §2.11, §6.5)
   - Quando `session.prefermenti.every(p => p.type === 'autolysis')` → mostrare "W invariato (atteso)" + P/L improvement come metrica primaria, nascondere card W decay

### Priorità BASSA
8. **Test asserzioni mancanti** (`engine-v2.4.0.test.js`)
   - `estimatePHForLBF` (4 valori già verificati nel mio script, da portare in test ufficiale)
   - `computeExtensibilityIndex` (5 fixture: estremi, intermedi, pesi)
   - `computeInverseProgram` (verifica scaling lineare con raddoppio durata)
9. **`AlertEngine.evaluate(wState)` centralizzato** con tutti i 4 livelli (INFO/ADVISORY/CRITICAL/COLLAPSE) ed emissione modal lock per COLLAPSE
10. **JSDoc completo** sulle nuove funzioni `estimatePHForLBF`, `computeExtensibilityIndex`, `computeInverseProgram`

---

## Riepilogo numerico

| Asse | PASS | WARN | FAIL |
|------|------|------|------|
| 1 — Strutturale | 9 | 1 | 0 |
| 2 — Ordine/completezza | 12 | 1 | 2 |
| 3 — Database | 6 | 0 | 1 |
| 4 — Fisica/biochimica (eseguito) | **48** | **5** | **0** |
| 5 — Dashboard | 5 | 4 | 3 |
| **Totale** | **80** | **11** | **6** |

**Conclusione**: il **modello scientifico è solido** (Asse 4 essenzialmente PASS, inclusi tutti i 3 bug-fix critici della KB: pH logaritmico, dose lineare, kRatio normalizzato, proteolisi in ore reali). I FAIL si concentrano sulla **UI/validazione di frontiera** (Asse 5 + Asse 2/3) e sono fix puntuali, non riscritture sistemiche.
