# TAMB_SALT_FIX_REPORT.md
## PizzaMatrix v2.4.2 · Fix T_ambient propagazione + Verifica Sale

---

## Parte A — Fix propagazione T_ambiente

### A1 — Path e punto di rottura

Il path completo `T_ambiente → motore`:

```
Wizard Step 4 → draft.tLaboratorio → Session.tLaboratorio → startSession()
  → buildInitialTimeline(session): ambientTempC = session.tLaboratorio ?? 22  ✓
  → processLogEntry: tempAmbient = session.tLaboratorio ?? 22                  ✓
  → tickState = null (SESSION_START reducer)                                   ⚠
  → primo tick immediato (useEffect line 205: tick())
      → ts = tsRef.current = null
      → tAmbient = ts?.tempAmbient ?? 22  ← BUG: usa 22, non tLaboratorio
      → dispatch TICK → tickState.tempAmbient = 22
  → tutti i tick successivi leggono ts.tempAmbient = 22 (corretto, ma già sbagliato)
```

**Punto di rottura**: `src/hooks/useTickEngine.ts` righe 57-58 — fallback hardcoded `?? 22` quando `ts` è null (primo tick). La sessione ha `tLaboratorio=25`, ma il tick non lo legge.

**Effetto a catena**:
- Dashboard "T AMBIENTE" mostra `ts.tempAmbient ?? 22` = 22 per tutta la sessione
- GompertzChart header: `ts?.tempAmbient ?? 22` = 22
- SweetSpotCard ETA: calcolata a 22°C invece di 25°C
- Newton's law termica: `doughCoreTemp(22, 22, ...)` = 22°C fissa invece di 25°C

**Bug secondario — `setPhase` (warm return)**: quando si torna da `balled_fridge` a `proofing`, `tempAmbient` non veniva aggiornato (`if (isCold) patch.tempAmbient = ambientTempC`). Dopo `setPhase('proofing')`, `ts.tempAmbient` restava a `4°C` (fridge) fino al prossimo tick manuale, mostrando 4°C in dashboard.

---

### A2 — Correzione

**File**: `src/hooks/useTickEngine.ts`

**Fix 1 — primo tick** (righe 57-58):
```diff
-const prevTDough = ts?.tempDough    ?? 22;
-const tAmbient   = ts?.tempAmbient  ?? 22;
+// Al primo tick ts è null: usa tLaboratorio della sessione come T iniziale impasto/ambiente.
+const prevTDough = ts?.tempDough    ?? session.tLaboratorio ?? 22;
+const tAmbient   = ts?.tempAmbient  ?? session.tLaboratorio ?? 22;
```

**Fix 2 — setPhase warm return** (riga 267-268):
```diff
-const patch: Record<string, unknown> = { phase: p };
-if (isCold) patch.tempAmbient = ambientTempC;
-dispatch({ type: 'TICK', patch: patch as any });
+// Aggiorna ts.phase e ts.tempAmbient sempre: frigo→TA ripristina tLaboratorio,
+// TA→frigo imposta fridgeTempC (Newton cooling parte subito in TC).
+dispatch({ type: 'TICK', patch: { phase: p, tempAmbient: ambientTempC } as any });
```

**Fix 3 — TempCard edit slider** (`src/components/dashboard/DashboardView.tsx` riga 635):
```diff
-<button onClick={() => setEditMode(e => !e)} ...>
+<button onClick={() => {
+  if (!editMode) setTmpT(ts?.tempAmbient ?? 22);  // sync slider con valore live prima di aprire
+  setEditMode(e => !e);
+}} ...>
```
Senza questo fix, `tmpT` (useState) si inizializzava a 22 e non si aggiornava (useState non re-inizializza su prop change).

---

### A3 — Verifica

Simulazione della propagazione prima e dopo la fix:

| T_laboratorio | ts iniziale | Prima: tAmbient primo tick | Dopo: tAmbient primo tick |
|:-:|:-:|:-:|:-:|
| 18°C | null | **22°C** (sbagliato) | **18°C** ✓ |
| 25°C | null | **22°C** (sbagliato) | **25°C** ✓ |
| 30°C | null | **22°C** (sbagliato) | **30°C** ✓ |

Verifica `setPhase` warm return:
- Prima: `setPhase('proofing')` → `ts.tempAmbient` resta 4°C fino al tick successivo
- Dopo: `setPhase('proofing')` → `ts.tempAmbient` = `session.tLaboratorio ?? 22` immediatamente

**Impatto cinetico**: a 25°C invece di 22°C, `fArrhenius(25)/fArrhenius(22) ≈ 1.18` → maturazione ~18% più rapida. L'ETA al sweet spot cambia di conseguenza.

---

## Parte B — Verifica % Sale

### B1 — Input nel wizard: già presente ✓

Il campo sale è in **Step 4** del wizard (`src/components/wizard/WizardView.tsx:822-832`):
- Range: 0–3.5% (baker's %) · Default: 2.0% · Step: 0.1%
- Schema Zod: `salt: z.number().min(0).max(5).optional()` (src/lib/schemas.ts)
- Persistito in `Session.salt: number` (Dexie, campo richiesto)
- Validazione step 4: `!!(draft.hydration && draft.salt !== undefined)` → blocca avanzamento se non definito
- Default AppContext: `salt: 2.0` (WIZARD_RESET e WIZARD_RESET_WITH_PATCH)
- Display in History: `<span>Sale {session.salt}%</span>`

### B2 — Effetto sul modello: già implementato e attivo ✓

**Engine** (`engine/engine-v2.4.0.js`):
```js
fSaltYeast(s)    = Math.max(0.60, 1.0 − 0.10 × s)   // inibizione osmotica lievito
fSaltProtease(s) = Math.max(0.70, 1.0 − 0.08 × s)   // inibizione osmotica proteasi
```

**Tick engine** (`src/hooks/useTickEngine.ts:86-88, 112, 152`):
```typescript
const saltYeast    = fSaltYeast(session.salt ?? 0);
const saltProtease = fSaltProtease(session.salt ?? 0);
// lievitazione:
const deltaAdu = kRatioVal * saltYeast * deltaH;    // sale rallenta la cinetica
// struttura:
const tCrit = computeTCrit(...) / (saltProtease * hardProt);  // sale protegge il glutine
```

### Tabella d'impatto sale (range 0–3.5%)

| Sale% | fYeast | Lievit. −% | fProtease | Proteolisi −% | Monotono |
|:-:|:-:|:-:|:-:|:-:|:-:|
| 0.0% | 1.000 | −0% | 1.000 | −0% | – |
| 0.5% | 0.950 | −5% | 0.960 | −4% | ✓ |
| 1.0% | 0.900 | −10% | 0.920 | −8% | ✓ |
| 1.5% | 0.850 | −15% | 0.880 | −12% | ✓ |
| 2.0% | 0.800 | **−20%** | 0.840 | **−16%** | ✓ |
| 2.5% | 0.750 | −25% | 0.800 | −20% | ✓ |
| 3.0% | 0.700 | −30% | 0.760 | −24% | ✓ |
| 3.5% | 0.650 | −35% | 0.720 | −28% | ✓ |

↑ sale ⇒ lievitazione monotonicamente più lenta (osmotico) + proteolisi più lenta (W decade meno) ✓

**Nota**: `fSaltYeast` ha floor a 0.60 (max −40%), `fSaltProtease` ha floor a 0.70 (max −30%). Parametri calibrati; non modificati.

### B3 — Fix formula display wizard

Il feedback card in Step 4 aveva un bug algebrico: "protezione W +X%" calcolava sempre X=0.

```diff
-Sale v2.4: −{...}% velocità lievitazione · protezione W +{((Math.max(0.7, 1 - 0.08 * salt)) * 100 - 100 + (1 - Math.max(0.7, 1 - 0.08 * salt)) * 100).toFixed(0)}%
+Sale v2.4: −{...}% velocità lievitazione · −{((1 - Math.max(0.7, 1 - 0.08 * salt)) * 100).toFixed(0)}% velocità proteolisi
```

La formula corretta `(1 − fSaltProtease) × 100` mostra la percentuale di inibizione proteasi.

---

## Verifica test

```
npx vitest run       →  68/68 ✅
npx tsc --noEmit     →  0 errori ✅
npx vite build       →  build OK ✅
```

---

## File modificati

| File | Modifica |
|------|----------|
| `src/hooks/useTickEngine.ts` | Righe 57-58: fallback `?? session.tLaboratorio ?? 22` (Fix A primo tick) · `setPhase`: sempre dispatch `tempAmbient` (Fix A warm return) |
| `src/components/dashboard/DashboardView.tsx` | TempCard: sync `tmpT` con `ts.tempAmbient` all'apertura edit |
| `src/components/wizard/WizardView.tsx` | Fix formula "protezione W" (era sempre 0) → `−{...}% velocità proteolisi` |

**Non modificati**: parametri calibrati `SALT_INHIBITION_PARAMS`, `fSaltYeast`, `fSaltProtease`, `fArrhenius`, ThermalTimeline, two-clock, seeding prefermenti.
