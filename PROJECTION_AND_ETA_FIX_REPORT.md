# Projection & ETA Fix — Proiezione piecewise + ETA sweet spot sull'orologio maturazione
## PizzaMatrix v2.4.1 · due bug correlati (re-baseline + clock errato)

---

## Sintesi

Su una sessione in **Appretto TC** dopo una puntata a TA, la dashboard mostrava:
1. La curva di maturazione **ricomputata da t=0 a 4°C costante** (la salita calda della puntata spariva, "appiattita").
2. L'etichetta **"In TC · stima a 4.0°C costante: ~1330.6h"** — ETA al picco calcolata sull'orologio **lievito** invece che maturazione.

**Causa comune**: lo Step 4 del two-clock era incompleto. La curva usava il `tAmbient` *live* (che dopo `setPhase(TC)` diventa `fridgeTempC = 4°C`) per **tutte** le fasi TA, e l'ETA usava `sweetSpot()` (cinetica lievito, ~0 a 4°C → 1330h).

**Dopo il fix**: curva **piecewise** (passato a temperature reali, ancorato allo stato integrato; futuro proiettato dalle fasi pianificate) + ETA sull'**orologio maturazione** (`fArrhenius`, 85% ≈ 48h@4°C).

---

## STEP 1 — Proiezione PIECEWISE (passato reale + futuro pianificato)

### Re-baseline rimosso
Il difetto era in `buildMultiSegmentData` (`src/components/dashboard/DashboardView.tsx`): i segmenti TA usavano il parametro `tAmbient` (= `ts.tempAmbient`), che `setPhase` porta a `fridgeTempC` quando si entra in una fase fredda (`useTickEngine.ts:238`). Risultato: puntata e appretto a TA venivano ridisegnati a 4°C → curva appiattita da t=0.

| File:riga | Prima (BUG) | Dopo (FIX) |
|-----------|-------------|------------|
| `DashboardView.tsx` baseSegs (TA) | `tempC: tAmbient` su Puntata/Staglio/Appretto TA | `tempC: warmAmbient` |
| `DashboardView.tsx` ramp init | `let T_entry = tAmbient` | `let T_entry = warmAmbient` |
| `DashboardView.tsx` warmup tc_appreto | `tAmbient + (fridgeT − tAmbient)·exp(...)` | `warmAmbient + (fridgeT − warmAmbient)·exp(...)` |

```js
const isColdNow   = currentPhase === 'bulk_fridge' || currentPhase === 'balled_fridge';
const warmAmbient = isColdNow ? (session.tLaboratorio ?? 22) : tAmbient;
```
Nelle fasi calde `warmAmbient === tAmbient` → **nessuna regressione** per i protocolli TA.

### Architettura a due segmenti con ancoraggio
La costruzione della curva è ora in due fasi (`DashboardView.tsx`, blocco `FASE 1 / FASE 2`):

- **FASE 1 — integrazione RAW**: integra l'ADU lievito e l'ADU enzimatico segmento per segmento, **ognuno alla sua temperatura** (warm/cold), producendo punti grezzi.
- **FASE 2 — ancoraggio allo stato reale** al tempo `anchorH = elapsedH`:
  - **Passato** (`h ≤ anchorH`): la salita grezza viene **scalata** così che l'endpoint coincida esattamente con lo stato integrato reale (`ts.cumulativeAdu`, `ts.enzymaticAdu`). La forma caldo→freddo è preservata; niente curva piatta.
  - **Futuro** (`h > anchorH`): riparte **dall'ancora reale** e prosegue con gli incrementi pianificati delle fasi successive (a temperature pianificate, non un'unica T costante).
  - **Giunzione continua**: a `h = anchorH`, passato e futuro valgono entrambi lo stato reale → nessun salto.

### process_log
`process_log` viene scritto **solo al kickoff** (`sessionService.ts:startSession`), non per-tick. Quindi la fonte di verità dell'integrazione reale del passato è il **tickState** (accumulato da `useTickEngine` ad ogni tick a partire dalla `tempDough` reale). La curva è ancorata a quello. La modalità "stima a X°C costante" resta solo come **informazione secondaria** (etichetta), non guida più la curva né i valori live.

---

## STEP 2 — ETA del sweet spot sull'orologio MATURAZIONE

Nuova funzione engine `sweetSpotMaturation(session, currentEnzAdu, currentTempC)` (`engine/engine-v2.4.0.js`), esportata in CommonJS + ESM:

```js
const aduAtPeak = findAduAt(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, peakPct);
const rateAtT   = fArrhenius(currentTempC);            // ADU enzimatico/h a T costante
const hoursUntilPeak = (aduAtPeak - currentEnzAdu) / rateAtT;
```

A differenza di `sweetSpot()` (cinetica lievito + correzione cardinale → rate ~0 sotto Tmin), usa `fArrhenius` (Ea=47, senza CTM): la proteolisi resta attiva al freddo.

| Call-site | Prima (BUG) | Dopo (FIX) |
|-----------|-------------|------------|
| `DashboardView.tsx` SweetSpotCard | `sweetSpot(session, ts.cumulativeAdu, tAmb)` | `sweetSpotMaturation(session, ts.enzymaticAdu, tAmb)` |
| `RottaView.tsx` spotCurr/spotNew | `sweetSpot(session, cumulativeAdu + offset*10, T)` | `sweetSpotMaturation(session, ts.enzymaticAdu, T)` |

In `RottaView` è stato rimosso anche il **residuo `+ offset*10`** (vecchia inversione di seeding già corretta altrove). La verticale del "target cottura" nel grafico è schedule-based (`session.targetBakeAt`) → **stabile**, non salta al cambio fase.

**Sanity check (test engine):**
- `sweetSpotMaturation(session, 0, 4°C)` → **48.0h** (validazione KB), NON 1330h.
- `sweetSpotMaturation(session, 0, 22°C)` → **13.8h**.
- Orologio lievito a 4°C: **1484h** vs maturazione **48h** (fattore ~31×, coerente con il ~27× del report).

---

## STEP 3 — Coerenza valori live ↔ curva

- L'hero "Maturazione enzimatica" e "Lievitazione" leggono `ts.maturationPct` / `ts.cumulativeAdu` → **integrazione reale** del tick loop.
- La curva è ora **ancorata** a `ts.cumulativeAdu` / `ts.enzymaticAdu` al tempo `elapsedH` → al tempo corrente, **curva = valori live per costruzione**. La `useMemo` del grafico include ora `ts.cumulativeAdu` e `ts.enzymaticAdu` nelle dipendenze.

---

## STEP 4 — Verifica sul caso reale (CONTEMPORANEA, diretto, TA→TC)

Simulazione: puntata 8h + staglio 0.5h @22°C, poi 5.5h @4°C (t=14h).

| Grandezza | Valore |
|-----------|--------|
| **LIVE** (integrazione reale) Maturazione @t=14h | **69.7%** |
| **BUG** (curva ri-baselinata @4°C da t=0) | **27.0%** ← appiattita/regredita |
| **FIX** curva @t=14h | **69.7%** (= LIVE → giunzione continua ✓) |
| **FIX** curva @4h (durante puntata calda) | **26.7%** (salita calda visibile, niente flat) |
| **ETA** 85% maturazione @4°C dallo stato attuale | **13.0h** |
| **ETA** riferimento da 0 @4°C | **48.0h** (mai 1330h) |

1. Durante la puntata a TA la maturazione/lievitazione salgono normalmente. ✓
2. Al passaggio ad Appretto TC i valori live **non si abbassano**; la curva del passato mantiene la salita calda. ✓
3. La maturazione continua a salire al ritmo ridotto del freddo (two-clock). ✓
4. ETA al target realistica (tiene conto del progresso a caldo), mai 1330h. ✓
5. Etichetta "stima a X°C costante" ora coerente (≤ ~48h). ✓
6. **Nessun reset visibile** al cambio fase. ✓

---

## File modificati

| File | Modifica |
|------|----------|
| `engine/engine-v2.4.0.js` | + `sweetSpotMaturation()` + export CommonJS/ESM |
| `engine/engine-v2.4.0.test.js` | + § S2 (7 test: 48h@4°C, 13.8h@22°C, past_peak, residua, confronto lievito) |
| `src/components/dashboard/DashboardView.tsx` | `buildMultiSegmentData` piecewise + `warmAmbient` + ancoraggio; SweetSpotCard → orologio maturazione |
| `src/components/rotta/RottaView.tsx` | ETA → `sweetSpotMaturation`; rimosso residuo `+ offset*10` |

**Non modificati**: parametri calibrati dei due orologi (`ENZYMATIC_CLOCK_PARAMS`, agent Gompertz), `computeCombinedInitialState`, il seeding two-clock di `useTickEngine`/`sessionService`.

---

## Validazione tecnica

- `node engine/engine-v2.4.0.test.js` → **116/118** (2 fail pre-esistenti `maltContrib`, non correlati)
- `npx vitest run` → **67/67 pass**
- `npx tsc --noEmit` → **0 errori**
- `npx vite build` → **build OK**

**Nota cache**: `combinedInitialState` e `projection_cache` sono per-sessione → verificare su **sessione nuova** (le sessioni vecchie conservano lo stato col bug).
