# PizzaMatrix v2.4.25

Motore di calcolo predittivo per la fermentazione dell'impasto pizza.
React + Vite + Dexie + Recharts + Capacitor Android.

> **Questo file è la sorgente unica di verità (KB) per tutti i parametri fisici,
> costanti del modello e invarianti architetturali. Aggiornato ad ogni release.**

---

## Indice

1. [Invarianti architetturali (da NON violare)](#invarianti)
2. [Two-Clock §2.0 — Doppio Orologio Fermentativo](#two-clock)
3. [Modello Attrito Meccanico Unificato §2.7 — v2.4.24](#attrito-unificato)
4. [Calcolo Temperatura Acqua (DDT) §2.7](#ddt)
5. [Sostituzione Ghiaccio — Bilancio Entalpico](#ghiaccio)
6. [Engine Physics v2.4.0](#physics)
7. [Modello Cottura §2.8 — v2.4.18/21/22](#cottura)
8. [Fasi Canoniche §2.9 — v2.4.20](#fasi)
9. [Collasso Strutturale §2.10 — v2.4.23](#collasso)
10. [Profilo Qualità — Solver inverso](#qualita)
11. [Architettura file](#architettura)
12. [Changelog sintetico v2.4.17 → v2.4.24](#changelog)

---

## 1. Invarianti architetturali {#invarianti}

> Vincoli assoluti: nessun commit li può violare senza una revisione esplicita del KB.

| Invariante | Regola |
|------------|--------|
| **Two-Clock §2.0** | `enzAdu` alimentato solo da `fArrhenius(T)` (clock proteolitico). `leavAdu` alimentato solo da `kEffective(T)` Gompertz (clock lievito). I due clock NON si mescolano mai. |
| **Friction §2.7** | Il modulo attrito (`friction-v2.4.24.js`) NON legge né scrive `enzAdu` o `leavAdu`. Alimenta solo il calcolo DDT e il display T_uscita. |
| **simulateTimeline** | `simulateTimeline`, tick loop, `plannerAlarmEngine`: zero modifiche strutturali senza verifica full test suite. |
| **Input utente immutabili** | `hydration`, `W`, `style`, `mixerType` sono dati utente. I moduli li leggono, MAI li sovrascrivono silenziosamente. Dove un reset è necessario (Autolisi → idr. pre-fermento 65% per Zod), è **advisory + undo** (v2.4.25, WP-5), non mutazione silenziosa. |
| **Gompertz/Hill/Arrhenius/CTM** | Costanti fisiche invariate: `muMax`, `lambda`, `Ea`, `W0`, `Hill n`. Modificabili solo con riferimento bibliografico esplicito. |
| **Dashboard v3.1** | `DashboardView.tsx` (v3.1): NON modificare. Il fix dashboard avviene a livello di `App.tsx`. |

---

## 2. Two-Clock §2.0 — Doppio Orologio Fermentativo {#two-clock}

PizzaMatrix modella **due processi biochimici indipendenti** che avanzano in parallelo:

### Clock 1 — Lievitazione (Yeast / Gompertz)
```
kEff(T) = exp[-Ea_y/R · (1/T − 1/Tref)] × γCTM(T)
ADU_liev += kEff(T) × Δt          // accumulato ad ogni tick
M_liev(ADU) = A · exp(-exp((μmax·e/A)·(λ−ADU)+1))  // Gompertz
```
- `Ea_y = 75 kJ/mol` (lievito di birra fresco)
- `μmax, λ` da `AGENT_GOMPERTZ[agentType]`
- Controlla lievitazione visibile, bollicine, volume

### Clock 2 — Maturazione Enzimatica (Proteolisi / fArrhenius)
```
kEnz(T) = exp[-Ea_e/R · (1/T − 1/Tref)]            // Arrhenius puro
ADU_enz += kEnz(T) × Δt           // accumulato ad ogni tick
M_enz(ADU) = Gompertz(ADU, μmax_e, λ_e)
```
- `ENZYMATIC_CLOCK_PARAMS = { muMax: 9.50, lambda: 0.50 }` (`engine-v2.4.0.js`)
- `Ea_e = 47 kJ/mol` (proteasi del glutine)
- Controlla maturazione, estensibilità, sapore
- Usato dal **solver Profilo Qualità** (`solveQualityProfile`)

**Regola**: `enzAdu` usa `fArrhenius`. `leavAdu` usa `kEffective`. Non intercambiabili.

---

## 3. Modello Attrito Meccanico Unificato §2.7 — v2.4.24 {#attrito-unificato}

### Sorgente unica di verità: `engine/friction-v2.4.24.js`

Sostituisce i coefficienti fissi `KNEADING_METHODS_FRICTION.cFrictionLo/Hi` con un
modello **duration-aware, mixer-aware, consistency-aware**, calibrato su misure reali.

### Funzione principale

```js
computeFrictionRise(mixer, durationMin, hydrationEff, massKg) → ΔT [°C sopra media-N]
```

| Parametro | Descrizione |
|-----------|-------------|
| `mixer` | `'spiral' | 'fork' | 'planetary' | 'diving_arm' | 'hand'` |
| `durationMin` | Durata impastamento [min] |
| `hydrationEff` | Idratazione efficace al momento dell'impasto [%] (→ `computeEffectiveMixHydration`) |
| `massKg` | Massa impasto totale [kg] |

### Modello strutturale (non calibrato)

```
ΔT_struct = baseRate[mixer] × (durationMin/10) × f_hyd(H_eff) × f_mass(massKg)
```

- `f_hyd = clamp(1 + k_H × (65 − H_eff), 0.80, 1.30)` con `k_H = 0.0075`
- `f_mass = clamp((massKg / 1.0)^0.15, 0.85, 1.35)` — esponente debole, hypothesis

### Tassi base `baseRatePer10min` [°C/10min @ 1kg, H_eff=65%]

| Mixer | Tasso base |
|-------|:----------:|
| Spirale | **3.8°C** |
| Forcella (fork) | 2.5°C |
| Planetaria | 7.5°C |
| Bracci tuffanti | 3.2°C |
| A mano | 1.2°C |

### Calibrazione

```js
frictionCalib[mixer]  // null → fit automatico dagli anchor misurati
fitFrictionCalib(mixer) = media(ΔT_measured / ΔT_struct) sugli anchor
computeFrictionRise = frictionRiseStructural × calib
```

### Anchor di calibrazione misurati

| id | mixer | durationMin | T_uscita_misurata | H_eff | massKg | status |
|----|-------|:-----------:|:-----------------:|:-----:|:------:|--------|
| `pasquale_biga_contemporanea_2026` | spiral | 14 | 32°C | 70% | 1.0 | `measured` |

> **Estendere `FRICTION_CALIBRATION_ANCHORS`** con nuove misure senza toccare il codice:
> il fit si aggiorna automaticamente.

### Funzioni ausiliarie

```js
// H_eff per impasti con prefermenti
computeEffectiveMixHydration(session)
  // H_eff = Σ(frac_i × H_pref_i) + frac_rinfresco × H_finale
  // Diretto → H_eff = H_finale; Biga 50% → abbassa H_eff (più attrito)

// T uscita impasto prevista [°C]
predictDoughExitTemp(avgNeffective, mixer, durationMin, hydrationEff, massKg)
  // = avgN + computeFrictionRise(...)
```

### Warning T_uscita

- `exitWarnC = 27°C` — T_uscita > 27°C → warning glutine slegato (`exitWarning: true`)
- `minLiquidWaterC = 4°C` — acqua richiesta < 4°C → ramo ghiaccio
- `defaultTapWaterC = 15°C` — fallback se `tapWaterC` non disponibile

### Legacy `KNEADING_METHODS_FRICTION` (retrocompatibilità)

Ancora esportata per gli slider dell'UI (`label`, `notes`). I valori `cFrictionLo/Hi`
sono sovrascritti dal modello unificato in tutti i calcoli DDT dall'engine.

---

## 4. Calcolo Temperatura Acqua (DDT) §2.7 {#ddt}

### `computeWaterTempDDT(input: WaterTempInput): WaterTempResult`

#### Dual-path da v2.4.24

| Condizione | Path | C_attrito usato |
|------------|------|-----------------|
| `kneadDurationMin > 0` | **UNIFIED** | `computeFrictionRise(mixer, durationMin, H_eff, massKg)` |
| `kneadDurationMin` assente / 0 | **LEGACY** | `KNEADING_METHODS_FRICTION[mixer].cFrictionMid` |

#### Input (`WaterTempInput`)

```ts
{
  ddtTarget:       number;        // DDT stile [°C]
  tempAmbient:     number;        // T_ambiente [°C]
  kneadingMethod:  KneadingMethod;
  waterTotalGrams: number;        // grammi acqua totali nella ricetta
  tempPreferment?: number;        // T_preimpasto [°C] — abilita formula 4-fattori
  // v2.4.24 — unified path:
  kneadDurationMin?: number;      // durata impasto [min] — attiva unified path
  hydrationEff?:    number;       // H_eff [%] (usare computeEffectiveMixHydration)
  doughMassKg?:     number;       // massa impasto [kg]
  tapWaterC?:       number;       // T acqua rubinetto [°C] — per ghiaccio
}
```

#### Output (`WaterTempResult`)

```ts
{
  mode:           'liquid' | 'ice' | 'unreachable';
  // liquid: acqua a temperatura positiva
  // ice:    serve ghiaccio (T_calc < ICE_THRESHOLD_C=3°C)
  // unreachable: ghiaccio necessario > acqua totale disponibile
  requiredWaterTempC?: number;    // T acqua calcolata [°C]
  iceNeeded?:      number;        // [g] ghiaccio (solo mode=ice)
  liquidNeeded?:   number;        // [g] acqua liquida
  cFriction:       number;        // C_attrito effettivo usato [°C]
  frictionModel?:  'unified' | 'legacy';
  frictionRiseC?:  number;        // ΔT attrito [°C] (solo unified)
  exitTempC?:      number;        // T_uscita impasto prevista [°C]
  exitWarning?:    boolean;       // true se exitTempC > 27°C
  levers?:         string[];      // suggerimenti operativi (solo unreachable)
  nFactors:        number;        // 3 (diretto) o 4 (con preimpasto)
}
```

#### Formule

```
Impasto diretto (nFactors=3):
  T_acqua = DDT × 3 − T_ambiente − T_farina − C_attrito

Impasto indiretto (nFactors=4, tempPreferment fornito):
  T_acqua = DDT × 4 − T_ambiente − T_farina − T_preimpasto − C_attrito

T_uscita = avgN + ΔT_attrito
  dove avgN = (T_amb + T_farina + [T_pref]) / nFactors_non_attrito
```

#### DDT consigliati per stile

| Stile | DDT target |
|-------|:----------:|
| Napoletana | 24°C |
| Contemporanea | 25°C |
| Teglia | 27°C |
| Pala | 26°C |
| NY Style | 23°C |

---

## 5. Sostituzione Ghiaccio — Bilancio Entalpico {#ghiaccio}

Se `T_acqua_calc < 3°C` (soglia `ICE_THRESHOLD_C = 3`): modalità ghiaccio.

```
M_ghiaccio = M_acqua_tot × (T_disponibile − T_acqua_calc) / (80 + T_disponibile)
M_liquida  = M_acqua_tot − M_ghiaccio
```

Se `M_ghiaccio > M_acqua_tot`: **mode = `'unreachable'`** — fisicamente impossibile
anche con tutto ghiaccio. L'UI mostra leve operative (`levers[]`).

- `T_disponibile` = `tapWaterC ?? 15°C`
- `80 cal/g` = calore latente fusione ghiaccio (L_fusione ≈ 334 J/g)

---

## 6. Engine Physics v2.4.0 {#physics}

| Modulo | Formula | Costanti chiave |
|--------|---------|-----------------|
| **Maturazione** | Gompertz-Zwietering: `M(ADU) = A·exp(-exp((μmax·e/A)·(λ−ADU)+1))` | `A=100`, `muMax`, `lambda` da `AGENT_GOMPERTZ` |
| **Lievito** | CTM Rosso (1993) × Arrhenius: `kEff(T) = exp[-Ea/R·(1/T−1/Tref)] × γCTM(T)` | `Ea=75 kJ/mol` (LBF) |
| **Inerzia termica** | Newton Cooling: `T(t) = T_amb + (T0−T_amb)·exp(-t/τ)` | `τ` da `thermalTimeConstantSphere` |
| **Proteolisi W** | Hill W-decay: `W(t) = W0/(1+D^n)`, `D = Σ(ΔH/tCrit)` | `n=2`, `tCrit` stile-dipendente |
| **Temperatura acqua** | DDT Balance (§2.7) | Dual-path v2.4.24 |
| **Ghiaccio** | Enthalpy: `M_g = M_acq × (T_av−T_calc) / (80+T_av)` | `L=80 cal/g` |
| **Clock enzimatico** | Arrhenius puro: `kEnz(T) = exp[-47/R·(1/T−1/Tref)]` | `Ea_e=47 kJ/mol`, `ENZYMATIC_CLOCK_PARAMS={muMax:9.50, lambda:0.50}` |

### AGENT_GOMPERTZ — Parametri per tipo agente

| Agente | Ea [kJ/mol] | muMax | lambda |
|--------|:-----------:|:-----:|:------:|
| `fresh_yeast` | 75 | 4.20 | 0.50 |
| `instant_dry_yeast` | 75 | 3.90 | 0.60 |
| `sourdough_wheat` | 55 | 2.80 | 1.20 |

---

## 7. Modello Cottura §2.8 — v2.4.18/21/22 {#cottura}

### BakeView — Configurazione forno

Validatore termodinamico: controlla compatibilità `(stile, hardware_forno)` e
genera advisory in tempo reale su:
- Temperatura forno vs range stile (`temp_forno_range`)
- Tempo cottura previsto (`bakeTimeS`) dipendente da temperatura (v2.4.22)
- Effusività superficie (`effusività_attiva`) per crosta e fondo

### `bakeTimeS(T_forno, style)` — v2.4.22

Interpolazione monotona su `[T_min, T_max]` → `[bakeTime_max, bakeTime_min]`.
Evita salti discontinui al variare della temperatura del forno.

### T impasto — Curva esponenziale reale (v2.4.21)

```
T_dough(t) = T_forno + (T_dough0 − T_forno) × exp(-t / τ_cottura)
```

Warning "cottura a freddo" se `T_dough0 < T_soglia_stile` all'avvio.

---

## 8. Fasi Canoniche §2.9 — v2.4.20 {#fasi}

### Ordine canonico (forward-only)

```ts
PHASE_ORDER = ['bulk_room', 'bulk_fridge', 'balled_room', 'balled_fridge', 'proofing', 'baking']
```

- Transizioni **solo forward** — il tap su una fase passata è bloccato (Bug #94, v2.4.19)
- `baking` è terminale: nessuna transizione ulteriore
- `simulateTimeline` usa le fasi canoniche per costruire la timeline termica uniforme (v2.4.20)

### Timeline uniforme (v2.4.20)

Prima di v2.4.20: la timeline aveva segmenti di durata variabile, causando
artefatti grafici nel GompertzChart. Ora ogni segmento è di durata costante
normalizzata — la curva realizzata/proiettata è continua.

### Marker mostrati sulla strip (`deriveCanonicalPhases`, `canonicalPhases.ts`)

`deriveCanonicalPhases` è la sorgente unica per chip header, strip orizzontale e
header grafico. Sempre PUNTATA → STAGLIO → APPRETTO → COTTURA, più un marker
condizionale **USCITA FRIGO**:

| Marker | Confine | Glifo | Presente quando |
|--------|---------|:-----:|-----------------|
| PUNTATA | span bulk | ● | sempre |
| STAGLIO | bulk → balled | ● | sempre (in TC puntata = uscita frigo `bulk_fridge → balled_room`) |
| APPRETTO | span balled/proofing | ● | sempre |
| **USCITA FRIGO** | `balled_fridge → proofing` | ● | **solo appretto TC con `temperingH > 0`** (v2.4.25 WP-6) |
| COTTURA | fine timeline | ★ | sempre (★ esclusiva cottura) |

- **USCITA FRIGO** (era "TEMPERING") = marker puntuale all'orario `cottura − temperingH`,
  tappabile forward-only (`transitionTo: 'proofing'` → `CONFIRM_PHASE_TRANSITION`),
  badge countdown "tra Xh Ym" se ≤ 4h. In **TC puntata** l'uscita frigo coincide con lo
  STAGLIO (nessun doppione). Con `temperingH === 0` non viene emesso (warning "cottura a
  freddo" v2.4.21 copre quel rischio).

---

## 9. Collasso Strutturale §2.10 — v2.4.23 {#collasso}

### Modello ETA-collasso

```
W_current(t) = W0 × (1 − decay_pct(t)/100)
COLLAPSED quando W_current < W_minimo_stesura[style]
```

Il dashboard mostra un **ETA di collasso** (ore rimanenti al COLLAPSED) calcolato
invertendo la Hill W-decay. Se `COLLAPSED`, la sessione viene terminata con warning.

### Soglie strutturali per stile

| Stile | W_minimo_stesura |
|-------|:----------------:|
| Napoletana | 160 |
| Contemporanea | 190 |
| Teglia | 140 |
| Pala | 180 |
| NY Style | 220 |

### Alert semaforo

| Stato | Condizione |
|-------|------------|
| `OK` | `W_current > W_minimo + margine` |
| `WARNING` | Avvicinamento a soglia |
| `CRITICAL` | `W_current` prossimo a `W_minimo_stesura` |
| `COLLAPSED` | `W_current ≤ W_minimo_stesura` |

---

## 10. Profilo Qualità — Solver inverso {#qualita}

### `solveQualityProfile(targets, flour, style, tAmb, fridgeT, staglioH)`

Inverte il profilo sensoriale: dai target (1–5) ricava i parametri di protocollo.
Usa il **clock enzimatico** (NON Gompertz lievito) — Two-Clock invariante.

#### Input

| Param | Tipo | Note |
|-------|------|------|
| `targets.extTarget` | 1–5 | Estensibilità target |
| `targets.aromaTarget` | 1–5 | Aromi target (guida scelta prefermento) |
| `targets.sciTarget` | 1–5 | Scioglievolezza target |
| `flour.W` | number | Forza farina |
| `flour.pl` | number | P/L |
| `style` | string | Stile pizza (cap puntata) |
| `tAmb` | number | T_ambiente [°C] |
| `fridgeT` | number | T_frigo [°C] |
| `staglioH` | number | Staglio [h] — dall'utente, non hardcoded |

#### Mappe di inversione

```
Estensibilità → idratazione:  hydRef = 60 + (extTarget − 1) × 4  [55–76%]
Estensibilità → maturazione:  mFromExt = (extTarget − 0.5 − flourContr) / 3.0
Scioglievolezza → m_sci:      picco scioglievolezza a 87% maturazione (non monotona)
Aroma → prefermento:          aromaTarget ≥ 5 → Biga 50% 18h; ≥ 4 → Biga 30%; ≥ 3 → Poolish 20%
```

#### Calcolo puntataH — v2.4.24 (fix)

```
aduTarget  = invertGompertz_enz(mTarget × 100)
aduFridge  = fArrhenius(fridgeT) × tcHours
prefEnzAdu = fArrhenius(prefTempC) × prefDurH × (prefFrac / 100)  ← NUOVO v2.4.24
aduNeeded  = max(0.1, aduTarget − aduFridge − prefEnzAdu)         ← accredita biga/poolish
kAmbRate   = fArrhenius(tAmb)
puntataRaw = aduNeeded / kAmbRate
puntataH   = clamp(puntataRaw, styleProfile.puntataH_range_ta[0], styleProfile.puntataH_range_ta[1])
```

**Effetto**: Biga 50% a 16°C per 18h abbassa puntata da ~4.3h → ~2h (Contemporanea).
Il cap stile evita puntate irrealistiche quando i target del solver supererebbero il range.

#### Cap puntata per stile

| Stile | Range puntata TA [h] | Ottimale TA [h] |
|-------|:--------------------:|:---------------:|
| Napoletana | 1–4 | 2 |
| Contemporanea | 1–3 | 2 |
| Teglia | 2–3.5 | 2.5 |
| Pala | 1–2 | 1.5 |
| NY Style | 0.25–1 | 0.5 |

#### Idratazione — valore derivato

In modalità Qualità, `hydration` è un **output** del solver (derivato da `extTarget`),
non un input modificabile dall'utente. Il planner la mostra come `DerivedField` (read-only
ma "vivo": alto contrasto, pill ∑ « derivato da Estensibilità », micro-pulse al variare).

#### `breakdown` — output additivo per la UI (v2.4.25, WP-0)

`solveQualityProfile` ritorna anche un blocco `breakdown` (sola esposizione, nessuna nuova
fisica) con le variabili intermedie già calcolate, consumato da card credito e cap esplicito:

| Campo | Significato |
|-------|-------------|
| `aduTarget` / `aduFridge` / `prefEnzAdu` / `aduNeeded` | termini della sottrazione ADU enzimatica |
| `kAmbRate` | `fArrhenius(tAmb)` |
| `puntataRaw` | `aduNeeded / kAmbRate` (con credito enzimatico) |
| `puntataRawNoCredit` | `(aduTarget − aduFridge) / kAmbRate` (senza credito — per anim WP-2) |
| `puntataCapped` / `capped` | puntata dopo cap stile / flag se il cap ha agito (tol. 0.05h) |
| `rangeTa` | `STYLE_PROFILES[style].puntataH_range_ta` |
| `hydRef` | `60 + (extTarget − 1) × 4` |
| `prefermentoSuggested` | `{ type, fraction, durationH, tempC }` o `null` |

---

## 11. Architettura file {#architettura}

```
engine/
├── engine-v2.4.0.js            — Core: Gompertz, CTM, Arrhenius, Hill, STYLE_PROFILES
│   ├── AGENT_GOMPERTZ           — parametri per tipo agente lievitante
│   ├── ENZYMATIC_CLOCK_PARAMS   — {muMax:9.50, lambda:0.50, Ea:47}
│   ├── STYLE_PROFILES           — puntataH_range_ta, alertThreshold, bubbleThresholdPct...
│   ├── kEffective(T, Ea, agent) — k ratio lievito
│   ├── fArrhenius(T)            — k ratio enzimi (Ea=47)
│   ├── gompertz(ADU,...)        — curva maturazione
│   ├── findAduAt(...)           — inversione Gompertz
│   ├── getStyleProfile(style)   — profilo stile
│   └── simulateTimeline(...)    — timeline termica completa
└── friction-v2.4.24.js         — §2.7 modello attrito unificato (sorgente unica)
    ├── FRICTION_PARAMS          — baseRatePer10min, kHydration, massExponent...
    ├── FRICTION_CALIBRATION_ANCHORS — anchor misurati (estendibili)
    ├── frictionRiseStructural() — salita non calibrata
    ├── fitFrictionCalib(mixer)  — fit da anchor
    ├── computeFrictionRise()    — salita calibrata (SORGENTE UNICA)
    ├── computeEffectiveMixHydration(session) — H_eff con prefermenti
    └── predictDoughExitTemp()   — T_uscita impasto prevista

src/
├── engine/index.ts             — re-export + tipi TypeScript
│   ├── WaterTempInput/WaterTempResult (estesi v2.4.24)
│   ├── computeWaterTempDDT()   — dual-path unified/legacy
│   ├── PHASE_ORDER             — fasi canoniche forward-only
│   └── export * from friction-v2.4.24.js
├── components/
│   ├── wizard/WizardView.tsx   — Step 4: DDT + kneadDurationMin/tapWaterC
│   │                             Step 8: Riepilogo (honora draft.puntataH override)
│   ├── tools/WaterTempView.tsx — WaterTempResultCard: liquid/ice/unreachable
│   ├── tools/FermentationPlannerView.tsx
│   │   ├── solveQualityProfile() — solver inverso qualità (v2.4.24)
│   │   ├── computeAllProtocols() — 4 protocolli ta/tc/tc_puntata/tc_appreto
│   │   └── computeNowAnchoredAlarms() — finestra servizio
│   ├── bake/BakeView.tsx       — configurazione forno + advisory (v2.4.18)
│   └── dashboard/DashboardV4  — Gompertz chart, Monitor/Analisi, ETA collasso
├── context/AppContext.tsx      — WizardDraft incl. kneadDurationMin, tapWaterC
├── db/db.ts                    — Session incl. kneadDurationMin, tapWaterC
├── data/
│   ├── styleConstraints.ts     — ddtForStyle(style)
│   └── flourDatabase.ts        — FLOUR_DATABASE, getFlourBrands/ByBrand
└── engine/
    ├── plannerAlarmEngine.ts   — computeNowAnchoredAlarms, NowAnchoredAlarmResult
    └── serviceWindowSolver.ts  — SERVICE_WINDOW_DEFAULTS, solver finestra servizio
```

---

## 12. Changelog sintetico v2.4.17 → v2.4.25 {#changelog}

### v2.4.25 (corrente) — Consolidamento UX dei 5 rami condizionali del Wizard

Release di sola presentazione + **una** estensione additiva dell'output di
`solveQualityProfile` (layer componente). **Nessuna modifica** a engine fisico, Two-Clock,
attrito o solver. Ogni WP è un commit indipendente.

**Component Inventory (nuovi / modificati):**
- `src/components/ui/feedback.tsx` — primitive condivise: `useReducedMotion`, `Badge`,
  `Advisory` (banner dismissibile + undo), `AnimatedNumber` (rAF, reduced-motion safe),
  `CoverageBar`, `MassSplitBar`, `ExpandableReward`, helper `pulseElement`/`shakeElement`.
- `src/lib/haptics.ts` — `haptics(style)` feature-detected. `@capacitor/haptics` **opzionale**
  (import dinamico non-letterale → no build-fail se assente, no-op su web). NON è dipendenza.
- `src/components/wizard/PrefermentCreditCard.tsx` — Two-Clock visivo: riga 🟡 enzimatica
  (ore) + riga 🔵 termica (°C), mai barra/unità condivise.
- `WaterTempResultCard` — nuova prop `variant` ('interactive' | 'summary'), `MassSplitBar`
  per il ghiaccio, leve `unreachable` come chip (`leverConfig`, `onLever` opzionale), `role="alert"`.
- `FermentationPlannerView` — `DerivedField` (idratazione qualità), cap esplicito + credito
  prefermento nella `QualityProfileResultCard`.

**WP per ramo:**
- **WP-0**: `solveQualityProfile` ritorna `breakdown` (additivo, vedi §10).
- **WP-1**: campi derivati "vivi" in modalità Qualità; switch non distruttivo (lo slider
  idratazione non viene mai mutato in Qualità → i valori manuali si conservano).
- **WP-2**: `PrefermentCreditCard` — il "crollo" puntata 4.3h→2.0h ora animato e spiegato.
- **WP-3**: Step 4 DDT progressive disclosure — durata 0 = card T-uscita dormiente (legacy);
  durata > 0 = sblocco previsione `exitTempC` + badge unified/legacy + warning ambra > 27°C.
- **WP-4**: card acqua — `MassSplitBar` (ghiaccio), leve chip naviganti, variant summary.
- **WP-5**: (A) feedback tap fase bloccata (shake/flash + haptics + coachmark, nessun dispatch);
  (B) reset Autolisi advisory + undo (undo solo se valore precedente ∈ [50,80]);
  (C) override puntata Step 8 — badge "modificato manualmente" + teorico ghost ripristinabile.
- **WP-6** (addendum): marker **USCITA FRIGO** sulla strip Dashboard. Sola presentazione:
  in `canonicalPhases.ts` la fase condizionale `tempering` (key invariata) è ora etichettata
  "USCITA FRIGO" e resa marker puntuale (`isMarker: true`, `endMs = startMs`) al confine
  `balled_fridge → proofing` (= `cottura − temperingH`). Tappabilità/countdown/forward-only
  già esistenti. Nessun doppione in TC puntata, nessun marker se `temperingH === 0`.

**Frizioni risolte (bug log):** campi morti in Qualità · crollo puntata percepito come bug ·
reset Autolisi silenzioso · tap fase passata senza feedback · leve unreachable passive ·
switch unified/legacy DDT invisibile · marker uscita frigo assente per TC appretto (segmento
tempering già in `session.timeline` ma non etichettato come momento d'uscita) — confermato che
TC puntata non richiede marker dedicato (uscita frigo = staglio).

### v2.4.24

**Modello attrito meccanico unificato** (`engine/friction-v2.4.24.js`):
- `computeFrictionRise` come sorgente unica di verità per il calore di attrito
- Modello duration-aware (ΔT ∝ durationMin), mixer-aware (5 tipi), consistency-aware (H_eff, mass)
- Calibrazione empirica via `FRICTION_CALIBRATION_ANCHORS` (anchor estendibili senza toccare il codice)
- `computeWaterTempDDT` — dual-path: UNIFIED (con `kneadDurationMin`) vs LEGACY
- `WaterTempResult.mode`: `'liquid' | 'ice' | 'unreachable'` — caso unreachable con leve operative
- `exitTempC`, `exitWarning` (soglia 27°C), `frictionRiseC` nel risultato DDT
- Wizard Step 4: nuovi input `kneadDurationMin` [min] e `tapWaterC` [°C]
- Wizard Step 8 DDT: usa unified path con H_eff e doughMassKg
- `WaterTempView`: gestisce i 3 mode con metriche e warning

**Quality solver overhaul**:
- `solveQualityProfile` riceve `staglioH` (era hardcoded 0.5h)
- Sottrae ADU enzimatico prefermento da `aduNeeded` (biga 50% → puntata ~2h vs ~4.3h pre-fix)
- Cap puntata a `STYLE_PROFILES[style].puntataH_range_ta` — rispetta linee guida stile
- C_attrito display: mostra `computeFrictionRise(mixer, 12, hydration, massKg)` (unificato)
- DDT card visibile anche in modalità Qualità con unified params
- Idratazione: read-only derivata da `extTarget` in modalità Qualità
- Fix riepilogo Step 8: `puntataH` display honora `draft.puntataH` override (era sempre `puntataHStep8`)
- Fix autolisi: type-change handler resetta `hydration: 65` (era 100% da poolish → errore Zod)
- Fix scroll-to-top: `useLayoutEffect + scrollRef` per div interno wizard; `window.scrollTo(0,0)` in `AppRouter`

### v2.4.23

- Collasso strutturale da sovra-lievitazione: ETA di collasso, stato `COLLAPSED`
- Dashboard v4: `GompertzChartV4` con split realizzato/proiettato ora-corrente
- Dashboard v4: toggle Monitor/Analisi, metriche caption semaforo (R5, R6)
- Fix sistemici accessibilità e UX (R1–R4, R7, R8, R10): WCAG AA, touch targets 44px, performance

### v2.4.22

- `bakeTimeS(T, style)`: dipendente da temperatura, interpolazione monotona
- Evita discontinuità al variare di `T_forno`

### v2.4.21

- T impasto curva esponenziale reale durante cottura (Newton cooling verso T_forno)
- Warning "cottura a freddo" se T_dough0 sotto soglia stile
- Raccomandazione cottura con effusività superficie attiva
- Fix blocco silenzioso wizard passo 7 (stato non terminale)

### v2.4.20

- Fasi canoniche `PHASE_ORDER` (forward-only, `baking` terminale)
- Timeline uniforme: segmenti durata costante normalizzata per GompertzChart
- Web Worker per il solver (infrastruttura performance)

### v2.4.19

- Phase gate: tap su fase passata bloccato (Bug #94)
- W-decay anchor recalibrazione (range Hill adattivo a sessione, Bug #95)
- ProcessLog two-clock: storico sessione persistente su Dexie

### v2.4.18

- BakeView: configurazione forno + advisory cottura UI
- Validatore termodinamico `stile × hardware_forno`

### v2.4.17

- Parità sale `solver ↔ tick` (§2.14.2 chiuso)
- Fix #1–#10 post code-review (type safety, guardie numeriche, geometria unificata)

---

*Generato da Claude Code — aggiornato a v2.4.24, 2026-06-14.*
