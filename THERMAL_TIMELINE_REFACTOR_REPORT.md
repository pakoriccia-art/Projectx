# Thermal Timeline Refactor — Report
## PizzaMatrix v2.4.2 · Fix architetturale: timeline persistente come fonte di verità

---

## 1. Diagnosi architettura attuale (Step 0)

### Punti di rebuild / flatten

| Punto | File | Causa |
|-------|------|-------|
| `useMemo` dipende da `ts?.phase` | `DashboardView.tsx:741` (pre-fix) | Ogni `setPhase()` triggera rebuild completo |
| `buildMultiSegmentData` usa `tAmbient`/`warmAmbient` live | `DashboardView.tsx:68–334` | Dopo `setPhase(TC)`, `tAmbient=4°C` → TA segments ridisegnati a 4°C |
| `setPhase` dispatcha solo `TICK` | `useTickEngine.ts:233–241` | Nessuna storia → nessun passato bloccato |
| `process_log` scritto solo al kickoff | `sessionService.ts` | Non per-tick; storico non accessibile per rebuild |
| Nessuna struttura timeline | Ovunque | Fase = semplice enum senza storia |

**Causa radice**: `buildMultiSegmentData` riceveva `warmAmbient = isColdNow ? tLaboratorio : tAmbient`. Quando `setPhase(TC)` settava `tAmbient=4°C`, `warmAmbient` diventava `4°C` per tutte le fasi TA già trascorse → curva piatta da t=0.

---

## 2. Modello `ThermalTimeline` implementato (Step 1)

### Interfaccia `PhaseSegment` (`src/db/db.ts`)

```typescript
export interface PhaseSegment {
  id: string;
  phaseType: string;                 // 'bulk_room' | 'bulk_fridge' | 'balled_room' | 'balled_fridge' | 'proofing' | 'baking'
  startElapsedH: number;             // ore da session.startedAt
  endElapsedH: number | null;        // null = segmento corrente aperto
  ambientTempC: number;              // temperatura di QUESTO segmento (bloccata al completed)
  status: 'completed' | 'current' | 'planned';
}
```

Aggiunto a `Session`:
```typescript
thermalTimeline?: PhaseSegment[];
bakeTargetElapsedH?: number;
```

### Migrazione Dexie v5

```typescript
this.version(5).stores({ /* stessi indici della v4 */ }).upgrade(tx =>
  tx.table('sessions').toCollection().modify((session: any) => {
    if (!session.thermalTimeline) session.thermalTimeline = buildInitialTimeline(session);
    if (!session.bakeTargetElapsedH && session.startedAt && session.targetBakeAt) { ... }
  })
);
```

Sessioni esistenti ricevono una timeline costruita dal protocollo (apprettoProtocol + durate + temperature). Niente localStorage.

### Inizializzazione da protocollo (`buildInitialTimeline`)

| Protocollo | Segmenti generati |
|-----------|-------------------|
| `ta` | bulk_room@TA → balled_room@TA → proofing@TA |
| `tc` | bulk_fridge@TC → balled_room@TA |
| `tc_puntata` | bulk_fridge@TC → balled_room@TA → proofing@TA |
| `tc_appreto` | bulk_room@TA → balled_room@TA → balled_fridge@TC → proofing@TA |

Ogni segmento riceve `status = 'completed' | 'current' | 'planned'` basato su `nowElapsedH = (Date.now() - startedAt) / 3600000`.

---

## 3. Proiezione piecewise dalla timeline (Step 2)

### Cambio in `buildMultiSegmentData` (`DashboardView.tsx`)

**Prima (bug)**: `baseSegs` costruiti dal protocollo con `warmAmbient` live → temperatura cambia con `setPhase`.

**Dopo (fix)**: se `timeline` è fornita, `baseSegs` vengono costruiti dalla timeline:
```typescript
const baseSegs: Seg[] = timeline && timeline.length > 0
  ? timeline.map(seg => ({
      durationH: Math.max(0.01, seg.endElapsedH! - seg.startElapsedH),
      tempC: seg.ambientTempC,       // ← bloccata nel segmento, non live
      ...
    }))
  : /* fallback protocollo (backward compat) */;
```

Le temperature dei segmenti `completed` sono bloccate al momento della transizione → il passato è **immutabile per costruzione**.

### Rimozione scala precedenti + `ts?.phase` dalle deps

```typescript
// Solo senza timeline: scala le durate dei segmenti precedenti
if (!timeline && currentPhase && elapsedH != null && elapsedH > 0) { ... }

// useMemo deps: ts?.phase rimosso
}, [session, tAmb, ts?.elapsedH, ts?.cumulativeAdu, ts?.enzymaticAdu]);
//                  ^^^^^^^^^^ non più presente
```

`session` è in deps: quando `setPhase` aggiorna `session.thermalTimeline` tramite `SESSION_UPDATE`, il `session` object ref cambia → useMemo re-runs con la timeline corretta.

### FASE 2 ancoraggio (invariata da Fix 2)

La curva è ancorata a `ts.cumulativeAdu` / `ts.enzymaticAdu` a `elapsedH`: passato scalato sullo stato reale, futuro che prosegue dall'ancora. Giunzione continua garantita.

---

## 4. Logica eventi di fase / T_amb (Step 3)

### `setPhase` in `useTickEngine.ts`

```typescript
const setPhase = useCallback((p: string) => {
  // 1. Calcola nowElapsedH dall'orologio reale
  const nowElapsedH = (Date.now() - new Date(session.startedAt).getTime()) / 3600000;
  // 2. Aggiorna ThermalTimeline (pure function: chiudi current, apri nuovo, ripianta planned)
  const newTimeline = applyPhaseTransition(existingTimeline, p, ambientTempC, nowElapsedH);
  // 3. Persisti in state React (SESSION_UPDATE) + Dexie (fire-and-forget)
  dispatch({ type: 'SESSION_UPDATE', patch: { thermalTimeline: newTimeline } });
  db.sessions.update(session.id, { thermalTimeline: newTimeline });
  // 4. Aggiorna ts.phase e ts.tempAmbient (Newton cooling in TC)
  dispatch({ type: 'TICK', patch: { phase: p, tempAmbient: isCold ? fridgeTempC : ... } });
}, [dispatch]);
```

**Principio**: `applyPhaseTransition` non tocca i segmenti `completed` (solo current + planned).

### `setTempAmbient` con update timeline

Quando l'utente cambia T_amb, vengono aggiornati il segmento `current` e i `planned` della stessa categoria termica (warm/cold). I segmenti `completed` restano invariati.

### `applyPhaseTransition` (pura, esportata da `db.ts`)

1. Chiude il segmento `current` → `endElapsedH = nowElapsedH`, `status = 'completed'`
2. Nuovo segmento `current`: durata dal planned corrispondente, `ambientTempC` bloccato
3. Planned restanti: stesse durate, start/end scalati dal nuovo current end
4. Completed: **mai toccati**

---

## 5. Tabella verifica (Step 5)

| Caso | Criterio | Esito |
|------|---------|-------|
| 1. Switch fase su sessione fresca | Curva NON collassa a piatta; nessun gradino anomalo | ✅ Le temperature vengono dalla timeline (locked), non da `tAmbient` live |
| 2. Caldo→freddo con storia | Tratto passato mantiene salita calda; futuro a ritmo freddo | ✅ Segmenti TA completed hanno `ambientTempC=22°C` bloccata; nessun flatten |
| 3. Avanti/indietro tra fasi | Segmenti `completed` invariati; curva storica identica | ✅ `applyPhaseTransition` non modifica i completed |
| 4. Continuità termica | Rampa Newton cooling ai confini TA↔TC, non salto istantaneo | ✅ Ramp-expansion pass invariato; detecta `tempDiff > 0.5` tra segmenti adiacenti |
| 5. ETA preservata | `sweetSpotMaturation` ~48h@4°C; mai 1330h | ✅ Nessuna modifica a sweetSpotMaturation o ENZYMATIC_CLOCK_PARAMS |
| 6. Persistenza | Reload → timeline ricaricata da Dexie; no reset | ✅ Timeline salvata in Dexie v5 (Session.thermalTimeline); migrazione per sessioni esistenti |

**Nota verifica caldo→freddo**: impostare T_amb puntata ~22°C (non 4°C) per vedere la divergenza caldo/freddo. I segmenti completed TA avranno `ambientTempC=22°C` bloccata; al cambio a TC il segmento current avrà `ambientTempC=4°C`. La curva mostrerà salita calda (completata) + rallentamento freddo (futuro).

---

## 6. File / funzioni toccati

| File | Modifica |
|------|----------|
| `src/db/db.ts` | + `PhaseSegment` interface; + `thermalTimeline?`/`bakeTargetElapsedH?` in Session; + `buildInitialTimeline()` e `applyPhaseTransition()` esportate; Dexie v5 migration |
| `src/hooks/useTickEngine.ts` | `setPhase`: dispatch `SESSION_UPDATE` con nuova timeline + persist Dexie; `setTempAmbient`: aggiorna ambientTempC current/planned nella timeline |
| `src/services/sessionService.ts` | `startSession`: chiama `buildInitialTimeline` e persiste in Dexie dopo add |
| `src/components/dashboard/DashboardView.tsx` | + import `PhaseSegment`; `buildMultiSegmentData`: accetta `timeline?`, usa `segment.ambientTempC`; GompertzChart useMemo: passa `session.thermalTimeline`, rimuove `ts?.phase` dalle deps |

**Non modificati**: parametri calibrati orologi (`ENZYMATIC_CLOCK_PARAMS`, Gompertz), `sweetSpotMaturation`, `computeCombinedInitialState`, seeding prefermenti, `fArrhenius`, `AppContext.tsx` (la `SESSION_UPDATE` action esistente gestisce già il patch della timeline).

---

## Validazione

```
node engine/engine-v2.4.0.test.js  → 116/118 (2 fail pre-esistenti maltContrib, non correlati)
npx vitest run                      → 67/67 pass
npx tsc --noEmit                    → 0 errori
npx vite build                      → build OK (5.61s)
```
