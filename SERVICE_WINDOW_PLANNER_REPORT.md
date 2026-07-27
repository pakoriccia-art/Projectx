# Service-Window Fermentation Planner — Report
## PizzaMatrix v2.4.2 · Pianifica per finestra di servizio (solver con vincoli)

---

## Sintesi

L'utente inserisce **quando inizia il servizio** (`serviceStart`) e **quanto dura**
(`serviceDurationH`). La finestra è a temperatura ambiente (palline fuori dal frigo).
Il solver calcola **a ritroso** lo schedule completo (impasto, dose, fasi, uscita dal
frigo, tempering) per centrare `maturazione(serviceEnd) ≈ 90%` rispettando tre vincoli
hard per **tutta** la finestra. Costruito sopra **ThermalTimeline + two-clock + inerzia
termica** già implementati, senza regredirli.

I vincoli si valutano a `serviceEnd` perché a TA entrambe le curve crescono monotòne →
il punto più avanzato della finestra è sempre la fine.

---

## Step 1 — Solver con vincoli

### Gradi di libertà determinati dal solver
- `mixStart` — quando impastare (dalla lunghezza totale dello schedule).
- `dose` — leva primaria per la lievitazione/bolle (scala SOLO `muMax`, lineare).
- durate/temperature fasi (puntata TA, appretto TC).
- `pullFromFridge` / `temperingH` — per soddisfare C1.

### Insight chiave: separazione delle leve
Il motore garantisce che la **dose** scali solo l'orologio lievito (`muMax`), non quello
enzimatico. Quindi:
- **tempo + temperatura** → maturazione enzimatica (C2). Dose-independent.
- **dose** → lievitazione/bolle (C3).
Le due curve sono indipendenti per costruzione (test §SW5: `enzAdu` identico a dosi
diverse sullo stesso schedule).

### Valutazione dei vincoli
- **C1 (`T_dough(serviceStart) ≥ 18°C`)**: `computeTemperingH` risolve closed-form
  `t = −τ·ln((18−amb)/(fridge−amb))` (Newton + τ sferica + resistenza contenitore). Il
  segmento di tempering `[serviceStart−temperingH, serviceStart]` accumula entrambi gli
  orologi durante la rampa.
- **C2 (`maturazione(serviceEnd) ≤ 90%`)**: anchoring a ritroso sull'orologio enzimatico.
  `aduMatTarget = findAduAt(9.50, 0.50, 100, 90)`. Il contributo della coda
  (tempering + servizio) è fisso e dose-independent; l'upstream (puntata TA + appretto TC)
  viene risolto per bisezione su `tcHours` così che
  `enzSeed + upstream + coda = aduMatTarget`. Inoltre `structuralState ∉ {CRITICAL, COLLAPSED}`.
- **C3 (`lievitazione(serviceEnd) ≤ bubbleThreshold`)**: schedule fisso (dose-independent),
  bisezione monotòna sulla dose finché `leaveningPct(serviceEnd) = bubbleThreshold`.

### `simulateTimeline` (cuore del modulo)
Integrazione forward dei due orologi lungo segmenti `{phaseType, durationH, ambientTempC}`,
replicando la fisica del tick loop: inerzia termica (`doughCoreTemp`/τ, **cuore continuo
attraverso i confini**), lievitazione (`kEffective`+cardinale), maturazione (`fArrhenius`),
danno W (integrale monotono `computeWHill`). Sub-step 0.05h (3 min).

---

## Step 2 — Fattibilità e finestra sicura massima

**Infattibile** quando: C1 impossibile (`ambient ≤ 18` → `cannot_temper`); overshoot
maturazione (`enzSeed + coda > aduMatTarget` → `maturation_overshoot`); collasso W a
`serviceEnd` (`w_collapse`).

`computeMaxSafeServiceWindow`: da uno stato **post-tempering** (così include il contributo
obbligatorio del tempering), simula fino a 24h a TA e trova il primo crossing tra
maturazione=90% (C2), lievitazione=soglia (C3), W=CRITICAL. Il minimo è la finestra sicura.

**Mitigazioni** (ordinate per vincolo che lega):
- *overshoot* → riduci la durata a ≤ finestra sicura · sforno progressivo · abbassa la TA · riduci offset prefermento.
- *w_collapse* → farina W più alta · più maturazione in frigo · più sale.
- *cannot_temper* → alza la TA sopra 18°C · accetta servizio sotto 18°C.

---

## Step 3 — Soglia bolle C3 (calibrabile)

`bubbleThresholdPct` limita la **lievitazione** (volume gas, orologio Gompertz lievito).
Default **92%** dell'asintoto: margine prima del plateau dove le celle coalescono →
blistering/collasso. Esposto come `Session.bubbleThresholdPct` + `WizardDraft.bubbleThresholdPct`
+ slider planner (60–95) + costante `SERVICE_WINDOW_DEFAULTS.bubbleThresholdPct`.

---

## Step 4 — Integrazione come ThermalTimeline (non regredire)

Il piano emette una `PhaseSegment[]` con `startElapsedH` relativi a `mixStart`:

| Segmento | phaseType | ambientTempC |
|----------|-----------|--------------|
| Puntata | `bulk_room` | TA |
| Staglio | `balled_room` | TA |
| Appretto TC | `balled_fridge` | frigo |
| Tempering | `proofing` | TA |
| Servizio | `proofing` | TA |

Tempering + servizio riusano `proofing` → **zero migrazione**; l'integratore
`buildMultiSegmentData` traccia `tempDough` separato da `ambientTempC`, quindi la rampa
di riscaldo è già modellata.

**Modifica non-regressiva chiave** (`sessionService.startSession`):
```ts
const thermalTimeline = session.thermalTimeline ?? buildInitialTimeline(sessionWithId);
```
Onora una timeline precomputata; fallback al builder esistente per ogni altro caller
(nessuno setta `thermalTimeline` prima di `startSession`). `buildInitialTimeline` e
`applyPhaseTransition` **non toccati**. In `WizardView.buildSession` il ricalcolo
`tc_appreto` (warmup/puntata) viene **saltato** se è presente una timeline precomputata
(lo schedule del solver è autoritativo).

---

## Step 5 — Verifica

### Test unitari `engine/serviceWindowSolver.test.js` — **25/25**

| Caso | Esito |
|------|-------|
| SW1 — servizio 2h fattibile | ✅ feasible, temperingH>0, maturazione 90±1%, lievitazione≤92%, struttura OK, timeline contigua |
| SW2 — C1 vincolante (ambient 19, palline grandi) | ✅ temperingH grande, T_dough(serviceStart) ≥ 18°C |
| SW3 — servizio 8h infattibile (overshoot) | ✅ feasible=false, reason=maturation_overshoot, maxSafe<8h, mitigazione "riduci durata" |
| SW4 — dose bubble-capped (soglia 8%) | ✅ bubbleCapped=true, lievitazione>soglia, **maturazione ancora ≈90%** (dose non perturba l'ancora) |
| SW5 — invarianti | ✅ cannot_temper a ≤18°C, indipendenza maturazione/dose, monotonia dose, tempering closed-form, timeline planned |

### Esempio numerico (SW1: LBF W300, ambient 22°C, fridge 4°C, servizio 2h)
- **Schedule**: puntata 2.0h · staglio 0.5h · appretto TC 21.6h · tempering 6.1h · servizio 2h
- **Dose**: 0.6% (C3 non vincolante → dose comfort = max sicura)
- **A inizio servizio**: T_dough 18.0°C (C1 ✓) · maturazione 86.2% · lievitazione 57.3%
- **A fine servizio**: maturazione **90.0%** (C2 ✓) · lievitazione 71.2% (≤ 92% C3 ✓) · W 300 (OK)

### Altri controlli
- `node engine/engine-v2.4.0.test.js` → 116/118 (2 fail pre-esistenti `maltContrib`, non correlati)
- `npx vitest run` → **68/68** (incluso il nuovo test di regressione: `startSession` onora la timeline precomputata)
- `npx tsc --noEmit` → 0 errori
- `npx vite build` → build OK

### Coerenza dashboard (non regredire timeline)
Caricando il piano come ThermalTimeline, la curva mostra la maturazione che arriva a ~90%
a `serviceEnd` e la lievitazione sotto soglia; le temperature dei segmenti sono bloccate →
nessun flatten, nessun reset al cambio fase.

---

## File creati / modificati

| File | Modifica |
|------|----------|
| `engine/serviceWindowSolver.js` | **nuovo** — `simulateTimeline`, `solveServiceWindow`, `computeTemperingH`, `computeMaxSafeServiceWindow`, `buildServiceWindowTimeline`, `SERVICE_WINDOW_DEFAULTS` |
| `engine/serviceWindowSolver.test.js` | **nuovo** — 25 test (SW1–SW5) |
| `src/engine/serviceWindowSolver.ts` | **nuovo** — re-export + interfacce TS |
| `src/services/sessionService.ts` | onora `session.thermalTimeline ?? buildInitialTimeline(...)` |
| `src/context/AppContext.tsx` | `WizardDraft += thermalTimeline?, bubbleThresholdPct?` |
| `src/lib/schemas.ts` | schema `.strict()` accetta i due nuovi campi |
| `src/components/wizard/WizardView.tsx` | `buildSession` propaga timeline + bubbleThreshold; salta ricalcolo `tc_appreto` se timeline presente |
| `src/components/tools/FermentationPlannerView.tsx` | toggle modalità "Finestra di servizio" + input + `ServiceWindowResultCard` + apply→wizard |
| `src/db/db.ts` | `Session += bubbleThresholdPct?` (no migrazione) |
| `src/__tests__/setup.ts` | mock Dexie: aggiunto `sessions.update` |
| `src/__tests__/sessionService.test.ts` | + test regressione timeline precomputata |

**Non modificati**: parametri calibrati orologi, `gompertz`/`findAduAt`/`fArrhenius`/`kEffective`,
`buildInitialTimeline`, `applyPhaseTransition`, two-clock seeding, `sweetSpotMaturation`, ETA su maturazione.
