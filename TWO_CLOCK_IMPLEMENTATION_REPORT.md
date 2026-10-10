# Two-Clock Fermentation Model — Implementation Report
## PizzaMatrix v2.4.1

---

## Riepilogo

Implementato il modello **two-clock** per separare lievitazione e maturazione enzimatica. Il vecchio unico orologio (Gompertz yeast ADU) sottostimava la maturazione a freddo di **~34×**. Il nuovo modello usa due orologi indipendenti con diverse sensibilità termiche.

---

## Il Problema

### Comportamento precedente (CASO A confermato)

L'unico "orologio" era il Gompertz lievito:

```
ADU += kRatio(T) × deltaH
maturationPct = gompertz(ADU, muMax, lambda, asymptote)
```

Il `kRatio` usa la **correzione cardinale (CTM)** che azzera il lievito vicino a `T_min` (1.5°C per fresh_yeast). A 4°C, `kRatio ≈ 0.0055` (0.55%).

**Risultato**: la "maturazione" a 4°C era 0.55% del ritmo a 22°C — praticamente zero.

### Test numerico di sottstima

| Durata | maturationPct (vecchio) | Maturaz. enzimatica attesa |
|--------|------------------------|---------------------------|
| 12h@4°C | 1.9% | ~20% |
| 24h@4°C | 2.1% | ~42% |
| 48h@4°C | 2.5% | **~85%** |

**Sottostima: ~34×** rispetto al comportamento fisico della proteolisi.

---

## La Soluzione: Two-Clock

### Orologio 1 — Lievitazione (invariato)

```
ADU += kRatio(T, agentEaKj, agentType) × saltYeast × deltaH
leaveningPct = gompertz(ADU, agentMuMax, agentLambda, agentAsymptote)
```

- `kRatio` usa `kEffective` con correzione cardinale (CTM) — si azzera sotto T_min
- Governa: gas, volume, struttura alveolare
- **Non modificato** — lievitazione a 4°C rimane soppressa come atteso

### Orologio 2 — Maturazione enzimatica (NUOVO)

```
enzAdu += fArrhenius(T_dough) × deltaH
maturationPct = gompertz(enzAdu, ENZ_MU_MAX, ENZ_LAMBDA, 100)
```

- `fArrhenius(T)` usa Ea=47 kJ/mol **senza CTM** — la proteolisi è attiva anche a 4°C
- Governa: proteolisi, struttura glutinica, aromi, estensibilità
- **Nuovo** — riflette il comportamento fisico reale

---

## Calibrazione Enzymatic Clock

Calibrato su: **48h@4°C → 85% maturazione enzimatica**

```
ENZYMATIC_CLOCK_PARAMS = { EaKj: 47, muMax: 9.50, lambda: 0.50 }
```

### Verifica calibrazione

| Condizione | enzAdu | matPct |
|-----------|--------|--------|
| 48h @ 4°C | fArr(4)×48 = 0.238×48 = **11.41** | gompertz(11.41, 9.50, 0.50, 100) = **85.0%** ✓ |
| 13.8h @ 22°C | fArr(22)×13.8 = 0.825×13.8 = **11.39** | gompertz(11.39, ...) = **84.8%** ✓ |
| 12h @ 4°C | 0.238×12 = 2.86 | **~20%** ✓ |
| 24h @ 4°C | 0.238×24 = 5.71 | **~49%** ✓ |

**Impatto sweet spot a TA (22°C)**: quasi invariato — entrambe le curve convergono a ~85% in ~13.8h.

### Ratio proteolisi: 4°C vs 22°C

```
fArrhenius(4°C)  = 0.238
fArrhenius(22°C) = 0.825
ratio = 0.238 / 0.825 = 0.288 ≈ 29%
```

La proteolisi a 4°C è il **29% del ritmo a 22°C**, vs **0.55% del lievito** (53× più attiva).

---

## File Modificati

### `engine/engine-v2.4.0.js`
- Aggiunto `ENZYMATIC_CLOCK_PARAMS = { EaKj: 47, muMax: 9.50, lambda: 0.50 }`
- Aggiunto a `_constants`, esportato in CommonJS e ES module

### `src/db/db.ts`
- Aggiunto `leaveningPct?: number` e `enzymaticMatPct?: number` a `ProcessLogEntry`
- Bumped schema a version 4

### `src/context/AppContext.tsx`
- Aggiornato `TickState` con campi: `leaveningPct`, `enzymaticAdu`, `enzymaticMatPct`
- `maturationPct` ora = maturazione enzimatica (ex: lievitazione)

### `src/hooks/useTickEngine.ts`
- Aggiunto secondo orologio nel tick loop dopo il Gompertz lievito:
  ```typescript
  const enzRate = fArrhenius(tDough)
  newEnzAdu = prevEnzAdu + enzRate × deltaH
  enzymaticMatPct = gompertz(newEnzAdu, 9.50, 0.50, 100)
  ```
- Dispatch aggiornato: `maturationPct` → enzymaticMatPct, aggiunto `leaveningPct/enzymaticAdu/enzymaticMatPct`
- Alert soglia rerouted su `enzymaticMatPct` (non più `matPct` lievito)

### `src/services/sessionService.ts`
- Seed iniziale aggiunto: `leaveningPct: 0, enzymaticMatPct: 0`

### `src/components/dashboard/DashboardView.tsx`
- **Hero card**: label cambiata in "Maturazione enzimatica", `matPct` ora da `ts?.maturationPct` (enzymatico)
- **Metrica secondaria**: "Lievitaz." (orologio lievito) appare nella griglia sotto la metrica hero
- **`buildMultiSegmentData`**: aggiunto tracking `enzAdu` con `fArrhenius(tempC)`, output `matPct` per ogni punto
- **`GompertzChart`**: terza curva gold `#e6c84a` "Maturazione", curva arancione tratteggiata "Lievitazione", tooltip distingue le due, legenda visuale
- **`SweetSpotCard`**: `isPast` rerouted su `ts?.maturationPct >= alertThreshold` (enzymatico)

### `engine/engine-v2.4.0.test.js`
- Aggiunta sezione `§ S — Two-Clock Enzymatic` (8 test, tutti passing)
- Test calibrazione: enzAdu(48h@4°C)=11.41 ✓, gompertz(11.41)=85% ✓, h@22°C=13.8h ✓, ratio=0.288 ✓

---

## Risultati Test

```
node engine/engine-v2.4.0.test.js
  Totale:  111
  ✅ Passed: 109
  ❌ Failed: 2  (pre-existing: maltContrib — non correlati)

npx tsc --noEmit
  0 errori TypeScript
```

---

## Tabella Comparativa Before/After

| Scenario | maturationPct (v2.4.0) | leaveningPct (v2.4.1) | maturationPct (v2.4.1) |
|---------|----------------------|----------------------|----------------------|
| 24h @ 4°C | 2.1% ← sbagliato | 2.1% | **~49%** ✓ |
| 48h @ 4°C | 2.5% ← sbagliato | 2.5% | **~85%** ✓ |
| 14h @ 22°C | ~85% | ~85% | **~85%** ✓ (invariato TA) |
| 8h @ 12°C | ~22% | ~22% | **~26%** |

La maturazione a TA è praticamente invariata (< 1% differenza), mentre a freddo il modello ora riflette la realtà fisica.

---

## Dashboard: Lettura Visuale

**Hero card**: "Maturazione enzimatica" — il numero grande che governa quando infornare.

**Griglia secondaria**: "Lievitaz." (gas/volume) accanto a pH e W att.

**Grafico**:
- `╌╌ Lievitazione` (arancione tratteggiato) — orologio lievito, si sopprime a freddo
- `—— Maturazione` (gold continuo) — orologio enzimatico, rimane attivo a freddo
- A TA le due curve quasi si sovrappongono
- A TC (4°C) si separano nettamente: Maturazione sale, Lievitazione quasi ferma

**Sweet spot**: `enzymaticMatPct >= alertThreshold` (default 85%)
