# FERMENTATION_PLANNING_REPORT — PizzaMatrix v2.4.0

**Data**: 2026-05-28  
**Branch**: `claude/pizzamatrix-engine-v2-4-0-xEhVU`  
**Prompt**: `CLAUDE_CODE_PROMPT_MATURAZIONE_SERVIZIO.md`  
**Modifiche al codice**: NESSUNA — diagnosi + design per approvazione.

---

## ⚠️ Findings Critici

| # | Problema | Severità | File:riga |
|---|----------|----------|-----------|
| C1 | **Maturazione agganciata esclusivamente al lievito (CASO A)** — a 4°C mostra <3% in 48h invece del ~85% enzimatico atteso → falsa ogni pianificazione con frigo | **CRITICA** | `useTickEngine.ts:95–104` |
| C2 | **Split 65/35 hardcoded** — puntataH = warmH × 0.65 indipendente dallo stile e dalle preferenze utente → a 18°C → puntata 15.4h | **ALTA** | `FermentationPlannerView.tsx:204–205` |
| C3 | **Assenza input servizio e tempering editabile** — il flusso reale (2h TA + 1h staglio + TC var. + 3-4h tempering) non è direttamente modellabile | **ALTA** | FermentationPlannerView |
| C4 | **Assenza modalità forward/editabile** — nessun feedback bidirezionale su schema manuale | **MEDIA** | FermentationPlannerView |

---

## ASSE 1 — Diagnosi split puntata/appretto

### Algoritmo effettivo

File: `src/components/tools/FermentationPlannerView.tsx:200–221`

```typescript
// 1. Calcola ore totali per raggiungere 85% ADU
const warmH = aduNeeded / rAmb      // rAmb = kRatio(tAmb)

// 2. Split FISSO 65/35 — nessun vincolo di stile, nessun input utente
const puntataH  = warmH * 0.65
const apprettoH = warmH * 0.35
```

Il valore `aduNeeded` è la differenza tra `ADU_target(85%)` e l'eventuale ADU iniziale (pre-fermento). Non c'è cap da `STYLE_CONSTRAINTS` né limitazione dell'appretto.

### Numeri a varie temperature (fresh_yeast 0.3%, ADU_85 = 9.836)

| T_amb | kRatio | warmH totale | puntataH (65%) | apprettoH (35%) |
|-------|--------|-------------|----------------|-----------------|
| 18°C  | 0.416  | 23.7h       | **15.4h** ←    | 8.3h            |
| 20°C  | 0.554  | 17.7h       | 11.5h           | 6.2h            |
| 22°C  | 0.716  | 13.7h       | 8.9h            | 4.8h            |
| 24°C  | 0.901  | 10.9h       | 7.1h            | 3.8h            |

A 18°C la puntata di 15.4h spiega esattamente il sintomo osservato dall'utente.

### Causa della puntata lunga a 18°C

Il `kRatio` a 18°C è 0.416 (vs 0.716 a 22°C): a temperatura più bassa il lievito accumula ADU lentamente, quindi `warmH` cresce e il 65% genera una puntata molto lunga. Il "18°C" che l'utente imposta non è l'ambiente di fermentazione ma la **temperatura target del cuore impasto durante il tempering pre-servizio** — costante hardcoded in `computeWarmupH` (FermentationPlannerView.tsx:109: `const T_SERVICE = 18`). L'utente ha probabilmente inserito 18°C come tAmb, causando il comportamento.

### Conferma/smentita anomalie

| Ipotesi | Esito |
|---------|-------|
| Appretto "tappato" da `maxTcHours` in STYLE_CONSTRAINTS | **SMENTITA** — nessun cap appretto esiste nel codice |
| Front-loading 65/35 hardcoded | **CONFERMATA** — FermentationPlannerView.tsx:204–205 |
| Default nascosto protocollo `ta` che ignora utente | **PARZIALE** — non c'è un override, ma il 65/35 fisso ignora la preferenza utente per puntata breve |

### Leve disponibili vs assenti

| Leva | Disponibile oggi | Note |
|------|-----------------|------|
| Dose lievito ↑ | Sì (slider) | Accorcia warmH proporzionalmente |
| Ora cottura → `targetTotalH` | Sì (date/time) | Abilita protocolli misti `tc_appreto` |
| Protocollo `tc_appreto` | Sì (calcolato auto) | Richiede targetTotalH; puntata calcolata, non fissa |
| **Puntata fissa editabile** | **NO** | Da aggiungere (Asse 3) |
| **Tempering ore editabile** | **NO** | Hardcoded su Newton 18°C — da esporre (Asse 3) |
| Staglio flessibile | Solo default 0.5h | Da espandere a range 0.25–3h |

---

## ASSE 2 — Maturazione a freddo: definizione e sottostima

### 2.1 Definizione attuale: CASO A confermato

La `maturationPct` (mostrata in dashboard e usata per lo sweet spot) è calcolata esclusivamente da ADU del lievito.

Catena esatta — `useTickEngine.ts:87–104`:
```typescript
const baseRate   = kEffective(tDough, session.agentEaKj, session.agentType)
const corrRate   = amylaseCorrectedRate(baseRate, ...)
const kRef       = kEffective(25, ...)
const kRatioVal  = kRef > 1e-12 ? corrRate / kRef : 0

const deltaAdu   = kRatioVal * saltYeast * deltaH   // ADU proporzionale a kRatio
const newAdu     = prevAdu + deltaAdu
const matPct     = gompertz(newAdu + offset, session.agentMuMax, ...)  // ← maturationPct
```

`kEffective = arrhenius(T) × cardinalCorrection(T, agentType)`. Il fattore cardinalCorrection si azzera a 4°C (prossimo a Tmin=1.5°C), portando kRatio → 0.55%.

### 2.2 Test numerico a 4°C (fresh_yeast 0.3%)

| Durata | ADU (lievito) | maturationPct attuale | Maturaz. enzimatica attesa |
|--------|--------------|----------------------|---------------------------|
| 12h    | 0.066        | **1.9%**             | ~23%                      |
| 24h    | 0.132        | **2.1%**             | ~49%                      |
| 48h    | 0.265        | **2.5%**             | **~85%** (riferimento)    |
| 72h    | 0.397        | **2.9%**             | ~96%                      |

**A 22°C per confronto**: maturationPct ≈ 78% in 12h, 98% in 24h.

### Confronto cinetica lievito vs proteolisi a freddo

| T    | kRatio lievito (CTM) | fArrhenius proteolisi | Rapporto |
|------|---------------------|----------------------|---------|
| 4°C  | 0.0055 (0.55%)       | 0.2377 (29%)          | ~53×    |
| 10°C | 0.0826 (8.3%)        | 0.3662 (44%)          | ~5×     |
| 15°C | 0.2520 (25%)         | 0.5179 (63%)          | ~2.5×   |
| 22°C | 0.7163 (72%)         | 0.8247 (100%)         | ~1.1×   |

A 4°C il lievito è quasi fermo (Tmin=1.5°C): la CTM sopprime il 99.45% dell'attività. La proteolisi — che **non ha soglia di inibizione CTM** — procede al 29% del ritmo a 22°C. Questa è la base biochimica della maturazione a freddo 24-72h.

**Sottostima**: modello attuale mostra 2.5% vs atteso ~85% in 48h a 4°C → **sottostima 34×**.

### 2.3 Proposta two-clock

#### Principio

Due orologi separati, additivi, NON si sostituiscono:
- **Orologio lievitazione** (INVARIATO): ADU via Gompertz + CTM + Arrhenius(Ea~62). Governa gas, volume, risposta al punto di flesso. Rimane esattamente com'è.
- **Orologio maturazione enzimatica** (NUOVO): integrale Arrhenius con Ea=47 kJ/mol (proteolisi, già calibrato in KB §2.4), **senza CTM** → non si azzera a freddo.

#### Formula orologio enzimatico

```javascript
// In tick loop — aggiunta non-distruttiva
const enzRate    = fArrhenius(tDough)             // Ea=47 kJ/mol, già presente
const enzCorr    = enzRate * fPH(currentPH) * fHydration(session.hydration)
const newEnzAdu  = prevEnzAdu + enzCorr * deltaH  // integrale separato

const enzymaticMatPct = gompertz(newEnzAdu, ENZ_MU_MAX, ENZ_LAMBDA, 100)
```

#### Parametri calibrati

Calibrazione: `48h @ 4°C → 85% maturazione enzimatica` (limite reale maturazione fredda):
```javascript
const ENZYMATIC_CLOCK_PARAMS = {
  EaKj:    47,           // Ea proteolisi (KB §2.4 — invariato)
  muMax:   9.50,         // calibrato: gompertz(11.41, 9.50, 0.5, 100) = 85.0% ✓
  lambda:  0.5,          // lag breve (proteolisi inizia quasi subito)
  aduRef:  11.41,        // enzAdu al 85% = fArrhenius(4) × 48 = 0.2377 × 48
};
```

Verifica: `gompertz(11.41, 9.50, 0.5, 100) = 85.00%` ✓

#### Tabella comparativa (calcolata, non solo stimata)

| Temp | Durata | Lievitazione (INVARIATA) | Maturaz. ATTUALE | Maturaz. PROPOSTA |
|------|--------|--------------------------|------------------|-------------------|
| 4°C  | 12h    | 1.9%                     | 1.9%             | **22.7%**         |
| 4°C  | 24h    | 2.1%                     | 2.1%             | **49.2%**         |
| 4°C  | 48h    | 2.5%                     | 2.5%             | **85.0%** ← cal.  |
| 4°C  | 72h    | 2.9%                     | 2.9%             | 96.3%             |
| 12°C | 12h    | 9.5%                     | 9.5%             | 43.2%             |
| 12°C | 24h    | 25.1%                    | 25.1%            | 79.7%             |
| 12°C | 48h    | 62.2%                    | 62.2%            | 98.3%             |
| 22°C | 12h    | **78.4%**                | 78.4%            | **78.6%**  ← ≡    |
| 22°C | 24h    | 98.5%                    | 98.5%            | 98.2%   ← ≡       |

**Impatto sweet spot a TA**: differenza < 0.2% → praticamente invariato. ✓  
**Non modifica CARDINAL_PARAMS, AGENT_GOMPERTZ, kEffective, cardinalCorrection.** ✓

#### Flusso reale utente simulato (proposta two-clock)

Schema: puntata 2h@22°C + staglio 1h@22°C + appretto 48h@4°C + tempering 3h@22°C

| Metrica | Valore | Interpretazione |
|---------|--------|-----------------|
| ADU (lievito) | 4.563 | 40.3% lievitazione |
| enzAdu | 16.36 | **95.6% maturazione** ✓ |

Con 24h TC invece di 48h: lievitazione 38.8%, maturazione **82.1%** (vicino al target 85%) → il pizzaiolo può usare 24h o 48h in base all'effetto desiderato.

**Lettura dello schema reale con two-clock**:
- Lievitazione 40%: il dough ha ancora capacità di produzione gas → "oven spring" garantito. ✓
- Maturazione 95%: proteolisi e amilasi hanno lavorato a lungo → flavor, estensibilità, digeribilità ottimali. ✓
- I due orologi divergono volutamente nelle fasi fredde: è corretto. ✓

#### Impatto su sweet spot alert

Lo sweet spot `alertThreshold` deve passare da `maturationPct ≥ 85` (lievito) a `enzymaticMatPct ≥ 85` (enzimatico) — oppure entrambe con pesi:
```
sweetSpot = enzymaticMatPct >= alertThreshold  // primario
leavening = maturationPct >= 40                // secondario (minimo gas)
```

#### Vincoli rispettati

- CARDINAL_PARAMS, AGENT_GOMPERTZ, kEffective, gompertz: **invariati** ✓
- Sweet spot a TA 22°C: differenza < 0.2% ✓
- Additivo, non sostitutivo: i due orologi coesistono ✓
- Nuovi parametri: solo `ENZYMATIC_CLOCK_PARAMS` (costante) + `enzymaticAdu` / `enzymaticMatPct` in tick state ✓

---

## ASSE 3 — Ora di servizio e ancoraggio sweet spot (design implementativo)

### Stato attuale

`FermentationPlannerView.tsx:569–586`:
- `targetDate` / `targetTime` = ora cottura, passa `hoursUntilBake` a `computeAllProtocols`
- `computeWarmupH(panMassKg, hydration, fridgeT, tAmb)` = tempering fisso (Newton: frigo → 18°C, T_SERVICE hardcoded)
- Non esiste "ora servizio" distinto né durata tempering editabile né puntata fissa

### Design nuovi input

Aggiungere a `FermentationPlannerView` nella sezione "Target cottura":

```typescript
// Nuovo stato — preferenze flusso reale
const [serviceDate,    setServiceDate]    = useState('');
const [serviceTime,    setServiceTime]    = useState('12:00');
const [temperingH,     setTemperingH]     = useState(3.5);  // default utente 3-4h
const [puntataFixedH,  setPuntataFixedH]  = useState(2.0);  // default utente 2h
const [staglioFixedH,  setStaglioFixedH]  = useState(1.0);  // default utente 1h
```

### Catena di ancoraggio a ritroso

```
serviceTime
  └─ totalH     = (serviceTime - now) in ore
  └─ temperingH = input utente (default 3.5h)
  └─ staglioH   = input utente (default 1h)
  └─ puntataH   = input utente (default 2h)
  └─ coldH      = totalH - puntataH - staglioH - temperingH  ← risolto
```

Il `coldH` così calcolato è il parametro `tcHours` del protocollo `tc_appreto`. La formula analitica già esistente risolve la coerenza ADU:

```typescript
// Riutilizzo computeRampAdu esistente (FermentationPlannerView.tsx:132–154)
const rampAdu_service = computeRampAdu(panMassKg, hydration, fridgeT, tAmb,
                                        temperingH, aParams.Ea, agentType, kRef);
const aduNeeded_cold  = Math.max(0.01, aduNeeded - rampAdu_service
                                    - rAmb * (puntataFixedH + staglioFixedH));
const coldH_service   = rFri > 0 ? aduNeeded_cold / rFri : 0;
```

### Gestione tempering editabile

`computeWarmupH` rimane per il calcolo informativo ("durata minima per raggiungere 18°C") ma non governa più il timing del piano. Il parametro `temperingH` dell'utente può essere:
- `< computeWarmupH` → warning "impasto ancora freddo al servizio (T_core < 18°C)"
- `> computeWarmupH` → nota informativa con T_core stimata al servizio

Temperatura cuore al servizio (display informativo):
```typescript
const T_core_at_service = tAmb + (fridgeT - tAmb) * Math.exp(-temperingH * 3600 / tau_sphere);
// Mostrare: "T impasto al servizio: ~{T_core_at_service.toFixed(1)}°C"
```

### Risultato atteso: card "Flusso Reale"

Una nuova card dedicata (sopra le 4 card protocollo esistenti) mostra:

```
┌─────────────────────────────────────────────────────────┐
│  FLUSSO REALE                        ★★★★★  OK         │
│  Puntata 2.0h TA + Staglio 1.0h + Freddo 41.5h + Riscaldo 3.5h │
│  Totale: 48.0h → servizio alle 12:00                    │
│  Al servizio: maturazione ~85%, lievitazione ~40%, T~18°C │
└─────────────────────────────────────────────────────────┘
```

### Persistenza nuovi campi

I campi vanno in `db.ts` (Dexie) nella `Session`, con migrazione di versione:
```typescript
serviceTime?:     Date;    // ora del servizio (distinta da targetBakeAt)
temperingH?:      number;  // ore di tempering pre-servizio
puntataFixedH?:   number;  // puntata TA fissa (schema flusso reale)
staglioFixedH?:   number;  // staglio fisso
```

---

## ASSE 4 — Modalità forward/editabile (design implementativo)

### Toggle Inverso → Manuale

Header della card protocolli:
```tsx
<div style={{ display: 'flex', justifyContent: 'space-between' }}>
  <span>Protocolli ottimali</span>
  <button onClick={() => setForwardMode(m => !m)}>
    {forwardMode ? '← Inverso' : '→ Manuale'}
  </button>
</div>
```

### Modalità manuale: input

```typescript
// Nuovi slider visibili solo in forwardMode
const [manPuntataH, setManPuntataH] = useState(2.0);    // 0.5–12h
const [manStaglioH, setManStaglioH] = useState(1.0);    // 0.25–3h
const [manColdH,    setManColdH]    = useState(24.0);   // 0–72h
const [manTempH,    setManTempH]    = useState(3.5);    // 0–8h
```

Temperature: usano `tAmb` e `fridgeT` già presenti.

### Output forward mode (calcolato in useMemo)

```typescript
const forwardResult = useMemo(() => {
  // ADU per fase
  const aduPuntata  = rAmb * manPuntataH;
  const aduStaglio  = rAmb * manStaglioH;
  const aduCold     = rFri * manColdH;
  const aduRamp     = computeRampAdu(..., manTempH);
  const aduTotal    = initialAdu + aduPuntata + aduStaglio + aduCold + aduRamp;

  const liev = gompertz(aduTotal, muMax, aParams.lambda, 100);
  const mat  = gompertz(enzAduTotal, muMax_enz, lambda_enz, 100);  // orologio 2
  const tCore = tAmb + (fridgeT - tAmb) * exp(-manTempH * 3600 / tau);

  // Sweet spot timing
  const sweetSpotH = /* risolve quando mat >= 85% nell'integrale */ ...;
  const deltaH_vs_service = hoursUntilService - sweetSpotH;

  return { liev, mat, tCore, sweetSpotH, deltaH_vs_service, W_decay };
}, [manPuntataH, manStaglioH, manColdH, manTempH, ...]);
```

### Suggerimento correzione bidirezionale

```typescript
function buildSuggestion(delta: number, rFri: number, manColdH: number): string {
  if (Math.abs(delta) < 0.5) return '✓ sweet spot coincide col servizio';
  if (delta > 0) {
    // sweet spot anticipato rispetto al servizio → dough troppo maturo al servizio
    const newCold = manColdH + delta / rFri;
    if (newCold > manColdH * 1.5)
      return `Aumenta dose oppure posticipa servizio di ${delta.toFixed(1)}h`;
    return `Allunga appretto TC da ${manColdH.toFixed(1)}h a ${newCold.toFixed(1)}h`;
  } else {
    const newCold = Math.max(0, manColdH + delta / rFri);
    return `Riduci appretto TC da ${manColdH.toFixed(1)}h a ${newCold.toFixed(1)}h`;
  }
}
```

### Validazioni non-bloccanti

```typescript
const warnings: string[] = [];
if (assessW(W, manPuntataH, manColdH).viability !== 'ok')
  warnings.push(`W${W}: struttura a rischio — effH = ${effH.toFixed(0)}h`);
if (mat > 98)
  warnings.push('Maturazione >98% — rischio sovrafermentazione');
if (forwardResult.tCore < 15)
  warnings.push(`T impasto al servizio ${forwardResult.tCore.toFixed(1)}°C < 15°C — impasto freddo`);
```

---

## Checklist di intervento prioritizzata

### Subito implementabile (feature/UX — nessuna approvazione scientifica necessaria)

| # | Intervento | Asse | File | Impatto utente |
|---|-----------|------|------|----------------|
| 1 | **Input puntata fissa (default 2h) + staglio (default 1h) + tempering (default 3.5h)** | 3 | FermentationPlannerView.tsx | Abilita flusso reale direttamente |
| 2 | **Card "Flusso Reale" tc_appreto con ancoraggio all'ora di servizio** | 3 | FermentationPlannerView.tsx | Elimina puntata 15h — mostra piano concreto |
| 3 | **Tempering editabile con display T_core al servizio** | 3 | FermentationPlannerView.tsx | Elimina hardcoding 18°C → Newton |
| 4 | **Modalità forward (toggle Inverso/Manuale)** | 4 | FermentationPlannerView.tsx | Permette verifica schema scelto |
| 5 | **Correzione split 65/35** — almeno sostituire con default rispettoso del flusso reale (es. puntata fissa 2h) | 1 | FermentationPlannerView.tsx:204 | Elimina puntata gonfiata |

### Richiede approvazione scientifica (cinetica a freddo)

| # | Intervento | Asse | File | Dipendenze |
|---|-----------|------|------|------------|
| 6 | **Orologio enzimatico**: `ENZYMATIC_CLOCK_PARAMS` + `computeEnzymaticAdu()` | 2 | engine-v2.4.0.js | Approvazione calibrazione |
| 7 | **Tick loop**: secondo orologio `enzymaticAdu` / `enzymaticMatPct` | 2 | useTickEngine.ts | → #6 |
| 8 | **Session + DB**: nuovi campi `enzymaticAdu`, `enzymaticMatPct`, `serviceTime`, `temperingH`, `puntataFixedH` | 2+3 | db.ts | → #6 + #7 |
| 9 | **Dashboard**: mostrare `enzymaticMatPct` accanto a `maturationPct`; sweet spot alert su orologio enzimatico | 2 | DashboardView.tsx | → #7 |
| 10 | **Planner**: integrare orologio enzimatico nella curva forward e nel matAtTarget dei protocolli | 2+4 | FermentationPlannerView.tsx | → #6 |
| 11 | **Test engine**: 6+ asserzioni su `computeEnzymaticAdu` ai valori tabellari | 2 | engine-v2.4.0.test.js | → #6 |

---

## Note tecniche per l'implementazione

### Parametri orologio enzimatico (verificati numericamente)

```javascript
ENZYMATIC_CLOCK_PARAMS = {
  EaKj:    47,      // Ea proteolisi — KB §2.4, già in HILL_W_DECAY.EaProteasiKj
  muMax:   9.50,    // calibrato: gompertz(11.41, 9.50, 0.5, 100) = 85.00% ✓
  lambda:  0.5,     // lag breve
  // enzAdu_85 = fArrhenius(4°C) × 48h = 0.2377 × 48 = 11.41
}
```

### Non duplicare costanti

`EaKj = 47` è già `HILL_W_DECAY.EaProteasiKj`. La funzione `fArrhenius(T)` già lo usa. L'orologio enzimatico riutilizza esattamente questa funzione — nessuna nuova costante di Ea.

### Compatibilità sessioni esistenti

`enzymaticAdu` parte da 0 per le sessioni nuove. Per le sessioni in corso al momento dell'upgrade, `enzymaticAdu = null` → il tick loop lo inizializza a 0 al prossimo tick. Nessuna migrazione dati onerosa.

### Schema display finale raccomandato (dashboard)

```
Lievitazione: 40%  ████░░░░░░  [orologio lievito, governa gas/volume]
Maturazione:  85%  █████████░  [orologio enzimatico, governa flavor/struttura]
                                ← SWEET SPOT RAGGIUNTO ✓
```
