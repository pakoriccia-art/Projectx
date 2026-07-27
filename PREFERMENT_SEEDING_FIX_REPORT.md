# Preferment Seeding Fix — Maturazione/Lievitazione invertite
## PizzaMatrix v2.4.1 · Regressione two-clock risolta

---

## Sintesi

Con biga al 70%, all'avvio dell'impasto finale la dashboard mostrava **Lievitazione 75% / Maturazione 4%** — invertito. Causa: l'`initialMaturationOffset` (head-start di maturazione della biga) era agganciato all'orologio **lievitazione**, mentre l'orologio **maturazione** partiva da ~0.

**Dopo il fix**: Biga 70% → **Maturazione ~52% / Lievitazione ~0%** (con cinetica di lievitazione accelerata).

---

## STEP 1 — `computeCombinedInitialState` è corretto (nessuna modifica)

Eseguito direttamente sull'engine:

| Caso | `initialMaturationOffset` | Atteso | Esito |
|------|--------------------------|--------|-------|
| Biga 50% (matPct pref=74) | **0.3700** | 0.370 (fixture KB) | ✓ |
| Biga 70% (matPct pref=74) | **0.5180** | ~0.45–0.52 | ✓ |
| Diretto (no pref) | **0** | 0 | ✓ |

Output Biga 50%: `initialMaturationOffset=0.37`, `effectiveW_initial=290`, `initialPH=5.2`.

La funzione calcola correttamente l'offset (media pesata `Σ flourFraction × maturationPct / 100`). **Il bug NON è qui** — è nell'applicazione del seeding.

---

## STEP 2 — Mappatura offset → orologio: l'inversione

L'offset finiva sull'orologio **sbagliato** in tutti i call-site:

| File:riga | Prima (BUG) | Orologio colpito |
|-----------|-------------|------------------|
| `useTickEngine.ts:100-105` | `gompertz(newAdu + offset*10, …)` | **Lievitazione** ← offset iniettato qui |
| `useTickEngine.ts:111` | `prevEnzAdu = ts?.enzymaticAdu ?? 0` | **Maturazione** ← parte da 0 |
| `useTickEngine.ts:80-83` | `gompertz(prevAdu + offset*10, …)` (pH) | Lievitazione |
| `sessionService.ts:19,29-30` | `cumulativeAdu = offset*100` | Lievitazione (DB seed) |
| `DashboardView.tsx` hero | `adu = rawAdu + offset*10` | Lievitazione |
| `DashboardView.tsx` buildMultiSegment | `cumulativeAdu = offset*10; enzAdu = 0` | Lievitazione / Maturazione=0 |
| `DashboardView.tsx` SweetSpotCard | `effectiveAdu = cumulativeAdu + offset*10` | Lievitazione |

**Inversione confermata (ipotesi primaria)**: l'offset di maturazione gonfiava la lievitazione (→75%), e la maturazione enzimatica partiva da ~0 (→4% nel primo tick).

---

## STEP 3 — Etichette dashboard: corrette

La linea "Maturazione" (oro `#e6c84a`, `dataKey="matPct"`) legge l'orologio enzimatico; la "Lievitazione" (arancione tratteggiata, `dataKey="pct"`) legge l'orologio lievito. Il tooltip/legenda associa i nomi giusti. **Nessuno scambio di etichette** — il bug è interamente nel modello (Step 2).

---

## STEP 4 — Correzione applicata

**Principio**: `initialMaturationOffset` semina la **maturazione**; la lievitazione parte bassa; la biga accelera la lievitazione via **cinetica** (lag ridotto), non via livello iniziale di gas.

### Seed maturazione (enzimatico)
Seed `enzymaticAdu` = `findAduAt(muMax=9.5, λ=0.5, 100, offset*100)` → l'orologio maturazione parte esattamente a `offset%`.

### Lievitazione: livello 0 + cinetica
- Rimosso `+ offset*10` da tutte le Gompertz di lievitazione → parte da ADU 0.
- `leavLambda = max(0.3, agentLambda × (1 − 0.5 × prefFrac))` → la biga riduce il lag (cinetica più rapida). Per biga 70%: `λ 1.2 → 0.78`.

### Call-site modificati

| File:riga | Dopo (FIX) |
|-----------|-----------|
| `useTickEngine.ts:60-74` | Nuovo blocco: `matOffsetPct`, `prefFrac`, `enzSeed`, `leavLambda` |
| `useTickEngine.ts` prevMatPct | `gompertz(prevAdu, muMax, leavLambda, …)` — no offset |
| `useTickEngine.ts` matPct | `gompertz(newAdu, muMax, leavLambda, …)` — no offset |
| `useTickEngine.ts` enzimatico | `prevEnzAdu = ts?.enzymaticAdu ?? enzSeed` ← seed maturazione |
| `useTickEngine.ts` import | aggiunto `findAduAt` |
| `sessionService.ts` | `cumulativeAdu=0`, `maturationPct=enzymaticMatPct=offset*100`, `leaveningPct=0` |
| `DashboardView.tsx` hero | leavening: no offset + `heroLeavLambda`; `matPct` fallback = `offset*100` |
| `DashboardView.tsx` buildMultiSegment | `cumulativeAdu=0`, `enzAdu=enzSeed`, leavening usa `leavLambda` |
| `DashboardView.tsx` SweetSpotCard | `effectiveAdu = cumulativeAdu` — no offset |
| `DashboardView.tsx` import | aggiunto `findAduAt`; tipo `prefermenti?: any[]` in buildMultiSegment |

**Non modificati**: `computeCombinedInitialState`, parametri calibrati biga/poolish, parametri dei due orologi.

---

## STEP 5 — Verifica (simulazione t=0 con params lievito reali muMax=12, λ=1.2)

| Caso | Maturazione iniz. (prima → dopo) | Lievitazione iniz. (prima → dopo) | Cinetica lievito |
|------|----------------------------------|-----------------------------------|------------------|
| **Biga 70%** | 4% → **52%** ✓ | 75% → **0%** (sale rapida) ✓ | λ 1.2 → 0.78 |
| **Biga 50%** | ~3% → **37%** ✓ (= fixture 0.370) | ~70% → **0%** ✓ | λ 1.2 → 0.90 |
| **Diretto** | 0% → **0%** ✓ | 0% → **0%** ✓ | λ 1.2 (invariato) |

L'inversione è risolta: la maturazione riflette l'head-start della biga, la lievitazione parte da degassato e risale con cinetica accelerata.

**Nota cache**: `combinedInitialState` e `projection_cache` sono per-sessione → verificare su **sessione nuova** (le sessioni vecchie conservano lo stato seminato col bug).

### Validazione tecnica
- `npx tsc --noEmit` → **0 errori**
- `node engine/engine-v2.4.0.test.js` → 109/111 (2 fail pre-esistenti `maltContrib`, non correlati)
- `vitest sessionService` → **7/7 pass**
