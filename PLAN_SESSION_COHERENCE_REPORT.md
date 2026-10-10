# PLAN_SESSION_COHERENCE_REPORT.md
## PizzaMatrix v2.4.2 · Coerenza Piano → Sessione → Curva

---

## Parte A — Input % Sale completo

### Problema
Il campo sale era hardcoded a 2.8% (`0.028`) in FermentationPlannerView.tsx. Il planner non aveva uno slider sale; il solver riceveva `salt: 2.0` fisso; né `useResult` né `useServiceResult` includevano `salt` nel dispatch.

### Correzioni
- **`src/components/tools/FermentationPlannerView.tsx`**:
  - Aggiunto `const [salt, setSalt] = useState(2.0)` (stato locale, default 2.0%)
  - Aggiunto slider `PlannerSlider label="Sale"` (range 0–4%, step 0.1%) nella Card Impasto, dopo idratazione
  - `panMassKg`: `0.028` → `salt / 100` (massa dipende dal sale reale)
  - Preview peso panetto: formula + testo dinamici `{salt.toFixed(1)}% sale`
  - Solver call: rimossa voce `salt: 2.0` hardcoded; aggiunta `salt,` (valore reale)
  - `useMemo` dep-array: aggiunto `salt`
  - `useResult` patch: aggiunto `salt,`
  - `useServiceResult` patch: aggiunto `salt,`

### Effetto modello (già presente, verificato)
`fSaltYeast(s) = max(0.60, 1 − 0.10s)` · `fSaltProtease(s) = max(0.70, 1 − 0.08s)` — applicati in `useTickEngine.ts`. Monotonicamente corretti (vedi TAMB_SALT_FIX_REPORT).

---

## Parte B — Fidelity Piano → Sessione

### Problemi identificati
1. **`alertThreshold: 85` hardcoded** in `WizardView.tsx:341` — non usava `draft.alertThreshold`
2. **`alertThreshold` non in WizardDraft** → non in WIZARD_RESET_WITH_PATCH → la patch del planner non poteva sovrascriverlo
3. **`salt` mancante nei dispatch patch** → la sessione usava sempre `salt: 2.0` di default
4. **`useServiceResult` non impostava `alertThreshold: 90`** → la sessione finestra-servizio partiva con target 85%, non 90%

### Correzioni

**`src/context/AppContext.tsx`**:
```diff
interface WizardDraft {
+  alertThreshold?: number;  // 85 default, 90 per finestra servizio
}

// WIZARD_RESET e WIZARD_RESET_WITH_PATCH defaults:
+  alertThreshold: 85,
```

**`src/lib/schemas.ts`** (Zod strict):
```diff
+  alertThreshold: z.number().min(50).max(100).optional(),
```

**`src/components/wizard/WizardView.tsx:341`**:
```diff
-  alertThreshold: 85,
+  alertThreshold: draft.alertThreshold ?? 85,
```

**`src/components/tools/FermentationPlannerView.tsx`** — `useServiceResult`:
```diff
+  salt,
+  alertThreshold: 90,   // target modalità finestra servizio = 90%
```

### Mappa campi trasferiti dopo il fix

| Campo | `useResult` (bake) | `useServiceResult` (servizio) |
|-------|:-:|:-:|
| `agentDosePct` | ✓ dosePct | ✓ r.dose (dose calcolata) |
| `alertThreshold` | 85 (default) | **90** (finestra servizio) |
| `salt` | ✓ | ✓ |
| `thermalTimeline` | ✗ | ✓ r.timeline |
| `bubbleThresholdPct` | ✗ | ✓ |
| `apprettoProtocol` | ✓ r.protocol | 'tc_appreto' |
| `tLaboratorio` | ✓ tAmb | ✓ tAmb |
| `puntataH/staglioH/tcHours` | ✓ | ✓ s.* |

---

## Parte C — Coerenza ETA ↔ curva ↔ asse X

### Problema
Per sessioni "finestra di servizio", `targetBakeAt = serviceStart + serviceDurationH` può essere molto lontano dal `startedAt` della sessione (es. 40h). Il `GompertzChart` calcolava `maxH = max(totalH * 1.5, 24)` dove `totalH` si basa solo sui campi sessione `puntataH + staglioH + tcHours + apprettoH`, escludendo `temperingH` (solo in ThermalTimeline). Risultato: `maxH ≈ 28h` mentre `targetBakeH ≈ 40h` — il marker e la coda della curva erano tagliati fuori asse.

La stessa logica interna a `buildMultiSegmentData` (line 251) aveva lo stesso limite.

### Correzioni

**`src/components/dashboard/DashboardView.tsx`**:

1. `buildMultiSegmentData` — nuovo parametro opzionale:
   ```diff
   - timeline?: PhaseSegment[],
   + timeline?: PhaseSegment[],
   + targetBakeH?: number,
   ```
   Formula `maxH` aggiornata:
   ```diff
   - const maxH = Math.max(totalH * 1.5, 24);
   + const maxH = Math.max(totalH * 1.5, 24, targetBakeH != null ? Math.ceil(targetBakeH * 1.1) : 0);
   ```

2. `GompertzChart` — `maxH` e call a `buildMultiSegmentData`:
   ```diff
   - const maxH = Math.max(totalH * 1.5, 24);
   + const maxH = Math.max(totalH * 1.5, 24, targetBakeH != null ? Math.ceil(targetBakeH * 1.1) : 0);
   ```
   ```diff
   - buildMultiSegmentData(session, tAmb, ts?.phase, ..., session.thermalTimeline)
   + buildMultiSegmentData(session, tAmb, ts?.phase, ..., session.thermalTimeline, targetBakeH ?? undefined)
   ```

### Risultato
- Chart X-axis si estende fino a `max(totalH * 1.5, 24, ceil(targetBakeH * 1.1))`
- Bake marker sempre visibile anche per servizi lontani nel futuro
- Curva simulata fino allo stesso `maxH` → ETA e punto sulla curva coincidono

**Nota**: l'ETA "AL TARGET COTTURA" è sempre il wall-clock da `now` a `targetBakeAt` (corretto) mentre la posizione `targetBakeH` sull'asse è `(targetBakeAt − startedAt) / 3600000`. Con la sessione appena avviata (`now ≈ startedAt`), i due valori coincidono.

---

## Parte D — Avviso margine finestra sicura

### Problema
`ServiceWindowResultCard` mostrava il margine `finestra sicura ~3.4h (richiesti 3.5h)` in grigio neutro (`var(--text-muted)`) anche quando `maxSafeServiceWindowH < serviceDurationH` — cioè tutti i chip C1/C2/C3 verdi ma la finestra pianificata supera il margine sicuro.

### Correzione

**`src/components/tools/FermentationPlannerView.tsx`** — margine con avviso condizionale:
```diff
- <div style={{ color: 'var(--text-muted)', ... }}>
-   Margine: finestra sicura ~Xh (richiesti Yh)
- </div>
+ // tightMargin = maxSafeServiceWindowH < serviceDurationH
+ <div style={{
+   color: tightMargin ? 'var(--accent-warning)' : 'var(--text-muted)',
+   background: tightMargin ? 'rgba(255,140,50,0.08)' : 'transparent',
+   border: tightMargin ? '1px solid rgba(255,140,50,0.25)' : 'none',
+   ...
+ }}>
+   {tightMargin && '⚠ '}Margine: finestra sicura ~Xh (richiesti Yh)
+   {tightMargin && <span>Sforo di {sforo}h · riduci durata a ~Xh o abbassa TA.</span>}
+ </div>
```

**Logica**: i chip C1/C2/C3 rimangono verdi se i vincoli sono rispettati al punto pianificato. L'avviso margine è separato e segnala che la finestra pianificata eccede la finestra sicura calcolata, indicando il valore dello sforo e le mitigazioni.

---

## Verifica test

```
npx vitest run    →  68/68 ✅
npx tsc --noEmit  →  0 errori ✅
npx vite build    →  build OK ✅
```

---

## Tabella file/funzioni toccati

| File | Modifica |
|------|----------|
| `src/components/tools/FermentationPlannerView.tsx` | Part A: salt state + slider + panMassKg + solver + dispatch patches · Part D: avviso margine |
| `src/context/AppContext.tsx` | Part B: `alertThreshold` in WizardDraft + defaults WIZARD_RESET/WIZARD_RESET_WITH_PATCH |
| `src/lib/schemas.ts` | Part B: `alertThreshold` nel Zod schema |
| `src/components/wizard/WizardView.tsx` | Part B: `alertThreshold: draft.alertThreshold ?? 85` |
| `src/components/dashboard/DashboardView.tsx` | Part C: `buildMultiSegmentData` + GompertzChart maxH esteso a targetBakeH |

**Non modificati**: motore enzimatico, parametri calibrati, ThermalTimeline, seeding prefermenti, two-clock, ETA sweetSpotMaturation.
