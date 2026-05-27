# PizzaMatrix v2.4.0

Motore di calcolo predittivo per la fermentazione dell'impasto pizza.
React + Vite + Dexie + Recharts + Capacitor Android.

---

## Coefficienti di Attrito Meccanico (§2.7)

### Tabella di Riferimento `KNEADING_METHODS_FRICTION`

Il **coefficiente di attrito C_attrito** rappresenta l'aumento totale di temperatura
dell'impasto dovuto all'energia meccanica dell'impastatrice, in una sessione tipica
da pizzeria (10–15 minuti a regime, 1–5 kg di farina, idratazione 60–70%).

| Metodo di Impasto   | C_attrito min | C_attrito medio | C_attrito max |
|---------------------|:-------------:|:---------------:|:-------------:|
| **A mano**          |      1°C      |      1.5°C      |      2°C      |
| **Spirale**         |     10°C      |      11°C       |     12°C      |
| **Planetaria**      |      8°C      |       9°C       |     10°C      |
| **Bracci tuffanti** |      6°C      |       7°C       |      8°C      |

**Costante TypeScript**: `KNEADING_METHODS_FRICTION` — `src/engine/index.ts`

#### Note tecniche e fonti

- **Calvel R. (1994)** "Le Goût du Pain": formula DDT originale, fattori di attrito per macchina
- **Suas M. (2009)** "Advanced Bread and Pastry" (SFBI): tabella attrito per tipo di impastatrice
- **Giorilli P.** "Il Grande Libro del Pane": valori sperimentali spirale e planetaria
- **Standard AVPN** (Associazione Verace Pizza Napoletana): specifiche per spirale 2ª velocità

**Spirale 10–12°C**: calibrato su 2ª velocità, regime tipico pizzeria napoletana.
A 1ª velocità / uso domestico: 6–8°C (usare variante "Bassa vel." nell'app).

**Planetaria 8–10°C**: valore per gancio (hook). Con frusta a filo aggiungere 1–2°C.

**Bracci tuffanti 6–8°C**: azione gentile che preserva le strutture proteiche del glutine.
Tempi di impasto tipicamente più lunghi (20–30 min).

**A mano 1–2°C**: attrito quasi trascurabile; solo per piccole quantità (<500 g farina).

---

## Calcolo Temperatura Acqua (DDT) — §2.7

### `computeWaterTempDDT(input: WaterTempInput): WaterTempResult`

Calcola la temperatura ottimale dell'acqua per raggiungere la **Temperatura Desiderata
Finale (DDT / TDF)** al termine dell'impastamento.

#### Impasto diretto (3 fattori variabili)

```
T_acqua = DDT × 3 − T_ambiente − T_farina − C_attrito
```

#### Impasto indiretto con pre-impasto (4 fattori variabili)

```
T_acqua = DDT × 4 − T_ambiente − T_farina − T_preimpasto − C_attrito
```

Il numero di fattori (3 o 4) è determinato dalla presenza di `tempPreferment` nell'input.

#### DDT consigliati per stile

| Stile         | DDT target |
|---------------|:----------:|
| Napoletana    |   24°C     |
| Contemporanea |   25°C     |
| Teglia        |   27°C     |
| Pala          |   26°C     |
| NY Style      |   23°C     |

---

## Sostituzione Ghiaccio — Bilancio Entalpico (§2.7)

Se `T_acqua_calc < 3°C` (soglia `ICE_THRESHOLD_C = 3`): il sistema attiva
automaticamente la **modalità ghiaccio** con bilancio entalpico esatto.

### Formula

```
M_ghiaccio = M_acqua_tot × (T_disponibile − T_acqua_calc) / (80 + T_disponibile)
M_liquida  = M_acqua_tot − M_ghiaccio
```

- `T_disponibile` = temperatura acqua corrente disponibile (default 3°C)
- `80 cal/g` = calore latente di fusione del ghiaccio a 0°C (L_fusione ≈ 334 J/g)
- `T_acqua_calc` può essere negativa per condizioni estreme

### Derivazione termodinamica (conservazione energia)

```
Q_ceduto_dall'acqua = Q_assorbito_dal_ghiaccio_che_fonde + Q_riscaldo_acqua_disciolta

(M_acq − M_g) × (T_disp − T_mix) = M_g × 80 + M_g × T_mix    [cp = 1 cal/(g·°C)]
M_acq × (T_disp − T_mix)         = M_g × (T_disp + 80)
M_g = M_acq × (T_disp − T_mix) / (T_disp + 80)               ✓
```

---

## Architettura

```
src/
├── engine/index.ts
│   ├── KNEADING_METHODS_FRICTION    — tabella C_attrito per impastatrice
│   ├── ICE_THRESHOLD_C              — soglia ghiaccio (3°C)
│   ├── computeWaterTempDDT()        — calcolo DDT + bilancio entalpico ghiaccio
│   └── WaterTempInput/WaterTempResult — tipi TypeScript
├── components/
│   ├── tools/WaterTempView.tsx      — 💧 view standalone + WaterTempWidget riusabile
│   ├── wizard/WizardView.tsx        — Step 4: selettore impastatrice; Step 8: widget
│   └── dashboard/DashboardView.tsx  — inerzia termica TA↔TC (ramp sub-segs)
├── context/AppContext.tsx            — WizardDraft.kneadingMethod; AppView 'water_calc'
├── db/db.ts                         — Session.kneadingMethod (persistenza Dexie)
└── hooks/useTickEngine.ts           — setPhase() auto-aggiorna tAmbient (Fix 1 inerzia)
```

## Engine Physics (v2.4.0)

| Modulo | Formula |
|--------|---------|
| Maturazione | Gompertz-Zwietering: `M(ADU) = A·exp(-exp((μmax·e/A)·(λ−ADU)+1))` |
| Lievito | CTM Rosso (1993) × Arrhenius: `kEff(T) = exp[-Ea/R·(1/T−1/Tref)] × γCTM(T)` |
| Inerzia termica | Newton Cooling: `T(t) = T_amb + (T0−T_amb)·exp(-t/τ)` |
| Proteolisi | Hill W: `W(t) = W0/(1+D^n)`, `D = Σ(ΔH/tCrit)` (integrale danno) |
| Temperatura acqua | DDT Balance: `T_acq = DDT×F − T_amb − T_far − [T_pref] − C_att` |
| Ghiaccio | Enthalpy: `M_g = M_acq × (T_av−T_calc) / (80+T_av)` |
