# STAGLIO_FIX_REPORT.md
## PizzaMatrix v2.4.2 · Fix: staglio utente non rispettato nel solver finestra servizio

---

## Step 1 — Origine del default e punto di rottura del path

### Root cause

**File**: `src/components/tools/FermentationPlannerView.tsx`  
**Riga (prima della fix)**: 832–856 — `serviceResult` useMemo

Il solver `solveServiceWindow` accetta `staglioH` come parametro opzionale con default
`SERVICE_WINDOW_DEFAULTS.staglioH = 0.5` (`engine/serviceWindowSolver.js` riga 227):

```js
export function solveServiceWindow({
  // ...
  staglioH = SERVICE_WINDOW_DEFAULTS.staglioH,  // ← default 0.5h
  // ...
})
```

Il path slider → solver era interrotto nel call-site: il valore `staglioH` era presente
nello state del componente (`useState(0.5)`) ma **non veniva passato** all'oggetto input
di `solveServiceWindow`. Il solver riceveva sempre il default 0.5h.

### Path completo interrotto

```
slider STAGLIO → setStaglioH(v) → staglioH: number [state]
                                       ↓
                          [NON propagato]
                                       ↓
solveServiceWindow({ serviceStart, serviceDurationH, ambientTempC, ... })
                                       ↓
staglioH = SERVICE_WINDOW_DEFAULTS.staglioH = 0.5h  ← hardcoded
```

Il break era **solo nel call-site** in `FermentationPlannerView.tsx`. Il motore
(`engine/serviceWindowSolver.js`) era già corretto: accettava `staglioH` come input
fisso, lo integrava nella ThermalTimeline come segmento `balled_room` a TA, e lo
includeva nei due orologi.

---

## Step 2 — Correzione: staglio come input fisso integrato nella timeline

### Fix applicato

**File**: `src/components/tools/FermentationPlannerView.tsx`  
**Righe modificate**: 851–856

```diff
-        prefermenti: pref ? [{ flourFraction: pref.flourFraction }] : [],
-        initialMaturationOffset: 0,
-        bubbleThresholdPct,
-      }) as SolveServiceWindowResult;
-    } catch { return null; }
-  }, [plannerMode, serviceStart, serviceDurationH, tAmb, fridgeT, agentType, aParams, dosePct, W, hydration, totalFlourG, numPanetti, pref, bubbleThresholdPct]);
+        prefermenti: pref ? [{ flourFraction: pref.flourFraction }] : [],
+        initialMaturationOffset: 0,
+        bubbleThresholdPct,
+        staglioH,
+      }) as SolveServiceWindowResult;
+    } catch { return null; }
+  }, [plannerMode, serviceStart, serviceDurationH, tAmb, fridgeT, agentType, aParams, dosePct, W, hydration, totalFlourG, numPanetti, pref, bubbleThresholdPct, staglioH]);
```

Due modifiche:
1. `staglioH` aggiunto all'oggetto input del solver → passa il valore utente
2. `staglioH` aggiunto al dep-array → il piano si ricalcola quando lo slider cambia

### Come il motore tratta lo staglio (già corretto)

Nel solver (`engine/serviceWindowSolver.js`):
- Lo `staglioH` viene usato come **vincolo fisso** (non grado di libertà)
- Entra nella ThermalTimeline come segmento `balled_room` a `ambientTempC` (TA)
- Viene integrato da entrambi gli orologi: maturazione (Arrhenius) e lievitazione (kEffective)
- Il solver compensa con i gradi di libertà residui (`tcHours`, dose) per mantenere C1/C2/C3

```js
// engine/serviceWindowSolver.js — segmento staglio nella timeline upstream
{ phaseType: 'balled_room', durationH: staglioH, ambientTempC }  // ← integrato a TA
```

---

## Step 3 — Tabella di verifica

**Parametri**: LBF W300, ambient 22°C, frigo 4°C, servizio 2h, fresh_yeast, dose 0.3%

| staglioH slider | Staglio nel piano | Anticipo mixStart | tcHours (appretto) | Mat. fine servizio | Liev. fine servizio |
|:-:|:-:|:-:|:-:|:-:|:-:|
| 0.5h | **0.50h** | 31.5h prima | 23.4h | 90.1% | 8.1% |
| 1.0h | **1.00h** | 30.1h prima | 21.6h | 90.0% | 8.3% |
| 1.5h | **1.50h** | 28.8h prima | 19.7h | 90.0% | 8.4% |
| 2.0h | **2.00h** | 27.8h prima | 18.3h | 90.1% | 8.6% |

**Osservazioni**:

1. **Staglio nel piano = staglio slider** per tutti i valori → bug risolto.
2. **↑ staglio ⇒ ↓ tcHours**: il solver compensa riducendo l'appretto in frigo (più tempo
   a TA durante lo staglio → meno freddo necessario per centrare 90%).
3. **Maturazione fine servizio ≈ 90%** per tutti i valori di staglio → C2 mantenuto.
4. **Lievitazione fine servizio ≤ 92%** per tutti i valori → C3 mantenuto.
5. **mixStart si avvicina** aumentando lo staglio (l'impasto parte prima del tempo in frigo
   ma la finestra complessiva si accorcia perché c'è meno appretto da recuperare in frigo).

**Sanity check** (richiesto nel prompt):  
↑ staglio ⇒ ↓ appretto (tcHours 23.4h → 18.3h) ≠ piano invariato ✓

---

## Verifica test

```
node engine/serviceWindowSolver.test.js  →  25/25 ✅
npx vitest run                           →  68/68 ✅
npx tsc --noEmit                         →  0 errori ✅
npx vite build                           →  build OK ✅
```

---

## File modificati

| File | Modifica |
|------|----------|
| `src/components/tools/FermentationPlannerView.tsx` | `staglioH` aggiunto all'input solver + dep-array del useMemo |

**Non modificati**: `engine/serviceWindowSolver.js` (già corretto), ThermalTimeline,
two-clock, vincoli C1/C2/C3, `SERVICE_WINDOW_DEFAULTS`.
