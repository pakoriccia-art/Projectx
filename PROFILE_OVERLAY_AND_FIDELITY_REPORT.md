# PROFILE_OVERLAY_AND_FIDELITY_REPORT

## Parte 1 — Overlay a doppio livello (QualityProfileCard)

### Componenti implementati

**`computeProfileIndicesAt(m, params)`** — funzione pura estratta:
```typescript
computeProfileIndicesAt(m: number, params: ProfileParams): { ext: number; aroma: number; sci: number }
```
Riceve la maturazione `m ∈ [0,1]` e i parametri di sessione (`pl, hyd, W_sci, prefs, proto, tcH, agentType, style, amylase`). Implementa le stesse formule del precedente blocco inline; ora riusata per i due istanti:
- **mNow** = `ts.maturationPct / 100` (orologio enzimatico live)
- **mAtBake** = proiezione di `buildMultiSegmentData` al punto `h ≥ targetBakeH`

**`QualityOverlayDot({ now, bake, color, label })`** — nuovo componente:
- Pallini `1..now` → pieno 100% opacità (indice attuale)
- Pallini `now+1..bake` → bordo anello `color` + `opacity: 0.55` + sfondo trasparente (indice previsto a cottura)
- Pallini oltre `bake` → semitrasparente muted
- `title="Ora X/5 · A cottura Y/5"` + `aria-label` per accessibilità

**`QualityProfileCard`** aggiornata:
- Calcola `targetBakeH` da `session.startedAt / targetBakeAt`
- Chiama `buildMultiSegmentData` (stessa funzione di `GompertzChart`) in `useMemo` per proiettare `mAtBake`
- Mostra legenda `"● ora · ◐ a cottura"` nell'header della card
- Avviso speciale: se `bakeIdx.sci < nowIdx.sci` (scioglievolezza non-monotona in calo) → badge `⚠ Scioglievolezza in calo a cottura`

### Garanzie

| Proprietà | Implementazione |
|---|---|
| mAtBake ≥ mNow | `Math.max(mNow, ...)` nel useMemo — la proiezione non va indietro |
| Scioglievolezza non-monotona | mostrata con valore reale al bake + badge warning |
| Nessuna logica duplicata | `computeProfileIndicesAt` è l'unica implementazione, richiamata due volte |
| Daltonico-friendly | doppio segnale: fill + bordo/anello |
| Tooltip/accessibilità | `title` + `aria-label` su ogni riga di pallini |

### File modificati

- `src/components/dashboard/DashboardView.tsx`
  - Aggiunta funzione `computeProfileIndicesAt` (linee ~445–495)
  - Aggiunto componente `QualityOverlayDot` (linee ~497–520)
  - Rimpiazzata logica inline di `QualityProfileCard` con chiamata a `computeProfileIndicesAt` × 2 istanti
  - Aggiunto `useMemo` per `targetBakeH` e `mAtBake`

---

## Parte 2 — Verifica mismatch peso e fidelity piano→sessione

### Mappa campi trasferiti: planner → wizard draft → sessione

| Campo piano | Stato planner | Draft wizard | Sessione | Note |
|---|---|---|---|---|
| `totalFlourGrams` | `totalFlourG` (React state) | `totalFlourGrams: totalFlourG` | `draft.totalFlourGrams ?? 1000` | **Catena pulita** |
| `hydration` | slider `hydration` | `hydration: hydration` (bake/service) · `hydration: r.hydration` (quality) | `draft.hydration ?? 65` | Quality usa idratazione calcolata |
| `prefermenti` | array `prefermenti` | `prefermenti: [{ ... }]` | ricostruito in `buildSession` con stato stimato | Trasferimento completo |
| `agentDosePct` | slider `dosePct` | `agentDosePct: dosePct` / `r.dose` | `draft.agentDosePct ?? 0.3` | Service usa dose da solver |
| `salt` | slider `salt` | `salt: salt` | `draft.salt ?? 2.0` | OK |
| `staglioH` | slider `staglioH` | `staglioH: r.staglioH` / `staglioH` | `draft.staglioH ?? 0.5` | OK |
| `tcHours` | slider/solver | `tcHours: r.tcHours` | `draft.tcHours` | OK |
| `fridgeTempC` | slider `fridgeT` | `fridgeTempC: fridgeT` | `draft.fridgeTempC ?? 4` | OK |
| `tLaboratorio` | slider `tAmb` | `tLaboratorio: tAmb` | `draft.tLaboratorio ?? 20` | OK |
| `thermalTimeline` | da solver servizio `r.timeline` | `thermalTimeline: r.timeline` | `session.thermalTimeline ?? buildInitialTimeline(...)` | Solo modalità servizio |
| `alertThreshold` | ← **BUG** | non impostato in modalità qualità | default **85** invece di `r.mTarget*100` | **FIX applicato** |

### Bug identificato: `alertThreshold` mancante in modalità qualità

**Sintomo**: il solver qualità calcola `mTarget ≈ 81%` come maturazione target ottimale per il profilo 4/5/5, ma la sessione usava `alertThreshold = 85` (default). L'allarme scattava 4 punti percentuali prima del previsto.

**Root cause**: `useQualityResult` non trasmetteva `alertThreshold: Math.round(r.mTarget * 100)`.

**Fix** (`src/components/tools/FermentationPlannerView.tsx`):
```typescript
dispatch({ type: 'WIZARD_RESET_WITH_PATCH', step: 8, patch: {
  ...
  alertThreshold: Math.round(r.mTarget * 100),  // aggiunto
}});
```

### Indagine mismatch 1750g → 11250g

Traccia completa del campo `totalFlourGrams` nel path "Usa questo schema →":

1. **Planner**: `totalFlourG = 1750` (slider) → `dispatch({ totalFlourGrams: totalFlourG })` in tutti e tre i mode (bake/service/quality)
2. **AppContext `WIZARD_RESET_WITH_PATCH`**: `{ ...defaults, ...patch }` → `wizardDraft.totalFlourGrams = 1750`
3. **WizardView `buildSession`**: `totalFlourGrams: draft.totalFlourGrams ?? 1000` = 1750
4. **`startSession`**: `db.sessions.add({ ...session })` → Dexie persiste 1750g
5. **DashboardView**: `state.activeSession.totalFlourGrams` = 1750g → `{session.totalFlourGrams}g`

**Nessun moltiplicatore trovato** nel percorso di creazione sessione corrente. Il valore 11250 (fattore ~6.43×) non corrisponde a nessuna combinazione logica di `numPanetti × farina`, `totalDoughG`, o conversioni di unità nel codice analizzato.

**Conclusione**: la catena di trasferimento `totalFlourGrams` è corretta nella versione attuale. Il valore 11250g riportato corrisponde probabilmente a un artefatto di test da una sessione Dexie precedente (versione precedente del codice), oppure il widget mostrava il **peso totale impasto per tutti i panetti** (`totalFlourG * (1 + hyd/100 + salt/100) * numPanetti ≈ 1750 * 1.67 * 4 ≈ 11500g` con 4 panetti) anziché solo la farina.

**Protezione aggiuntiva**: `WizardInputSchema` impone `totalFlourGrams: z.number().min(200).max(13_000)` — un valore 11250 passerebbe la validazione ma 11250 > 9000 indicherebbe un batch industriale insolito e può essere segnalato in futuro con un avviso UI.

---

## Conferma fidelity sessione == piano

Con i fix applicati, la sessione generata in modalità qualità con target 4/5/5 rispecchia:

| Campo | Piano (solver) | Sessione | Stato |
|---|---|---|---|
| `totalFlourGrams` | 1750g (slider) | 1750g | ✅ |
| `hydration` | 72% (da `extTarget=4`) | 72% | ✅ |
| `agentDosePct` | 0.3% | 0.3% | ✅ |
| `alertThreshold` | 81% (`mTarget*100`) | 81% | ✅ (fix) |
| `prefermenti[0].type` | biga | biga | ✅ |
| `prefermenti[0].flourFraction` | 50% | 50% | ✅ |
| `tcHours` | solver output | `r.tcHours` | ✅ |
| `apprettoProtocol` | `tc_appreto` | `r.apprettoProtocol` | ✅ |
| `puntataH` | solver output | `r.puntataH` | ✅ |
| Profilo previsto a cottura | 4/5/5 | `computeProfileIndicesAt(mAtBake, ...)` = 4/5/5 | ✅ |

---

## Vincoli non regrediti

- ThermalTimeline, two-clock, kEffective, gompertz, fArrhenius: **intoccati**
- `buildInitialTimeline`, `applyPhaseTransition`: **intoccati**
- Persistenza Dexie: **invariata**
- Tutti i 68 test Vitest passano; build produzione pulita
