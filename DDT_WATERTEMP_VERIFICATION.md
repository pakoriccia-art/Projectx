# DDT_WATERTEMP_VERIFICATION — PizzaMatrix v2.4.0

**Data**: 2026-05-28  
**Branch**: `claude/pizzamatrix-engine-v2-4-0-xEhVU`  
**Prompt di riferimento**: `CLAUDE_CODE_PROMPT_VERIFICA_DDT.md`  
**Modifiche al codice**: NESSUNA — solo verifica e report.

---

## Verdetto sintetico

> **La temperatura iniziale dell'impasto NON è seminata correttamente al DDT.**
>
> Il motore inizializza `T_dough(t=0) = tLaboratorio ?? 22°C` (temperatura ambiente), non il DDT calcolato (~25°C).
> L'acqua calda consigliata dal wizard (es. 33.5°C) è matematicamente corretta, ma il motore di simulazione
> la ignora completamente: al primo tick l'impasto è già a temperatura ambiente e il decadimento Newton
> è piatto (T_init = T_ambient → esponenziale = 0 per ogni t).
>
> **Causa**: `useTickEngine.ts:55` — `const prevTDough = ts?.tempDough ?? 22` — seeding ambientale, caso B.
>
> Questa è l'incoerenza centrale: la formula dell'acqua calcola T_acqua per portare l'impasto a DDT,
> ma la simulazione parte già all'ambiente come se quell'acqua non fosse mai stata usata.

---

## Tabella verifiche

| # | Check | Esito | Atteso | Ottenuto | file:riga | Severità |
|---|-------|-------|--------|----------|-----------|----------|
| V1a | Formula acqua straight dough: usa ×3 | PASS | `3×DDT − T_amb − T_farina − C_attrito` | `ddtTarget*3 − tempAmbient − tempFlour − cFriction` | `src/engine/index.ts:300–302` | — |
| V1b | Formula acqua con prefermento: usa ×4 | PASS | `4×DDT − T_amb − T_farina − T_pref − C_attrito` | `ddtTarget*4 − tempAmbient − tempFlour − tempPreferment − cFriction` | `src/engine/index.ts:297,300–302` | — |
| V1c | Attrito sottratto una sola volta | PASS | `−C_attrito` (singolo) | `− cFriction` (singolo) | `src/engine/index.ts:301–302` | — |
| V1d | Funzione legacy `computeWaterTemp` usa ×3 anche con prefermenti | WARN | ×4 con prefermenti | Sempre ×3, nessun branch | `engine/engine-v2.4.0.js:902–907` | BASSA (non è il path attivo nell'UI React) |
| V2a | DDT da `STYLE_CONSTRAINTS` (non hardcoded) | PASS | Costante centralizzata | `DDT_BY_STYLE` derivato da `STYLE_CONSTRAINTS` | `src/components/wizard/WizardView.tsx:26–27` | — |
| V2b | Valori `ddtTarget` concordi con KB §7.1 | FAIL | nap:23 cont:23 teg:24 pala:23 nys:24 | nap:**24** cont:**25** teg:**27** pala:**26** nys:23 | `src/data/styleConstraints.ts:35,44,53,62,71` | MEDIA |
| V2c | DDT=25 nello screenshot spiegato | PASS | Stile "contemporanea" → ddtTarget=25 | Confermato: `STYLE_CONSTRAINTS.contemporanea.ddtTarget = 25` | `src/data/styleConstraints.ts:44` | — |
| V3a | Seeding `T_init` impasto = DDT (≈25°C) | **FAIL** | DDT (~25°C) — caso A | `ts?.tempDough ?? 22` → **22°C** al primo tick — **caso B** | `src/hooks/useTickEngine.ts:55` | **CRITICA** |
| V3b | `ProcessLogEntry[0].tempDough` = DDT | **FAIL** | DDT (~25°C) | `session.tLaboratorio ?? 22` → 22°C | `src/services/sessionService.ts:26` | **CRITICA** |
| V3c | Newton cooling converge DA DDT VERSO ambiente | **FAIL** | `T(t) = 22 + 3·exp(−t/8340)` → da 25°C a 22°C | `T(t) = 22 + 0·exp(−t/8340) = 22` (piatto) | `src/hooks/useTickEngine.ts:55,66` | **CRITICA** |
| V4a | Dashboard mostra `tempDough` iniziale | PASS | Campo `ts.tempDough` | `(ts?.tempDough ?? 22).toFixed(1)` | `src/components/dashboard/DashboardView.tsx:520` | — |
| V4b | Causa "parte da 22°": display vs modello | — | — | **Modello** (seeding sbagliato) — la dashboard legge il campo corretto ma il campo vale 22°C | `src/hooks/useTickEngine.ts:55` | CRITICA (via V3) |
| V5a | `mixingMinutes` propagato a `computeWaterTempDDT` | FAIL | `mixingMinutes` → formula attrito | Non propagato: UI usa `cFrictionMid` fisso (no input tempo) | `src/engine/index.ts:279–315` | MEDIA |
| V5b | `f_time` nel motore legacy: saturante o lineare? | FAIL | Saturante (asintotico) | **Lineare**: `fTime = mixingMinutes / 10` | `engine/engine-v2.4.0.js:893` | ALTA (legacy engine) |
| V5c | ΔT_friction a 30 min planetaria (1kg, 65%) | WARN | ≤10°C | **22.5°C** → T_water=9.5°C (borderline ICE_REQUIRED) | `engine/engine-v2.4.0.js:890–896` | ALTA (legacy) |
| V5d | ΔT_friction a 45 min planetaria (1kg, 65%) | FAIL | ≤15°C | **33.75°C** → T_water=**−1.75°C** → ICE_REQUIRED spurio | `engine/engine-v2.4.0.js:890–896` | ALTA (legacy) |
| V5e | `f_time = 1.0` a 10 min | PASS | 1.0 | `10/10 = 1.0` ✓ | `engine/engine-v2.4.0.js:893` | — |
| V6a | Formula pesata su calori specifici (CP) | WARN | Ponderazione CP_WATER / CP_FLOUR_DRY | Non usata: formula euristica N×DDT | `src/engine/index.ts:279–315` | BASSA |
| V6b | Differenza formula euristica vs pesata (H=65%) | INFO | — | ~+1.8°C sull'acqua (euristica sottostima) | stima analitica | BASSA |
| V6c | Differenza formula euristica vs pesata (H=80%) | INFO | — | ~+1.2°C sull'acqua | stima analitica | BASSA |

---

## Dettaglio V1 — Formula acqua

### Funzione attiva (UI React)

**`computeWaterTempDDT`** — `src/engine/index.ts:279–315`

```typescript
const factors: 3 | 4 = tempPreferment != null ? 4 : 3;

const tWaterCalc = factors === 4
  ? ddtTarget * 4 - tempAmbient - tempFlour - tempPreferment! - cFriction
  : ddtTarget * 3 - tempAmbient - tempFlour - cFriction;
```

- N=3 straight dough, N=4 con prefermento: **corretto**.
- `tempPreferment`: media delle `tempC` dei prefermenti (WizardView.tsx:852–854).
- `cFriction` = `KNEADING_METHODS_FRICTION[kneadingMethod].cFrictionMid` — valore fisso per tipo impastatrice, **non dipende da `mixingMinutes`**.
- `hand.cFrictionMid = 1.5°C` → `3×25 − 20 − 20 − 1.5 = 33.5°C` ✓ riproduce esattamente il caso osservato.

### Funzione legacy (engine JS, non nel path UI)

**`computeWaterTemp`** — `engine/engine-v2.4.0.js:902–907`

```js
function computeWaterTemp({ ddt, tempFlour, tempRoom, mixerType, hydration, flourKg, mixingMinutes }) {
  const friction = computeFrictionHeat({ mixerType, hydration, flourKg, mixingMinutes });
  const T_water = 3 * ddt - tempFlour - tempRoom - friction;  // SEMPRE ×3
  return safeClamp(T_water, 0, 35);
}
```

Usa sempre N=3, nessun ramo prefermento. Bug solo per l'engine JS diretto; la UI React usa `computeWaterTempDDT`.

---

## Dettaglio V2 — DDT target per stile

`STYLE_CONSTRAINTS` (`src/data/styleConstraints.ts`) vs KB §7.1:

| Stile | Codice | KB §7.1 | Delta | Nota |
|-------|--------|---------|-------|------|
| napoletana | **24°C** | 23°C | +1 | diverge |
| contemporanea | **25°C** | 23°C | +2 | diverge — spiega screenshot |
| teglia | **27°C** | 24°C | +3 | diverge |
| pala | **26°C** | 23°C | +3 | diverge |
| nystyle | 23°C | **24°C** | −1 | diverge |

I valori nel codice sono stati presi da `DDT_BY_STYLE` preesistente (prima dell'introduzione di `styleConstraints.ts`) e non allineati con KB §7.1. La KB ha valori più bassi (stile tradizionale italiano), il codice ha valori più alti (stile "pan-europeo" tipico di alcune scuole tecniche). Nessuno dei due è errato in assoluto, ma c'è incoerenza documentale.

---

## Dettaglio V3 — Seeding temperatura impasto (CRITICA)

### Percorso completo del bug

**Step 1 — Wizard calcola DDT** (es. 25°C) e T_acqua (es. 33.5°C). Nessun valore DDT viene persistito nella Session.

**Step 2 — `startSession()` scrive ProcessLogEntry[0]**:
```typescript
// src/services/sessionService.ts:26
tempDough: session.tLaboratorio ?? 22,  // ← ambiente, NON DDT
```

**Step 3 — Primo tick del motore**:
```typescript
// src/hooks/useTickEngine.ts:55
const prevTDough = ts?.tempDough ?? 22;  // ← ts=null al kickoff → 22°C
```

**Step 4 — Newton cooling**:
```typescript
// src/hooks/useTickEngine.ts:66
const tDough = doughCoreTemp(prevTDough, tAmbient, deltaSec, tauTotal);
// doughCoreTemp(22, 22, Δt, τ) = 22 + (22−22)·exp(−Δt/τ) = 22 per ogni Δt
```

L'impasto è perennemente a 22°C. Il calore dell'acqua (33.5°C) ha mescolato l'impasto portandolo al DDT fisico di 25°C, ma il modello non ne sa nulla.

### Test temporale atteso (corretto)

Con T_init=25°C (DDT), T_amb=20°C, τ≈8340s (1kg, 65%, closed_box):

| t | T_dough attesa | T_dough attuale (bug) |
|---|----------------|----------------------|
| 0 | **25.0°C** | 22.0°C |
| 1h | 23.97°C | 22.0°C |
| 3h | 23.01°C | 22.0°C |
| 6h | 22.35°C | 22.0°C |
| 24h | 22.0°C | 22.0°C |

### Impatto sulla simulazione

- `kEffective(tDough=22, ...)` invece di `kEffective(tDough=25, ...)`: con Ea≈47 kJ/mol, la differenza è ≈ `exp(47000/R × (1/295 − 1/298)) ≈ 1.13` → il modello **sottostima del 13% la velocità di maturazione nelle prime ore** (le più calde), accumulando ADU più lentamente del reale.
- `computeTCrit` con tDough=22 invece di 25: proteolisi iniziale più lenta del reale.

---

## Dettaglio V5 — f_time nel motore legacy

`computeFrictionHeat` — `engine/engine-v2.4.0.js:890–896`:

```js
const fTime = mixingMinutes / 10;  // LINEARE — cresce all'infinito
```

Tabella ΔT_friction per planetaria (1kg, 65%):

| Tempo | f_time | ΔT_friction | T_acqua (DDT=24, T_amb=T_farina=20) | Esito |
|-------|--------|-------------|--------------------------------------|-------|
| 10 min | 1.0 | 7.50°C | 32.5°C | OK |
| 20 min | 2.0 | 15.0°C | 25.0°C | OK |
| 30 min | 3.0 | 22.5°C | 9.5°C | WARN (borderline ICE) |
| 45 min | 4.5 | 33.75°C | **−1.75°C** | **FAIL — ICE_REQUIRED spurio** |

Fisicamente a regime (>15 min) il calore dissipato ≈ calore generato → ΔT_friction tende a un plateau. La funzione lineare sovrastima il calore oltre i 15–20 min.

**Impatto sulla UI React**: NESSUNO diretto — `computeWaterTempDDT` usa `cFrictionMid` fisso e non chiama `computeFrictionHeat`. Il bug è latente nel motore JS legacy.

---

## Dettaglio V6 — Formula equipesata vs calori specifici

La formula del panettiere `T_acqua = N×DDT − ΣT − C_attrito` pesa tutti i componenti identicamente. Una formula fisicamente più accurata userebbe i calori specifici pesati:

```
T_acqua_pesata = [DDT×CP_dough(h) − T_farina×CP_flour_dry×(1−h) − T_amb×CP_flour_dry×(1−h)] / (h × CP_water)
```

Con CP_WATER=4186, CP_FLOUR_DRY=1840 J/(kg·K), H=65%, DDT=25, T_amb=T_farina=20:
- CP_dough(65%) ≈ 3365 J/(kg·K)
- T_acqua_pesata ≈ 35.3°C vs T_acqua_euristica = 33.5°C → differenza **+1.8°C**

Con H=80%:
- CP_dough(80%) ≈ 3715 J/(kg·K)
- differenza **+1.2°C**

La formula euristica è lo standard di settore (Suas 2009) e l'approssimazione è accettabile (< 2°C).
`doughSpecificHeat()` è disponibile nel motore ma non viene usata in `computeWaterTempDDT`.

---

## Conflitto KB §8.5 — Specifica incompleta

La KB §8.5 riporta:
```
waterTemp = ddt − tempFlour − tempRoom − frictionDeltaT
```
(senza moltiplicatore N).

Applicata letteralmente: `25 − 20 − 20 − 1.5 = −16.5°C` → assurdo.

**Il codice è corretto** (`×3` per straight dough, `×4` con prefermento). **La spec KB §8.5 va corretta** aggiungendo il fattore N:
```
straight dough:  waterTemp = 3 × ddt − tempFlour − tempRoom − frictionDeltaT
con prefermento: waterTemp = 4 × ddt − tempFlour − tempRoom − tempPreferment − frictionDeltaT
```

---

## Correzione minima per Verifica 3 (da NON applicare in questa sessione)

Il fix minimo richiede 3 modifiche coordinate:

### 1. Aggiungere campo `tImpasto` a `Session` (db.ts)
```typescript
tImpasto?: number;  // DDT calcolato a fine wizard [°C]
```

### 2. Persistere DDT nella `buildSession()` del wizard (WizardView.tsx)
```typescript
tImpasto: wResult.tWaterCalc != null
  ? STYLE_CONSTRAINTS[draft.style ?? 'napoletana'].ddtTarget
  : session.tLaboratorio ?? 22,
```
Oppure, più preciso: calcolare il DDT medio ponderato tenendo conto della temperatura prefermento.

### 3. Usare `tImpasto` come seed in `useTickEngine.ts:55`
```typescript
const prevTDough = ts?.tempDough ?? session.tImpasto ?? session.tLaboratorio ?? 22;
```

### 4. Aggiornare `sessionService.ts:26`
```typescript
tempDough: session.tImpasto ?? session.tLaboratorio ?? 22,
```

**Nota**: il DDT è la temperatura target dell'impasto *dopo* l'impastamento. È ragionevole usarlo come T_init solo se `tImpasto` è il DDT target, non la temperatura effettiva misurata. Per massima accuratezza, si dovrebbe aggiungere un campo di input "T impasto misurata" nel wizard (caso C del prompt), che l'utente compila dopo aver rilevato la temperatura con il termometro.

---

## Checklist di remediation prioritizzata

| # | Issue | Severità | File | Azione |
|---|-------|----------|------|--------|
| 1 | **Seeding T_impasto = ambiente invece di DDT** | **CRITICA** | `useTickEngine.ts:55`, `sessionService.ts:26`, `db.ts` | Aggiungere `tImpasto` a Session, seed da DDT |
| 2 | `computeWaterTemp` legacy usa ×3 con prefermenti | BASSA | `engine/engine-v2.4.0.js:902–907` | Aggiungere branch ×4 (o deprecare la funzione) |
| 3 | `ddtTarget` in `STYLE_CONSTRAINTS` diverge da KB §7.1 | MEDIA | `src/data/styleConstraints.ts:35,44,53,62,71` | Riconciliare con KB §7.1 o aggiornare KB |
| 4 | `mixingMinutes` non propagato alla formula DDT nell'UI | MEDIA | `src/engine/index.ts:279`, `WizardView.tsx` | Aggiungere input minuti + passarli a `cFriction` variante |
| 5 | `f_time` lineare → ICE_REQUIRED spurio a 45 min pianetaria | ALTA (legacy) | `engine/engine-v2.4.0.js:893` | Saturare con `1 − exp(−mixingMinutes / 10)` normalizzato a 10 min |
| 6 | KB §8.5 manca moltiplicatore ×N | — | `PIZZAMATRIX_KB_UNIFIED.md §8.5` | Aggiornare spec KB (non il codice) |
| 7 | Formula equipesata (no CP) | BASSA | `src/engine/index.ts:279` | Valutare upgrade a formula pesata (differenza <2°C) |
