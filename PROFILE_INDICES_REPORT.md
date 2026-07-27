# Profilo Impasto — Diagnosi e Ricalibrazione Indici
## PizzaMatrix v2.4.1 · REPORT (per approvazione prima dell'implementazione)

---

## STEP 1 — Formule esatte attuali

File: `src/components/dashboard/DashboardView.tsx:359–411` — funzione `QualityProfileCard`.

**NOTA PRELIMINARE**: Il dashboard non usa la funzione `computeExtensibilityIndex()` dell'engine (che ha un parametro `maturationPct`). Ha formule proprie, più semplici, completamente slegate dalla fermentazione.

---

### 1.1 — Estensibilità (`ext`)

```typescript
// DashboardView.tsx:368–370
const plScore  = Math.max(0, Math.min(4, (1.2 - pl) / 0.15));  // [0, 4]
const hydBonus = (hyd - 55) / 30;                               // unbounded above
const ext = Math.max(1, Math.min(5, Math.round(plScore + hydBonus)));
```

| Componente | Formula | Range | Peso |
|-----------|---------|-------|------|
| P/L (inverso) | `(1.2 - P/L) / 0.15` clampato [0, 4] | 0 a P/L≥1.2, 4 a P/L≤0.6 | dominante |
| Idratazione | `(hyd - 55) / 30` | 0 a 55%, 0.33 a 65%, 0.67 a 75% | secondario |
| Maturazione | **ASSENTE** | — | 0 |

**Fonte maturazione: (D)** — solo proprietà statiche di farina e idratazione. Nessun dato di fermentazione.

**Punto di valutazione**: indipendente dal tempo/fermentazione — identico all'avvio e al bake.

**Saturazione**: plScore raggiunge il cap 4 per qualunque P/L ≤ 0.60. Con hyd ≥ 70%, hydBonus ≥ 0.50 → `round(4.50) = 5`.

---

### 1.2 — Aromi (`aromaScore`)

```typescript
// DashboardView.tsx:373–381
let aroma = 2.0;                                  // base fissa
prefs.forEach((p) => {
  if (p.type === 'biga')        aroma += 1.5;
  else if (p.type === 'poolish') aroma += 1.0;
  else if (p.type === 'riporto') aroma += 1.2;
});
if (proto === 'tc' || proto === 'tc_puntata' || proto === 'tc_appreto') aroma += 0.5;
if (session.agentType === 'sourdough_wheat') aroma += 0.8;
const aromaScore = Math.max(1, Math.min(5, Math.round(aroma)));
```

| Componente | Valore | Note |
|-----------|--------|------|
| Base | 2.0 | fisso per tutti i diretti |
| Biga | +1.5 | per ogni prefermento biga |
| Poolish | +1.0 | per ogni prefermento poolish |
| Riporto | +1.2 | per ogni riporto |
| Protocollo TC | +0.5 | binario: TC sì/no, nessuna distinzione per durata |
| Sourdough | +0.8 | |
| Maturazione | **ASSENTE** | — |
| Durata TC | **ASSENTE** | 12h TC = 168h TC = stesso +0.5 |

**Fonte maturazione: (D)** — dati statici di protocollo/tipo lievito. La durata TC non influenza il bonus (+0.5 sia a 12h che a 72h). Il tempo accumulato di maturazione non entra mai.

**Punto di valutazione**: indipendente dal tempo/fermentazione — identico all'avvio e al bake.

**Caso diretto TA, no prefs**: aromaScore = round(2.0) = **2** (questo in realtà funziona per caso).

---

### 1.3 — Scioglievolezza (`sciScore`)

```typescript
// DashboardView.tsx:384–388
const styleBonus: Record<string, number> = {
  napoletana: 1.2, contemporanea: 0.8, teglia: 0.4, pala: 0.4, nystyle: -0.2,
};
const sci = 1 + (hyd - 55) / 30 * 1.5 + (350 - W) / 300 * 1.5 + (styleBonus[style] ?? 0);
const sciScore = Math.max(1, Math.min(5, Math.round(sci)));
```

| Componente | Formula | Range | Peso |
|-----------|---------|-------|------|
| Base | 1.0 | fisso | — |
| Idratazione | `(hyd-55)/30 × 1.5` | 0 a 55%, 0.5 a 65%, 1.0 a 75% | 1.5× |
| W (inverso) | `(350-W)/300 × 1.5` | 0.75 a W=350, 1.5 a W=50, -0.75 a W=500 | 1.5× |
| Stile | napoletana→+1.2, cont→+0.8, teglia→+0.4, pala→+0.4, ny→-0.2 | — | — |
| Maturazione | **ASSENTE** | — | 0 |

**Fonte maturazione: (D)** — solo idratazione, W, stile. La formula è **monotona crescente** con la maturazione, ma la maturazione stessa non entra mai.

**Punto di valutazione**: indipendente dal tempo/fermentazione.

---

### 1.4 — Nota su `computeExtensibilityIndex()` (engine)

L'engine ha una funzione separata (KB §15.4) **con** `maturationPct`:

```javascript
// engine-v2.4.0.js:1343–1349
function computeExtensibilityIndex({ W, pl, stability, maturationPct }) {
  const wNorm    = clamp((W - 80) / 320, 0, 1);
  const plNorm   = clamp(1 - Math.abs(pl - 0.65) / 0.70, 0, 1);
  const stabNorm = clamp(stability / 25, 0, 1);
  const matNorm  = clamp(maturationPct / 100, 0, 1);
  return 0.30*wNorm + 0.20*plNorm + 0.30*stabNorm + 0.20*matNorm;
}
```

Questa funzione NON è importata né usata nel dashboard. La `QualityProfileCard` ha formule indipendenti.

---

## STEP 2 — Diagnosi del caso "diretto a TA = 5/5"

**Setup**: napoletana, P/L=0.45, hyd=70%, W₀=310, no prefermenti, IDY, protocollo TA.

### Calcolo Estensibilità attuale

```
plScore  = max(0, min(4, (1.2 - 0.45) / 0.15))
         = max(0, min(4, 0.75/0.15))
         = max(0, min(4, 5.0))
         = 4.0   ← SATURO al cap
hydBonus = (70 - 55) / 30
         = 15/30 = 0.50
ext      = round(4.0 + 0.50) = round(4.50) = 5
```

**→ ext = 5/5 anche se la maturazione è 55%.**

Il bug è a due livelli:
1. `plScore` satura a 4 per qualunque P/L ≤ 0.60 (riguarda praticamente tutte le farine napoletane)
2. `hydBonus` non è clampato superiormente: hyd=70% contribuisce 0.50, spingendo il totale a 4.5 → round → 5
3. **La maturazione realizzata (55%) non entra mai nel calcolo**

### Calcolo Aromi attuale

```
aroma = 2.0 (base fissa — diretto TA, no prefs, IDY)
aromaScore = round(2.0) = 2
```

**→ aroma = 2/5** — per puro caso coincide con l'atteso, ma per ragioni sbagliate. Se aggiungessi un poolish: 3/5 indipendentemente dalla maturazione realizzata.

### Calcolo Scioglievolezza attuale

```
sci = 1 + (70-55)/30*1.5 + (350-310)/300*1.5 + 1.2  (napoletana)
    = 1 + 0.5*1.5 + 0.133*1.5 + 1.2
    = 1 + 0.75 + 0.20 + 1.20
    = 3.15
sciScore = round(3.15) = 3
```

**→ sci = 3/5** — coincide con l'atteso (MEDIA) ma ancora per ragioni sbagliate: identico a un impasto iper-maturato dello stesso tipo.

### Conclusione diagnosi

| Indice | Risultato attuale | Risultato atteso | Causa bug |
|--------|-----------------|-----------------|-----------|
| Estensibilità | **5/5** | 2–3/5 | `plScore` satura → P/L non discrimina; `hydBonus` illimitato; matPct assente |
| Aromi | 2/5 | 2/5 | Coincide per caso (base=2.0 per diretti) |
| Scioglievolezza | 3/5 | 3/5 | Coincide per caso |

**Il bug è strutturale**: tutti e tre gli indici ignorano la maturazione realizzata. Aromi e Scioglievolezza sembrano corretti nel caso A per pura coincidenza numerica, ma sarebbero sbagliati con altri setup (es. aggiungere un poolish senza maturazione → aromi 3/5 anziché 2/5).

---

## STEP 3 — Formule ricalibrate proposte

**Principio unificante**: la maturazione realizzata (`matPct` dal nuovo orologio enzimatico) è il **gate primario**. Le proprietà statiche della farina/ricetta scalano entro questo gate.

**Input aggiunto**: `ts?.maturationPct ?? 0` — orologio enzimatico (two-clock). Il componente `QualityProfileCard` dovrà ricevere `ts` come prop aggiuntiva.

---

### 3.1 — Estensibilità (proposta)

**Fisica**: la proteolisi (maturationPct) rilassa le catene gliadiniche → estensibilità. Senza maturazione, anche una farina a basso P/L rimane tenace.

```
matContrib  = 3.0 × clamp(matPct / 100, 0, 1)       — [0.0, 3.0]
plScore     = clamp((1.2 − P/L) / 0.35, 0.5, 2.0)   — [0.5, 2.0]  (P/L=0.55 → 1.86)
hydScore    = 0.5 + clamp((hyd − 55) / 30, 0, 1.0)  — [0.5, 1.5]  (hyd=65 → 0.83)
flourContr  = (plScore + hydScore) / 2               — [0.5, 1.75]

extRaw = matContrib + flourContr
ext    = round(clamp(extRaw, 1, 5))
```

**Invarianti**:
- A matPct=0%: `extRaw = 0 + flourContr ∈ [0.5, 1.75]` → ext=1
- A matPct=55%: `matContrib=1.65` + `flourContr≈1.35` = 3.00 → **ext=3**
- A matPct=95%: `matContrib=2.85` + `flourContr≈1.35` = 4.20 → **ext=4**
- A matPct=100%+P/L basso+hyd alta: max = 3.0+1.75 = 4.75 → **ext=5** (eccezionale)

Il gate maturationPct garantisce: **a matPct=55% l'estensibilità è al massimo 3** indipendentemente dalla farina.

---

### 3.2 — Aromi (proposta)

**Fisica**: sottoprodotti aromatici (aldeidi, esteri, acidi) si accumulano in funzione di tempo×attività fermentativa. La maturazione lenta a freddo (proteolisi lenta = lunga esposizione) genera più complessità dei diretti caldi.

```
matContrib   = 2.0 × clamp(matPct / 100, 0, 1)               — [0, 2.0]
prefContrib  = per ogni prefermento:
               biga→1.2, poolish→0.8, riporto→0.9, autolisi→0.1
coldContrib  = se (TC && tcHours>8): min(1.0, tcHours / 24)  — [0, 1.0]
               (12h TC → 0.50; 24h → 1.0; 48h → 1.0 clampato)
sdContrib    = sourdough → 0.8, else 0

aromaRaw   = 1.0 + matContrib + prefContrib + coldContrib + sdContrib
aromaScore = round(clamp(aromaRaw, 1, 5))
```

**Nota chiave**: il `coldContrib` scala con `tcHours` (continuo, non binario). 12h TC ≠ 48h TC. Il binario `+0.5 se TC` attuale è eliminato; la durata conta.

**Invarianti**:
- Diretto TA, no prefs, matPct=55%: `1.0 + 1.10 + 0 + 0 + 0 = 2.10` → **aroma=2** ✓
- TC 48h, no prefs, matPct=95%: `1.0 + 1.90 + 0 + 1.0 + 0 = 3.90` → **aroma=4** ✓
- TC 48h + biga 30%, matPct=95%: `1.0 + 1.90 + 1.2 + 1.0 + 0 = 5.10` → capped **5** ✓
- Sourdough TC 48h, matPct=95%: `1.0 + 1.90 + 0 + 1.0 + 0.8 = 4.70` → **5** ✓

---

### 3.3 — Scioglievolezza (proposta)

**Fisica**: la scioglievolezza ha un **optimum** alla maturazione ottimale (~85-90%). Sotto-maturato = pesante/gommoso; over-maturato = W collassato = impasto gommoso. La curva è non-monotona.

```
m        = clamp(matPct / 100, 0, 1)
sciMat   = 1 − (m − 0.87)² / 0.25         — bell con picco a 87%, larghezza σ²=0.25
           clampato [0, 1]
           (m=0.55 → 0.486; m=0.87 → 1.0; m=0.95 → 0.974; m=1.1 → 0.887)

hydBonus = clamp((hyd − 55) / 50, 0, 0.8) — 0.2 a hyd=65; 0.4 a hyd=75

amylBonus = min(0.4, max(0, (effectiveAmylaseIndex − 1.0) × 0.4))
            (FN basso → alta amylaseIdx → più zuccheri → Maillard → crumb leggero)

styleSci  = napoletana→0.3, contemporanea→0.2, teglia→0.0, pala→0.1, nystyle→−0.2

sciRaw   = 1 + 3.0 × sciMat + hydBonus + amylBonus + styleSci
sciScore = round(clamp(sciRaw, 1, 5))
```

**Invarianti**:
- matPct=55%: `sciMat=0.486`; hyd=65, nap: `1 + 3×0.486 + 0.2 + 0 + 0.3 = 2.96` → **sci=3** ✓
- matPct=95%: `sciMat=0.974`; hyd=65, nap: `1 + 3×0.974 + 0.2 + 0 + 0.3 = 4.42` → **sci=4** ✓
- matPct=87% (optimum): `sciMat=1.0`; hyd=65, nap: `1 + 3.0 + 0.2 + 0 + 0.3 = 4.5` → **sci=5** o **4-5** ✓
- Over-maturato matPct=120%: `sciMat=1-(1.2-0.87)²/0.25=1-0.436=0.564` → `1+1.69+0.2+0+0.3=3.19` → **sci=3** ✓ (cala)

---

## STEP 4 — Validazione ancore empiriche

### Setup casi

| Param | Caso A | Caso B |
|-------|--------|--------|
| Protocollo | Diretto TA | 2h TA + 1h staglio + 48h TC@4.5°C + 3h tempering |
| matPct (realizzata) | 55% | 95% |
| P/L | 0.45 | 0.45 |
| hyd | 70% | 70% |
| W₀ | 310 | 310 |
| Stile | napoletana | napoletana |
| Prefermenti | nessuno | nessuno |
| Agente | IDY | IDY |
| tcHours | 0 | 48 |

### Calcoli — Estensibilità

| Formula | Caso A (55%) | Caso B (95%) |
|---------|-------------|-------------|
| **Attuale** | plScore=4 (sat), hydBonus=0.5 → `round(4.5)` = **5** ❌ | plScore=4, hydBonus=0.5 → **5** |
| **Proposta** | matContrib=1.65, plScore=1.71, hydScore=1.00, flourContr=1.36 → `round(3.01)` = **3** ✓ | matContrib=2.85, stessa flour → `round(4.21)` = **4** ✓ |

Calcolo proposta Caso A (dettaglio):
```
matContrib = 3.0×0.55 = 1.65
plScore    = (1.2−0.45)/0.35 = 2.14 → clamped 2.0
hydScore   = 0.5 + (70−55)/30 = 0.5+0.5 = 1.0
flourContr = (2.0+1.0)/2 = 1.5
extRaw     = 1.65 + 1.5 = 3.15 → ext=3 ✓
```

### Calcoli — Aromi

| Formula | Caso A (55%, TA) | Caso B (95%, TC 48h) |
|---------|-----------------|----------------------|
| **Attuale** | base=2.0, no prefs, no TC → `round(2.0)` = **2** (caso fortuito) | base=2.0 + TC=0.5 → **3** (sbagliato: 48h TC → TC binario = 12h TC) |
| **Proposta** | 1+1.10+0+0+0=2.10 → **2** ✓ | 1+1.90+0+min(1.0,48/24)+0=3.90 → **4** ✓ |

### Calcoli — Scioglievolezza

| Formula | Caso A (55%) | Caso B (95%) |
|---------|-------------|-------------|
| **Attuale** | hyd=70→1.5×0.5=0.75, W=310→(350-310)/300×1.5=0.2, nap=1.2; sci=1+0.75+0.2+1.2=3.15 → **3** (caso fortuito) | **identico 3** — maturazione non entra! ❌ |
| **Proposta** | sciMat=0.486, hydBonus=0.3, styleSci=0.3; 1+1.46+0.3+0+0.3=3.06 → **3** ✓ | sciMat=0.974, hydBonus=0.3; 1+2.92+0.3+0+0.3=4.52 → **5** ✓ |

### Tabella riassuntiva before/after

| Indice | Caso A attuale | **Caso A proposta** | Caso B attuale | **Caso B proposta** |
|--------|--------------|-------------------|----------------|-------------------|
| Estensibilità | 5 ❌ | **3** ✓ | 5 | **4** ✓ |
| Aromi | 2 (fortuito) | **2** ✓ | 3 (sbagliato: ≠ durata) | **4** ✓ |
| Scioglievolezza | 3 (fortuito) | **3** ✓ | 3 (identico al Caso A) ❌ | **5** ✓ |

**Differenza tra protocolli** (Caso A vs B): attuale = nessuna differenza in scioglievolezza, solo +0.5 in aromi (TC binario). Proposta: estensibilità +1, aromi +2, scioglievolezza +2. Il protocollo lungo a freddo ora si distingue nettamente.

---

## Call-site per la patch (nessun fix parziale)

| File | Linea | Cosa cambia |
|------|-------|------------|
| `DashboardView.tsx:359` | `QualityProfileCard({ session })` | Aggiungere `ts` come prop: `QualityProfileCard({ session, ts })` |
| `DashboardView.tsx:368–388` | formule `ext`, `aromaScore`, `sciScore` | Sostituire con le formule proposte |
| `DashboardView.tsx:882` | `<QualityProfileCard session={session} />` | Cambiare in `<QualityProfileCard session={session} ts={ts} />` |

Non ci sono altri call-site che leggono `ext`/`aromaScore`/`sciScore` — i valori calcolati non sono esposti fuori dalla card.

La funzione engine `computeExtensibilityIndex` (line 1343) non è usata nel dashboard e non va modificata.

---

## Riepilogo decisioni da approvare

1. **Gate maturationPct**: usare `ts?.maturationPct ?? 0` (orologio enzimatico) come driver principale per tutti e tre gli indici. Da 0% a 100% di matPct l'indice cresce monotonamente, con eccezione scioglievolezza (non-monotona, picco a ~87%).

2. **Estensibilità**: formula `matContrib + flourContr` dove `matContrib = 3×matPct/100`. Max 3 punti da matPct (su 5 totali). La proprietà farina (P/L, hyd) contribuisce max 1.75 punti aggiuntivi.

3. **Aromi**: formula cumulativa con `tcHours` continuo (non binario). La durata del freddo ora scala linearmente fino a 24h, poi plateau.

4. **Scioglievolezza**: curva a campana centrata su 87%, larghezza σ²=0.25. Questo modella la non-monotonia: over-maturazione → scioglievolezza cala.

5. **Nessuna modifica** ai parametri del modello lievitazione/maturazione (two-clock). Solo il calcolo degli indici cambia.

6. **Amylase bonus per scioglievolezza**: piccolo bonus (`effectiveAmylaseIndex − 1.0) × 0.4`, massimo 0.4) per FN basso → più zuccheri fermentescibili → crumb più leggero. Opzionale: può essere omesso se si preferisce semplicità.

---

*Attendere conferma della logica prima dell'implementazione.*
